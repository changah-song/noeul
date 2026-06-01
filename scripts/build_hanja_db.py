#!/usr/bin/env python3
"""
Build a local SQLite Hanja database from frozen JSON artifacts.

Inputs:
  - scripts/hanja_translated.json
  - scripts/hanja_words.json

Output:
  - frontend/assets/data/hanja.db
  - frontend/assets/data/hanja_manifest.json
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"
OUTPUT_DIR = ROOT_DIR / "frontend" / "assets" / "data"

CHARACTERS_PATH = SCRIPTS_DIR / "hanja_translated.json"
WORDS_PATH = SCRIPTS_DIR / "hanja_words.json"
DB_PATH = OUTPUT_DIR / "hanja.db"
MANIFEST_PATH = OUTPUT_DIR / "hanja_manifest.json"

CHARACTER_REQUIRED_KEYS = {
    "character",
    "eum",
    "hun_korean",
    "hun_english",
}
WORD_REQUIRED_KEYS = {
    "id",
    "hangul",
    "hanja",
    "definition_korean",
    "definition_english",
    "pos",
}


def is_cjk(char: str) -> bool:
    codepoint = ord(char)
    return (
        0x3400 <= codepoint <= 0x4DBF
        or 0x4E00 <= codepoint <= 0x9FFF
        or 0xF900 <= codepoint <= 0xFAFF
        or 0x20000 <= codepoint <= 0x2A6DF
        or 0x2A700 <= codepoint <= 0x2B73F
        or 0x2B740 <= codepoint <= 0x2B81F
        or 0x2B820 <= codepoint <= 0x2CEAF
        or 0x2CEB0 <= codepoint <= 0x2EBEF
        or 0x30000 <= codepoint <= 0x3134F
    )


def is_hangul_syllable(char: str) -> bool:
    return 0xAC00 <= ord(char) <= 0xD7A3


def normalize_string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def nullable_string(value: Any) -> str | None:
    normalized = normalize_string(value)
    return normalized or None


def load_json_rows(path: Path, required_keys: set[str], label: str) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"Missing required {label} input file: {path}")

    with path.open("r", encoding="utf-8") as file:
        rows = json.load(file)

    if not isinstance(rows, list):
        raise ValueError(f"{path} must contain a JSON array")

    malformed = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            malformed.append((index, "not an object"))
            continue

        missing = required_keys - set(row)
        if missing:
            malformed.append((index, f"missing keys: {sorted(missing)}"))

    if malformed:
        preview = ", ".join(
            f"row {index}: {problem}" for index, problem in malformed[:5]
        )
        raise ValueError(f"{path} has malformed {label} rows: {preview}")

    return rows


def duplicate_extra_count(values: list[Any]) -> int:
    return sum(count - 1 for count in Counter(values).values() if count > 1)


def duplicate_keys(values: list[Any]) -> list[Any]:
    counts = Counter(values)
    return [value for value, count in counts.items() if count > 1]


def normalize_character_rows(rows: list[dict[str, Any]]) -> list[tuple[str, str, str, str | None]]:
    normalized = []
    for index, row in enumerate(rows):
        character = normalize_string(row["character"])
        eum = normalize_string(row["eum"])
        hun_korean = normalize_string(row["hun_korean"])
        hun_english = nullable_string(row.get("hun_english"))

        if not character or not eum or not hun_korean:
            raise ValueError(
                "Malformed character row "
                f"{index}: character, eum, and hun_korean must be non-empty"
            )

        normalized.append((character, eum, hun_korean, hun_english))

    duplicate_character_keys = duplicate_keys(
        [(character, eum) for character, eum, _, _ in normalized]
    )
    if duplicate_character_keys:
        preview = ", ".join(
            f"{character}/{eum}" for character, eum in duplicate_character_keys[:10]
        )
        raise ValueError(
            "Duplicate character primary keys found in hanja_translated.json: "
            f"{preview}"
        )

    return sorted(
        normalized,
        key=lambda row: (
            row[0],
            row[1],
            row[2],
            row[3] or "",
        ),
    )


def normalize_word_rows(
    rows: list[dict[str, Any]],
) -> tuple[list[tuple[str, str, str | None, str | None, str | None, str | None]], int]:
    normalized = []
    skipped_count = 0

    for row in rows:
        word_id = normalize_string(row["id"])
        hangul = normalize_string(row["hangul"])
        if not word_id or not hangul:
            skipped_count += 1
            continue

        normalized.append(
            (
                word_id,
                hangul,
                nullable_string(row.get("hanja")),
                nullable_string(row.get("definition_korean")),
                nullable_string(row.get("definition_english")),
                nullable_string(row.get("pos")),
                nullable_string(row.get("word_grade")),
            )
        )

    duplicate_word_ids = duplicate_keys([row[0] for row in normalized])
    if duplicate_word_ids:
        preview = ", ".join(str(word_id) for word_id in duplicate_word_ids[:10])
        raise ValueError(f"Duplicate word ids found in hanja_words.json: {preview}")

    return (
        sorted(
            normalized,
            key=lambda row: (
                row[1],
                row[2] or "",
                row[0],
            ),
        ),
        skipped_count,
    )


def extract_cjk_chars(value: str | None) -> list[str]:
    if not value:
        return []
    return [char for char in value if is_cjk(char)]


def extract_hangul_syllables(value: str) -> list[str]:
    return [char for char in value if is_hangul_syllable(char)]


def build_join_rows(
    word_rows: list[tuple[str, str, str | None, str | None, str | None, str | None]],
) -> list[tuple[str, str, int, str | None]]:
    join_rows = []
    for word_id, hangul, hanja, _, _, _, _ in word_rows:
        hanja_chars = extract_cjk_chars(hanja)
        hangul_syllables = extract_hangul_syllables(hangul)
        for char_index, character in enumerate(hanja_chars):
            eum = (
                hangul_syllables[char_index]
                if char_index < len(hangul_syllables)
                else None
            )
            join_rows.append((word_id, character, char_index, eum))

    return join_rows


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;
        PRAGMA encoding = 'UTF-8';

        CREATE TABLE hanja_characters (
          character TEXT NOT NULL,
          eum TEXT NOT NULL,
          hun_korean TEXT NOT NULL,
          hun_english TEXT,
          PRIMARY KEY (character, eum)
        );

        CREATE TABLE hanja_words (
          id TEXT PRIMARY KEY,
          hangul TEXT NOT NULL,
          hanja TEXT,
          definition_korean TEXT,
          definition_english TEXT,
          pos TEXT,
          word_grade TEXT
        );

        CREATE TABLE hanja_word_characters (
          word_id TEXT NOT NULL,
          character TEXT NOT NULL,
          char_index INTEGER NOT NULL,
          eum TEXT,
          PRIMARY KEY (word_id, character, char_index),
          FOREIGN KEY (word_id) REFERENCES hanja_words(id)
        );

        CREATE INDEX idx_hanja_words_hangul ON hanja_words(hangul);
        CREATE INDEX idx_hanja_words_hanja ON hanja_words(hanja);
        CREATE INDEX idx_hanja_characters_character ON hanja_characters(character);
        CREATE INDEX idx_hanja_word_characters_character ON hanja_word_characters(character);
        CREATE INDEX idx_hanja_word_characters_word_id ON hanja_word_characters(word_id);
        """
    )


