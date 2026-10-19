"""Per-word features for the app's difficulty model: how common a word is
(Zipf) and, for Korean, whether it is a loanword. Read from the word_features
table in proficiency_levels.db (scripts/import_word_features.py) and attached
to preprocessing results by main.py.

Kept out of main.py so it can be tested without the server's dependencies.
"""
from __future__ import annotations

import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proficiency_levels.db")
BATCH_SIZE = 500


def _unique(values) -> list[str]:
    seen: dict[str, None] = {}
    for value in values or []:
        if isinstance(value, str) and value.strip():
            seen.setdefault(value.strip(), None)
    return list(seen)


def lookup_word_features(language: str, terms: list[str], db_path: str = DB_PATH) -> dict[str, dict]:
    """{term: {"zipf": float | None, "loanword": bool}}. Empty when the table
    or the database is missing."""
    normalized = _unique(terms)
    if not normalized or not os.path.exists(db_path):
        return {}
    features: dict[str, dict] = {}
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return {}
    try:
        for start in range(0, len(normalized), BATCH_SIZE):
            batch = normalized[start:start + BATCH_SIZE]
            placeholders = ",".join(["?"] * len(batch))
            for term, zipf, loanword in conn.execute(
                f"SELECT term, zipf, loanword FROM word_features WHERE language = ? AND term IN ({placeholders})",
                [language, *batch],
            ).fetchall():
                features[term] = {"zipf": zipf, "loanword": bool(loanword)}
    except sqlite3.Error as exc:
        # An older proficiency_levels.db without the table.
        print(f"[word_features] unavailable: {exc}")
        return {}
    finally:
        conn.close()
    return features


def attach_word_features(language: str, entries: list[dict]) -> list[dict]:
    """Add zipf / loanword to each entry by its stem, falling back to its surface."""
    keys = [
        (entry.get("stem") or entry.get("surface") or "").strip()
        for entry in entries
        if isinstance(entry, dict)
    ]
    features = lookup_word_features(language, keys)
    if not features:
        return entries
    out = []
    for entry in entries:
        if not isinstance(entry, dict):
            out.append(entry)
            continue
        found = features.get((entry.get("stem") or "").strip()) or features.get((entry.get("surface") or "").strip())
        out.append({**entry, **found} if found else entry)
    return out
