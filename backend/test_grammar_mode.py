"""Grammar mode: the pattern lists, and checking the model's reply. The reply
parsing lives in main.py, which CI's light environment can't import; the
catalog tests run everywhere."""
import json

import pytest

import grammar_catalog


def test_every_language_has_patterns_with_unique_ids_and_levels():
    ids = [entry["id"] for entries in grammar_catalog.CATALOG.values() for entry in entries]
    assert len(ids) == len(set(ids))
    for language, entries in grammar_catalog.CATALOG.items():
        assert len(entries) >= 25
        for entry in entries:
            assert entry["id"].startswith(f"{language}.")
            assert entry["form"] and entry["name"] and entry["level"]
    assert "en.relative_extra |" in grammar_catalog.catalog_prompt_lines("en")
    assert grammar_catalog.patterns_for("zh-Hant") == grammar_catalog.CATALOG["zh"]


def _main():
    pytest.importorskip("fastapi")
    return pytest.importorskip("main")


def test_a_reply_is_checked_against_the_text_and_the_list():
    main = _main()
    sentence = "Scrooge, who had never been afraid of anything, felt a strange chill."
    raw = "Here you go: " + json.dumps({
        "pattern_id": "en.relative_extra",
        "title": "who로 덧붙이는 설명",
        "rule": "쉼표 사이의 who 부분은 앞사람을 설명해요.",
        "chunks": [
            {"text": "Scrooge,", "label": "누가", "pattern": False},
            {"text": "who had never been afraid of anything,", "label": "어떤 사람", "pattern": True},
            {"text": "not in the sentence", "label": "x", "pattern": False},
            {"text": "felt a strange chill.", "label": "한 일", "pattern": False},
        ],
        "blank": "who",
        "options": ["which", "what", "Which", "whose"],
    })
    parsed = main.parse_grammar_reply(raw, "en", sentence, sentence)
    assert parsed["pattern_id"] == "en.relative_extra"
    assert parsed["level"] == "B1"
    assert [chunk["text"] for chunk in parsed["chunks"]] == [
        "Scrooge,", "who had never been afraid of anything,", "felt a strange chill.",
    ]
    assert parsed["blank"] == "who"
    assert parsed["options"] == ["which", "what", "whose"]


def test_an_unknown_or_other_language_pattern_is_none_and_a_bad_blank_is_dropped():
    main = _main()
    raw = json.dumps({
        "pattern_id": "ko.past", "title": "t", "rule": "r",
        "chunks": [], "blank": "nowhere", "options": ["a", "b", "c"],
    })
    parsed = main.parse_grammar_reply(raw, "en", "He went home.", "He went home.")
    assert parsed["pattern_id"] == "none"
    assert parsed["blank"] == "" and parsed["options"] == []
    assert main.parse_grammar_reply("no json here", "en", "x", "x") is None
