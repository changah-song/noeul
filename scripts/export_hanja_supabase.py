#!/usr/bin/env python3
"""
Export the Supabase hanja_words table into a deterministic local JSON artifact.

This freezes the current remote word dataset next to the existing local
character dataset in scripts/hanja_translated.json.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client


ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ENV_PATH = ROOT_DIR / "backend" / ".env"

CHARACTERS_PATH = SCRIPT_DIR / "hanja_translated.json"
WORDS_PATH = SCRIPT_DIR / "hanja_words.json"
MANIFEST_PATH = SCRIPT_DIR / "hanja_dataset_manifest.json"

BATCH_SIZE = 1000
WORD_COLUMNS = [
    "id",
    "hangul",
    "hanja",
    "definition_korean",
    "definition_english",
    "pos",
    "word_grade",
]
CHARACTER_REQUIRED_KEYS = {
    "character",
    "hun_korean",
    "eum",
    "hun_english",
}
WORD_REQUIRED_KEYS = set(WORD_COLUMNS)


def contains_hanja(value: str | None) -> bool:
    if not value:
        return False

    return any(
        ("\u3400" <= char <= "\u4dbf")
        or ("\u4e00" <= char <= "\u9fff")
        or ("\uf900" <= char <= "\ufaff")
        for char in value
    )


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def load_json_rows(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as file:
        rows = json.load(file)

    if not isinstance(rows, list):
        raise ValueError(f"{path} must contain a JSON array")
    if not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"{path} must contain only JSON objects")

    return rows


def validate_required_keys(
    rows: list[dict[str, Any]],
    required_keys: set[str],
    label: str,
    path: Path,
) -> None:
    missing = [
        (index, sorted(required_keys - set(row)))
        for index, row in enumerate(rows)
        if required_keys - set(row)
    ]
    if missing:
        preview = ", ".join(
            f"row {index}: {keys}" for index, keys in missing[:5]
        )
        raise ValueError(
            f"{path} has {len(missing)} {label} rows missing required keys: {preview}"
        )


def deterministic_word_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered_rows = [
        {column: row.get(column, "") for column in WORD_COLUMNS}
        for row in rows
    ]
    return sorted(
        ordered_rows,
        key=lambda row: (
            str(row.get("hangul") or ""),
            str(row.get("hanja") or ""),
            str(row.get("id") or ""),
        ),
    )


def fetch_hanja_words() -> list[dict[str, Any]]:
    load_dotenv(BACKEND_ENV_PATH)

    supabase_url = require_env("SUPABASE_URL")
    supabase_key = require_env("SUPABASE_KEY")
    supabase = create_client(supabase_url, supabase_key)

    rows: list[dict[str, Any]] = []
    offset = 0

    while True:
        response = (
            supabase.table("hanja_words")
            .select(",".join(WORD_COLUMNS))
            .order("id")
            .range(offset, offset + BATCH_SIZE - 1)
            .execute()
        )
        batch = response.data or []
        rows.extend(batch)
        print(f"Fetched {len(rows)} hanja_words rows...")

        if len(batch) < BATCH_SIZE:
            break
        offset += BATCH_SIZE

    return deterministic_word_rows(rows)


def duplicate_extra_count(values: list[Any]) -> int:
    return sum(count - 1 for count in Counter(values).values() if count > 1)


def build_manifest(
    character_rows: list[dict[str, Any]],
    word_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    duplicate_id_count = duplicate_extra_count(
        [row.get("id") for row in word_rows if row.get("id")]
    )
    duplicate_pair_count = duplicate_extra_count(
        [
            (row.get("hangul"), row.get("hanja"))
            for row in word_rows
            if row.get("hangul") or row.get("hanja")
        ]
    )
    words_with_hanja_count = sum(
        1 for row in word_rows if contains_hanja(row.get("hanja"))
    )

    return {
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "characters_count": len(character_rows),
        "words_count": len(word_rows),
        "words_with_hanja_count": words_with_hanja_count,
        "duplicate_id_count": duplicate_id_count,
        "duplicate_hangul_hanja_pair_count": duplicate_pair_count,
        "source": {
            "characters": "scripts/hanja_translated.json",
            "words": "supabase.hanja_words",
        },
    }


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main() -> None:
    character_rows = load_json_rows(CHARACTERS_PATH)
    validate_required_keys(
        character_rows,
        CHARACTER_REQUIRED_KEYS,
        "character",
        CHARACTERS_PATH,
    )

    word_rows = fetch_hanja_words()
    validate_required_keys(word_rows, WORD_REQUIRED_KEYS, "word", WORDS_PATH)

    write_json(WORDS_PATH, word_rows)

    manifest = build_manifest(character_rows, word_rows)
    write_json(MANIFEST_PATH, manifest)

    print("\nValidation summary")
    print(f"  character rows: {manifest['characters_count']}")
    print(f"  word rows: {manifest['words_count']}")
    print(f"  word rows with Hanja chars: {manifest['words_with_hanja_count']}")
    print(f"  duplicate ids: {manifest['duplicate_id_count']}")
    print(
        "  duplicate (hangul, hanja) pairs: "
        f"{manifest['duplicate_hangul_hanja_pair_count']}"
    )
    print(f"\nWrote {WORDS_PATH}")
    print(f"Wrote {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
