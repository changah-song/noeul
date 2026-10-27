"""Generate the vocabulary-size grids the app seeds a new reader's ability from.

The Profile cold-start picker shows frequency-ordered tiers ("I know the ~100
most common words", "~300", ...) and the reader taps the last row where they
know every sample word. Each tier carries the `theta` it seeds, computed here
against the graded bands so the seed lands on the same axis the reader uses
for word difficulty (frontend/services/abilityModel.js: band k of K maps to
-3 + (k - 1) * 6 / (K - 1)).

Korean: NIKL reading levels 1-6 (korean_nikl_vocab.level_rank), words ordered
by wordfreq. Chinese: HSK 3.0 levels 1-7 (chinese_hsk.level_rank), one tier
per level, sample words the most frequent of that level by wordfreq.
English: CEFR A1-C2 (english_cefr.level_rank 1-6), one tier per level like
Chinese.

Usage (wordfreq is not a backend dependency):
  python3 -m pip install --target /tmp/vocablibs wordfreq
  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/generate_vocab_size_tiers.py

Output: frontend/assets/data/vocab-size/{ko,zh,en}.generated.json
  { "<lang>": { "system": "frequency"|"hsk"|"cefr", "total": <int>,
                "bandCounts": {"1": n, ...},
                "tiers": [ { "threshold": N, "theta": t, "words": [...],
                             "advanced"?: true, "label"?: "HSK 3" } ] } }
"""
from __future__ import annotations

import json
import random
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "proficiency_levels.db"
EN_DICT_PATH = ROOT / "backend" / "en_learner.db"
OUTPUT_DIR = ROOT / "frontend" / "assets" / "data" / "vocab-size"

THETA_MIN, THETA_MAX = -3.0, 3.0
KO_BANDS = 6
ZH_BANDS = 7
EN_BANDS = 6
EN_LEVEL_LABELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

# Frequency-rank boundaries shown as Korean grid rows (cumulative "top-N
# words"), capped at the available pool size at build time.
KO_TIER_BOUNDARIES = [100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000]
WORDS_PER_TIER = 10
FREQ_LIST_DEPTH = 100_000
SEED = 20260713

HANGUL_WORD = re.compile(r"^[가-힣]{2,6}$")
HAN_WORD = re.compile(r"^[一-鿿]{1,4}$")
EN_WORD = re.compile(r"^[a-z]{3,14}$")


def band_scale(band: float, band_count: int) -> float:
    """Position of a (possibly fractional) band on the shared ability axis."""
    if band_count <= 1:
        return (THETA_MIN + THETA_MAX) / 2
    theta = THETA_MIN + (band - 1.0) * (THETA_MAX - THETA_MIN) / (band_count - 1)
    return round(max(THETA_MIN, min(THETA_MAX, theta)), 3)


def theta_for_count(n: int, cumulative: list[int], band_count: int) -> float:
    """Ability of a reader who knows the N easiest graded words: the band the
    N-th word sits in, interpolated by how far into that band N reaches."""
    previous = 0
    for band, upper in enumerate(cumulative, start=1):
        if n <= upper or band == band_count:
            span = max(1, upper - previous)
            fraction = max(0.0, min(1.0, (n - previous) / span))
            return band_scale(band + fraction, band_count)
        previous = upper
    return THETA_MAX


def frequency_rank(language: str, pattern: re.Pattern[str]) -> dict[str, int]:
    """word -> 1-based rank in the filtered wordfreq list for the language."""
    try:
        import wordfreq
    except ModuleNotFoundError:
        sys.exit(
            "wordfreq not importable. Install it, e.g.:\n"
            "  python3 -m pip install --target /tmp/vocablibs wordfreq\n"
            "  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/generate_vocab_size_tiers.py"
        )
    ranks: dict[str, int] = {}
    rank = 0
    for token in wordfreq.top_n_list(language, FREQ_LIST_DEPTH):
        if pattern.fullmatch(token):
            rank += 1
            ranks.setdefault(token, rank)
    return ranks


def cumulative_counts(band_counts: dict[int, int], band_count: int) -> list[int]:
    totals = []
    running = 0
    for band in range(1, band_count + 1):
        running += band_counts.get(band, 0)
        totals.append(running)
    return totals


def generate_ko(conn: sqlite3.Connection, rng: random.Random) -> dict:
    freq = frequency_rank("ko", HANGUL_WORD)
    term_band: dict[str, int] = {}
    for term, rank in conn.execute("SELECT term, level_rank FROM korean_nikl_vocab WHERE level_rank IS NOT NULL"):
        if term and HANGUL_WORD.fullmatch(term):
            term_band[term] = min(term_band.get(term, 99), int(rank))
    band_counts: dict[int, int] = {}
    for band in term_band.values():
        band_counts[band] = band_counts.get(band, 0) + 1
    cumulative = cumulative_counts(band_counts, KO_BANDS)

    # Graded words that appear in the frequency list, most frequent first.
    ranked = sorted(((t, b, freq[t]) for t, b in term_band.items() if t in freq), key=lambda item: item[2])
    total = len(ranked)
    boundaries = [n for n in KO_TIER_BOUNDARIES if n < total] + [total]

    tiers = []
    previous = 0
    for threshold in boundaries:
        segment = [t for t, _b, _r in ranked[previous:threshold]]
        sample = sorted(rng.sample(segment, min(WORDS_PER_TIER, len(segment))))
        tiers.append({"threshold": threshold, "theta": theta_for_count(threshold, cumulative, KO_BANDS), "words": sample})
        previous = threshold

    # The rare graded tail that never surfaces in the frequency list: the row a
    # near-native reader picks, seeding the top of the scale.
    rare = sorted(t for t, b in term_band.items() if t not in freq and b >= KO_BANDS - 1)
    if rare:
        sample = sorted(rng.sample(rare, min(WORDS_PER_TIER, len(rare))))
        tiers.append({"threshold": cumulative[-1], "theta": THETA_MAX, "words": sample, "advanced": True})

    return {
        "system": "frequency",
        "total": total,
        "bandCounts": {str(k): band_counts.get(k, 0) for k in range(1, KO_BANDS + 1)},
        "tiers": tiers,
    }


