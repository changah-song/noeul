"""Read side of en_learner.db, the English dictionary for learners of English.

Built by scripts/build_en_learner_dict.py from Wiktionary. A word has up to
four entries (one per part of speech or homograph, most common first), each
with a few English senses and the equivalent words in the learner's interface
language (run -> 달리다, 뛰다). No etymology or word parts.
"""

from __future__ import annotations

import json
import os
import sqlite3
from functools import lru_cache

EN_LEARNER_DB_PATH = os.path.join(os.path.dirname(__file__), "en_learner.db")
SQLITE_CHUNK = 500


def is_installed() -> bool:
    return os.path.exists(EN_LEARNER_DB_PATH)


@lru_cache(maxsize=1)
def _connection() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{EN_LEARNER_DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def normalize_word(word: str) -> str:
    return (word or "").strip().lower().replace("’", "'")


def _chunks(values: list[str]):
    for start in range(0, len(values), SQLITE_CHUNK):
        yield values[start:start + SQLITE_CHUNK]


def _json_list(raw) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(item) for item in value if item] if isinstance(value, list) else []


# Aliased words that only stand for one part of speech of their headword.
ALIAS_PREFERRED_POS = {"these": "determiner", "those": "determiner"}


def resolve_aliases(words: list[str]) -> dict[str, str]:
    """word -> the headword to look up: itself, or its main spelling
    (apologise -> apologize) when only that has an entry."""
    conn = _connection()
    resolved = {word: word for word in words}
    for chunk in _chunks(words):
        placeholders = ",".join("?" * len(chunk))
        for row in conn.execute(
            f"SELECT word, target FROM en_aliases WHERE word IN ({placeholders})", chunk
        ):
            resolved[row["word"]] = row["target"]
    return resolved


def lookup_entries(
    stems: list[str],
    interface_language: str = "en",
    max_entries: int | None = None,
) -> dict[str, list[dict]]:
    """stem -> its entries, most common first. Stems with no entry are absent.

    Each entry: word, pos, ipa, audio_us, audio_uk, senses (English),
    translated_senses (aligned with senses: the stored translation into
    interface_language, or None), definition (see localized_definition),
    equivalents (in interface_language, possibly empty) and gloss (the
    equivalents joined, or None).
    """
    if not is_installed():
        return {}
    normalized = list(dict.fromkeys(normalize_word(stem) for stem in stems if normalize_word(stem)))
    if not normalized:
        return {}

    headword_of = resolve_aliases(normalized)
    headwords = list(dict.fromkeys(headword_of.values()))
    conn = _connection()

    entries_by_word: dict[str, list[dict]] = {}
    for chunk in _chunks(headwords):
        placeholders = ",".join("?" * len(chunk))
        for row in conn.execute(
            f"""
            SELECT word, entry_no, pos, ipa, audio_us, audio_uk, senses
            FROM en_entries WHERE word IN ({placeholders})
            ORDER BY word, entry_no
            """,
            chunk,
        ):
            senses = _json_list(row["senses"])
            entries_by_word.setdefault(row["word"], []).append({
                "word": row["word"],
                "entry_no": row["entry_no"],
                "pos": row["pos"],
                "ipa": row["ipa"],
                "audio_us": row["audio_us"],
                "audio_uk": row["audio_uk"],
                "senses": senses,
                "translated_senses": [None] * len(senses),
                "definition": "\n".join(senses) or None,
                "equivalents": [],
                "gloss": None,
            })

    if interface_language and interface_language != "en":
        for chunk in _chunks(headwords):
            placeholders = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"""
                SELECT word, entry_no, words FROM en_equivalents
                WHERE interface_language = ? AND word IN ({placeholders})
                """,
                [interface_language, *chunk],
            ):
                for entry in entries_by_word.get(row["word"], []):
                    if entry["entry_no"] == row["entry_no"]:
                        entry["equivalents"] = _json_list(row["words"])
                        entry["gloss"] = ", ".join(entry["equivalents"]) or None

        translations = sense_translations(
            [sense for entries in entries_by_word.values() for entry in entries for sense in entry["senses"]],
            interface_language,
        )
        for entries in entries_by_word.values():
            for entry in entries:
                entry["translated_senses"] = [translations.get(sense) for sense in entry["senses"]]
                entry["definition"] = localized_definition(entry, interface_language)

    out: dict[str, list[dict]] = {}
    for stem in normalized:
        entries = entries_by_word.get(headword_of[stem])
        if not entries:
            continue
        preferred_pos = ALIAS_PREFERRED_POS.get(stem)
        if preferred_pos:
            # "those" is the determiner "that", not its conjunction.
            entries = sorted(entries, key=lambda entry: entry.get("pos") != preferred_pos)
        limited = entries[:max_entries] if max_entries else entries
        out[stem] = [
            {**entry, "stem": stem, "language": "en", "interface_language": interface_language}
            for entry in limited
        ]
    return out


def sense_translations(senses: list[str], interface_language: str) -> dict[str, str]:
    """English sense -> its stored translation (scripts/translate_en_senses.py)."""
    unique = list(dict.fromkeys(sense for sense in senses if sense))
    if not unique or not interface_language or interface_language == "en":
        return {}
    conn = _connection()
    try:
        out: dict[str, str] = {}
        for chunk in _chunks(unique):
            placeholders = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"""
                SELECT source, text FROM en_sense_translations
                WHERE interface_language = ? AND source IN ({placeholders})
                """,
                [interface_language, *chunk],
            ):
                out[row["source"]] = row["text"]
        return out
    except sqlite3.OperationalError:
        # A dictionary built before the table existed.
        return {}


def localized_definition(entry: dict, interface_language: str) -> str | None:
    """The entry's senses in the learner's language, one per line: only the
    translated ones, never mixed with English. None when no sense has a
    translation yet. An English interface gets the English senses."""
    if not interface_language or interface_language == "en":
        return "\n".join(entry.get("senses") or []) or None
    translated = [text for text in entry.get("translated_senses") or [] if text]
    return "\n".join(translated) or None


def best_entry(entries: list[dict]) -> dict | None:
    """The entry to show first: the most common one that has an equivalent in
    the learner's language, else the most common one."""
    if not entries:
        return None
    for entry in entries[:2]:
        if entry.get("equivalents"):
            return entry
    return entries[0]


def zipf_frequencies(words: list[str]) -> dict[str, float]:
    if not is_installed():
        return {}
    normalized = list(dict.fromkeys(normalize_word(word) for word in words if normalize_word(word)))
    conn = _connection()
    out: dict[str, float] = {}
    for chunk in _chunks(normalized):
        placeholders = ",".join("?" * len(chunk))
        for row in conn.execute(f"SELECT word, zipf FROM en_words WHERE word IN ({placeholders})", chunk):
            out[row["word"]] = row["zipf"]
    return out
