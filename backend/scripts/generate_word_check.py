"""Generate the word pools for the in-app word check.

The word check (frontend/services/wordCheck.js) asks "do you know this
word?" about ~28 real words picked adaptively around the reader's level, with
~8 made-up words mixed in. A reader who says they know a made-up word is
guessing, and the level engine discounts their "know" answers accordingly.

Real words: graded words spread evenly over the difficulty scale, each with
the features the app's difficulty formula uses (level rank, Korean
percentile, Zipf frequency, Korean loanword flag), so the app computes the
same difficulty the reader's underlines use.

Made-up words: real syllables or characters from common words, recombined,
and kept only when no dictionary, level list or frequency list has them.

Usage (wordfreq is not a backend dependency):
  python3 -m pip install --target /tmp/vocablibs wordfreq
  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/generate_word_check.py

Output: frontend/assets/data/word-check/{ko,zh,en}.generated.json
  { "language": "ko",
    "words": [ { "w": "사람", "r": 1, "p": null, "z": 6.29, "l": 0 }, ... ],
    "pseudo": [ "가묵", ... ] }
"""
from __future__ import annotations

import json
import random
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
LEVELS_DB = BACKEND / "proficiency_levels.db"
KO_DICT = BACKEND / "ko_dict.db"
ZH_DICT = BACKEND / "zh_dict.db"
EN_DICT = BACKEND / "en_learner.db"
OUTPUT_DIR = ROOT / "frontend" / "assets" / "data" / "word-check"

SEED = 20261019
BINS = 12                 # over the difficulty scale −3…+3
WORDS_PER_BIN = 30
PSEUDO_COUNT = 60

# Mirrors frontend/services/levelEngine.js wordDifficulty.
ZIPF_EASY, ZIPF_HARD = 6.5, 2.5
BAND_WEIGHT = 0.5
LOANWORD_EASE = 0.8
BAND_COUNT = {"ko": 6, "zh": 7, "en": 6}

HANGUL_WORD = re.compile(r"^[가-힣]{2,4}$")
HAN_WORD = re.compile(r"^[\u4e00-\u9fff]{1,4}$")
EN_WORD = re.compile(r"^[a-z]{3,12}$")
EN_VOWELS = set("aeiouy")
# Function characters make a made-up pair read as a phrase (人看, 了妈).
ZH_FUNCTION_CHARS = set("了的着过吗呢吧啊么什那这哪谁们个也都就还又才很太最被把让给和跟与或如只没不别会能要可得地是在有我你他她它咱您自已之其所以而")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def difficulty(language: str, rank, percentile, zipf, loanword) -> float | None:
    band = None
    if percentile is not None:
        band = -3 + clamp(percentile, 0, 1) * 6
    elif rank is not None:
        k = BAND_COUNT[language]
        band = -3 + clamp((rank - 1) / (k - 1), 0, 1) * 6
    freq = None
    if zipf is not None:
        freq = -3 + clamp((ZIPF_EASY - zipf) / (ZIPF_EASY - ZIPF_HARD), 0, 1) * 6
    if band is not None and freq is not None:
        d = BAND_WEIGHT * band + (1 - BAND_WEIGHT) * freq
    else:
        d = band if band is not None else freq
    if d is None:
        return None
    if language == "ko" and loanword:
        d -= LOANWORD_EASE
    return clamp(d, -3, 3)


def features(conn: sqlite3.Connection, language: str) -> dict[str, tuple]:
    return {
        term: (zipf, loanword)
        for term, zipf, loanword in conn.execute(
            "SELECT term, zipf, loanword FROM word_features WHERE language = ?", (language,)
        )
    }


def spread(candidates: list[dict], rng: random.Random) -> list[dict]:
    """Up to WORDS_PER_BIN words from each difficulty bin, preferring common
    citation forms within a bin (they make clearer prompts)."""
    bins: dict[int, list[dict]] = {}
    for item in candidates:
        b = min(BINS - 1, int((item["d"] + 3) / 6 * BINS))
        bins.setdefault(b, []).append(item)
    picked = []
    for b in sorted(bins):
        pool = bins[b]
        rng.shuffle(pool)
        picked.extend(pool[:WORDS_PER_BIN])
    return sorted(picked, key=lambda item: item["d"])