def generate_level_tiers(
    by_band: dict[int, list[str]],
    freq: dict[str, int],
    band_total: int,
    labels: list[str],
    system: str,
    rng: random.Random,
) -> dict:
    """One tier per graded level (HSK 1-7, CEFR A1-C2): sample words are
    common words of that level, seeding the level's theta."""
    band_counts = {band: len(set(words)) for band, words in by_band.items()}
    cumulative = cumulative_counts(band_counts, band_total)
    tiers = []
    for band in range(1, band_total + 1):
        words = sorted(set(by_band.get(band, [])), key=lambda w: freq.get(w, 10**9))
        # Show common words of the level, but not only the very top ones: a
        # spread over the most frequent quarter reads as "this level".
        pool = words[: max(WORDS_PER_TIER, len(words) // 4)] or words
        sample = sorted(rng.sample(pool, min(WORDS_PER_TIER, len(pool))))
        tiers.append({
            "threshold": cumulative[band - 1],
            "theta": band_scale(band, band_total),
            "words": sample,
            "label": labels[band - 1],
        })
    return {
        "system": system,
        "total": cumulative[-1],
        "bandCounts": {str(k): band_counts.get(k, 0) for k in range(1, band_total + 1)},
        "tiers": tiers,
    }


def generate_en(conn: sqlite3.Connection, rng: random.Random) -> dict:
    freq = frequency_rank("en", EN_WORD)
    # Sample only words the learner dictionary has as ordinary words, not as
    # names (amazon, nazi) or not at all.
    common_words: set[str] = set()
    if EN_DICT_PATH.exists():
        with sqlite3.connect(EN_DICT_PATH) as en:
            common_words = {word for (word,) in en.execute("SELECT DISTINCT word FROM en_entries WHERE pos != 'name'")}
    by_band: dict[int, list[str]] = {}
    for term, rank in conn.execute("SELECT word, level_rank FROM english_cefr WHERE level_rank IS NOT NULL"):
        term = (term or "").strip().lower()
        # Only words common enough to be recognisable as that level's words.
        if EN_WORD.fullmatch(term) and term in freq and (not common_words or term in common_words):
            by_band.setdefault(int(rank), []).append(term)
    return generate_level_tiers(by_band, freq, EN_BANDS, EN_LEVEL_LABELS, "cefr", rng)


def generate_zh(conn: sqlite3.Connection, rng: random.Random) -> dict:
    freq = frequency_rank("zh", HAN_WORD)
    by_band: dict[int, list[str]] = {}
    for term, rank in conn.execute("SELECT term, level_rank FROM chinese_hsk WHERE level_rank IS NOT NULL"):
        if term and HAN_WORD.fullmatch(term):
            by_band.setdefault(int(rank), []).append(term)
    band_counts = {band: len(set(words)) for band, words in by_band.items()}
    cumulative = cumulative_counts(band_counts, ZH_BANDS)

    tiers = []
    for band in range(1, ZH_BANDS + 1):
        words = sorted(set(by_band.get(band, [])), key=lambda w: freq.get(w, 10**9))
        # Show common words of the level, but not only the very top ones: a
        # spread over the most frequent quarter reads as "this level".
        pool = words[: max(WORDS_PER_TIER, len(words) // 4)] or words
        sample = sorted(rng.sample(pool, min(WORDS_PER_TIER, len(pool))))
        tiers.append({
            "threshold": cumulative[band - 1],
            "theta": band_scale(band, ZH_BANDS),
            "words": sample,
            "label": f"HSK {band}",
        })

    return {
        "system": "hsk",
        "total": cumulative[-1],
        "bandCounts": {str(k): band_counts.get(k, 0) for k in range(1, ZH_BANDS + 1)},
        "tiers": tiers,
    }


if __name__ == "__main__":
    rng = random.Random(SEED)
    conn = sqlite3.connect(DB_PATH)
    try:
        outputs = {"ko": generate_ko(conn, rng), "zh": generate_zh(conn, rng), "en": generate_en(conn, rng)}
    finally:
        conn.close()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for language, data in outputs.items():
        path = OUTPUT_DIR / f"{language}.generated.json"
        path.write_text(json.dumps({language: data}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{language} ({data['system']}): {len(data['tiers'])} tiers over {data['total']} graded words -> {path}")
        for tier in data["tiers"]:
            label = tier.get("label") or f"top {tier['threshold']}"
            print(f"  {label:>9}  theta={tier['theta']:>6}  {', '.join(tier['words'])}")
