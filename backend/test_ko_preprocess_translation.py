"""Korean chapter preprocessing returns definitions in the interface language.

The Korean pipeline reads English KRDICT senses; translate_ko_preprocess_results
turns them into the learner's language (cached in translate_cache) so the
reader's under-word translations follow the app language.
"""

import asyncio

import pytest

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


def test_definitions_are_translated_once_and_cached(monkeypatch, batch_cache):
    calls = []

    async def fake_batch(texts, source="en", target="en", batch_size=100):
        calls.append(list(texts))
        return [f"[{target}] {text}" for text in texts]

    monkeypatch.setattr(main, "_translate_batch", fake_batch)
    results = [
        {"stem": "가난", "definition": "poverty"},
        {"stem": "빈곤", "definition": "poverty"},
        {"stem": "없음", "definition": None},
    ]
    out = asyncio.run(main.translate_ko_preprocess_results(results, "es"))
    assert out[0]["definition"] == "[es] poverty"
    assert out[0]["interface_language"] == "es"
    assert out[1]["definition"] == "[es] poverty"
    assert out[2]["definition"] is None
    # Identical definitions are translated once.
    assert calls == [["poverty"]]

    # A later chapter reuses the cache: no provider call.
    calls.clear()
    again = asyncio.run(main.translate_ko_preprocess_results([{"stem": "가난", "definition": "poverty"}], "es"))
    assert again[0]["definition"] == "[es] poverty"
    assert calls == []


def test_untranslated_definitions_are_labelled_english(monkeypatch, batch_cache):
    async def failing_batch(texts, source="en", target="en", batch_size=100):
        return [None for _ in texts]

    monkeypatch.setattr(main, "_translate_batch", failing_batch)
    out = asyncio.run(main.translate_ko_preprocess_results([{"stem": "가난", "definition": "poverty"}], "vi"))
    assert out[0]["definition"] == "poverty"
    assert out[0]["interface_language"] == "en"
    assert out[0]["fallback_language"] == "en"


def test_english_interface_is_untouched(monkeypatch, batch_cache):
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("no translation for English")

    monkeypatch.setattr(main, "_translate_batch", unexpected)
    results = [{"stem": "가난", "definition": "poverty"}]
    assert asyncio.run(main.translate_ko_preprocess_results(results, "en")) == results