def korean(conn: sqlite3.Connection, freqs: dict[str, float], rng: random.Random) -> dict:
    feats = features(conn, "ko")
    rows: dict[str, dict] = {}
    for term, rank, pct in conn.execute(
        "SELECT term, level_rank, difficulty_percentile FROM korean_nikl_vocab"
    ):
        rows[term] = {"w": term, "r": rank, "p": round(pct, 4) if pct is not None else None}
    for term, rank in conn.execute("SELECT term, level_rank FROM korean_krdict_grades"):
        rows.setdefault(term, {"w": term, "r": rank, "p": None})
    candidates = []
    for term, row in rows.items():
        if not HANGUL_WORD.match(term):
            continue
        zipf, loan = feats.get(term, (None, 0))
        d = difficulty("ko", row["r"], row["p"], zipf, loan)
        if d is None:
            continue
        candidates.append({**row, "z": zipf, "l": int(loan or 0), "d": d})

    lexicon = set(rows) | set(freqs)
    if KO_DICT.exists():
        with sqlite3.connect(KO_DICT) as ko:
            lexicon.update(stem for (stem,) in ko.execute("SELECT stem FROM ko_dictionary"))
    common = [t for t, z in ((t, feats.get(t, (None, 0))[0]) for t in rows) if z and z >= 4.6 and re.match(r"^[가-힣]{2}$", t)]
    pseudo: set[str] = set()
    attempts = 0
    while len(pseudo) < PSEUDO_COUNT and attempts < 200000:
        attempts += 1
        a, b = rng.choice(common), rng.choice(common)
        word = a[0] + b[1]
        if rng.random() < 0.3:
            word += rng.choice(common)[rng.randrange(2)]
        if word in lexicon or word in pseudo:
            continue
        # A real word inside the made-up one (사람 in 사람값) gives it away.
        if any(word[i:j] in lexicon for i in range(len(word)) for j in range(i + 2, len(word) + 1) if (i, j) != (0, len(word))):
            continue
        pseudo.add(word)
    return {"language": "ko", "words": strip(spread(candidates, rng)), "pseudo": sorted(pseudo)}


def chinese(conn: sqlite3.Connection, freqs: dict[str, float], rng: random.Random) -> dict:
    feats = features(conn, "zh")
    rows: dict[str, dict] = {}
    for term, rank in conn.execute("SELECT term, level_rank FROM chinese_hsk WHERE script = 'simplified'"):
        if term not in rows or rank < rows[term]["r"]:
            rows[term] = {"w": term, "r": rank, "p": None}
    candidates = []
    for term, row in rows.items():
        if not HAN_WORD.match(term):
            continue
        zipf, _ = feats.get(term, (None, 0))
        d = difficulty("zh", row["r"], None, zipf, 0)
        if d is None:
            continue
        candidates.append({**row, "z": zipf, "l": 0, "d": d})

    lexicon = set(rows) | set(freqs)
    if ZH_DICT.exists():
        with sqlite3.connect(ZH_DICT) as zh:
            for simplified, traditional in zh.execute("SELECT simplified, traditional FROM zh_dictionary"):
                lexicon.add(simplified)
                lexicon.add(traditional)
    common = [t for t, row in rows.items() if row["r"] <= 3 and len(t) == 2]
    chars = sorted({ch for t in common for ch in t if ch not in ZH_FUNCTION_CHARS})
    pseudo: set[str] = set()
    attempts = 0
    while len(pseudo) < PSEUDO_COUNT and attempts < 200000:
        attempts += 1
        word = rng.choice(chars) + rng.choice(chars)
        if word[0] == word[1] or word in lexicon or word in pseudo:
            continue
        pseudo.add(word)
    return {"language": "zh", "words": strip(spread(candidates, rng)), "pseudo": sorted(pseudo)}


