"""Picking the sense a Korean homograph has in its sentence (/ko_sense_in_context/)."""

import pytest

main = pytest.importorskip("main")


def sense(trans, origin="N/A"):
    return {"word": "부처", "origin": origin, "pos": "명사", "transWord": trans}


def test_only_homographs_from_different_words_are_asked_about():
    buddha = [sense("Buddha"), sense("Buddha"), sense("ministry and office", "部處"), sense("married couple", "夫妻")]
    assert main.ko_homograph_senses(buddha) == buddha
    # One word's senses (가다): nothing to choose between.
    going = [sense("go"), sense("leave"), sense("attend")]
    assert main.ko_homograph_senses(going) == []
    assert main.ko_homograph_senses([sense("price", "價格")]) == []


def test_the_question_lists_each_sense_with_its_hanja():
    message = main.build_sense_pick_message("부처", "부처가 함께 살았다.", [sense("Buddha"), sense("married couple", "夫妻")])
    assert "1. Buddha\n2. married couple [夫妻]" in message
    assert "부처가 함께 살았다." in message


@pytest.mark.parametrize("raw, expected", [("2", 1), (" 3.", 2), ("Sense 1", 0), ("9", None), ("none", None)])
def test_the_reply_is_a_sense_number(raw, expected):
    assert main.parse_sense_pick(raw, 4) == expected
