"""/translate_sentences/: a chapter's sentences in one request, each cached."""

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
    monkeypatch.setattr(main, "_translate_cache_put", lambda key, value: store.__setitem__(key, value))
    monkeypatch.setattr(main, "TRANSLATION_PROVIDERS", ["fake"])
    test_client = TestClient(main.app)
    test_client.quota_calls = quota_calls
    test_client.store = store
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
