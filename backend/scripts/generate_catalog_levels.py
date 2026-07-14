#!/usr/bin/env python3
"""Regenerate the bundled public-domain catalog's book levels WITH band distributions.

Why: the shipped PUBLIC_DOMAIN_LEVELS in
frontend/assets/data/public-domain/catalog.js were estimated from a 100-word
sample and store only the single 80th-percentile band. The reading-ease
estimate (frontend/services/bookEase.js `bookEaseFromDistribution`) needs the
full per-band histogram — and with only 3 NIKL bands, the single band collapses
every Korean book to one of three ease values.

This script runs the SAME pipeline the backend uses for chapter preprocessing
(kiwipiepy for Korean, jieba for Chinese, proficiency_levels.db for the graded
bands, `score_vocabulary_level` for the payload shape) over the FULL bundled
text of every catalog book, and writes
frontend/assets/data/public-domain/levels.generated.json keyed by catalog id.

Run from the backend venv (kiwipiepy + jieba required):

    backend/venv/bin/python backend/scripts/generate_catalog_levels.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
PUBLIC_DOMAIN_DIR = REPO_ROOT / "frontend" / "assets" / "data" / "public-domain"
CATALOG_PATH = PUBLIC_DOMAIN_DIR / "catalog.js"
BOOKS_DIR = PUBLIC_DOMAIN_DIR / "books"
OUTPUT_PATH = PUBLIC_DOMAIN_DIR / "levels.generated.json"

sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402  (the backend module; imports FastAPI app but doesn't serve)

# Matches one book object in the catalog's BOOKS array. Field order is stable
# (id … language … textAsset), and every bundled book has a textAsset.
BOOK_PATTERN = re.compile(
    r"id:\s*'(?P<id>[^']+)'"
    r"[\s\S]*?language:\s*'(?P<language>ko|zh|en)'"
    r"[\s\S]*?textAsset:\s*require\('\./books/(?P<file>[^']+)'\)",
)


def extract_stems(language: str, text: str) -> list[str]:
    if language == "ko":
        stems, _surface_index, _pos = main.extract_ko_lookup_tokens(text)
        return stems
    if language == "zh":
        words, _surface_index, _pos = main.extract_zh_lookup_tokens_with_jieba(text)
        return words
    raise ValueError(f"unsupported catalog language: {language}")


def lookup_levels(language: str, stems: list[str]) -> dict[str, dict]:
    if language == "ko":
        return main.lookup_korean_nikl_levels(stems)
    if language == "zh":
        return main.lookup_chinese_hsk_levels(stems)
    raise ValueError(f"unsupported catalog language: {language}")


def generate() -> dict[str, dict]:
    catalog_source = CATALOG_PATH.read_text(encoding="utf-8")
    books = [match.groupdict() for match in BOOK_PATTERN.finditer(catalog_source)]
    if not books:
        raise SystemExit(f"no books with textAsset found in {CATALOG_PATH}")

    levels_by_id: dict[str, dict] = {}
    for book in books:
        book_id = book["id"]
        language = book["language"]
        text_path = BOOKS_DIR / book["file"]
        if not text_path.exists():
            print(f"[skip] {book_id}: missing text file {text_path.name}")
            continue

        text = text_path.read_text(encoding="utf-8")
        stems = extract_stems(language, text)
        levels = lookup_levels(language, stems)
        # One entry per unique content word; unmatched words count as unknown
        # (they lower coverage but stay out of the distribution, mirroring the
        # on-device accumulator).
        entries = [levels.get(stem) or {} for stem in stems]
        payload = main.score_vocabulary_level(
            language,
            entries,
            sample_size=max(len(entries), 1),
        )
        levels_by_id[book_id] = payload
        print(
            f"[ok] {book_id}: {payload['level']} (rank {payload['level_rank']}), "
            f"{payload['matched_count']}/{payload['sample_size']} matched "
            f"(coverage {payload['coverage']}), "
            f"distribution {[(row['rank'], row['count']) for row in payload['distribution']]}"
        )

    return levels_by_id


if __name__ == "__main__":
    levels = generate()
    OUTPUT_PATH.write_text(
        json.dumps(levels, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"\nwrote {len(levels)} book levels → {OUTPUT_PATH}")
