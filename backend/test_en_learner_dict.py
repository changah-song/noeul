"""English for learners: the bundled en_learner.db and the endpoints' use of it.

A lookup shows the English senses plus the equivalent words in the learner's
language from Wiktionary (run -> 달리다); only a word with no equivalent gets a
machine translation of the headword.
"""

import asyncio

import pytest

import en_learner_dict

pytestmark = pytest.mark.skipif(not en_learner_dict.is_installed(), reason="en_learner.db is not built")


def test_entries_carry_senses_and_korean_equivalents():
    entries = en_learner_dict.lookup_entries(["run"], "ko")["run"]
    first = entries[0]
    assert first["pos"] == "verb"
    assert first["ipa"]
    assert first["senses"] and first["definition"].split("\n") == first["senses"]
    assert "달리다" in first["equivalents"]
    assert first["gloss"].startswith("달리다")


def test_homographs_stay_separate_with_their_own_equivalents():
    entries = en_learner_dict.lookup_entries(["bank"], "ko")["bank"]
    glosses = [entry["gloss"] for entry in entries]
    assert glosses[0] == "은행"
    assert "둑" in glosses


def test_chinese_equivalents_follow_the_script():
    simplified = en_learner_dict.lookup_entries(["bank"], "zh")["bank"][0]["equivalents"]
    traditional = en_learner_dict.lookup_entries(["bank"], "zh-Hant")["bank"][0]["equivalents"]
    assert simplified == ["银行"]
    assert traditional == ["銀行"]


def test_spelling_variants_and_case_resolve_to_the_main_entry():
    out = en_learner_dict.lookup_entries(["Apologise", "Happy"], "ko")
    assert out["apologise"][0]["word"] == "apologize"
    assert out["happy"][0]["stem"] == "happy"


def test_english_interface_gets_no_equivalents_and_unknown_words_are_absent():
    out = en_learner_dict.lookup_entries(["run", "qzxvwordnotreal"], "en")
    assert out["run"][0]["equivalents"] == []
    assert "qzxvwordnotreal" not in out


def test_best_entry_prefers_a_common_entry_with_an_equivalent():
    entries = [
        {"word": "x", "equivalents": []},
        {"word": "y", "equivalents": ["와이"]},
        {"word": "z", "equivalents": ["제트"]},
    ]
    assert en_learner_dict.best_entry(entries)["word"] == "y"
    assert en_learner_dict.best_entry([{"word": "x", "equivalents": []}])["word"] == "x"
    assert en_learner_dict.best_entry([]) is None


main = pytest.importorskip("main", reason="main.py needs the full backend requirements")


@pytest.fixture
def batch_cache(monkeypatch):
    store = {}
    monkeypatch.setattr(
        main,
        "_translate_cache_get_many",
        lambda keys: {key: store[key] for key in keys if key in store},
    )
    monkeypatch.setattr(main, "_translate_cache_put", lambda key, value: store.__setitem__(key, value))
    return store


def test_preprocess_results_keep_definitions_for_every_language():
    results, found = main.lookup_en_learner_results(["run", "qzxvwordnotreal"], "ko")
    assert found == 1
    assert results[0]["definition"] and results[0]["gloss"].startswith("달리다")
    assert results[1]["definition"] is None


def test_only_words_without_an_equivalent_are_machine_translated(monkeypatch, batch_cache):
    calls = []

    async def fake_batch(texts, source="en", target="en", batch_size=100):
        calls.append((list(texts), target))
        return [f"[{target}] {text}" for text in texts]

    monkeypatch.setattr(main, "_translate_batch", fake_batch)
    results = [
        {"word": "run", "definition": "To move swiftly.", "gloss": "달리다"},
        {"word": "lexeme", "definition": "A unit of meaning.", "gloss": None},
        {"word": "qzxv", "definition": None, "gloss": None},
    ]
    out = asyncio.run(main.translate_en_missing_glosses(results, "zh-Hant"))
    assert calls == [(["lexeme"], "zh-TW")]
    assert out[0]["gloss"] == "달리다"
    assert out[1]["gloss"] == "[zh-TW] lexeme"
    assert out[1]["gloss_source"] == "machine"
    assert out[2]["gloss"] is None

    calls.clear()
    asyncio.run(main.translate_en_missing_glosses(results, "zh-Hant"))
    assert calls == []


def test_english_interface_is_left_alone(monkeypatch, batch_cache):
    async def fail(*args, **kwargs):
        raise AssertionError("should not translate")

    monkeypatch.setattr(main, "_translate_batch", fail)
    results = [{"word": "lexeme", "definition": "A unit.", "gloss": None}]
    assert asyncio.run(main.translate_en_missing_glosses(results, "en")) == results


def test_tokenizer_keeps_common_verbs_and_drops_function_words():
    lemmas, surfaces, _pos = main.extract_en_lookup_tokens(
        "She didn't want to give up, so she kept running and made it home."
    )
    for lemma in ("give", "keep", "run", "make", "want", "home"):
        assert lemma in lemmas
    for skipped in ("she", "do", "so", "it", "to"):
        assert skipped not in lemmas
    assert {"surface": "running", "stem": "run"} in surfaces
