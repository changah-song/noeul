"""English rare words: lemma repair (trellis, not "trelli") and the frequency
and name tagging that let the app underline a rare word with no entry."""
import main


def test_a_lemma_with_no_entry_falls_back_to_the_written_word(monkeypatch):
    monkeypatch.setattr(main.en_learner_dict, "words_with_entries", lambda words: {"trellis", "door"} & set(words))
    stems, index, pos = main.repair_en_lemmas(
        ["trelli", "door", "epigram"],
        [
            {"surface": "trellis", "stem": "trelli"},
            {"surface": "door", "stem": "door"},
            {"surface": "epigram", "stem": "epigram"},
        ],
        {"trelli": "NOUN", "door": "NOUN", "epigram": "NOUN"},
    )
    assert stems == ["trellis", "door", "epigram"]
    assert {"surface": "trellis", "stem": "trellis"} in index
    assert pos["trellis"] == "NOUN"


def test_frequency_is_attached_and_unknown_proper_nouns_become_names(monkeypatch):
    monkeypatch.setattr(main.en_learner_dict, "zipf_frequencies", lambda words: {"trellis": 2.59})
    no_entry = lambda stem: {"stem": stem, "definition": None, "gloss": None}  # noqa: E731
    results, surfaces = main.attach_en_word_frequency(
        [
            {"stem": "trellis", "definition": "a frame", "gloss": None},
            no_entry("epigram"),
            no_entry("bracknell"),
        ],
        [{"surface": "trellis", "stem": "trellis"}],
        {"trellis": "NOUN", "epigram": "NOUN", "bracknell": "PROPN"},
        set(),
    )
    by_stem = {result["stem"]: result for result in results}
    assert by_stem["trellis"]["zipf"] == 2.59
    assert "zipf" not in by_stem["epigram"]
    assert by_stem["epigram"].get("pos") is None
    assert by_stem["bracknell"]["pos"] == main.EN_NAME_POS
    assert surfaces == [{"surface": "trellis", "stem": "trellis", "zipf": 2.59}]
