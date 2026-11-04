"""Rank CC-CEDICT senses so a word's first definition is a meaning, not a pointer.

CC-CEDICT lists entries in file order, which for many characters puts a
cross-reference ("old variant of 乾|干[gan1]", "surname Li", "see 某人[mou3 ren2]")
ahead of the real meaning. The reader shows the first entry's first sense as the
gloss under a word, so 李 glossed as "surname Li" and 干 as "old variant of 乾".

This module is pure (no DB, no FastAPI) so it can be unit-tested directly.

A *reference sense* only points somewhere else:

    variant of X / old variant of X / Japanese variant of X ...
    surname X
    see X / see also X
    also written X
    also pr. [X]
    used in X            (CC-CEDICT's "this char only occurs inside word X")

These are *not* references, even though they look bureaucratic:

    abbr. for X          -> often the only meaning (北大 = abbr. for 北京大学)
    classifier for ...   -> a real meaning
    (bound form) ...     -> a real meaning
    CL:...               -> real meaning (a noun with its classifier)
"""

from __future__ import annotations

import re

SENSE_SEPARATOR = "; "

# A sense that is nothing but a pointer at another headword/reading.
ZH_REFERENCE_SENSE_RE = re.compile(
    r"^(?:"
    r"(?:[A-Za-z]+ ){0,2}variant of "   # variant of / old variant of / Japanese variant of
    r"|surname "
    r"|see (?:also )?"
    r"|also written "
    r"|also pr\. "
    r"|used in "
    r")"
)  # case-sensitive on purpose: "See you there!" is a meaning, "see 某人[...]" a pointer

# After enrichment the backend inlines the target: "variant of 乾|干[gan1]: dry; ...".
# When a reference sense carries such an inline meaning, that meaning is the best
# fallback gloss.
# The pointer is written with or without its [pinyin] ("variant of 上城区:
# Shangcheng, a district ..." when the reference had none).
_INLINE_MEANING_RE = re.compile(r"^[^:]*: (.+)$")


def split_senses(definition: str | None) -> list[str]:
    raw = definition.strip() if isinstance(definition, str) else ""
    if not raw:
        return []
    return [sense.strip() for sense in raw.split(SENSE_SEPARATOR) if sense.strip()]


def is_reference_sense(sense: str | None) -> bool:
    return bool(ZH_REFERENCE_SENSE_RE.match((sense or "").strip()))


def is_reference_only_definition(definition: str | None) -> bool:
    """True when every sense of `definition` is a cross-reference (or it is empty)."""
    senses = split_senses(definition)
    return bool(senses) and all(is_reference_sense(sense) for sense in senses)


def reorder_senses(definition: str | None) -> str | None:
    """Within one entry, move reference senses after the real ones (stable).

    "variant of 豐|丰[feng1]; luxuriant; buxom" -> "luxuriant; buxom; variant of 豐|丰[feng1]"
    """
    senses = split_senses(definition)
    if not senses:
        return definition
    real = [sense for sense in senses if not is_reference_sense(sense)]
    refs = [sense for sense in senses if is_reference_sense(sense)]
    return SENSE_SEPARATOR.join(real + refs)


def first_meaning_sense(definition: str | None) -> str | None:
    """The first sense that is an actual meaning.

    A pointer that carries an inlined meaning ("variant of X[..]: dry; dried
    food", as enrich_zh_entries writes it) yields that inlined meaning: the
    senses after it belong to the referenced word. Falls back to the first
    sense when the entry is reference-only.
    """
    senses = split_senses(definition)
    if not senses:
        return None
    for sense in senses:
        if not is_reference_sense(sense):
            return sense
        inline = _INLINE_MEANING_RE.match(sense)
        if inline and inline.group(1).strip():
            return inline.group(1).strip()
    return senses[0]


def _is_proper_name_pinyin(pinyin: str | None) -> bool:
    text = (pinyin or "").strip()
    return bool(text) and text[0].isupper()


