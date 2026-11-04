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

from collections.abc import Callable, Collection, Iterable

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

# Adverbs (d*), conjunctions (c), prepositions (p), particles (u*), modal
# particles (y*), interjections (e*) and onomatopoeia (o) are indexed only as
# multi-character words: 已经, 终于, 如果, 因为, 所以, 可是, 对于, 似的, 而已,
# 哈哈. The single-character ones (都, 就, 和, 在, 的, 了, 呢) are grammatical
# glue a learner rarely needs annotated, and they would otherwise underline
# every line. The multi-character ones are vocabulary (如果 and 因为 are HSK
# 1-2), and leaving them out did worse than no gloss: the reader matches the
# book's words anywhere in the text, so 如果 showed its characters' glosses,
# 如 "as" + 果 "fruit", and 只有 showed 有 "to have".
ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES: tuple[str, ...] = ("d", "c", "p", "u", "y", "e", "o")

# Everything else stays out on purpose: non-morphemes / punctuation (x, w),
# latin runs ("eng"), prefixes/suffixes (h, k) and bare morphemes (g).

# Longest dictionary part the compound splitter will try. Mirrors
# ZH_FALLBACK_MAX_WORD_LEN in main.py (the dictionary-only tokenizer).
ZH_SPLIT_MAX_PART_LEN = 8


def is_zh_han_char(char: str) -> bool:
    return bool(char) and (
        "\u3400" <= char <= "\u4dbf"
        or "\u4e00" <= char <= "\u9fff"
        or "\uf900" <= char <= "\ufaff"
    )


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

    if (
        len(normalized_word) > 1
        and normalized_flag != "eng"
        and normalized_flag.startswith(ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES)
        and any(is_zh_han_char(char) for char in normalized_word)
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
    zipf: Callable[[str], float | None] | None = None,
) -> dict[str, list[str]]:
    """Map each multi-character word with no dictionary entry to its parts.

    Words that have a dictionary entry are left alone (empty mapping) so the
    index keeps the compound reading; unknown compounds map to the
    longest-match parts from :func:`split_into_known_parts`. Words with no
    recoverable parts are omitted. With ``zipf`` (a word -> Zipf frequency
    lookup) the parts come from :func:`best_known_split` instead of the
    greedy split.
    """
    expansions: dict[str, list[str]] = {}
    for word in words:
        if not isinstance(word, str):
            continue
        normalized = word.strip()
        if len(normalized) <= 1 or normalized in known_words or normalized in expansions:
            continue
        if zipf is not None:
            parts = best_known_split(normalized, known_words, zipf, max_part_len=max_part_len)
        else:
            parts = split_into_known_parts(normalized, known_words, max_part_len=max_part_len)
        if parts:
            expansions[normalized] = parts
    return expansions


# Characters that only write a number (一九一九, 二十多, 两三). Inside a numeral
# compound they are not vocabulary; the counted word after them (年, 岁, 天,
# 个) is.
ZH_NUMERAL_CHARS = frozenset("〇零一二三四五六七八九十百千万亿两几多半")


def is_zh_numeral(word: str) -> bool:
    return bool(word) and all(char in ZH_NUMERAL_CHARS for char in word)


def compound_index_plan(
    word: str,
    flag: str | None,
    parts: list[str],
    part_flag: Callable[[str], str | None],
) -> tuple[bool, list[str]]:
    """How to index a jieba compound CC-CEDICT doesn't know, given its
    dictionary-known ``parts``: (index the compound itself, parts to index).

    A compound the parts cover completely (涨红了脸 → 涨红 + 了 + 脸) is not
    indexed itself: it has no definition or level, and as the longest match it
    would hide its known parts from underlines and taps. One with characters
    no dictionary word covers is kept, as before. Parts pass the same POS
    policy as jieba tokens, so 的 and 了 inside a compound stay out (a part
    with no jieba tag counts as a noun), and a numeral compound (一九一九年,
    十二岁) keeps its counted word but not the bare number.
    """
    covered = "".join(parts) == word
    numeral_compound = normalize_zh_pos_flag(flag).startswith("m")
    kept = [
        part
        for part in parts
        if is_zh_lookup_token(part, part_flag(part) or "n")
        and not (numeral_compound and is_zh_numeral(part))
    ]
    return (not covered, kept)


# ─── Splitting by frequency ────────────────────────────────────────────────
#
# The greedy left-to-right split above took 转过身 (a jieba word CC-CEDICT
# lacks) as 转 + 过身, and 过身 is "to die": a rare (dialect) word made of the
# verb's complement 过 and its object 身. best_known_split scores every way to
# cover the word with dictionary parts by how common each part is (wordfreq
# Zipf, like jieba's own max-probability path), and charges a rare
# multi-character part extra: inside an unknown compound it is far more often
# an accident of two neighbours (过+身) than the word the writer meant.

ZH_RARE_PART_ZIPF = 3.0
ZH_RARE_PART_PENALTY = 2.0
ZH_UNKNOWN_PART_ZIPF = 1.5
ZH_SKIPPED_CHAR_COST = 12.0


