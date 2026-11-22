"""/translate_sentences/ and /translate/: sentences through Claude, Google as the fallback, each cached."""

import json

import pytest

main = pytest.importorskip("main", reason="main.py needs the full backend requirements")
from fastapi.testclient import TestClient  # noqa: E402

USER = {"user_id": "user-1", "is_anonymous": False, "claims": {}}


@pytest.fixture
def client(monkeypatch):
    main.app.dependency_overrides[main.verify_supabase_token] = lambda: USER
    quota_calls = []

    async def counting_quota(*_args, **kwargs):
        quota_calls.append(kwargs.get("amount", 1))

    async def unlimited_budget(_chars):
        return True

    store = {}
    monkeypatch.setattr(main, "enforce_daily_quota", counting_quota)
    monkeypatch.setattr(main, "reserve_translate_chars", unlimited_budget)
    monkeypatch.setattr(
        main,
        "_translate_cache_get_many",
        lambda keys: {key: store[key] for key in keys if key in store},
    )
    monkeypatch.setattr(main, "_translate_cache_put_many", lambda rows: store.update(rows))
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", ["fake"])
    # Google alone unless a test turns Claude on (and never the real API).
    monkeypatch.setattr(main, "CLAUDE_TRANSLATION", False)
    monkeypatch.setattr(main, "_translate_cache_get", lambda key: store.get(key))
    monkeypatch.setattr(main, "_get_daily_spend_usd", lambda: 0.0)
    spend = []
    monkeypatch.setattr(main, "_add_daily_spend", spend.append)
    test_client = TestClient(main.app)
    test_client.quota_calls = quota_calls
    test_client.store = store
    test_client.spend = spend
    yield test_client
    main.app.dependency_overrides.clear()


def fake_provider(monkeypatch, calls):
    async def translate_texts(_client, _providers, texts, source, target, timeout):
        calls.append(list(texts))
        return [f"<{target}> {text}" for text in texts]

    monkeypatch.setattr(main, "translate_texts", translate_texts)


def test_translates_a_batch_in_order_and_dedupes(client, monkeypatch):
    calls = []
    fake_provider(monkeypatch, calls)
    response = client.post("/translate_sentences/", json={
        "texts": ["감자를 먹었다.", "", "그래서?", "감자를 먹었다."],
        "source": "ko",
        "target": "es",
    })
    assert response.status_code == 200
    assert response.json()["translations"] == [
        "<es> 감자를 먹었다.",
        None,
        "<es> 그래서?",
        "<es> 감자를 먹었다.",
    ]
    # One provider call, each distinct sentence once.
    assert calls == [["감자를 먹었다.", "그래서?"]]
    # One quota unit for the whole batch.
    assert client.quota_calls == [1]


def test_cached_sentences_are_not_sent_again(client, monkeypatch):
    calls = []
    fake_provider(monkeypatch, calls)
    client.post("/translate_sentences/", json={"texts": ["하나.", "둘."], "source": "ko", "target": "en"})
    calls.clear()
    response = client.post("/translate_sentences/", json={"texts": ["하나.", "셋."], "source": "ko", "target": "en"})
    assert response.json()["translations"] == ["<en> 하나.", "<en> 셋."]
    assert calls == [["셋."]]


def test_rejects_oversized_batches(client, monkeypatch):
    fake_provider(monkeypatch, [])
    too_many = client.post("/translate_sentences/", json={
        "texts": ["가."] * (main.TRANSLATE_SENTENCES_MAX_ITEMS + 1),
        "source": "ko",
        "target": "en",
    })
    assert too_many.status_code == 413
    assert too_many.json()["code"] == "too_many_items"

    too_long = client.post("/translate_sentences/", json={
        "texts": ["가" * 1000] * 13,
        "source": "ko",
        "target": "en",
    })
    assert too_long.status_code == 413
    assert too_long.json()["code"] == "request_too_large"


