"""English forms that collide with an unrelated headword: "born" and "bore"
are the verb "bear", whose first entry is the animal (곰); "wound" the verb is
"wind", whose first entry is the air (숨). The gloss under a word follows its
part of speech in the text, and a participle the dictionary has as an
adjective of its own (born: 태어난) keeps its own entry."""
import pytest

import en_learner_dict

pytestmark = pytest.mark.skipif(not en_learner_dict.is_installed(), reason="en_learner.db is not built")


ENTRIES = [
    {"word": "bear", "pos": "noun", "equivalents": ["곰"]},
    {"word": "bear", "pos": "verb", "equivalents": []},
    {"word": "bear", "pos": "adjective", "equivalents": []},
    {"word": "bear", "pos": "verb", "equivalents": ["나르다"]},
]


def test_best_entry_follows_the_part_of_speech_in_the_text():
    assert en_learner_dict.best_entry(ENTRIES, "VERB")["equivalents"] == ["나르다"]
    assert en_learner_dict.best_entry(ENTRIES, "NOUN")["equivalents"] == ["곰"]
    # Of that part of speech but with no equivalent: still that part of speech
    # (the gloss is then machine-translated as "bear (adjective)").
    assert en_learner_dict.best_entry(ENTRIES, "ADJ")["pos"] == "adjective"
    # No part of speech, or none of that one in the dictionary: as before.
    assert en_learner_dict.best_entry(ENTRIES)["equivalents"] == ["곰"]
    assert en_learner_dict.best_entry(ENTRIES, "ADV")["equivalents"] == ["곰"]
    assert en_learner_dict.best_entry(ENTRIES, "name")["equivalents"] == ["곰"]


def test_lexicalized_adjectives_are_widely_translated_adjective_only_words():
    found = en_learner_dict.lexicalized_adjectives(
        ["born", "broken", "lost", "frozen", "left", "ground", "felt", "taken", "withdrawn", "hung", "bear"]
    )
    assert {"born", "broken", "lost", "frozen"} <= found
    # left (also a noun and an adverb), ground, felt: homographs, not participles.
    # taken ("infatuated"), withdrawn, hung: rare adjective senses.
    assert not found & {"left", "ground", "felt", "taken", "withdrawn", "hung", "bear"}


main = pytest.importorskip("main", reason="main.py needs the full backend requirements")


def _spacy_or_skip():
    pytest.importorskip("spacy")
    try:
        main.get_en_nlp()
    except main.ApiError:
        pytest.skip("en_core_web_sm is not installed")


def _glosses(text: str) -> dict[tuple[str, str], tuple[str, str | None, str | None]]:
    """(surface, stem) -> (stem's part of speech, entry pos, Korean gloss)."""
    stems, surface_index, pos_by_stem = main.extract_en_lookup_tokens(text)
    results, _found = main.lookup_en_learner_results(stems, "ko", pos_by_stem)
    by_stem = {result["stem"]: result for result in results}
    return {
        (entry["surface"], entry["stem"]): (
            pos_by_stem[entry["stem"]],
            by_stem[entry["stem"]].get("pos"),
            by_stem[entry["stem"]].get("gloss"),
        )
        for entry in surface_index
    }


def test_born_is_its_own_adjective_never_the_animal():
    _spacy_or_skip()
    for text in ("He was born in a small village.", "She is a born leader.", "Born in 1990, he moved away."):
        glosses = _glosses(text)
        surface = "Born" if text.startswith("Born") else "born"
        assert (surface, "bear") not in glosses
        pos, entry_pos, gloss = glosses[(surface, "born")]
        assert (pos, entry_pos) == ("ADJ", "adjective")
        assert "태어난" in gloss
        assert "곰" not in gloss


def test_irregular_verb_forms_get_the_verb_not_the_colliding_noun():
    _spacy_or_skip()
    glosses = _glosses("He bore the pain.")
    assert glosses[("bore", "bear")][:2] == ("VERB", "verb")
    assert "곰" not in (glosses[("bore", "bear")][2] or "")

    glosses = _glosses("He wound the clock.")
    # The verb "wind" (no Korean equivalent: machine-translated later), not 숨.
    assert glosses[("wound", "wind")][:2] == ("VERB", "verb")
    assert glosses[("wound", "wind")][2] is None

    glosses = _glosses("He left the room. I saw the house. They found the key.")
    assert "떠나다" in glosses[("left", "leave")][2]
    assert "보다" in glosses[("saw", "see")][2]
    assert "찾다" in glosses[("found", "find")][2]
    glosses = _glosses("She lay on the bed. The sun rose. The coffee was ground finely.")
    assert glosses[("lay", "lie")][1] == "verb"
    assert "오르다" in glosses[("rose", "rise")][2]
    assert "갈다" in glosses[("ground", "grind")][2]


def test_the_noun_homographs_keep_their_own_meaning():
    _spacy_or_skip()
    glosses = _glosses("He cut it with a saw. She held a rose. The wound bled. Turn to the left.")
    assert "톱" in glosses[("saw", "saw")][2]
    assert "장미" in glosses[("rose", "rose")][2]
    assert "상처" in glosses[("wound", "wound")][2]
    assert "왼쪽" in glosses[("left", "left")][2]


def test_left_and_perfect_participles_stay_forms_of_their_verb():
    _spacy_or_skip()
    glosses = _glosses("He was left alone.")
    # "left" is also a noun and an adverb: not a participle of its own (왼).
    assert ("left", "leave") in glosses
    assert ("left", "left") not in glosses
    glosses = _glosses("I have lost my keys. He has broken the cup.")
    assert ("lost", "lose") in glosses and ("lost", "lost") not in glosses
    assert ("broken", "break") in glosses and ("broken", "broken") not in glosses
    glosses = _glosses("We were lost. The vase was broken.")
    assert ("lost", "lost") in glosses
    assert ("broken", "broken") in glosses


def test_a_stem_takes_its_most_frequent_part_of_speech():
    _spacy_or_skip()
    _stems, _index, pos_by_stem = main.extract_en_lookup_tokens(
        "The bear slept. The bear woke. He bore the pain."
    )
    assert pos_by_stem["bear"] == "NOUN"