def best_known_split(
    word: str,
    known_words: Collection[str],
    zipf: Callable[[str], float | None],
    *,
    max_part_len: int = ZH_SPLIT_MAX_PART_LEN,
) -> list[str]:
    """Dictionary parts of ``word`` on its most probable path.

    Each part costs ``9 - zipf`` (its -log10 probability per word); a part
    missing from the frequency list counts as Zipf 1.5, a multi-character part
    listed under Zipf 3 pays ``ZH_RARE_PART_PENALTY`` more, and a character no part covers costs
    ``ZH_SKIPPED_CHAR_COST`` and is left out. The whole word is never a part.
    Ties keep the longer part first (as the greedy split did).
    """
    normalized = word.strip() if isinstance(word, str) else ""
    length = len(normalized)
    if length <= 1:
        return []

    def part_cost(part: str) -> float:
        value = zipf(part)
        if not isinstance(value, (int, float)):
            # Not in the frequency list at all (涨红 "to flush"): a plain
            # dictionary word, not a known-rare one.
            return 9.0 - ZH_UNKNOWN_PART_ZIPF
        cost = 9.0 - value
        if len(part) > 1 and value < ZH_RARE_PART_ZIPF:
            cost += ZH_RARE_PART_PENALTY
        return cost

    inf = float("inf")
    # best[i]: (cost, parts) for the suffix starting at i
    best: list[tuple[float, list[str]]] = [(inf, [])] * (length + 1)
    best[length] = (0.0, [])
    for start in range(length - 1, -1, -1):
        skip_cost, skip_parts = best[start + 1]
        choice = (skip_cost + ZH_SKIPPED_CHAR_COST, skip_parts)
        for end in range(min(length, start + max_part_len), start, -1):
            if end - start == length:
                continue  # the whole word; not a "part"
            part = normalized[start:end]
            if part not in known_words:
                continue
            rest_cost, rest_parts = best[end]
            cost = part_cost(part) + rest_cost
            if cost < choice[0] - 1e-9:
                choice = (cost, [part, *rest_parts])
        best[start] = choice
    return best[0][1]


# ─── Separable verbs ───────────────────────────────────────────────────────
#
# A verb-object word takes an aspect marker or classifier between its halves:
# 转身 "to turn round" -> 转过身, 回头 -> 回过头, 鞠躬 -> 鞠了躬, 帮忙 -> 帮个忙,
# 吃饭 -> 吃了饭. CC-CEDICT has the plain word only, so the split one either
# went to pieces (转 + 过身 "to die") or had no gloss. Indexed whole with the
# plain word as its stem, it reads "to turn round" and keeps its parts from
# being matched on their own. 不 and 得 are not infixes here: 打不开 "cannot
# open" is not 打开 "to open".
ZH_SEPARABLE_INFIXES = frozenset("过了着个")
# 个 after a numeral or demonstrative is a classifier, not an infix (一个人).
ZH_NOT_SEPARABLE_HEADS = frozenset("一二三四五六七八九十两几这那每哪某半整")
# A particle after the infix ends the phrase: 打过的 is not 打的 "to take a taxi".
ZH_NOT_SEPARABLE_TAILS = frozenset("的地得了着过么吗呢吧啊呀")


def separable_base(word: str) -> str | None:
    """The plain verb-object word a 3-character A+X+B surface may be (X an
    aspect marker / 个): 转过身 -> 转身. Only the shape is checked; the caller
    confirms the base is a dictionary word and the whole is not."""
    normalized = word.strip() if isinstance(word, str) else ""
    if len(normalized) != 3 or not all(is_zh_han_char(char) for char in normalized):
        return None
    head, infix, tail = normalized
    if infix not in ZH_SEPARABLE_INFIXES or head in ZH_NOT_SEPARABLE_HEADS or tail in ZH_NOT_SEPARABLE_TAILS:
        return None
    if head == tail or head in ZH_SEPARABLE_INFIXES:
        return None  # 想了想, 看了看: a reduplicated verb, not verb + object
    return head + tail


def separable_windows(tokens: list[tuple[str, str]]) -> list[tuple[int, int, str, str]]:
    """Runs of 1-3 consecutive jieba tokens that spell an A+X+B separable
    form, as (first token index, end index, surface, base). A run of several
    tokens must start on a verb (jieba flag v*); one jieba token of three
    characters may carry any flag (jieba tags 鞠了躬 an idiom, 吃了饭 a phrase)."""
    windows: list[tuple[int, int, str, str]] = []
    for start in range(len(tokens)):
        starts_on_verb = normalize_zh_pos_flag(tokens[start][1]).startswith("v")
        surface = ""
        for end in range(start, min(len(tokens), start + 3)):
            surface += tokens[end][0]
            if len(surface) > 3:
                break
            if len(surface) == 3:
                if end > start and not starts_on_verb:
                    break
                base = separable_base(surface)
                if base:
                    windows.append((start, end + 1, surface, base))
                break
    return windows


def merge_separable_tokens(
    tokens: list[tuple[str, str]],
    known_words: Collection[str],
) -> list[tuple[str, str, str]]:
    """jieba tokens as (surface, flag, stem), with each separable form
    (转过身, or 转 / 过身, or 鞠 / 了 / 躬) merged into one token whose stem is
    the plain word. A run is merged only when its base is in ``known_words``
    and the 3-character surface itself is not (a real word such as 打个盹
    keeps its own entry). Other tokens keep their surface as stem."""
    merged: list[tuple[str, str, str]] = []
    windows = {
        start: (end, surface, base)
        for start, end, surface, base in separable_windows(tokens)
        if base in known_words and surface not in known_words
    }
    index = 0
    while index < len(tokens):
        window = windows.get(index)
        if window:
            end, surface, base = window
            merged.append((surface, tokens[index][1], base))
            index = end
            continue
        word, flag = tokens[index]
        merged.append((word, flag, word))
        index += 1
    return merged