def test_a_chapter_sized_request_is_answered_from_the_cache_only(client, monkeypatch):
    calls = []
    fake_provider(monkeypatch, calls)
    monkeypatch.setattr(main, "TRANSLATE_CHAPTERS_AHEAD", False)
    monkeypatch.setattr(main, "TRANSLATE_ON_DEMAND_MAX_ITEMS", 8)
    # The reader opened one sentence's translation: translated and cached.
    client.post("/translate_sentences/", json={"texts": ["문장 3."], "source": "ko", "target": "en"})
    assert calls == [["문장 3."]]
    calls.clear()
    client.quota_calls.clear()

    chapter = [f"문장 {index}." for index in range(20)]
    response = client.post("/translate_sentences/", json={"texts": chapter, "source": "ko", "target": "en"})
    assert response.status_code == 200
    expected = [None] * 20
    expected[3] = "<en> 문장 3."
    assert response.json()["translations"] == expected
    # Nothing sent to the provider, nothing counted against the reader.
    assert calls == []
    assert client.quota_calls == []


def test_a_span_of_a_few_sentences_is_still_translated(client, monkeypatch):
    calls = []
    fake_provider(monkeypatch, calls)
    monkeypatch.setattr(main, "TRANSLATE_CHAPTERS_AHEAD", False)
    monkeypatch.setattr(main, "TRANSLATE_ON_DEMAND_MAX_ITEMS", 8)
    span = [f"문장 {index}." for index in range(8)]
    response = client.post("/translate_sentences/", json={"texts": span, "source": "ko", "target": "en"})
    assert response.json()["translations"] == [f"<en> {text}" for text in span]


def test_chapters_ahead_can_be_switched_back_on(client, monkeypatch):
    calls = []
    fake_provider(monkeypatch, calls)
    monkeypatch.setattr(main, "TRANSLATE_CHAPTERS_AHEAD", True)
    chapter = [f"문장 {index}." for index in range(20)]
    response = client.post("/translate_sentences/", json={"texts": chapter, "source": "ko", "target": "en"})
    assert response.json()["translations"] == [f"<en> {text}" for text in chapter]
    assert calls == [chapter]


class Usage:
    input_tokens = 1_000_000
    output_tokens = 0


def fake_claude(monkeypatch, calls, fail=False):
    """Claude on, answering through a stand-in for the API call."""
    monkeypatch.setattr(main, "CLAUDE_TRANSLATION", True)

    async def call(request, *, timeout, retries):
        content = request["messages"][0]["content"]
        texts = [content] if request["output_format"] is None else json.loads(content)["texts"]
        calls.append({"texts": texts, "timeout": timeout, "retries": retries})
        if fail:
            raise RuntimeError("overloaded")
        if request["output_format"] is None:
            return f"[claude] {texts[0]}", "end_turn", Usage()
        return json.dumps({"translations": [f"[claude] {text}" for text in texts]}), "end_turn", Usage()

    monkeypatch.setattr(main, "_claude_translation_call", call)


def no_google_budget(monkeypatch, reserved):
    async def reserve(chars):
        reserved.append(chars)
        return True

    monkeypatch.setattr(main, "reserve_translate_chars", reserve)


def test_claude_translates_and_google_is_not_charged(client, monkeypatch):
    claude_calls, google_calls, reserved = [], [], []
    fake_claude(monkeypatch, claude_calls)
    fake_provider(monkeypatch, google_calls)
    no_google_budget(monkeypatch, reserved)
    response = client.post("/translate_sentences/", json={"texts": ["하나.", "둘."], "source": "ko", "target": "en"})
    assert response.json()["translations"] == ["[claude] 하나.", "[claude] 둘."]
    assert google_calls == [] and reserved == []
    # A sentence a reader is waiting on: short timeout, no retry, Google next.
    assert claude_calls[0]["timeout"] == main.ON_DEMAND_CLAUDE_TIMEOUT_SECONDS
    assert claude_calls[0]["retries"] == 0
    # The cost reaches the daily AI budget (1M input tokens of Haiku 5.5 = $0.10).
    assert client.spend == [pytest.approx(0.10)]
    # And the translations are cached for everyone.
    claude_calls.clear()
    client.post("/translate_sentences/", json={"texts": ["하나."], "source": "ko", "target": "en"})
    assert claude_calls == []


