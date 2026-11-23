"""Dictionary text (a chapter's definitions and headwords, a searched word's
gloss, bundled content): Claude first, Google only for what Claude left."""

import asyncio
import json

import pytest

main = pytest.importorskip("main", reason="main.py needs the full backend requirements")
from fastapi.testclient import TestClient  # noqa: E402

USER = {"user_id": "user-1", "is_anonymous": False, "claims": {}}


class Usage:
    input_tokens = 1_000_000
    output_tokens = 0


@pytest.fixture
def engines(monkeypatch):
    """Claude and Google both stood in for, with what each was sent."""
    state = {"claude": [], "google": [], "reserved": [], "spend": [], "cache": {}, "claude_fails": set()}

    async def claude_call(request, *, timeout, retries):
        content = request["messages"][0]["content"]
        texts = [content] if request["output_format"] is None else json.loads(content)["texts"]
        state["claude"].append({"texts": texts, "system": request["system"], "timeout": timeout, "retries": retries})
        if state["claude_fails"] & set(texts):
            raise RuntimeError("overloaded")
        if request["output_format"] is None:
            return f"[claude] {texts[0]}", "end_turn", Usage()
        return json.dumps({"translations": [f"[claude] {text}" for text in texts]}), "end_turn", Usage()

    async def google_call(_client, _providers, texts, source, target, timeout):
        state["google"].append(list(texts))
        return [f"[google] {text}" for text in texts]

    async def reserve(chars):
        state["reserved"].append(chars)
        return True

    monkeypatch.setattr(main, "CLAUDE_TRANSLATION", True)
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", ["fake"])
    monkeypatch.setattr(main, "_claude_translation_call", claude_call)
    monkeypatch.setattr(main, "translate_texts", google_call)
    monkeypatch.setattr(main, "reserve_translate_chars", reserve)
    monkeypatch.setattr(main, "_get_daily_spend_usd", lambda: 0.0)
    monkeypatch.setattr(main, "_add_daily_spend", state["spend"].append)
    monkeypatch.setattr(main, "_translate_cache_get", lambda key: state["cache"].get(key))
    monkeypatch.setattr(
        main, "_translate_cache_get_many", lambda keys: {key: state["cache"][key] for key in keys if key in state["cache"]}
    )
    monkeypatch.setattr(main, "_translate_cache_put_many", lambda rows: state["cache"].update(rows))
    return state


def batch(texts, source="en", target="ko"):
    return asyncio.run(main._translate_batch(list(texts), source=source, target=target))


def test_a_chapters_definitions_go_to_claude_and_google_is_not_charged(engines):
    senses = [f"sense {index}" for index in range(60)]
    assert batch(senses) == [f"[claude] {sense}" for sense in senses]
    assert engines["google"] == [] and engines["reserved"] == []
    # As dictionary text, in chunks, each call on the dictionary's own clock.
    assert [len(call["texts"]) for call in engines["claude"]] == [25, 25, 10]
    for call in engines["claude"]:
        assert "dictionary text from English into Korean" in call["system"]
        assert call["timeout"] == main.DICTIONARY_CLAUDE_TIMEOUT_SECONDS
        assert call["retries"] == 0
    # Every call counts against the daily AI budget.
    assert engines["spend"] == [pytest.approx(0.10)] * 3


def test_google_takes_only_what_claude_left(engines):
    senses = [f"sense {index}" for index in range(30)]
    engines["claude_fails"] = {"sense 25"}  # the second chunk (senses 25-29) fails
    out = batch(senses)
    assert out[:25] == [f"[claude] {sense}" for sense in senses[:25]]
    assert out[25:] == [f"[google] {sense}" for sense in senses[25:]]
    assert engines["google"] == [senses[25:]]
    assert engines["reserved"] == [sum(len(sense) for sense in senses[25:])]


def test_with_the_google_engine_everything_goes_to_google(engines, monkeypatch):
    monkeypatch.setattr(main, "CLAUDE_TRANSLATION", False)
    assert batch(["one", "two"]) == ["[google] one", "[google] two"]
    assert engines["claude"] == []
    assert engines["google"] == [["one", "two"]]


def test_claude_alone_is_enough(engines, monkeypatch):
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", [])
    engines["claude_fails"] = {"two"}
    assert batch(["one"]) == ["[claude] one"]
    # Nothing to fall back to: what Claude could not do stays untranslated.
    assert batch(["two"]) == [None]
    assert engines["google"] == []


def test_google_takes_over_when_the_ai_budget_is_spent(engines, monkeypatch):
    monkeypatch.setattr(main, "_get_daily_spend_usd", lambda: main.DAILY_AI_BUDGET_USD)
    assert batch(["one"]) == ["[google] one"]
    assert engines["claude"] == []


def test_empty_texts_are_not_sent_and_same_language_is_untouched(engines):
    assert batch(["one", "", "  ", "two"]) == ["[claude] one", None, None, "[claude] two"]
    assert engines["claude"][0]["texts"] == ["one", "two"]
    assert batch(["one"], source="en", target="en") == [None]
    assert batch([]) == []
    assert len(engines["claude"]) == 1


def test_a_searched_words_gloss_goes_to_claude_as_dictionary_text_and_is_cached(engines):
    assert asyncio.run(main._translate_text("to study; to learn", source="en", target="ja")) == "[claude] to study; to learn"
    call = engines["claude"][0]
    assert "dictionary text from English into Japanese" in call["system"]
    assert call["timeout"] == main.ON_DEMAND_CLAUDE_TIMEOUT_SECONDS and call["retries"] == 0
    assert engines["google"] == []
    # Cached for everyone: nothing is sent the second time.
    assert asyncio.run(main._translate_text("to study; to learn", source="en", target="ja")) == "[claude] to study; to learn"
    assert len(engines["claude"]) == 1


def test_a_searched_words_gloss_falls_back_to_google(engines):
    engines["claude_fails"] = {"fire"}
    assert asyncio.run(main._translate_text("fire", source="en", target="ja")) == "[google] fire"
    assert engines["google"] == [["fire"]]


def test_english_senses_of_a_chapter_reach_claude(engines):
    results = [{
        "stem": "idol",
        "word": "idol",
        "senses": ["A representation of a deity.", "Someone particularly revered."],
        "translated_senses": ["신의 형상.", None],
    }]
    out = asyncio.run(main.translate_en_missing_senses(results, "ko"))
    assert out[0]["translated_senses"] == ["신의 형상.", "[claude] Someone particularly revered."]
    assert engines["claude"][0]["texts"] == ["Someone particularly revered."]
    assert engines["google"] == []


def test_translate_content_works_without_google(engines, monkeypatch):
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", [])

    async def no_quota(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "enforce_daily_quota", no_quota)
    main.app.dependency_overrides[main.verify_supabase_token] = lambda: USER
    try:
        response = TestClient(main.app).post(
            "/translate_content/", json={"texts": ["fire", "water"], "kind": "hanja_meaning", "interface_language": "ja"}
        )
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["translations"] == ["[claude] fire", "[claude] water"]
    assert engines["google"] == []
