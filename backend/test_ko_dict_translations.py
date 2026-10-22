"""Korean definitions in the interface language come from ko_dict.db.

The bundled snapshot carries KRDICT's own glosses in its other languages, so a
Vietnamese or Japanese user gets their language without a live KRDICT call:
tap lookups read it directly, and chapter preprocessing swaps it in before
falling back to machine translation.
"""

import asyncio

import pytest

main = pytest.importorskip("main", reason="main.py needs the full backend requirements")

pytestmark = pytest.mark.skipif(
    not main.is_ko_dict_db_installed(), reason="backend/ko_dict.db is not installed"
)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def no_live_krdict(monkeypatch):
    calls = []

    async def fail_live(*args, **kwargs):
        calls.append(args)
        raise AssertionError("live KRDICT should not be called")

    monkeypatch.setattr(main, "search_krdict_live", fail_live)
    return calls


def test_snapshot_covers_krdict_languages_but_not_chinese():
    assert main.ko_dict_covers_language("en")
    assert main.ko_dict_covers_language("vi")
    assert main.ko_dict_covers_language("ja")
    assert not main.ko_dict_covers_language("zh")
    assert not main.ko_dict_covers_language("pt")


def test_vietnamese_tap_is_answered_from_the_snapshot(no_live_krdict):
    results = run(main.search_krdict_entries(None, "가격", "key", "vi"))
    assert [result["transWord"] for result in results[:2]] == [
        "giá cả, giá",
        "sự đánh đập, sự ra đòn",
    ]
    assert results[0]["origin"] == "價格"
    assert not any(result.get("fallback_language") for result in results)
    assert no_live_krdict == []


def test_english_tap_still_reads_the_english_table(no_live_krdict):
    results = run(main.search_krdict_entries(None, "가격", "key", "en"))
    assert "price" in results[0]["transWord"]


def test_snapshot_miss_goes_to_live_krdict(monkeypatch):
    async def live(client, query, key, trans_lang):
        return [{"word": query, "transWord": f"live {trans_lang}"}]

    monkeypatch.setattr(main, "search_krdict_live", live)
    results = run(main.search_krdict_entries(None, "없는낱말이다", "key", "vi"))
    assert results == [{"word": "없는낱말이다", "transWord": "live 7"}]


def test_repeated_krdict_failures_stop_tap_lookups_waiting(monkeypatch):
    calls = []

    async def failing_live(client, query, key, trans_lang):
        calls.append(query)
        raise main.KrdictUnavailableError("timeout")

    monkeypatch.setattr(main, "search_krdict_live", failing_live)
    monkeypatch.setattr(main, "_krdict_cooldown_until", 0.0)
    monkeypatch.setattr(main, "_krdict_tap_failures", 0)

    for _ in range(main.KRDICT_MAX_CONSECUTIVE_FAILURES):
        run(main.search_krdict_entries(None, "없는낱말이다", "key", "zh"))
    assert len(calls) == main.KRDICT_MAX_CONSECUTIVE_FAILURES

    # Cooling down: the next lookup falls back without calling KRDICT.
    run(main.search_krdict_entries(None, "없는낱말이다", "key", "zh"))
    assert len(calls) == main.KRDICT_MAX_CONSECUTIVE_FAILURES


def test_preprocess_results_take_the_snapshot_gloss_and_skip_machine_translation(monkeypatch):
    translated = []

    async def fake_batch(texts, source="en", target="en", batch_size=100):
        translated.extend(texts)
        return [f"[{target}] {text}" for text in texts]

    monkeypatch.setattr(main, "_translate_batch", fake_batch)
    monkeypatch.setattr(main, "_translate_cache_get_many", lambda keys: {})
    monkeypatch.setattr(main, "_translate_cache_put", lambda key, value: None)

    results = [
        {"stem": "사람", "definition": "human; person"},
        {"stem": "없는낱말이다", "definition": "made-up word"},
        {"stem": "가격", "definition": None},
    ]
    with_snapshot = main.apply_ko_dict_translations(results, "vi")
    out = run(main.translate_ko_preprocess_results(with_snapshot, "vi"))

    assert "người" in out[0]["definition"]
    assert out[0]["interface_language"] == "vi"
    assert out[1] == {"stem": "없는낱말이다", "definition": "[vi] made-up word", "interface_language": "vi"}
    assert out[2]["definition"] is None
    # Only the word the snapshot lacks went to machine translation.
    assert translated == ["made-up word"]


def test_english_preprocess_results_are_untouched():
    results = [{"stem": "사람", "definition": "human; person"}]
    assert main.apply_ko_dict_translations(results, "en") == results
