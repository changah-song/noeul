#!/usr/bin/env python3
"""
Build a standalone offline Chinese character decomposition database.

Inputs:
  - scripts/dictionary.txt
  - scripts/kangxi_radicals.csv
  - scripts/kangxi_radical_forms.csv

Outputs:
  - frontend/assets/data/zh_characters.db
  - frontend/assets/data/zh_characters_manifest.json
"""

from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"
OUTPUT_DIR = ROOT_DIR / "frontend" / "assets" / "data"

MMAH_PATH = SCRIPTS_DIR / "dictionary.txt"
RADICALS_CSV_PATH = SCRIPTS_DIR / "kangxi_radicals.csv"
RADICAL_FORMS_CSV_PATH = SCRIPTS_DIR / "kangxi_radical_forms.csv"
DB_PATH = OUTPUT_DIR / "zh_characters.db"
MANIFEST_PATH = OUTPUT_DIR / "zh_characters_manifest.json"

RADICAL_COLUMNS = {"radical_number", "canonical_radical", "english_name", "korean_name"}
RADICAL_FORM_COLUMNS = {"form", "radical_number"}


def require_input(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing required input file: {path}")


def normalize_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def nullable_string(value: Any) -> str | None:
    normalized = normalize_string(value)
    return normalized or None


def parse_radical_number(value: Any, *, path: Path, row_number: int) -> int:
    raw = normalize_string(value)
    try:
        radical_number = int(raw)
    except ValueError as error:
        raise ValueError(
            f"{path} row {row_number}: radical_number must be an integer, got {raw!r}"
        ) from error

    if radical_number < 1 or radical_number > 214:
        raise ValueError(
            f"{path} row {row_number}: radical_number must be between 1 and 214"
        )

    return radical_number


def validate_columns(path: Path, fieldnames: list[str] | None, required: set[str]) -> None:
    fields = set(fieldnames or [])
    missing = required - fields
    if missing:
        raise ValueError(f"{path} is missing required columns: {sorted(missing)}")


def load_radicals(path: Path) -> list[tuple[int, str, str | None, str | None]]:
    rows: list[tuple[int, str, str | None, str | None]] = []
    seen_numbers: set[int] = set()

    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        validate_columns(path, reader.fieldnames, RADICAL_COLUMNS)

        for row_number, row in enumerate(reader, start=2):
            radical_number = parse_radical_number(
                row.get("radical_number"),
                path=path,
                row_number=row_number,
            )
            canonical_radical = normalize_string(row.get("canonical_radical"))
            if not canonical_radical:
                raise ValueError(f"{path} row {row_number}: canonical_radical is required")
            if radical_number in seen_numbers:
                raise ValueError(f"{path} row {row_number}: duplicate radical_number {radical_number}")

            seen_numbers.add(radical_number)
            rows.append(
                (
                    radical_number,
                    canonical_radical,
                    nullable_string(row.get("english_name")),
                    nullable_string(row.get("korean_name")),
                )
            )

    missing_numbers = [number for number in range(1, 215) if number not in seen_numbers]
    if missing_numbers:
        raise ValueError(f"{path} must include all 214 radicals; missing: {missing_numbers[:20]}")

    return sorted(rows, key=lambda row: row[0])


def load_radical_forms(path: Path) -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    seen_pairs: set[tuple[str, int]] = set()
    radical_numbers: set[int] = set()

    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        validate_columns(path, reader.fieldnames, RADICAL_FORM_COLUMNS)

        for row_number, row in enumerate(reader, start=2):
            form = normalize_string(row.get("form"))
            if not form:
                raise ValueError(f"{path} row {row_number}: form is required")

            radical_number = parse_radical_number(
                row.get("radical_number"),
                path=path,
                row_number=row_number,
            )
            pair = (form, radical_number)
            if pair in seen_pairs:
                raise ValueError(
                    f"{path} row {row_number}: duplicate form/radical pair "
                    f"{form!r}/{radical_number}"
                )

            seen_pairs.add(pair)
            radical_numbers.add(radical_number)
            rows.append((form, radical_number))

    missing_numbers = [number for number in range(1, 215) if number not in radical_numbers]
    if missing_numbers:
        raise ValueError(
            f"{path} must map at least one form for every Kangxi radical; "
            f"missing radical numbers: {missing_numbers[:20]}"
        )

    return sorted(rows, key=lambda row: (row[1], row[0]))


def load_zh_characters(path: Path) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    seen_characters: set[str] = set()

    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            stripped = line.strip()
            if not stripped:
                continue

            try:
                data = json.loads(stripped)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path} line {line_number}: invalid JSON") from error

            character = normalize_string(data.get("character"))
            if not character:
                raise ValueError(f"{path} line {line_number}: character is required")
            if character in seen_characters:
                raise ValueError(f"{path} line {line_number}: duplicate character {character!r}")
            seen_characters.add(character)

            etymology = data.get("etymology") or {}
            if not isinstance(etymology, dict):
                raise ValueError(f"{path} line {line_number}: etymology must be an object or null")

            rows.append(
                (
                    character,
                    nullable_string(data.get("definition")),
                    json.dumps(data.get("pinyin") or [], ensure_ascii=False, separators=(",", ":")),
                    nullable_string(data.get("decomposition")),
                    nullable_string(data.get("radical")),
                    nullable_string(etymology.get("type")),
                    nullable_string(etymology.get("semantic")),
                    nullable_string(etymology.get("phonetic")),
                    nullable_string(etymology.get("hint")),
                    json.dumps(data.get("matches") or [], ensure_ascii=False, separators=(",", ":")),
                )
            )

    if not rows:
        raise ValueError(f"{path} did not contain any Chinese character rows")

    return sorted(rows, key=lambda row: row[0])


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;
        PRAGMA encoding = 'UTF-8';

        CREATE TABLE zh_characters (
          character TEXT PRIMARY KEY,
          definition TEXT,
          pinyin_json TEXT,
          decomposition TEXT,
          radical TEXT,
          etymology_type TEXT,
          semantic TEXT,
          phonetic TEXT,
          hint TEXT,
          matches_json TEXT
        );

        CREATE TABLE kangxi_radicals (
          radical_number INTEGER PRIMARY KEY,
          canonical_radical TEXT NOT NULL,
          english_name TEXT,
          korean_name TEXT
        );

        CREATE TABLE kangxi_radical_forms (
          form TEXT NOT NULL,
          radical_number INTEGER NOT NULL,
          PRIMARY KEY (form, radical_number),
          FOREIGN KEY (radical_number) REFERENCES kangxi_radicals(radical_number) ON DELETE CASCADE
        );

        CREATE INDEX idx_zh_characters_phonetic ON zh_characters(phonetic);
        CREATE INDEX idx_zh_characters_semantic ON zh_characters(semantic);
        CREATE INDEX idx_zh_characters_radical ON zh_characters(radical);
        CREATE INDEX idx_kangxi_radical_forms_number ON kangxi_radical_forms(radical_number);
        """
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_database(
    character_rows: list[tuple[Any, ...]],
    radical_rows: list[tuple[int, str, str | None, str | None]],
    radical_form_rows: list[tuple[str, int]],
) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        create_schema(conn)
        conn.executemany(
            """
            INSERT INTO kangxi_radicals
              (radical_number, canonical_radical, english_name, korean_name)
            VALUES (?, ?, ?, ?)
            """,
            radical_rows,
        )
        conn.executemany(
            """
            INSERT INTO kangxi_radical_forms (form, radical_number)
            VALUES (?, ?)
            """,
            radical_form_rows,
        )
        conn.executemany(
            """
            INSERT INTO zh_characters
              (character, definition, pinyin_json, decomposition, radical,
               etymology_type, semantic, phonetic, hint, matches_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            character_rows,
        )
        conn.commit()
        conn.execute("VACUUM")


