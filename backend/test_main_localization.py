"""Endpoint-level localization checks against main.py.

main.py imports the full backend stack (FastAPI, PyJWT, NLP libraries), which
CI's minimal test job doesn't install, so this module skips itself there and
runs wherever the backend venv is available.
"""

import asyncio
import types

import pytest

main = pytest.importorskip("main", reason="main.py needs the full backend requirements")
from fastapi.testclient import TestClient  # noqa: E402

USER = {"user_id": "user-1", "is_anonymous": False, "claims": {}}


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[main.verify_supabase_token] = lambda: USER

    async def no_quota(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "enforce_daily_quota", no_quota)
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


@pytest.fixture
def memory_translate_cache(monkeypatch):
    store = {}
    monkeypatch.setattr(main, "_translate_cache_get", lambda key: store.get(key))
    monkeypatch.setattr(main, "_translate_cache_put", lambda key, value: store.__setitem__(key, value))
    return store


# ─── /translate_content/ ─────────────────────────────────────────────────────

def test_translate_content_translates_and_caches(client, monkeypatch, memory_translate_cache):
    calls = []

    async def fake_batch(texts, source="en", target="en", batch_size=100):
        calls.append((list(texts), source, target))
        return [f"{target}:{text}" for text in texts]

    monkeypatch.setattr(main, "_translate_batch", fake_batch)
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", ["fake"])

    body = {"texts": ["water", "fire", "water", ""], "kind": "hanja_meaning"}
    response = client.post("/translate_content/", json=body, headers={"X-Interface-Language": "ja"})
    assert response.status_code == 200
    data = response.json()
    assert data["interface_language"] == "ja"
    assert data["translations"] == ["ja:water", "ja:fire", "ja:water", None]
    assert calls == [(["water", "fire"], "en", "ja")]

    # Second request is served from the cache: no provider call.
    again = client.post("/translate_content/", json={"texts": ["fire"], "interface_language": "ja"})
    assert again.json()["translations"] == ["ja:fire"]
    assert len(calls) == 1

    # Traditional Chinese goes to Google as zh-TW and is cached separately.
    hant = client.post("/translate_content/", json={"texts": ["fire"], "interface_language": "zh-Hant"})
    assert hant.json()["translations"] == ["zh-TW:fire"]


def test_translate_content_english_is_passthrough(client):
    response = client.post("/translate_content/", json={"texts": ["water"], "interface_language": "en"})
    assert response.json()["translations"] == ["water"]


def test_translate_content_failure_returns_nulls(client, monkeypatch, memory_translate_cache):
    async def failing_batch(texts, **_kwargs):
        return [None] * len(texts)

    monkeypatch.setattr(main, "_translate_batch", failing_batch)
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", ["fake"])
    response = client.post("/translate_content/", json={"texts": ["water"], "interface_language": "pt"})
    assert response.json()["translations"] == [None]
    assert memory_translate_cache == {}


def test_translate_content_rejects_oversized_with_code(client):
    response = client.post("/translate_content/", json={"texts": ["x"] * 65, "interface_language": "ja"})
    assert response.status_code == 413
    assert response.json()["code"] == "too_many_items"
    assert response.json()["params"] == {"limit": 64}


# ─── coded errors from real endpoints ────────────────────────────────────────

def test_assess_entry_anonymous_gets_coded_error():
    main.app.dependency_overrides[main.verify_supabase_token] = lambda: {**USER, "is_anonymous": True}
    try:
        response = TestClient(main.app).post("/assess_entry/", json={"body": "안녕"})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 403
    assert response.json()["code"] == "sign_in_required"


def test_assess_entry_too_short_is_coded(client, monkeypatch):
    monkeypatch.setattr(main, "anthropic_sdk", object())
    monkeypatch.setattr(main, "ANTHROPIC_API_KEY", "test")
    response = client.post("/assess_entry/", json={"body": "짧아요", "language": "ko"})
    assert response.status_code == 422
    data = response.json()
    assert data["code"] == "entry_too_short_words"
    assert data["params"]["length"] == 1
    assert data["params"]["min"] > 1


# ─── writing feedback language ───────────────────────────────────────────────

