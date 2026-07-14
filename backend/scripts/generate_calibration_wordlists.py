#!/usr/bin/env python3
"""Generate the bundled calibration-quiz wordlists from proficiency_levels.db.

The cold-start calibration quiz ("check the words you know") shows the reader a
stratified sample of graded words and turns each know / don't-know tap into an
online IRT update (frontend/services/Database.js `updateThetaFromOutcome`).
The on-device dictionary_cache only has ranks for words the reader has already
looked up, so the quiz pool has to ship with the app.

Output: frontend/assets/data/calibration/words.generated.json
  { "<language>": { "system": "...", "bands": { "<rank>": ["word", ...] } } }

Sampling is seeded so re-runs are deterministic (diffs stay reviewable).

Run: backend/venv/bin/python backend/scripts/generate_calibration_wordlists.py
"""

from __future__ import annotations

import json
import random
import re
import sqlite3
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BACKEND_DIR / "proficiency_levels.db"
OUTPUT_PATH = (
    BACKEND_DIR.parent
    / "frontend"
    / "assets"
    / "data"
    / "calibration"
    / "words.generated.json"
)

WORDS_PER_BAND = 40
SEED = 20260712

# Quiz words must be self-contained, recognizable citation forms: no affixes
# ("-가"), no multi-word phrases, no annotation characters.
HANGUL_WORD = re.compile(r"^[가-힣]{1,6}$")
HANZI_WORD = re.compile(r"^[一-鿿]{1,4}$")
LATIN_WORD = re.compile(r"^[a-z]{2,16}$")


def sample_band(rng: random.Random, words: list[str], count: int) -> list[str]:
    unique = sorted(set(words))
    if len(unique) <= count:
        return unique
    return sorted(rng.sample(unique, count))


def korean_bands(conn: sqlite3.Connection, rng: random.Random) -> dict[str, list[str]]:
    bands: dict[str, list[str]] = {}
    for rank in (1, 2, 3):
        rows = conn.execute(
            "SELECT term FROM korean_nikl_vocab WHERE level_rank = ?", (rank,)
        ).fetchall()
        words = [row[0] for row in rows if HANGUL_WORD.fullmatch(row[0] or "")]
        bands[str(rank)] = sample_band(rng, words, WORDS_PER_BAND)
    return bands


def chinese_bands(conn: sqlite3.Connection, rng: random.Random) -> dict[str, list[str]]:
    bands: dict[str, list[str]] = {}
    for rank in range(1, 8):
        rows = conn.execute(
            """
            SELECT simplified FROM chinese_hsk
            WHERE level_rank = ? AND script = 'simplified'
            """,
            (rank,),
        ).fetchall()
        words = [row[0] for row in rows if HANZI_WORD.fullmatch(row[0] or "")]
        bands[str(rank)] = sample_band(rng, words, WORDS_PER_BAND)
    return bands


def english_bands(conn: sqlite3.Connection, rng: random.Random) -> dict[str, list[str]]:
    bands: dict[str, list[str]] = {}
    for rank in range(1, 7):
        rows = conn.execute(
            "SELECT DISTINCT word FROM english_cefr WHERE level_rank = ?", (rank,)
        ).fetchall()
        words = [row[0] for row in rows if LATIN_WORD.fullmatch(row[0] or "")]
        bands[str(rank)] = sample_band(rng, words, WORDS_PER_BAND)
    return bands


def generate() -> dict:
    conn = sqlite3.connect(DB_PATH)
    try:
        rng = random.Random(SEED)
        return {
            "ko": {"system": "NIKL", "bands": korean_bands(conn, rng)},
            "zh": {"system": "HSK", "bands": chinese_bands(conn, rng)},
            "en": {"system": "CEFR", "bands": english_bands(conn, rng)},
        }
    finally:
        conn.close()


if __name__ == "__main__":
    wordlists = generate()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(wordlists, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    for language, payload in wordlists.items():
        counts = {rank: len(words) for rank, words in payload["bands"].items()}
        print(f"{language} ({payload['system']}): {counts}")
    print(f"\nwrote → {OUTPUT_PATH}")