def write_manifest(
    *,
    character_count: int,
    radical_count: int,
    radical_form_count: int,
) -> None:
    db_size = DB_PATH.stat().st_size
    db_sha256 = sha256_file(DB_PATH)
    manifest = {
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "content_version": f"{db_sha256}:{db_size}",
        "database_sha256": db_sha256,
        "database_size_bytes": db_size,
        "inputs": {
            "dictionary": str(MMAH_PATH.relative_to(ROOT_DIR)),
            "kangxi_radicals": str(RADICALS_CSV_PATH.relative_to(ROOT_DIR)),
            "kangxi_radical_forms": str(RADICAL_FORMS_CSV_PATH.relative_to(ROOT_DIR)),
        },
        "outputs": {
            "database": str(DB_PATH.relative_to(ROOT_DIR)),
        },
        "counts": {
            "characters": character_count,
            "kangxi_radicals": radical_count,
            "kangxi_radical_forms": radical_form_count,
        },
    }

    with MANIFEST_PATH.open("w", encoding="utf-8") as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)
        file.write("\n")


def smoke_test() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        sample = conn.execute(
            """
            SELECT c.character, c.pinyin_json, c.decomposition, c.semantic, c.phonetic,
                   kr.canonical_radical, kr.english_name, kr.korean_name
            FROM zh_characters c
            LEFT JOIN kangxi_radical_forms rf ON rf.form = c.semantic
            LEFT JOIN kangxi_radicals kr ON kr.radical_number = rf.radical_number
            WHERE c.character = ?
            """,
            ("想",),
        ).fetchone()

    print("Smoke test")
    print(f"  想: {json.dumps(dict(sample) if sample else None, ensure_ascii=False)}")


def main() -> None:
    for path in (MMAH_PATH, RADICALS_CSV_PATH, RADICAL_FORMS_CSV_PATH):
        require_input(path)

    radical_rows = load_radicals(RADICALS_CSV_PATH)
    radical_form_rows = load_radical_forms(RADICAL_FORMS_CSV_PATH)
    character_rows = load_zh_characters(MMAH_PATH)

    build_database(character_rows, radical_rows, radical_form_rows)
    write_manifest(
        character_count=len(character_rows),
        radical_count=len(radical_rows),
        radical_form_count=len(radical_form_rows),
    )

    print("Build summary")
    print(f"  character rows: {len(character_rows)}")
    print(f"  Kangxi radical rows: {len(radical_rows)}")
    print(f"  Kangxi radical form rows: {len(radical_form_rows)}")
    print(f"  database: {DB_PATH}")
    print(f"  manifest: {MANIFEST_PATH}")
    smoke_test()


if __name__ == "__main__":
    main()
