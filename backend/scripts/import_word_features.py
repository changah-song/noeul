"""Add per-word features for the difficulty model to proficiency_levels.db.

The levels (Noeul reading levels, KRDICT grades, HSK) put a word in one of a
few bands, so every word in a band looks equally hard. Two features split the
bands:

- zipf: how common the word is, on the Zipf scale (log10 of uses per billion
  words; ~7 for the most common words, ~3 for rare ones), from wordfreq.
  Korean wordfreq counts morphemes, so a verb or adjective (먹다) is counted
  by its stem (먹), and a 하다/되다 verb by its noun (공부하다 -> 공부) a little
  lower. Chinese counts whole words.
- loanword (Korean only): KRDICT gives a loanword's origin in Latin letters
  (컴퓨터 <- computer). Loanwords are spelled out in Hangul, so a learner can
  sound them out and often recognise them; Chinese loanwords are written with
  characters picked for their sound and get no such flag.

Rows cover the graded words, the dictionary headwords and wordfreq's own list,
so a book word missing from the levels still gets a frequency.

Usage (wordfreq is not a backend dependency):
  python3 -m pip install --target /tmp/vocablibs wordfreq
  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/import_word_features.py
"""
from __future__ import annotations

import math
import os
import re
import sqlite3
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BACKEND, "proficiency_levels.db")
KO_DICT = os.path.join(BACKEND, "ko_dict.db")
ZH_DICT = os.path.join(BACKEND, "zh_dict.db")

HANGUL = re.compile(r"^[가-힣]+$")
HAN = re.compile(r"^[一-鿿]{1,6}$")
LATIN = re.compile(r"[A-Za-z]")
# A 하다/되다 verb is a little rarer than its noun.
LIGHT_VERB_SUFFIXES = ("하다", "되다", "시키다", "스럽다", "롭다")
LIGHT_VERB_PENALTY = 0.3
# Chinese words rarer than this are left out; the reader treats a missing
# frequency as rare anyway.
ZH_MIN_ZIPF = 2.0

SCHEMA = """
DROP TABLE IF EXISTS word_features;
CREATE TABLE word_features (
    language TEXT NOT NULL,
    term     TEXT NOT NULL,
    zipf     REAL,
    loanword INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (language, term)
);
"""


def zipf_of(freq: float | None) -> float | None:
    if not freq or freq <= 0:
        return None
    return round(math.log10(freq) + 9, 2)


def korean_zipf(term: str, freqs: dict[str, float]) -> float | None:
    if term in freqs:
        return zipf_of(freqs[term])
    for suffix in LIGHT_VERB_SUFFIXES:
        base = term[: -len(suffix)]
        if term.endswith(suffix) and base in freqs:
            value = zipf_of(freqs[base])
            return None if value is None else round(value - LIGHT_VERB_PENALTY, 2)
    if term.endswith("다") and len(term) > 1 and term[:-1] in freqs:
        return zipf_of(freqs[term[:-1]])
    return None


def korean_rows(freqs: dict[str, float]) -> list[tuple]:
    terms: set[str] = {t for t in freqs if HANGUL.match(t)}
    loanwords: set[str] = set()
    with sqlite3.connect(DB_PATH) as levels:
        terms.update(t for (t,) in levels.execute("SELECT term FROM korean_nikl_vocab"))
        terms.update(t for (t,) in levels.execute("SELECT term FROM korean_krdict_grades"))
    if os.path.exists(KO_DICT):
        with sqlite3.connect(KO_DICT) as ko:
            for stem, origin in ko.execute("SELECT stem, hanja FROM ko_dictionary"):
                if not stem:
                    continue
                terms.add(stem)
                if origin and LATIN.search(origin):
                    loanwords.add(stem)
    rows = []
    for term in sorted(terms):
        if not HANGUL.match(term):
            continue
        zipf = korean_zipf(term, freqs)
        loan = 1 if term in loanwords else 0
        if zipf is None and not loan:
            continue
        rows.append(("ko", term, zipf, loan))
    return rows


def chinese_rows(freqs: dict[str, float]) -> list[tuple]:
    terms: set[str] = {t for t in freqs if HAN.match(t)}
    with sqlite3.connect(DB_PATH) as levels:
        terms.update(t for (t,) in levels.execute("SELECT term FROM chinese_hsk"))
    rows = []
    for term in sorted(terms):
        zipf = zipf_of(freqs.get(term))
        if zipf is None or zipf < ZH_MIN_ZIPF:
            continue
        rows.append(("zh", term, zipf, 0))
    return rows


def main() -> None:
    try:
        from wordfreq import get_frequency_dict
    except ModuleNotFoundError:
        sys.exit(
            "wordfreq not importable. Install it, e.g.:\n"
            "  python3 -m pip install --target /tmp/vocablibs wordfreq\n"
            "  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/import_word_features.py"
        )
    rows = korean_rows(get_frequency_dict("ko")) + chinese_rows(get_frequency_dict("zh"))
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT OR REPLACE INTO word_features (language, term, zipf, loanword) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()
    for language in ("ko", "zh"):
        subset = [r for r in rows if r[0] == language]
        print(f"{language}: {len(subset)} terms, {sum(r[3] for r in subset)} loanwords")


if __name__ == "__main__":
    main()