# ─── Register tags ──────────────────────────────────────────────────────────
#
# CC-CEDICT marks senses a learner reading a modern book should not get as the
# one-word gloss: "to surpass (old)" (赵), "smile (archaic)" (听), "(literary)
# juice" (沈), "(dialect) younger sister", "(Cantonese) ...", "(Tw) ...". They
# stay in the definition the card shows; the short gloss under the word and the
# choice of entry prefer an untagged sense.
ZH_REGISTER_TAGS = (
    "old", "archaic", "literary", "classical", "obsolete", "dialect", "Cantonese",
    "Hokkien", "Wu dialect", "Shanghainese", "Tw", "Taiwan", "HK", "Internet slang",
    "original meaning",
)
_REGISTER_TAG_RE = re.compile(
    r"\((?:" + "|".join(re.escape(tag) for tag in ZH_REGISTER_TAGS) + r")(?:[,;][^)]*)?\)"
    r"|\((?:old|archaic|literary|classical|dialect)\b[^)]*\)",
)


def is_register_tagged_sense(sense: str | None) -> bool:
    """True for a sense CC-CEDICT marks as old, literary, dialect, Taiwan-only..."""
    return bool(_REGISTER_TAG_RE.search(sense or ""))


def is_register_only_definition(definition: str | None) -> bool:
    """Every real (non-pointer) sense is register-tagged: 赵 "to surpass (old)"."""
    real = [sense for sense in split_senses(definition) if not is_reference_sense(sense)]
    return bool(real) and all(is_register_tagged_sense(sense) for sense in real)


def _meaning_sense_count(definition: str | None) -> int:
    return sum(
        1
        for sense in split_senses(definition)
        if not is_reference_sense(sense) and not is_register_tagged_sense(sense)
    )


def normalize_reading(pinyin: str | None) -> str:
    """Tone-marked pinyin compared without case or spaces: "Shuō" == "shuō"."""
    return re.sub(r"\s+", "", (pinyin or "").strip().lower()).replace("u:", "ü")


def _entry_rank(entry: dict) -> int:
    """0 = real meaning, 1 = proper-name reading with real senses,
    2 = only old / literary / dialect senses, 3 = references only.

    Capitalised pinyin ("Lǐ", "Hou4") marks a proper-noun entry in CC-CEDICT.
    It is a secondary cue: a reference-only entry goes last regardless, and a
    proper-name entry with substantive senses (place names, "Peking University")
    only yields to lower-case readings, never to pointers. An entry whose every
    meaning is tagged old / archaic / literary / dialect (赵 zhao4 "to surpass
    (old)") yields even to the surname: 赵 in a novel is Zhao the family.
    """
    definition = entry.get("definition")
    if is_reference_only_definition(definition):
        return 3
    if is_register_only_definition(definition):
        return 2
    if _is_proper_name_pinyin(entry.get("pinyin")) or _is_proper_name_pinyin(entry.get("pinyin_numbers")):
        return 1
    return 0


def rank_zh_entries(entries: list[dict], preferred_reading: str | None = None) -> list[dict]:
    """Stable reorder of one word's dictionary entries: meanings first, pointers last.

    Entries are dicts with at least a `definition`; `pinyin` / `pinyin_numbers`
    are used as the proper-name cue. Entries without a definition keep their
    place at the end. The entries themselves are not modified.

    `preferred_reading` (tone-marked pinyin, e.g. pypinyin's most common
    reading of the word) breaks ties among the real meanings: 说 is shuō "to
    speak" before shuì "to persuade", 着 zhe "-ing" before zhāo "a move in
    chess". Among entries with that same reading, the one with more meaning
    senses goes first: CC-CEDICT has no frequency, and a common word carries
    many senses (后 hòu "back; behind; rear; after ..." over "empress; queen").
    Without a reading CC-CEDICT order is kept inside each group.
    """
    if not entries:
        return []
    with_definition = [entry for entry in entries if (entry.get("definition") or "").strip()]
    without_definition = [entry for entry in entries if not (entry.get("definition") or "").strip()]
    preferred = normalize_reading(preferred_reading)

    def key(entry: dict):
        rank = _entry_rank(entry)
        if not preferred or rank != 0:
            return (rank, 0, 0)
        matches = normalize_reading(entry.get("pinyin")) == preferred
        return (rank, 0 if matches else 1, -_meaning_sense_count(entry.get("definition")) if matches else 0)

    ranked = sorted(with_definition, key=key)  # sorted() is stable
    return ranked + without_definition


# ─── Short gloss ────────────────────────────────────────────────────────────

