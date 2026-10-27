#!/usr/bin/env python3
"""Build en_learner.db, the English dictionary for learners of English.

It replaces the old en_dict.db (one definition per word, 374 MB, never
deployed) with a small learner dictionary that is committed like zh_dict.db and
ko_dict.db. See lookup_en_learner_entries in main.py for the read side.

Source
------
The Wiktionary extract from kaikki.org (CC BY-SA, the same license family as
KRDICT): https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
plus wordfreq (https://github.com/rspeer/wordfreq) to choose which words to keep.
wordfreq is a build-time dependency only:

    pip install wordfreq
    python scripts/build_en_learner_dict.py --src kaikki.org-dictionary-English.jsonl.gz

Scope
-----
- Words: wordfreq's top --top English words plus every word in english_cefr
  (proficiency_levels.db), when Wiktionary has a real entry for them. Inflected
  forms ("ran", "children") are left out; the tokenizer looks up the lemma.
- Entries: one row per Wiktionary part-of-speech entry (homographs such as
  bank "money" and bank "river" stay separate), at most MAX_ENTRIES per word, in
  Wiktionary order, which puts the common meaning first.
- Senses: the first MAX_SENSES per entry, skipping obsolete, archaic, rare,
  dialect, slang and offensive senses and pure "form of" senses.
- Equivalents: words in each interface language (Korean first, the first
  audience) from Wiktionary's translation tables, e.g. run → 달리다, 뛰다. These
  are human-written; a language without one falls back to a machine
  translation at lookup time.
- Pronunciation: one IPA transcription and the US/UK audio files when present.
- No etymology, word parts or related words: English roots are not a learning
  aid the way hanja or Chinese characters are.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sqlite3
import sys
from datetime import date

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(BACKEND_DIR, "en_learner.db")
DEFAULT_LEVELS_DB = os.path.join(BACKEND_DIR, "proficiency_levels.db")

MAX_ENTRIES = 4
MAX_SENSES = 3
MAX_EQUIVALENTS = 4
# Translation groups (one per meaning) an entry's equivalents may come from.
MAX_EQUIVALENT_GROUPS = 2

SKIP_SENSE_TAGS = {
    "obsolete", "archaic", "rare", "dialectal", "historical", "nonstandard",
    "slang", "vulgar", "offensive", "derogatory", "ethnic", "misspelling",
    "pejorative", "Internet", "euphemistic", "obsolete-sense", "dated",
}
SKIP_POS = {"name", "character", "symbol", "prefix", "suffix", "infix", "affix", "proverb", "phrase", "abbrev", "contraction"}
POS_LABELS = {
    "noun": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb",
    "pron": "pronoun", "prep": "preposition", "conj": "conjunction", "det": "determiner",
    "intj": "interjection", "num": "numeral", "article": "article", "particle": "particle",
    "postp": "postposition",
}

# Interface language -> Wiktionary translation codes. Chinese is one language
# ("cmn") in Wiktionary, split here by script tags.
INTERFACE_LANGUAGE_CODES = {
    "ko": {"ko"},
    "zh": {"cmn", "zh"},
    "zh-Hant": {"cmn", "zh"},
    "ja": {"ja"},
    "es": {"es"},
    "vi": {"vi"},
    "ar": {"ar"},
    "pt": {"pt"},
    "fr": {"fr"},
    "ru": {"ru"},
    "th": {"th"},
    "id": {"id"},
    "mn": {"mn"},
}

WORD_RE = re.compile(r"^[a-z][a-z'\-]*[a-z]$|^[a-z]$")
PARENS_RE = re.compile(r"\s*[(（][^)）]*[)）]")
HAN_RE = re.compile(r"[\u3400-\u9fff]")
MONGOLIAN_SCRIPT_RE = re.compile(r"[\u1800-\u18af]")


def clean_equivalent(word: str, language: str) -> str:
    # 예약(豫約)하다 -> 예약하다: Korean equivalents carry hanja in parentheses.
    word = PARENS_RE.sub("", word or "").strip()
    if language in ("zh", "zh-Hant"):
        # Wiktionary writes a word with two scripts as "銀行 /银行".
        if " /" in word:
            traditional, simplified = (part.strip() for part in word.split(" /", 1))
            word = traditional if language == "zh-Hant" else simplified
        # Other Chinese languages (Dungan in Cyrillic) share the code.
        if not HAN_RE.search(word):
            return ""
    if language == "mn" and MONGOLIAN_SCRIPT_RE.search(word):
        # The app's Mongolian is Cyrillic; skip the traditional script.
        return ""
    return word


def script_ok(language: str, tags: list[str]) -> bool:
    tagset = {t.lower() for t in tags or []}
    if language == "zh":
        return "traditional-chinese" not in tagset
    if language == "zh-Hant":
        return "simplified-chinese" not in tagset
    return True


def keep_sense(sense: dict) -> bool:
    if sense.get("form_of") or sense.get("alt_of"):
        return False
    tags = set(sense.get("tags") or [])
    if tags & SKIP_SENSE_TAGS or "form-of" in tags or "alt-of" in tags:
        return False
    glosses = sense.get("glosses") or []
    return bool(glosses and glosses[-1].strip())


def sense_text(sense: dict) -> str:
    """The most specific gloss, or its parent when the subsense is a fragment
    ("...because it has already been mentioned")."""
    glosses = [g.strip() for g in sense.get("glosses") or [] if g and g.strip()]
    text = glosses[-1]
    if len(glosses) > 1 and (text.startswith(".") or text[:1].islower()):
        text = glosses[0]
    return text


def first_ipa(sounds: list[dict]) -> str | None:
    for sound in sounds:
        ipa = sound.get("ipa")
        if ipa and ipa.startswith("/"):
            return ipa
    return None


def audio_for(sounds: list[dict], accents: tuple[str, ...]) -> str | None:
    for sound in sounds:
        url = sound.get("mp3_url") or sound.get("ogg_url")
        if not url:
            continue
        name = url.rsplit("/", 1)[-1].lower()
        tags = {t.lower() for t in sound.get("tags") or []}
        if any(name.startswith(f"en-{accent}-") for accent in accents) or tags & set(accents):
            return url
    return None


def equivalents_for(entry: dict, kept_senses: list[dict]) -> dict[str, list[str]]:
    """Each interface language's equivalents: translations attached to the kept
    senses first, then the entry's translation tables, one group per meaning."""
    groups: list[list[dict]] = [s.get("translations") or [] for s in kept_senses]
    by_sense: dict[str, list[dict]] = {}
    for translation in entry.get("translations") or []:
        by_sense.setdefault(translation.get("sense") or "", []).append(translation)
    groups.extend(by_sense.values())

    out: dict[str, list[str]] = {}
    for language, codes in INTERFACE_LANGUAGE_CODES.items():
        words: list[str] = []
        used_groups = 0
        for group in groups:
            matches = [
                clean_equivalent(t.get("word"), language)
                for t in group
                if t.get("code") in codes and t.get("word") and script_ok(language, t.get("tags"))
            ]
            matches = [m for m in matches if m]
            if not matches:
                continue
            used_groups += 1
            for match in matches:
                if match not in words:
                    words.append(match)
            if used_groups >= MAX_EQUIVALENT_GROUPS or len(words) >= MAX_EQUIVALENTS:
                break
        if words:
            out[language] = words[:MAX_EQUIVALENTS]
    return out


