"""Chinese lookup-token policy: POS filter + unknown-compound splitting."""

import pytest

from zh_tokens import (
    ZH_LOOKUP_CONTENT_POS_PREFIXES,
    ZH_LOOKUP_MULTI_CHAR_ONLY_POS_PREFIXES,
    best_known_split,
    compound_index_plan,
    expand_unknown_compounds,
    is_zh_lookup_token,
    merge_separable_tokens,
    separable_base,
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
        # Multi-character function words are vocabulary too. Left out, the
        # reader showed 如果 as its characters: 如 "as" + 果 "fruit".
        ("如果", "c"), ("或者", "c"), ("因为", "c"), ("对于", "p"),
        ("似的", "uj"), ("而已", "y"), ("哈哈", "o"),
    ],
)
def test_content_words_and_multi_char_function_words_are_indexed(word, flag):
    assert is_zh_lookup_token(word, flag)


@pytest.mark.parametrize(
    "word, flag",
    [
        ("的", "uj"), ("了", "ul"), ("着", "uz"), ("过", "ug"),
        ("和", "c"), ("而", "c"),
        ("在", "p"), ("从", "p"),
        ("呢", "y"), ("罢", "yg"),
        ("都", "d"), ("就", "d"), ("便", "d"), ("才", "d"),
        ("，", "x"), ("。", "w"), ("hello", "eng"), ("ab", "c"),
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


# ─── Frequency-scored split ────────────────────────────────────────────────

# wordfreq Zipf values as in proficiency_levels.db.
ZIPF = {"转": 5.18, "过": 6.1, "身": 4.73, "过身": 2.16, "掌柜": 2.85, "的": 7.6,
        "掌": 3.9, "柜": 3.8, "涨": 4.39, "红": 4.95, "了": 7.14, "脸": 5.05}


def test_best_split_never_makes_a_rare_word_of_a_complement_and_its_object():
    # 转过身: the greedy split took 过身 "to die"; the scored one keeps the verb,
    # its complement and the object apart.
    known = {"转", "过", "身", "过身"}
    assert split_into_known_parts("转过身", known) == ["转", "过身"]
    assert best_known_split("转过身", known, ZIPF.get) == ["转", "过", "身"]


def test_best_split_keeps_real_compounds():
    known = {"掌柜", "掌", "柜", "的", "涨红", "涨", "红", "了", "脸"}
    assert best_known_split("掌柜的", known, ZIPF.get) == ["掌柜", "的"]
    # 涨红 has no frequency: a plain dictionary word, not a known-rare one.
    assert best_known_split("涨红了脸", known, ZIPF.get) == ["涨红", "了", "脸"]


def test_best_split_skips_uncovered_characters_and_never_returns_the_word():
    assert best_known_split("X看着", {"看", "着"}, ZIPF.get) == ["看", "着"]
    assert best_known_split("看见", {"看见", "看"}, ZIPF.get) == ["看"]
    assert best_known_split("人", {"人"}, ZIPF.get) == []
    assert best_known_split("", {"人"}, ZIPF.get) == []


def test_expand_unknown_compounds_uses_the_scored_split_with_frequencies():
    known = {"转", "过", "身", "过身"}
    assert expand_unknown_compounds(["转过身"], known) == {"转过身": ["转", "过身"]}
    assert expand_unknown_compounds(["转过身"], known, zipf=ZIPF.get) == {"转过身": ["转", "过", "身"]}


# ─── Separable verbs ───────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "surface, base",
    [
        ("转过身", "转身"), ("回过头", "回头"), ("鞠了躬", "鞠躬"),
        ("帮个忙", "帮忙"), ("吃了饭", "吃饭"), ("睡着觉", "睡觉"),
        # not infixes here: they change the meaning (打不开 = cannot open)
        ("打不开", None), ("看得见", None),
        # 个 after a numeral or demonstrative is a classifier
        ("一个人", None), ("这个人", None),
        # reduplicated verbs
        ("想了想", None), ("看了看", None),
        # a particle after the infix: 打过的 is not 打的 "to take a taxi"
        ("打过的", None), ("走过了", None),
        ("转身", None), ("转过身来", None), ("", None), (None, None),
    ],
)
def test_separable_base(surface, base):
    assert separable_base(surface) == base


def test_merge_separable_tokens_joins_jieba_tokens_into_the_plain_word():
    known = {"转身", "回头", "吃饭", "看书"}
    # one jieba token
    assert merge_separable_tokens([("他", "r"), ("转过身", "v"), ("来", "v")], known) == [
        ("他", "r", "他"), ("转过身", "v", "转身"), ("来", "v", "来"),
    ]
    # jieba's other split: 转 / 过身 "to die"
    assert merge_separable_tokens([("转", "v"), ("过身", "v")], known) == [("转过身", "v", "转身")]
    # three tokens, starting on a verb
    assert merge_separable_tokens([("看", "v"), ("过", "ug"), ("书", "n")], known) == [("看过书", "v", "看书")]
    # a phrase jieba tags as an idiom / phrase is one token: any flag will do
    assert merge_separable_tokens([("吃了饭", "l")], known) == [("吃了饭", "l", "吃饭")]


def test_merge_separable_tokens_leaves_the_rest_alone():
    known = {"转身", "好些"}
    # base unknown
    assert merge_separable_tokens([("回过头", "v")], known) == [("回过头", "v", "回过头")]
    # several tokens not starting on a verb (好 / 了 / 些)
    assert merge_separable_tokens([("好", "a"), ("了", "ul"), ("些", "q")], known) == [
        ("好", "a", "好"), ("了", "ul", "了"), ("些", "q", "些"),
    ]
    # the three-character surface has its own entry
    assert merge_separable_tokens([("转过身", "v")], {"转身", "转过身"}) == [("转过身", "v", "转过身")]
    # a run that would end inside a longer token
    assert merge_separable_tokens([("转", "v"), ("过", "ug"), ("身体", "n")], known) == [
        ("转", "v", "转"), ("过", "ug", "过"), ("身体", "n", "身体"),
    ]