def english(conn: sqlite3.Connection, freqs: dict[str, float], rng: random.Random) -> dict:
    """CEFR A1-C2 words with their Zipf frequency (wordfreq), and made-up
    words spliced from two common words at a vowel (bla|nder, fro|mpet) that
    no frequency list or dictionary has."""
    from wordfreq import zipf_frequency

    rows: dict[str, dict] = {}
    for term, rank in conn.execute("SELECT word, level_rank FROM english_cefr WHERE level_rank IS NOT NULL"):
        term = (term or "").strip().lower()
        if EN_WORD.match(term) and (term not in rows or rank < rows[term]["r"]):
            rows[term] = {"w": term, "r": rank, "p": None}
    candidates = []
    for term, row in rows.items():
        zipf = round(zipf_frequency(term, "en"), 2) or None
        d = difficulty("en", row["r"], None, zipf, 0)
        if d is None:
            continue
        candidates.append({**row, "z": zipf, "l": 0, "d": d})

    lexicon = set(rows) | set(freqs)
    if EN_DICT.exists():
        with sqlite3.connect(EN_DICT) as en:
            lexicon.update(word for (word,) in en.execute("SELECT word FROM en_words"))
            lexicon.update(word for (word,) in en.execute("SELECT word FROM en_aliases"))
    common = [t for t, row in rows.items() if row["r"] <= 3 and 4 <= len(t) <= 8]

    def vowel_cut(word: str, from_end: bool) -> int | None:
        positions = [i for i in range(1, len(word) - 1) if word[i] in EN_VOWELS and word[i - 1] not in EN_VOWELS]
        if not positions:
            return None
        return positions[-1] if from_end else positions[0]

    pseudo: set[str] = set()
    attempts = 0
    while len(pseudo) < PSEUDO_COUNT and attempts < 200000:
        attempts += 1
        a, b = rng.choice(common), rng.choice(common)
        cut_a, cut_b = vowel_cut(a, False), vowel_cut(b, True)
        if cut_a is None or cut_b is None:
            continue
        word = a[:cut_a] + b[cut_b:]
        if not (5 <= len(word) <= 9) or word in lexicon or word in pseudo:
            continue
        # Spellings no English word has give the game away (sqock, acqetre).
        if re.search(r"q(?!u)|[^aeiouy]{4}", word):
            continue
        # Never a word anywhere: no frequency at all, and it doesn't end in a
        # real word's inflection of something known (blander = bland + er).
        if zipf_frequency(word, "en") > 0 or any(word[:-k] in lexicon for k in (1, 2, 3) if len(word) - k >= 3):
            continue
        pseudo.add(word)
    return {"language": "en", "words": strip(spread(candidates, rng)), "pseudo": sorted(pseudo)}


def strip(items: list[dict]) -> list[dict]:
    return [{k: item[k] for k in ("w", "r", "p", "z", "l")} for item in items]


def main() -> None:
    try:
        from wordfreq import get_frequency_dict
    except ModuleNotFoundError:
        sys.exit(
            "wordfreq not importable. Install it, e.g.:\n"
            "  python3 -m pip install --target /tmp/vocablibs wordfreq\n"
            "  PYTHONPATH=/tmp/vocablibs python3 backend/scripts/generate_word_check.py"
        )
    rng = random.Random(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(LEVELS_DB) as conn:
        outputs = [
            korean(conn, get_frequency_dict("ko"), rng),
            chinese(conn, get_frequency_dict("zh"), rng),
            english(conn, get_frequency_dict("en"), rng),
        ]
    for data in outputs:
        path = OUTPUT_DIR / f"{data['language']}.generated.json"
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"{data['language']}: {len(data['words'])} words, {len(data['pseudo'])} made-up -> {path}")
        print("  made-up sample:", ", ".join(data["pseudo"][:12]))


if __name__ == "__main__":
    main()
