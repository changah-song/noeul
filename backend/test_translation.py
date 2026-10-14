import asyncio

import pytest

import translation as t


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class ReadTimeout(Exception):
    """Named like httpx's timeout errors."""


class FakeClient:
    def __init__(self, answers):
        self.answers = answers  # provider url -> FakeResponse | Exception
        self.calls = []

    async def post(self, url, *, params=None, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "params": params, "headers": headers, "json": json})
        answer = self.answers[url]
        if isinstance(answer, Exception):
            raise answer
        return answer


def ok(*texts):
    return FakeResponse({"data": {"translations": [{"translatedText": f" {x} "} for x in texts]}})


BOTH = t.configured_providers("cloud-key", "rapid-key")


def run(client, providers=BOTH, texts=("안녕",)):
    return asyncio.run(t.translate_texts(client, providers, list(texts), source="ko", target="en", timeout=5))


def test_official_api_first_with_key_in_query():
    client = FakeClient({t.GOOGLE_CLOUD_TRANSLATE_URL: ok("hello")})
    assert run(client) == ["hello"]
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["params"] == {"key": "cloud-key"}
    assert call["json"] == {"q": ["안녕"], "source": "ko", "target": "en", "format": "text"}
    assert "X-RapidAPI-Key" not in call["headers"]


def test_falls_back_to_rapidapi_when_official_fails():
    client = FakeClient({
        t.GOOGLE_CLOUD_TRANSLATE_URL: FakeResponse({}, status=403),
        t.RAPIDAPI_TRANSLATE_URL: ok("hello"),
    })
    assert run(client) == ["hello"]
    assert [c["url"] for c in client.calls] == [t.GOOGLE_CLOUD_TRANSLATE_URL, t.RAPIDAPI_TRANSLATE_URL]
    assert client.calls[1]["headers"]["X-RapidAPI-Key"] == "rapid-key"


def test_wrong_number_of_translations_counts_as_failure():
    client = FakeClient({
        t.GOOGLE_CLOUD_TRANSLATE_URL: ok("only one"),
        t.RAPIDAPI_TRANSLATE_URL: ok("a", "b"),
    })
    assert run(client, texts=("가", "나")) == ["a", "b"]


def test_all_failing_raises_and_reports_timeout():
    client = FakeClient({
        t.GOOGLE_CLOUD_TRANSLATE_URL: RuntimeError("boom"),
        t.RAPIDAPI_TRANSLATE_URL: ReadTimeout(),
    })
    with pytest.raises(t.TranslationError) as raised:
        run(client)
    assert raised.value.timed_out


def test_rapidapi_only_still_works():
    client = FakeClient({t.RAPIDAPI_TRANSLATE_URL: ok("hello")})
    assert run(client, providers=t.configured_providers("", "rapid-key")) == ["hello"]


def test_no_provider_configured():
    assert t.configured_providers("", "") == []
    with pytest.raises(t.TranslationError):
        run(FakeClient({}), providers=[])


def test_empty_translation_becomes_none():
    client = FakeClient({t.GOOGLE_CLOUD_TRANSLATE_URL: FakeResponse({"data": {"translations": [{"translatedText": "  "}]}})})
    assert run(client) == [None]


@pytest.mark.parametrize("value,expected", [
    ("en-US", "en"),
    ("EN", "en"),
    ("ko", "ko"),
    ("pt_BR", "pt"),
    ("zh", "zh-CN"),
    ("zh-Hans", "zh-CN"),
    ("zh-Hant", "zh-TW"),
    ("zh-TW", "zh-TW"),
    ("", "ko"),
    (None, "ko"),
])
def test_normalize_language_code(value, expected):
    assert t.normalize_language_code(value, "ko") == expected