def build_database(
    character_rows: list[tuple[str, str, str, str | None]],
    word_rows: list[tuple[str, str, str | None, str | None, str | None, str | None]],
    join_rows: list[tuple[str, str, int, str | None]],
) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if DB_PATH.exists():
        DB_PATH.unlink()

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        create_schema(conn)
        conn.executemany(
            """
            INSERT INTO hanja_characters
              (character, eum, hun_korean, hun_english)
            VALUES (?, ?, ?, ?)
            """,
            character_rows,
        )
        conn.executemany(
            """
            INSERT INTO hanja_words
              (id, hangul, hanja, definition_korean, definition_english, pos, word_grade)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            word_rows,
        )
        conn.executemany(
            """
            INSERT INTO hanja_word_characters
              (word_id, character, char_index, eum)
            VALUES (?, ?, ?, ?)
            """,
            join_rows,
        )
        conn.commit()
        conn.execute("VACUUM")


def fetch_rows(
    conn: sqlite3.Connection,
    query: str,
    params: tuple[Any, ...] = (),
) -> list[dict[str, Any]]:
    cursor = conn.execute(query, params)
    return [dict(row) for row in cursor.fetchall()]


def print_sample(title: str, rows: list[dict[str, Any]]) -> None:
    print(f"  {title}:")
    if not rows:
        print("    []")
        return

    for row in rows:
        print(f"    {json.dumps(row, ensure_ascii=False)}")


def smoke_test() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        word_sample_label = "word 강수"
        word_sample = fetch_rows(
            conn,
            """
            SELECT id, hangul, hanja, pos
            FROM hanja_words
            WHERE hangul = ?
            ORDER BY hanja, id
            LIMIT 5
            """,
            ("강수",),
        )
        if not word_sample:
            word_sample_label = "word 가가호호"
            word_sample = fetch_rows(
                conn,
                """
                SELECT id, hangul, hanja, pos
                FROM hanja_words
                WHERE hangul = ?
                ORDER BY hanja, id
                LIMIT 5
                """,
                ("가가호호",),
            )

        character_sample = fetch_rows(
            conn,
            """
            SELECT character, eum, hun_korean, hun_english
            FROM hanja_characters
            WHERE character = ?
            ORDER BY eum
            LIMIT 5
            """,
            ("家",),
        )
        related_word_sample = fetch_rows(
            conn,
            """
            SELECT w.id, w.hangul, w.hanja, wc.char_index, wc.eum
            FROM hanja_word_characters wc
            JOIN hanja_words w ON w.id = wc.word_id
            WHERE wc.character = ?
            ORDER BY w.hangul, w.hanja, w.id, wc.char_index
            LIMIT 5
            """,
            ("家",),
        )

    print("\nSmoke tests")
    print_sample(word_sample_label, word_sample)
    print_sample("character 家", character_sample)
    print_sample("related words for 家", related_word_sample)


def write_manifest(
    character_count: int,
    word_count: int,
    join_count: int,
    words_with_hanja_count: int,
    skipped_word_count: int,
) -> None:
    manifest = {
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "inputs": {
            "characters": "scripts/hanja_translated.json",
            "words": "scripts/hanja_words.json",
        },
        "outputs": {
            "database": "frontend/assets/data/hanja.db",
        },
        "counts": {
            "characters": character_count,
            "words": word_count,
            "word_characters": join_count,
            "words_with_hanja": words_with_hanja_count,
            "skipped_words_missing_id_or_hangul": skipped_word_count,
        },
        "db_file_size_bytes": DB_PATH.stat().st_size,
    }

    with MANIFEST_PATH.open("w", encoding="utf-8") as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main() -> None:
    raw_character_rows = load_json_rows(
        CHARACTERS_PATH,
        CHARACTER_REQUIRED_KEYS,
        "character",
    )
    raw_word_rows = load_json_rows(WORDS_PATH, WORD_REQUIRED_KEYS, "word")

    duplicate_character_count = duplicate_extra_count(
        [
            (normalize_string(row["character"]), normalize_string(row["eum"]))
            for row in raw_character_rows
        ]
    )
    duplicate_word_id_count = duplicate_extra_count(
        [
            normalize_string(row["id"])
            for row in raw_word_rows
            if normalize_string(row["id"])
        ]
    )

    character_rows = normalize_character_rows(raw_character_rows)
    word_rows, skipped_word_count = normalize_word_rows(raw_word_rows)
    join_rows = build_join_rows(word_rows)
    words_with_hanja_count = sum(1 for row in word_rows if extract_cjk_chars(row[2]))

    build_database(character_rows, word_rows, join_rows)
    write_manifest(
        len(character_rows),
        len(word_rows),
        len(join_rows),
        words_with_hanja_count,
        skipped_word_count,
    )

    print("Build summary")
    print(f"  character rows: {len(character_rows)}")
    print(f"  word rows: {len(word_rows)}")
    print(f"  join rows: {len(join_rows)}")
    print(f"  duplicate character (character, eum) rows: {duplicate_character_count}")
    print(f"  duplicate word ids: {duplicate_word_id_count}")
    print(f"  words with real Hanja: {words_with_hanja_count}")
    print(f"  skipped words missing id or hangul: {skipped_word_count}")
    print(f"\nWrote {DB_PATH}")
    print(f"Wrote {MANIFEST_PATH}")

    smoke_test()


if __name__ == "__main__":
    main()
