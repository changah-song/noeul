#!/usr/bin/env python3
"""Build the compact proficiency-level lookup database used by preprocessing.

The raw sources are intentionally not loaded by the app at runtime:

* English CEFR source: legacy Excel workbook with Word / Part of Speech / CEFR.
* Chinese HSK source: JSON entries with simplified, forms.traditional, and level tags.
* Korean source: bundled hanja.db rows with hangul and NIKL-style word_grade.

This script extracts only the lookup data the backend needs and writes a small
SQLite database. It is safe to rerun; the output database is rebuilt atomically.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

try:
    import xlrd
except ImportError as exc:  # pragma: no cover - dependency hint for CLI users
    raise SystemExit(
        "Missing dependency: xlrd. Install backend requirements or run "
        "`python -m pip install xlrd>=2.0,<3`."
    ) from exc


CEFR_RANKS = {
    "A1": 1,
    "A2": 2,
    "B1": 3,
    "B2": 4,
    "C1": 5,
    "C2": 6,
}

KOREAN_GRADE_RANKS = {
    "초급": 1,
    "중급": 2,
    "고급": 3,
}

EN_POS_MAP = {
    "abbreviation": "X",
    "adjective": "ADJ",
    "adverb": "ADV",
    "conjunction": "CONJ",
    "determiner": "DET",
    "exclamation": "INTJ",
    "miscellaneous": "X",
    "modal verb": "AUX",
    "noun": "NOUN",
    "number": "NUM",
    "preposition": "ADP",
    "pronoun": "PRON",
    "verb": "VERB",
}


def normalize_text(value: Any) -> str:
    raw = "" if value is None else str(value)
    normalized = unicodedata.normalize("NFKC", raw)
    normalized = normalized.replace("’", "'").replace("‘", "'").replace("`", "'")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def normalize_word(value: Any) -> str:
    return normalize_text(value).lower()


def normalize_cefr(value: Any) -> str | None:
    level = normalize_text(value)
    level = level.replace("“", "").replace("”", "").replace('"', "").replace("'", "")
    level = level.upper()
    return level if level in CEFR_RANKS else None


def normalize_en_pos(value: Any) -> tuple[str, str]:
    source_pos = normalize_text(value)
    normalized = EN_POS_MAP.get(source_pos.lower(), "")
    return normalized, source_pos


def is_valid_en_word(word: str) -> bool:
    # Keep single terms and phrases from the source. Filter empty/system rows only.
    return bool(word and any("a" <= char <= "z" for char in word))


def update_easiest(
    store: dict[Any, tuple[str, int, dict[str, Any]]],
    key: Any,
    level: str,
    payload: dict[str, Any],
) -> bool:
    rank = CEFR_RANKS[level] if level in CEFR_RANKS else int(level)
    existing = store.get(key)
    if existing is None or rank < existing[1]:
        store[key] = (level, rank, payload)
        return True
    return False


def load_english_rows(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_index(0)
    headers = [normalize_text(sheet.cell_value(0, col)) for col in range(sheet.ncols)]
    header_index = {header: index for index, header in enumerate(headers)}

    required = {"Word", "Part of Speech", "CEFR"}
    missing = sorted(required - set(header_index))
    if missing:
        raise ValueError(f"English workbook missing required columns: {', '.join(missing)}")

    word_pos_rows: dict[tuple[str, str], tuple[str, int, dict[str, Any]]] = {}
    fallback_rows: dict[str, tuple[str, int, dict[str, Any]]] = {}
    ignored_rows = 0
    duplicate_word_pos_conflicts = 0

    for row_idx in range(1, sheet.nrows):
        word = normalize_word(sheet.cell_value(row_idx, header_index["Word"]))
        level = normalize_cefr(sheet.cell_value(row_idx, header_index["CEFR"]))
        pos, source_pos = normalize_en_pos(sheet.cell_value(row_idx, header_index["Part of Speech"]))

        if not is_valid_en_word(word) or level is None:
            ignored_rows += 1
            continue

        payload = {
            "word": word,
            "pos": pos,
            "source_pos": source_pos,
            "cefr_level": level,
            "level_rank": CEFR_RANKS[level],
        }
        key = (word, pos)
        if key in word_pos_rows and word_pos_rows[key][0] != level:
            duplicate_word_pos_conflicts += 1
        update_easiest(word_pos_rows, key, level, payload)
        update_easiest(fallback_rows, word, level, payload)

    english_rows = [
        {
            "word": key[0],
            "pos": key[1],
            "source_pos": payload["source_pos"],
            "cefr_level": level,
            "level_rank": rank,
        }
        for key, (level, rank, payload) in sorted(word_pos_rows.items())
    ]
    english_fallback_rows = [
        {
            "word": word,
            "cefr_level": level,
            "level_rank": rank,
        }
        for word, (level, rank, _payload) in sorted(fallback_rows.items())
    ]

    stats = {
        "english_source_rows": sheet.nrows - 1,
        "english_rows": len(english_rows),
        "english_fallback_rows": len(english_fallback_rows),
        "english_ignored_rows": ignored_rows,
        "english_duplicate_word_pos_conflicts": duplicate_word_pos_conflicts,
    }
    return english_rows, english_fallback_rows, stats


def hsk_new_level(entry: dict[str, Any]) -> int | None:
    levels = entry.get("level") or []
    matched: list[int] = []
    for tag in levels:
        match = re.fullmatch(r"new-(\d+)", normalize_text(tag))
        if match:
            matched.append(int(match.group(1)))
    return min(matched) if matched else None


def add_hsk_lookup(
    rows_by_term: dict[str, dict[str, Any]],
    *,
    term: str,
    simplified: str,
    script: str,
    hsk_level: int,
) -> bool:
    if not term:
        return False

    candidate = {
        "term": term,
        "simplified": simplified,
        "script": script,
        "hsk_level": hsk_level,
        "level_rank": hsk_level,
        "hsk_system": "new",
    }
    existing = rows_by_term.get(term)
    if existing is None or hsk_level < existing["hsk_level"]:
        rows_by_term[term] = candidate
        return True
    return False


def load_hsk_rows(path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("HSK source must be a JSON list")

    rows_by_term: dict[str, dict[str, Any]] = {}
    source_entries_with_new = 0
    skipped_without_new = 0
    traditional_terms_added = 0
    term_conflicts = 0

    for entry in data:
        if not isinstance(entry, dict):
            continue

        simplified = normalize_text(entry.get("simplified"))
        level = hsk_new_level(entry)
        if not simplified or level is None:
            skipped_without_new += 1
            continue

        source_entries_with_new += 1
        before = rows_by_term.get(simplified)
        add_hsk_lookup(
            rows_by_term,
            term=simplified,
            simplified=simplified,
            script="simplified",
            hsk_level=level,
        )
        if before and before["simplified"] != simplified:
            term_conflicts += 1

        for form in entry.get("forms") or []:
            if not isinstance(form, dict):
                continue
            traditional = normalize_text(form.get("traditional"))
            if not traditional or traditional == simplified:
                continue

            before = rows_by_term.get(traditional)
            changed = add_hsk_lookup(
                rows_by_term,
                term=traditional,
                simplified=simplified,
                script="traditional",
                hsk_level=level,
            )
            if changed:
                traditional_terms_added += 1
            if before and before["simplified"] != simplified:
                term_conflicts += 1

    rows = sorted(rows_by_term.values(), key=lambda row: (row["hsk_level"], row["term"]))
    stats = {
        "hsk_source_entries": len(data),
        "hsk_source_entries_with_new": source_entries_with_new,
        "hsk_skipped_without_new": skipped_without_new,
        "hsk_lookup_rows": len(rows),
        "hsk_traditional_terms_added": traditional_terms_added,
        "hsk_term_conflicts": term_conflicts,
    }
    return rows, stats


def load_korean_rows(path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT hangul, word_grade
            FROM hanja_words
            WHERE word_grade IN ('초급', '중급', '고급')
              AND TRIM(hangul) <> ''
            """
        ).fetchall()
    finally:
        conn.close()

    rows_by_term: dict[str, dict[str, Any]] = {}
    ignored_rows = 0
    grade_conflicts = 0

    for row in rows:
        term = normalize_text(row["hangul"])
        grade = normalize_text(row["word_grade"])
        rank = KOREAN_GRADE_RANKS.get(grade)
        if not term or rank is None:
            ignored_rows += 1
            continue

        existing = rows_by_term.get(term)
        if existing and existing["nikl_grade"] != grade:
            grade_conflicts += 1
        if existing is None or rank < existing["level_rank"]:
            rows_by_term[term] = {
                "term": term,
                "nikl_grade": grade,
                "level_rank": rank,
            }

    korean_rows = sorted(rows_by_term.values(), key=lambda row: (row["level_rank"], row["term"]))
    stats = {
        "korean_source_rows": len(rows),
        "korean_lookup_rows": len(korean_rows),
        "korean_ignored_rows": ignored_rows,
        "korean_grade_conflicts": grade_conflicts,
    }
    return korean_rows, stats


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = OFF;

        DROP TABLE IF EXISTS metadata;
        DROP TABLE IF EXISTS english_cefr;
        DROP TABLE IF EXISTS english_cefr_fallback;
        DROP TABLE IF EXISTS chinese_hsk;
        DROP TABLE IF EXISTS korean_nikl_vocab;

        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE english_cefr (
          word TEXT NOT NULL,
          pos TEXT NOT NULL DEFAULT '',
          source_pos TEXT,
          cefr_level TEXT NOT NULL,
          level_rank INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'en_m3',
          PRIMARY KEY (word, pos)
        );

        CREATE INDEX idx_english_cefr_word
          ON english_cefr(word);

        CREATE TABLE english_cefr_fallback (
          word TEXT PRIMARY KEY,
          cefr_level TEXT NOT NULL,
          level_rank INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'en_m3'
        );

        CREATE TABLE chinese_hsk (
          term TEXT NOT NULL,
          simplified TEXT NOT NULL,
          script TEXT NOT NULL CHECK(script IN ('simplified', 'traditional')),
          hsk_level INTEGER NOT NULL,
          level_rank INTEGER NOT NULL,
          hsk_system TEXT NOT NULL DEFAULT 'new',
          PRIMARY KEY (term, hsk_system)
        );

        CREATE INDEX idx_chinese_hsk_simplified
          ON chinese_hsk(simplified);

        CREATE INDEX idx_chinese_hsk_level
          ON chinese_hsk(hsk_system, hsk_level);

        CREATE TABLE korean_nikl_vocab (
          term TEXT PRIMARY KEY,
          nikl_grade TEXT NOT NULL CHECK(nikl_grade IN ('초급', '중급', '고급')),
          level_rank INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'nikl_graded_vocab'
        );

        CREATE INDEX idx_korean_nikl_vocab_level
          ON korean_nikl_vocab(level_rank);
        """
    )


def write_database(
    output_path: Path,
    english_rows: list[dict[str, Any]],
    english_fallback_rows: list[dict[str, Any]],
    hsk_rows: list[dict[str, Any]],
    korean_rows: list[dict[str, Any]],
    metadata: dict[str, Any],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
    try:
        create_schema(conn)
        conn.executemany(
            """
            INSERT INTO english_cefr (word, pos, source_pos, cefr_level, level_rank)
            VALUES (:word, :pos, :source_pos, :cefr_level, :level_rank)
            """,
            english_rows,
        )
        conn.executemany(
            """
            INSERT INTO english_cefr_fallback (word, cefr_level, level_rank)
            VALUES (:word, :cefr_level, :level_rank)
            """,
            english_fallback_rows,
        )
        conn.executemany(
            """
            INSERT INTO chinese_hsk (term, simplified, script, hsk_level, level_rank, hsk_system)
            VALUES (:term, :simplified, :script, :hsk_level, :level_rank, :hsk_system)
            """,
            hsk_rows,
        )
        conn.executemany(
            """
            INSERT INTO korean_nikl_vocab (term, nikl_grade, level_rank)
            VALUES (:term, :nikl_grade, :level_rank)
            """,
            korean_rows,
        )
        conn.executemany(
            "INSERT INTO metadata (key, value) VALUES (?, ?)",
            [(key, json.dumps(value, ensure_ascii=False, sort_keys=True)) for key, value in metadata.items()],
        )
        conn.execute("PRAGMA user_version = 2")
        conn.commit()
    finally:
        conn.close()

    os.replace(tmp_path, output_path)


def level_distribution(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts = Counter(str(row[field]) for row in rows)
    return dict(sorted(counts.items(), key=lambda item: item[0]))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--english-xls",
        type=Path,
        required=True,
        help="Path to en_m3.xls",
    )
    parser.add_argument(
        "--hsk-json",
        type=Path,
        required=True,
        help="Path to HSK vocab.json",
    )
    parser.add_argument(
        "--korean-hanja-db",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "frontend" / "assets" / "data" / "hanja.db",
        help="Path to bundled hanja.db containing NIKL-style word_grade values",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "proficiency_levels.db",
        help="Output SQLite database path",
    )
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> int:
    args = parse_args()
    english_path = args.english_xls.expanduser().resolve()
    hsk_path = args.hsk_json.expanduser().resolve()
    korean_path = args.korean_hanja_db.expanduser().resolve()
    output_path = args.output.expanduser().resolve()

    if not english_path.exists():
        raise FileNotFoundError(english_path)
    if not hsk_path.exists():
        raise FileNotFoundError(hsk_path)
    if not korean_path.exists():
        raise FileNotFoundError(korean_path)

    english_rows, english_fallback_rows, english_stats = load_english_rows(english_path)
    hsk_rows, hsk_stats = load_hsk_rows(hsk_path)
    korean_rows, korean_stats = load_korean_rows(korean_path)

    metadata = {
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "schema_version": 2,
        "english_source_file": english_path.name,
        "english_source_sha256": file_sha256(english_path),
        "hsk_source_file": hsk_path.name,
        "hsk_source_sha256": file_sha256(hsk_path),
        "hsk_system": "new",
        "korean_source_file": korean_path.name,
        "korean_source_sha256": file_sha256(korean_path),
        "korean_system": "nikl_graded_vocab",
        "english_stats": english_stats,
        "hsk_stats": hsk_stats,
        "korean_stats": korean_stats,
        "english_cefr_distribution": level_distribution(english_rows, "cefr_level"),
        "english_fallback_distribution": level_distribution(english_fallback_rows, "cefr_level"),
        "hsk_lookup_distribution": level_distribution(hsk_rows, "hsk_level"),
        "korean_lookup_distribution": level_distribution(korean_rows, "nikl_grade"),
    }

    write_database(output_path, english_rows, english_fallback_rows, hsk_rows, korean_rows, metadata)

    print(f"Wrote {output_path}")
    for key in (
        "english_rows",
        "english_fallback_rows",
        "hsk_lookup_rows",
        "hsk_source_entries_with_new",
        "hsk_traditional_terms_added",
        "korean_lookup_rows",
        "korean_grade_conflicts",
    ):
        print(f"{key}: {english_stats.get(key, hsk_stats.get(key, korean_stats.get(key)))}")
    print(f"english_cefr_distribution: {metadata['english_cefr_distribution']}")
    print(f"hsk_lookup_distribution: {metadata['hsk_lookup_distribution']}")
    print(f"korean_lookup_distribution: {metadata['korean_lookup_distribution']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