ZH_SHORT_GLOSS_MAX = 40
_PARENTHETICAL_RE = re.compile(r"\s*\([^()]*\)")
_BRACKET_RE = re.compile(r"\[[^\]]*\]")
# A Traditional|Simplified pair inside a sense: 瀋陽|沈阳 -> 沈阳
_TRAD_SIMP_RE = re.compile(r"[\u3400-\u9fff]+\|([\u3400-\u9fff]+)")
_CLASSIFIER_SENSE_RE = re.compile(r"^classifier\b[^:]*:\s*(.+)$")
_SURNAME_RE = re.compile(r"^surname (\S+)$")


def _clean_sense(sense: str) -> str:
    """"(of a person) to turn round" -> "to turn round"; drops notes and
    [pinyin], writes 瀋陽|沈阳 as 沈阳, keeps a classifier's meaning."""
    text = _BRACKET_RE.sub("", sense)
    previous = None
    while previous != text:  # nested "(a (b) c)"
        previous = text
        text = _PARENTHETICAL_RE.sub("", text)
    text = re.sub(r"\s*\(.*$", "", text)  # an unclosed "(" left by a cut
    text = _TRAD_SIMP_RE.sub(r"\1", text)
    classifier = _CLASSIFIER_SENSE_RE.match(text.strip())
    if classifier:
        text = classifier.group(1)
    text = re.sub(r"\s+", " ", text).strip(" ;:.-")
    return text


def short_gloss(definition: str | None, *, proper_name: bool = False) -> str | None:
    """The few words shown under a Chinese word in the reader.

    Picks the first sense that is a meaning (not a "variant of" / "see"
    pointer) and not tagged old / literary / dialect / Taiwan, falling back to
    tagged senses, then pointers with an inlined meaning. The sense is cleaned
    of notes in parentheses and [pinyin] and must fit in ZH_SHORT_GLOSS_MAX
    characters (then only its first comma piece is kept); a longer one gives
    way to the next sense, and only the last resort is cut. "(classifier used before a
    noun ...)" alone becomes "classifier". A proper-name entry (赵 Zhao4) is
    glossed by its "surname X" sense.
    """
    senses = split_senses(definition)
    if not senses:
        return None
    if proper_name:
        for sense in senses:
            if _SURNAME_RE.match(sense):
                return sense
    # In text order; a pointer with an inlined meaning ("variant of X[..]: dry")
    # stands for that meaning, in its place.
    meanings: list[str] = []
    for sense in senses:
        if not is_reference_sense(sense):
            meanings.append(sense)
            continue
        inline = _INLINE_MEANING_RE.match(sense)
        if inline and inline.group(1).strip():
            meanings.append(inline.group(1).strip())
    preferred = [sense for sense in meanings if not is_register_tagged_sense(sense)]
    tagged = [sense for sense in meanings if is_register_tagged_sense(sense)]
    fallback = None
    for sense in preferred + tagged:
        cleaned = _clean_sense(sense)
        if not cleaned:
            if sense.lower().startswith("(classifier"):
                # 个 "(classifier used before a noun that has no specific classifier)"
                return "classifier"
            # A sense that is all note: 了 "(completed action marker)".
            note = _clean_sense(sense.strip()[1:-1]) if sense.strip().startswith("(") and sense.strip().endswith(")") else ""
            if not note:
                continue
            cleaned = note
        if len(cleaned) <= ZH_SHORT_GLOSS_MAX:
            # "some, a few, several" -> "some". Only a short sense is cut at
            # its comma: the first piece of a long description is nonsense
            # (打 "a semantically light, transitive verb that ...").
            return cleaned.split(",")[0].strip(" ;:.-") or cleaned
        if fallback is None:
            # Kept for when no sense fits: its first comma piece ("the
            # Mid-autumn festival", "Ah Q"), or the start of it.
            first_piece = cleaned.split(",")[0].strip(" ;:.-")
            fallback = first_piece if 0 < len(first_piece) <= ZH_SHORT_GLOSS_MAX else (
                cleaned[:ZH_SHORT_GLOSS_MAX].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
            )
    if fallback:
        return fallback
    # Pointers only ("surname Li", "see X"): the pointer itself.
    first = senses[0]
    return first if len(first) <= ZH_SHORT_GLOSS_MAX else None
