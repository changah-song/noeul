#!/usr/bin/env python3
"""Generate the bundled Korean vocabulary-size tiers for the Profile level grid.

The Profile screen gauges a reader's Korean level with a frequency-tier grid
(rows: "know the ~100 most common words", "~300", "~700" ...). The reader taps
the last row where they know ALL the words; that pick seeds their ability
`theta`. This script builds the data that grid renders and the theta each tier
maps to.

Two data sources are combined:

  * Word ordering / commonness — the `wordfreq` package's Korean frequency list
    (bundled offline, built from subtitles / wikipedia / news). Its raw tokens
    are morpheme-level and noisy (particles, conjugation endings), so we...
  * ...intersect them with the NIKL graded vocabulary in proficiency_levels.db.
    That leaves only real dictionary words AND gives every word its NIKL band,
    which is what lets us compute a theta on the app's NIKL-anchored ability
    axis (frontend/services/abilityModel.js: band1 -> -3, band2 -> 0, band3 -> +3).

theta bridge — "reader knows the top-N most frequent words" is treated as
"reader knows the N easiest graded words" (frequency ~ difficulty). N maps to a
continuous frontier rank r via the cumulative NIKL band boundaries, then to
theta via the same rankToScale the rest of the model uses:

    G <= C1            : r = 1 + 0.5 * (G / C1)
    C1 < G <= C2       : r = 1.5 + (G - C1) / (C2 - C1)
    C2 < G <= C3       : r = 2.5 + 0.5 * (G - C2) / (C3 - C2)
    theta = -3 + (r - 1) * 3            (clamped to [-3, 3])

So knowing all of band1 (and no more) lands mid-way between the beginner and
intermediate seeds, etc. — a conservative cold-start prior, refined later by
reading behavior.

Output: frontend/assets/data/vocab-size/ko.generated.json
  { "ko": { "system": "frequency", "total": <int>,
            "tiers": [ { "threshold": 100, "theta": -2.86, "words": [...] }, ... ] } }

Run (wordfreq must be importable):
  python3 -m pip install --target /tmp/vocablibs wordfreq
  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/generate_vocab_size_tiers.py
"""

from __future__ import annotations

import json
import random
import re
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BACKEND_DIR / "proficiency_levels.db"
OUTPUT_PATH = (
    BACKEND_DIR.parent
    / "frontend"
    / "assets"
    / "data"
    / "vocab-size"
    / "ko.generated.json"
)

# Frequency-rank boundaries shown as grid rows (cumulative "top-N words"), echoing
# the reference design. Capped at the available pool size at build time.
TIER_BOUNDARIES = [100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000]
WORDS_PER_TIER = 10           # sample words shown on each row
FREQ_LIST_DEPTH = 100_000     # how deep into the wordfreq list to read
SEED = 20260713

# Clean, self-contained citation forms only: 2-6 Hangul syllables, no affixes or
# single-syllable fragments (which are mostly particles / homograph noise).
HANGUL_WORD = re.compile(r"^[가-힣]{2,6}$")


def load_frequency_rank() -> dict[str, int]:
    """word -> 1-based rank in the (filtered) Korean frequency list."""
    try:
        import wordfreq
    except ModuleNotFoundError:
        sys.exit(
            "wordfreq not importable. Install it, e.g.:\n"
            "  python3 -m pip install --target /tmp/vocablibs wordfreq\n"
            "  PYTHONPATH=/tmp/vocablibs python3 "
            "backend/scripts/generate_vocab_size_tiers.py"
        )

    freq_rank: dict[str, int] = {}
    rank = 0
    for token in wordfreq.top_n_list("ko", FREQ_LIST_DEPTH):
        if HANGUL_WORD.fullmatch(token):
            rank += 1
            freq_rank.setdefault(token, rank)
    return freq_rank


def load_nikl_bands(conn: sqlite3.Connection) -> tuple[dict[str, int], dict[int, int]]:
    """(term -> best/lowest band) and (band -> distinct-term count)."""
    term_band: dict[str, int] = {}
    for term, rank in conn.execute(
        "SELECT term, level_rank FROM korean_nikl_vocab"
    ):
        if term and HANGUL_WORD.fullmatch(term):
            term_band[term] = min(term_band.get(term, 99), rank)

    band_counts: dict[int, int] = {}
    for band in term_band.values():
        band_counts[band] = band_counts.get(band, 0) + 1
    return term_band, band_counts


def theta_for_threshold(n: int, c1: int, c2: int, c3: int) -> float:
    """Map "knows the top-N graded words" to theta on [-3, 3]."""
    g = max(0, min(n, c3))
    if g <= c1:
        r = 1.0 + 0.5 * (g / c1)
    elif g <= c2:
        r = 1.5 + (g - c1) / (c2 - c1)
    else:
        r = 2.5 + 0.5 * (g - c2) / (c3 - c2)
    theta = -3.0 + (r - 1.0) * 3.0
    return round(max(-3.0, min(3.0, theta)), 3)


def generate() -> dict:
    conn = sqlite3.connect(DB_PATH)
    try:
        freq_rank = load_frequency_rank()
        term_band, band_counts = load_nikl_bands(conn)
    finally:
        conn.close()

    # NIKL words that appear in the frequency list, ordered most-frequent first.
    ranked = sorted(
        ((term, band, freq_rank[term]) for term, band in term_band.items() if term in freq_rank),
        key=lambda item: item[2],
    )
    total = len(ranked)

    # Rare graded words that never surface in the frequency list — the tail a
    # near-native reader knows. Used to build the final "advanced" row so those
    # readers aren't capped at the top frequency tier's theta.
    rare_advanced = sorted(
        term for term, band in term_band.items()
        if term not in freq_rank and band == 3
    )

    c1 = band_counts.get(1, 1)
    c2 = c1 + band_counts.get(2, 0)
    c3 = c2 + band_counts.get(3, 0)

    rng = random.Random(SEED)
    boundaries = [n for n in TIER_BOUNDARIES if n < total] + [total]

    tiers = []
    prev = 0
    for threshold in boundaries:
        segment = [term for term, _band, _r in ranked[prev:threshold]]
        sample = sorted(rng.sample(segment, min(WORDS_PER_TIER, len(segment))))
        tiers.append({
            "threshold": threshold,
            "theta": theta_for_threshold(threshold, c1, c2, c3),
            "words": sample,
        })
        prev = threshold

    # Final "advanced" row: rarer graded words beyond the frequency list, seeding
    # near-native ability (theta at the c3 ceiling -> +3).
    if rare_advanced:
        sample = sorted(rng.sample(rare_advanced, min(WORDS_PER_TIER, len(rare_advanced))))
        tiers.append({
            "threshold": c3,
            "theta": theta_for_threshold(c3, c1, c2, c3),
            "words": sample,
            "advanced": True,
        })

    return {
        "ko": {
            "system": "frequency",
            "total": total,
            "bandCounts": {"1": band_counts.get(1, 0), "2": band_counts.get(2, 0), "3": band_counts.get(3, 0)},
            "tiers": tiers,
        }
    }


if __name__ == "__main__":
    data = generate()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    ko = data["ko"]
    print(f"ko (frequency): {len(ko['tiers'])} tiers over {ko['total']} graded words")
    for tier in ko["tiers"]:
        print(f"  top {tier['threshold']:>5}  theta={tier['theta']:>6}  {', '.join(tier['words'])}")
    print(f"\nwrote -> {OUTPUT_PATH}")
