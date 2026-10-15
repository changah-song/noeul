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
_INLINE_MEANING_RE = re.compile(r"^[^:]*\]: (.+)$")


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


def _entry_rank(entry: dict) -> int:
    """0 = real meaning, 1 = proper-name reading with real senses, 2 = references only.

    Capitalised pinyin ("Lǐ", "Hou4") marks a proper-noun entry in CC-CEDICT.
    It is a secondary cue: a reference-only entry goes last regardless, and a
    proper-name entry with substantive senses (place names, "Peking University")
    only yields to lower-case readings, never to pointers.
    """
    definition = entry.get("definition")
    if is_reference_only_definition(definition):
        return 2
    if _is_proper_name_pinyin(entry.get("pinyin")) or _is_proper_name_pinyin(entry.get("pinyin_numbers")):
        return 1
    return 0


def rank_zh_entries(entries: list[dict]) -> list[dict]:
    """Stable reorder of one word's dictionary entries: meanings first, pointers last.

    Entries are dicts with at least a `definition`; `pinyin` / `pinyin_numbers`
    are used as the proper-name cue. Original order is kept inside each group,
    since CC-CEDICT order is otherwise sensible (the first entry for a reading is
    normally the common one). Entries without a definition keep their place at
    the end. The entries themselves are not modified.
    """
    if not entries:
        return []
    with_definition = [entry for entry in entries if (entry.get("definition") or "").strip()]
    without_definition = [entry for entry in entries if not (entry.get("definition") or "").strip()]
    ranked = sorted(with_definition, key=_entry_rank)  # sorted() is stable
    return ranked + without_definition