def test_google_takes_over_a_sentence_when_claude_fails(client, monkeypatch):
    claude_calls, google_calls = [], []
    fake_claude(monkeypatch, claude_calls, fail=True)
    fake_provider(monkeypatch, google_calls)
    response = client.post("/translate_sentences/", json={"texts": ["하나."], "source": "ko", "target": "en"})
    assert response.json()["translations"] == ["<en> 하나."]
    assert google_calls == [["하나."]]


def test_a_chapter_ahead_never_falls_back_to_google(client, monkeypatch):
    claude_calls, google_calls = [], []
    fake_claude(monkeypatch, claude_calls, fail=True)
    fake_provider(monkeypatch, google_calls)
    monkeypatch.setattr(main, "TRANSLATE_CHAPTERS_AHEAD", True)
    chapter = [f"문장 {index}." for index in range(20)]
    response = client.post("/translate_sentences/", json={"texts": chapter, "source": "ko", "target": "en"})
    assert response.status_code == 200
    assert response.json()["translations"] == [None] * 20
    assert google_calls == []
    assert claude_calls[0]["timeout"] == main.AHEAD_CLAUDE_TIMEOUT_SECONDS


def test_a_chapter_ahead_goes_to_claude(client, monkeypatch):
    claude_calls = []
    fake_claude(monkeypatch, claude_calls)
    fake_provider(monkeypatch, [])
    monkeypatch.setattr(main, "TRANSLATE_CHAPTERS_AHEAD", True)
    chapter = [f"문장 {index}." for index in range(40)]
    response = client.post("/translate_sentences/", json={"texts": chapter, "source": "ko", "target": "en"})
    assert response.json()["translations"] == [f"[claude] {text}" for text in chapter]
    assert sorted(len(call["texts"]) for call in claude_calls) == [15, 25]


def test_google_is_used_when_the_ai_budget_is_spent(client, monkeypatch):
    claude_calls, google_calls = [], []
    fake_claude(monkeypatch, claude_calls)
    fake_provider(monkeypatch, google_calls)
    monkeypatch.setattr(main, "_get_daily_spend_usd", lambda: main.DAILY_AI_BUDGET_USD)
    response = client.post("/translate_sentences/", json={"texts": ["하나."], "source": "ko", "target": "en"})
    assert response.json()["translations"] == ["<en> 하나."]
    assert claude_calls == []


def test_nothing_translated_without_google_is_an_error(client, monkeypatch):
    fake_claude(monkeypatch, [], fail=True)
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", [])
    response = client.post("/translate_sentences/", json={"texts": ["하나."], "source": "ko", "target": "en"})
    assert response.status_code == 502
    assert response.json()["code"] == "translate_failed"


def test_translate_endpoint_uses_claude_then_google(client, monkeypatch):
    claude_calls, google_calls = [], []
    fake_claude(monkeypatch, claude_calls)
    fake_provider(monkeypatch, google_calls)
    response = client.post("/translate/", json={"query": "안녕하세요.", "source": "ko", "target": "en-US"})
    assert response.json()["translatedText"] == "[claude] 안녕하세요."
    assert claude_calls[0]["timeout"] == main.INTERACTIVE_CLAUDE_TIMEOUT_SECONDS
    assert google_calls == []

    fake_claude(monkeypatch, [], fail=True)
    response = client.post("/translate/", json={"query": "고마워요.", "source": "ko", "target": "en"})
    assert response.json()["translatedText"] == "<en> 고마워요."
    assert google_calls == [["고마워요."]]


@pytest.mark.parametrize("value,claude_on,expected", [
    (None, True, True),
    ("", False, False),
    ("off", True, False),
    ("0", True, False),
    ("on", False, True),
    ("TRUE", False, True),
])
def test_chapters_ahead_defaults_to_on_with_claude(value, claude_on, expected):
    assert main.chapters_ahead_setting(value, claude_on) is expected