def test_assess_entry_prompts_in_interface_language(client, monkeypatch):
    captured = {}

    class FakeMessages:
        async def create(self, **kwargs):
            captured.update(kwargs)
            text = (
                '{"annotations": [{"id": "1", "type": "NATIVE_INSERT", "original": "school",'
                ' "explanation": "学校は韓国語で학교です。", "suggestions": ["학교"], "suggestion_notes": ["自然です"]}],'
                ' "summary": {"patterns": ["p"], "strengths": ["s"], "vocab_items": []}}'
            )
            return types.SimpleNamespace(content=[types.SimpleNamespace(text=text)], usage=None)

    class FakeClient:
        messages = FakeMessages()

        def with_options(self, **_kwargs):
            return self

    async def noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "anthropic_sdk", object())
    monkeypatch.setattr(main, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(main, "get_anthropic_async_client", lambda: FakeClient())
    monkeypatch.setattr(main, "enforce_assessment_quota", noop)
    monkeypatch.setattr(main, "enforce_ai_budget", noop)
    monkeypatch.setattr(main, "record_ai_spend", noop)

    body = " ".join(["나는 오늘 school 에 갔어요."] * 8)
    response = client.post(
        "/assess_entry/",
        json={"body": body, "language": "ko", "category": "reflective", "interface_language": "ja"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["feedback_language"] == "ja"
    system = captured["system"]
    assert "in Japanese" in system
    assert "written in English" not in system

    # Header fallback when the body has no interface_language (older builds).
    response = client.post(
        "/assess_entry/",
        json={"body": body, "language": "ko"},
        headers={"X-Interface-Language": "vi"},
    )
    assert response.json()["feedback_language"] == "vi"
    assert "in Vietnamese" in captured["system"]


# ─── English fallbacks are labelled ─────────────────────────────────────────

def test_zh_results_untranslated_are_labelled_english(monkeypatch):
    async def no_translation(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "_translate_text", no_translation)
    results = asyncio.run(
        main.translate_zh_results([{"stem": "水", "word": "水", "definition": "water"}], "fr")
    )
    assert results[0]["definition"] == "water"
    assert results[0]["interface_language"] == "en"
    assert results[0]["fallback_language"] == "en"


def test_zh_preprocess_untranslated_are_labelled_english(monkeypatch):
    async def no_batch(texts, **_kwargs):
        return [None] * len(texts)

    monkeypatch.setattr(main, "_fetch_cached_zh_translations", lambda stems, lang: {})
    monkeypatch.setattr(main, "_store_zh_translations", lambda entries, lang: None)
    monkeypatch.setattr(main, "_translate_batch", no_batch)
    results = asyncio.run(
        main.translate_and_cache_zh_preprocess([{"stem": "水", "definition": "water"}], "th")
    )
    assert results[0]["interface_language"] == "en"
    assert results[0]["fallback_language"] == "en"


def test_explain_uses_header_language(monkeypatch):
    from content_i18n import reset_request_interface_language, set_request_interface_language

    async def no_quota(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "anthropic_sdk", object())
    monkeypatch.setattr(main, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(main, "enforce_daily_quota", no_quota)
    token = set_request_interface_language("id")
    try:
        req = asyncio.run(main._prepare_explain_request({"word": "물", "sentence": "물을 마셔요."}, USER))
    finally:
        reset_request_interface_language(token)
    assert req.interface_language == "id"
    # The explanation cache key carries the interface language.
    assert req.cache_key.startswith(main.lookup_cache_key("물", "물을 마셔요.", "ko", "id"))
    assert not req.cache_key.startswith(main.lookup_cache_key("물", "물을 마셔요.", "ko", "en"))


def test_explain_selection_mode_allows_longer_text_and_separate_cache(monkeypatch):
    async def no_quota(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "anthropic_sdk", object())
    monkeypatch.setattr(main, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(main, "enforce_daily_quota", no_quota)
    phrase = "a Canadian author best known for a series of novels beginning with Anne"
    sentence = f"L.M. Montgomery was {phrase} of Green Gables."
    assert len(phrase) > main.EXPLAIN_WORD_MAX_CHARS

    req = asyncio.run(main._prepare_explain_request(
        {"word": phrase, "sentence": sentence, "language": "en", "mode": "selection"}, USER
    ))
    assert req.mode == "selection"
    assert req.cache_key.endswith(":sel")

    # The same text as a tapped word is still refused.
    with pytest.raises(main.ApiError):
        asyncio.run(main._prepare_explain_request({"word": phrase, "sentence": sentence, "language": "en"}, USER))
