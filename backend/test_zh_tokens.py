"""Chinese lookup-token policy: POS filter + unknown-compound splitting."""

import pytest

from zh_tokens import (
    ZH_LOOKUP_CONTENT_POS_PREFIXES,
    ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES,
    compound_index_plan,
    expand_unknown_compounds,
    is_zh_lookup_token,
    split_into_known_parts,
    zh_split_candidates,
)

# A fake CC-CEDICT: just the surfaces that "have an entry".
FAKE_DICT = {
    "看", "着", "看见", "镇", "口", "鲁", "做", "点", "事", "做点",
    "舀", "出", "人", "酒", "的", "掌柜", "每", "碗", "一", "个",
}


@pytest.mark.parametrize(
    "word, flag",
    [
        ("人", "n"), ("买", "v"), ("酒", "n"), ("站", "v"), ("喝", "vg"),
        ("大", "a"), ("花", "v"), ("做", "v"), ("笋", "ng"), ("煑", "zg"),
        ("这", "r"), ("我", "r"), ("别处", "r"),
        ("一个", "m"), ("多", "m"), ("十几", "m"), ("碗", "q"),
        ("傍晚", "t"), ("当街", "s"), ("前", "f"), ("里面", "f"),
        ("已经", "d"), ("终于", "d"),
        ("孔乙己", "nr"), ("鲁镇", "ns"),
    ],
)
def test_content_words_and_multi_char_adverbs_are_indexed(word, flag):
    assert is_zh_lookup_token(word, flag)


@pytest.mark.parametrize(
    "word, flag",
    [
        ("的", "uj"), ("了", "ul"), ("着", "uz"), ("过", "ug"),
        ("和", "c"), ("或者", "c"), ("如果", "c"),
        ("在", "p"), ("从", "p"),
        ("呢", "y"), ("罢", "yg"),
        ("都", "d"), ("就", "d"), ("便", "d"), ("才", "d"),
        ("，", "x"), ("。", "w"), ("hello", "eng"),
        ("", "n"), ("  ", "v"), ("人", ""), ("人", None), (None, "n"),
    ],
)
def test_function_words_particles_and_single_char_adverbs_are_excluded(word, flag):
    assert not is_zh_lookup_token(word, flag)


def test_flag_matching_is_case_and_whitespace_insensitive():
    assert is_zh_lookup_token(" 人 ", " N ")


def test_prefix_sets_do_not_overlap():
    assert not set(ZH_LOOKUP_CONTENT_POS_PREFIXES) & set(ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES)


def test_split_candidates_enumerates_substrings_up_to_max_len():
    assert zh_split_candidates(["看着"]) == {"看", "着", "看着"}
    assert zh_split_candidates(["abcd"], max_part_len=2) == {"a", "b", "c", "d", "ab", "bc", "cd"}
    assert zh_split_candidates([None, ""]) == set()


@pytest.mark.parametrize(
    "word, expected",
    [
        ("看着", ["看", "着"]),
        ("镇口", ["镇", "口"]),
        ("鲁镇", ["鲁", "镇"]),
        ("舀出", ["舀", "出"]),
        ("每碗", ["每", "碗"]),
        # greedy longest match: 做点 wins over 做 + 点
        ("做点事", ["做点", "事"]),
        # a character that starts no known word is skipped
        ("掌柜的", ["掌柜", "的"]),
        ("X看着", ["看", "着"]),
        ("看X着", ["看", "着"]),
    ],
)
def test_split_into_known_parts_is_greedy_longest_match_from_the_left(word, expected):
    assert split_into_known_parts(word, FAKE_DICT) == expected


def test_split_never_returns_the_whole_word_as_its_only_part():
    # 看见 is in the dictionary, but as a "part" we want its sub-parts.
    assert split_into_known_parts("看见", FAKE_DICT) == ["看"]


def test_split_respects_max_part_len():
    known = {"做点事", "做点", "事"}
    assert split_into_known_parts("做点事人", known, max_part_len=2) == ["做点", "事"]


def test_split_of_single_char_or_blank_is_empty():
    assert split_into_known_parts("人", FAKE_DICT) == []
    assert split_into_known_parts("", FAKE_DICT) == []
    assert split_into_known_parts(None, FAKE_DICT) == []


def test_split_with_nothing_known_is_empty():
    assert split_into_known_parts("看着", set()) == []


def test_expand_unknown_compounds_only_touches_words_missing_from_the_dictionary():
    expansions = expand_unknown_compounds(
        ["看着", "看见", "人", "镇口", "鲁镇", "看着", "XY", None],
        FAKE_DICT,
    )
    assert expansions == {
        "看着": ["看", "着"],
        "镇口": ["镇", "口"],
        "鲁镇": ["鲁", "镇"],
    }
    # known compounds and single characters are never expanded
    assert "看见" not in expansions
    assert "人" not in expansions
    # compounds with no recoverable part are omitted rather than mapped to []
    assert "XY" not in expansions


# jieba's own tags for the fake parts (word_tag_tab); None = untagged.
FAKE_TAGS = {"脸": "n", "涨红": "v", "了": "ul", "的": "uj", "额": "n", "上": "f",
             "十二": "m", "岁": "q", "年": "m"}


def test_fully_covered_unknown_compound_indexes_only_its_content_parts():
    whole, parts = compound_index_plan("涨红了脸", "n", ["涨红", "了", "脸"], FAKE_TAGS.get)
    assert whole is False
    assert parts == ["涨红", "脸"]
    whole, parts = compound_index_plan("额上的", "nr", ["额", "上", "的"], FAKE_TAGS.get)
    assert (whole, parts) == (False, ["额", "上"])


def test_numeral_compound_keeps_the_counted_word_not_the_number():
    whole, parts = compound_index_plan("十二岁", "m", ["十二", "岁"], FAKE_TAGS.get)
    assert (whole, parts) == (False, ["岁"])


def test_compound_with_uncovered_characters_is_kept():
    # 咖 is in no dictionary word here, so the compound stays tappable whole.
    whole, parts = compound_index_plan("咖脸", "n", ["脸"], FAKE_TAGS.get)
    assert whole is True
    assert parts == ["脸"]


def test_untagged_part_counts_as_content():
    assert compound_index_plan("鲁镇", "ns", ["鲁", "镇"], lambda part: None) == (False, ["鲁", "镇"])
