"""Pure helpers for turning jieba's Chinese segmentation into lookup tokens.

Kept free of jieba / FastAPI / sqlite so the CI job (which installs only
backend/requirements-ci.txt) can test the policy with a fake dictionary set.
main.py wires these into the Chinese preprocess path.

Two policies live here:

1. Which jieba part-of-speech flags produce lookup tokens, and whether a
   single-character token with that flag is worth indexing. The old rule
   (``len(word) <= 1`` dropped) lost most of a book: 人, 买, 酒, 站, 喝 are
   real words a learner taps on.

2. How to recover dictionary-known parts from a jieba compound that has no
   CC-CEDICT entry (看着, 镇口, 鲁镇, 做点事): greedy longest-match from the
   left over the dictionary, so 看着 → 看 + 着 and 鲁镇 → 鲁 + 镇.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable

# jieba (ICTCLAS) flag prefixes that may become lookup tokens even when the
# token is a single character. These are the "content" classes: nouns (n*,
# incl. nr/ns/nt/nz proper nouns and ng noun morphemes), verbs (v*, incl. vg
# morphemes and vn/vd), adjectives (a*, incl. an/ad/ag), pronouns (r*),
# numerals (m*), measure words (q*), time words (t*), place words (s*),
# direction words (f*: 上, 前, 里面), status words (z*: 穿/煑 are tagged zg),
# distinguishing words (b), idioms (i), idiomatic phrases (l), and
# abbreviations (j).
ZH_LOOKUP_CONTENT_POS_PREFIXES: tuple[str, ...] = (
    "n", "v", "a", "r", "m", "q", "t", "s", "f", "z", "b", "i", "l", "j",
)

# Adverbs (d*) are indexed only as multi-character words (已经, 终于). The
# single-character ones (都, 就, 便, 才, 很) are grammatical glue a learner
# rarely needs annotated, and they would otherwise underline every line.
ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES: tuple[str, ...] = ("d",)

# Everything else stays out on purpose: particles (u*: 的/了/着/过 as aspect
# markers, uj/ul/uz/ud/ug/uv), prepositions (p), conjunctions (c), modal
# particles (y*), interjections (e*, also "eng" for latin runs),
# onomatopoeia (o), non-morphemes / punctuation (x, w), prefixes/suffixes
# (h, k) and bare morphemes (g). They are connecting words, not vocabulary.

# Longest dictionary part the compound splitter will try. Mirrors
# ZH_FALLBACK_MAX_WORD_LEN in main.py (the dictionary-only tokenizer).
ZH_SPLIT_MAX_PART_LEN = 8


def normalize_zh_pos_flag(flag: str | None) -> str:
    return flag.strip().lower() if isinstance(flag, str) else ""


def is_zh_lookup_token(word: str | None, flag: str | None) -> bool:
    """Whether a jieba (word, flag) pair should be indexed for lookup."""
    normalized_word = word.strip() if isinstance(word, str) else ""
    if not normalized_word:
        return False

    normalized_flag = normalize_zh_pos_flag(flag)
    if not normalized_flag:
        return False

    if normalized_flag.startswith(ZH_LOOKUP_CONTENT_POS_PREFIXES):
        return True

    if len(normalized_word) > 1 and normalized_flag.startswith(
        ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES
    ):
        return True

    return False


def zh_split_candidates(
    words: Iterable[str],
    *,
    max_part_len: int = ZH_SPLIT_MAX_PART_LEN,
) -> set[str]:
    """Every substring (up to ``max_part_len`` chars) of the given words.

    The caller batch-checks these against the dictionary once, then feeds the
    known subset to :func:`split_into_known_parts`.
    """
    candidates: set[str] = set()
    for word in words:
        if not isinstance(word, str):
            continue
        length = len(word)
        for start in range(length):
            max_end = min(length, start + max_part_len)
            for end in range(start + 1, max_end + 1):
                candidates.add(word[start:end])
    return candidates


def split_into_known_parts(
    word: str,
    known_words: Collection[str],
    *,
    max_part_len: int = ZH_SPLIT_MAX_PART_LEN,
) -> list[str]:
    """Greedy longest-match split of ``word`` into dictionary-known parts.

    Scans left to right; at each position the longest prefix (at most
    ``max_part_len`` chars) present in ``known_words`` is taken. A character
    that starts no known word is skipped. Returns the parts in text order;
    the whole word itself is never returned as a part (callers index the
    original surface separately), so a word that *is* known still splits into
    its sub-parts when asked.
    """
    normalized = word.strip() if isinstance(word, str) else ""
    length = len(normalized)
    if length <= 1:
        return []

    parts: list[str] = []
    index = 0
    while index < length:
        match = ""
        max_end = min(length, index + max_part_len)
        for end in range(max_end, index, -1):
            if end - index == length:
                # the whole word; not a "part"
                continue
            candidate = normalized[index:end]
            if candidate in known_words:
                match = candidate
                break

        if match:
            parts.append(match)
            index += len(match)
        else:
            index += 1

    return parts


def expand_unknown_compounds(
    words: Iterable[str],
    known_words: Collection[str],
    *,
    max_part_len: int = ZH_SPLIT_MAX_PART_LEN,
) -> dict[str, list[str]]:
    """Map each multi-character word with no dictionary entry to its parts.

    Words that have a dictionary entry are left alone (empty mapping) so the
    index keeps the compound reading; unknown compounds map to the
    longest-match parts from :func:`split_into_known_parts`. Words with no
    recoverable parts are omitted.
    """
    expansions: dict[str, list[str]] = {}
    for word in words:
        if not isinstance(word, str):
            continue
        normalized = word.strip()
        if len(normalized) <= 1 or normalized in known_words or normalized in expansions:
            continue
        parts = split_into_known_parts(normalized, known_words, max_part_len=max_part_len)
        if parts:
            expansions[normalized] = parts
    return expansions