def load_wanted_words(levels_db: str, top: int) -> tuple[dict[str, float], set[str]]:
    """(candidate word -> Zipf frequency, the learner word list)."""
    from wordfreq import top_n_list, zipf_frequency

    words = {w for w in top_n_list("en", top) if WORD_RE.match(w)}
    learner_words: set[str] = set()
    if os.path.exists(levels_db):
        conn = sqlite3.connect(levels_db)
        try:
            learner_words = {
                str(row[0]).strip().lower()
                for row in conn.execute("SELECT word FROM english_cefr")
                if row[0] and WORD_RE.match(str(row[0]).strip().lower())
            }
        finally:
            conn.close()
    words |= learner_words
    return {w: zipf_frequency(w, "en") for w in words}, learner_words


def build(src: str, out: str, levels_db: str, top: int) -> None:
    wanted, learner_words = load_wanted_words(levels_db, top)
    aliases: dict[str, str] = {}
    print(f"[build_en_learner_dict] {len(wanted)} candidate words")

    # word -> list of (is_capitalized, entry dict); lowercase entries sort first
    # so "may" (verb) comes before "May" (month).
    collected: dict[str, list[tuple[int, int, dict]]] = {}
    order = 0
    with gzip.open(src, "rt", encoding="utf-8") as handle:
        for line in handle:
            raw = json.loads(line)
            if raw.get("lang_code") != "en":
                continue
            headword = raw.get("word") or ""
            key = headword.lower()
            if key not in wanted:
                continue
            pos = raw.get("pos")
            if pos in SKIP_POS and not (pos == "name" and key in learner_words and headword != key):
                continue
            all_senses = raw.get("senses") or []
            senses = [s for s in all_senses if keep_sense(s)][:MAX_SENSES]
            if not senses:
                # A spelling variant ("apologise", "colour") points at its main
                # entry; inflections ("ran") are left to the tokenizer.
                for sense in all_senses:
                    for target in sense.get("alt_of") or []:
                        target_word = str(target.get("word") or "").lower()
                        if target_word and target_word != key:
                            aliases.setdefault(key, target_word)
                continue
            sounds = raw.get("sounds") or []
            order += 1
            collected.setdefault(key, []).append((int(headword != key), order, {
                "pos": POS_LABELS.get(raw.get("pos"), raw.get("pos")),
                "ipa": first_ipa(sounds),
                "audio_us": audio_for(sounds, ("us", "us-inlandnorth", "general-american")),
                "audio_uk": audio_for(sounds, ("uk", "gb", "received-pronunciation")),
                "senses": [sense_text(s) for s in senses],
                "equivalents": equivalents_for(raw, senses),
            }))

    # Machine-translated senses (scripts/translate_en_senses.py) cost money;
    # keep them across rebuilds. They're keyed by the English sense text, so
    # an unchanged sense keeps its translation.
    kept_translations: list[tuple] = []
    if os.path.exists(out):
        old = sqlite3.connect(out)
        try:
            kept_translations = old.execute(
                "SELECT interface_language, source, text FROM en_sense_translations"
            ).fetchall()
        except sqlite3.OperationalError:
            pass
        finally:
            old.close()
        os.remove(out)
    conn = sqlite3.connect(out)
    conn.executescript(
        """
        CREATE TABLE en_words (
            word TEXT PRIMARY KEY,
            zipf REAL NOT NULL            -- wordfreq Zipf frequency, 0-8
        ) WITHOUT ROWID;
        CREATE TABLE en_entries (
            word     TEXT NOT NULL,
            entry_no INTEGER NOT NULL,    -- 1 = most common entry
            pos      TEXT,
            ipa      TEXT,
            audio_us TEXT,
            audio_uk TEXT,
            senses   TEXT NOT NULL,       -- JSON list of English definitions
            PRIMARY KEY (word, entry_no)
        ) WITHOUT ROWID;
        CREATE TABLE en_equivalents (
            interface_language TEXT NOT NULL,
            word               TEXT NOT NULL,
            entry_no           INTEGER NOT NULL,
            words              TEXT NOT NULL,  -- JSON list, e.g. ["달리다", "뛰다"]
            PRIMARY KEY (interface_language, word, entry_no)
        ) WITHOUT ROWID;
        CREATE TABLE en_aliases (
            word   TEXT PRIMARY KEY,      -- spelling variant: apologise, colour
            target TEXT NOT NULL          -- its main entry: apologize, color
        ) WITHOUT ROWID;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
        """
    )
    entry_rows = equivalent_rows = 0
    for word, items in sorted(collected.items()):
        items.sort(key=lambda item: (item[0], item[1]))
        conn.execute("INSERT INTO en_words VALUES (?, ?)", (word, round(wanted[word], 2)))
        for entry_no, (_cap, _order, entry) in enumerate(items[:MAX_ENTRIES], start=1):
            conn.execute(
                "INSERT INTO en_entries VALUES (?, ?, ?, ?, ?, ?, ?)",
                (word, entry_no, entry["pos"], entry["ipa"], entry["audio_us"], entry["audio_uk"],
                 json.dumps(entry["senses"], ensure_ascii=False)),
            )
            entry_rows += 1
            for language, words in entry["equivalents"].items():
                conn.execute(
                    "INSERT INTO en_equivalents VALUES (?, ?, ?, ?)",
                    (language, word, entry_no, json.dumps(words, ensure_ascii=False)),
                )
                equivalent_rows += 1
    conn.execute(
        """
        CREATE TABLE en_sense_translations (
            interface_language TEXT NOT NULL,
            source             TEXT NOT NULL,  -- the English sense, as in en_entries.senses
            text               TEXT NOT NULL,
            PRIMARY KEY (interface_language, source)
        ) WITHOUT ROWID
        """
    )
    conn.executemany("INSERT OR IGNORE INTO en_sense_translations VALUES (?, ?, ?)", kept_translations)
    alias_rows = [(word, target) for word, target in sorted(aliases.items())
                  if target in collected and word not in collected]
    conn.executemany("INSERT INTO en_aliases VALUES (?, ?)", alias_rows)
    conn.executemany("INSERT INTO metadata VALUES (?, ?)", [
        ("source", "Wiktionary via kaikki.org (CC BY-SA 4.0); word list from wordfreq"),
        ("built", date.today().isoformat()),
        ("top_words", str(top)),
    ])
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    print(f"[build_en_learner_dict] {len(collected)} words, {entry_rows} entries, "
          f"{equivalent_rows} equivalent rows, {len(alias_rows)} aliases -> {out} ({os.path.getsize(out) / 1e6:.1f} MB)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", required=True, help="kaikki.org-dictionary-English.jsonl.gz")
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--levels-db", default=DEFAULT_LEVELS_DB)
    parser.add_argument("--top", type=int, default=50000, help="how many of wordfreq's most common words to consider")
    args = parser.parse_args()
    build(args.src, args.out, args.levels_db, args.top)
    return 0


if __name__ == "__main__":
    sys.exit(main())
