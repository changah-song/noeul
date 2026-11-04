"""End to end: jieba + zh_dict.db + word frequencies, as /preprocess_chapter_zh/
indexes a text. The two reported cases and the rules behind them.

The reader matches the book's indexed words anywhere in the text (longest
first), so what matters is which surfaces get indexed and their glosses:

- 如果 must be a surface of its own, glossed "if". It was dropped as a
  conjunction, and the reader drew its characters' glosses: 如 "as" 果 "fruit".
- 转过身 must be one surface looked up as 转身 "to turn round". The old split
  made 转 + 过身, and 过身 is "to die".
"""

import asyncio

import pytest

main = pytest.importorskip("main", reason="main.py needs the full backend requirements")

pytestmark = [
    pytest.mark.skipif(main.zh_pseg is None, reason="jieba is not installed"),
    pytest.mark.skipif(not main.is_zh_dict_db_installed(), reason="zh_dict.db is missing"),
]


def surfaces(text: str) -> dict[str, str]:
    _words, surface_index, _pos = main.extract_zh_lookup_tokens(text)
    return {entry["surface"]: entry["stem"] for entry in surface_index}


def glosses(text: str) -> dict[str, str | None]:
    result = asyncio.run(main._preprocess_zh_core(text, interface_language="en"))
    by_stem = {entry["stem"]: entry.get("gloss") for entry in result["results"]}
    return {entry["surface"]: by_stem.get(entry["stem"]) for entry in result["surface_index"]}


def test_ruguo_is_indexed_whole_and_glossed_if():
    found = surfaces("如果你不来，我就走了。")
    assert found.get("如果") == "如果"
    assert "如" not in found and "果" not in found
    assert glosses("如果你不来，我就走了。")["如果"] == "if"


def test_zhuanguoshen_is_turn_round_never_to_die():
    for text in ("他转过身来，看着我。", "她慢慢转过身去。"):
        found = surfaces(text)
        assert found.get("转过身") == "转身", text
        assert "过身" not in found, text
        assert glosses(text)["转过身"] == "to turn round"


def test_jieba_split_into_verb_and_rare_word_is_rejoined():
    # Whatever jieba does with 转过身, 过身 "to die" is never indexed.
    found = surfaces("他转过身，把门关上了。")
    assert "过身" not in found


@pytest.mark.parametrize(
    "text, surface, stem",
    [
        ("他回过头来看我。", "回过头来", "回过头来"),  # CC-CEDICT has the whole phrase
        ("他向老师鞠了躬。", "鞠了躬", "鞠躬"),
        ("你能帮个忙吗？", "帮个忙", "帮忙"),
    ],
)
def test_separable_verbs_are_looked_up_under_their_plain_form(text, surface, stem):
    assert surfaces(text).get(surface) == stem


@pytest.mark.parametrize(
    "text, word",
    [
        ("因为下雨，所以我没去。", "因为"),
        ("因为下雨，所以我没去。", "所以"),
        ("可是他不知道。", "可是"),
        ("只有他知道。", "只有"),
        ("他于是走了。", "于是"),
    ],
)
def test_multi_character_function_words_are_indexed(text, word):
    assert word in surfaces(text)


@pytest.mark.parametrize(
    "word, gloss",
    [
        ("说", "to speak"),       # not shuì "to persuade"
        ("后", "back"),           # not "empress"
        ("赵", "surname Zhao"),   # not "to surpass (old)"
        ("他", "he"),             # not the whole definition
        ("个", "classifier"),
        ("听", "to listen to"),   # not yǐn "smile (archaic)"
    ],
)
def test_single_character_glosses_take_the_common_reading(word, gloss):
    groups, _found = main.lookup_zh_dictionary_entries([word])
    assert groups[0][0]["gloss"] == gloss


def test_stale_translated_chinese_rows_are_purged_once():
    import sqlite3

    conn = sqlite3.connect(":memory:")
    main.create_dictionary_cache_table(conn)
    conn.executemany(
        "INSERT INTO dictionary_cache (stem, language, interface_language, definition, gloss) VALUES (?, ?, ?, ?, ?)",
        [
            ("说", "zh", "ko", "설득하다", "설득하다"),
            ("说", "zh", "en", "to speak", "to speak"),
            ("사랑", "ko", "en", "love", "love"),
        ],
    )
    assert main.purge_stale_zh_translations(conn) == 1
    assert main.purge_stale_zh_translations(conn) == 0
    left = {(row[0], row[1], row[2]) for row in conn.execute("SELECT stem, language, interface_language FROM dictionary_cache")}
    assert left == {("说", "zh", "en"), ("사랑", "ko", "en")}
