import asyncio
import json

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


# --- Claude ------------------------------------------------------------------


class FakeClaude:
    """Answers each request by echoing its texts tagged with the target code,
    unless told to misbehave for chunks whose first text is listed."""

    def __init__(self, fail=(), stop=None, short=()):
        self.fail, self.stop, self.short = set(fail), stop, set(short)
        self.requests = []

    async def __call__(self, request):
        self.requests.append(request)
        content = request["messages"][0]["content"]
        if request["output_format"] is None:
            if content in self.fail:
                raise RuntimeError("overloaded")
            return f" <{content}> ", self.stop or "end_turn", {"texts": 1}
        texts = json.loads(content)["texts"]
        if texts[0] in self.fail:
            raise RuntimeError("overloaded")
        translations = [f"<{text}>" for text in texts]
        if texts[0] in self.short:
            translations = translations[:-1]
        usage = {"texts": len(texts)}
        return json.dumps({"translations": translations}), self.stop or "end_turn", usage


def claude(call, texts, source="ko", target="en"):
    return asyncio.run(t.translate_with_claude(call, list(texts), source=source, target=target))


def test_claude_translates_in_order_and_reports_usage():
    call = FakeClaude()
    translations, usages = claude(call, ["하나.", "둘."])
    assert translations == ["<하나.>", "<둘.>"]
    assert usages == [{"texts": 2}]
    request = call.requests[0]
    assert "Korean into English" in request["system"]
    assert json.loads(request["messages"][0]["content"]) == {"texts": ["하나.", "둘."]}
    assert request["output_format"]["schema"] == t.TRANSLATIONS_SCHEMA


def test_claude_splits_a_chapter_into_chunks():
    texts = [f"문장 {index}." for index in range(60)]
    call = FakeClaude()
    translations, usages = claude(call, texts)
    assert translations == [f"<{text}>" for text in texts]
    assert [len(json.loads(r["messages"][0]["content"])["texts"]) for r in call.requests] == [25, 25, 10]
    assert len(usages) == 3


def test_claude_chunks_also_cap_characters():
    long_text = "가" * 1500
    chunks = t.claude_chunks([long_text, long_text, "짧다."])
    assert chunks == [[long_text], [long_text, "짧다."]]


def test_a_failed_chunk_leaves_only_its_texts_untranslated():
    texts = [f"문장 {index}." for index in range(30)]
    call = FakeClaude(fail={"문장 25."})
    translations, usages = claude(call, texts)
    assert translations[:25] == [f"<{text}>" for text in texts[:25]]
    assert translations[25:] == [None] * 5
    assert len(usages) == 1  # the failed call billed nothing


def test_wrong_count_or_early_stop_counts_as_failure_but_is_still_billed():
    translations, usages = claude(FakeClaude(short={"가."}), ["가.", "나."])
    assert translations == [None, None]
    assert len(usages) == 1
    translations, usages = claude(FakeClaude(stop="max_tokens"), ["가."])
    assert translations == [None]
    assert len(usages) == 1


def test_a_lone_text_goes_as_plain_text():
    call = FakeClaude()
    translations, usages = claude(call, ["안녕하세요."], target="ja")
    assert translations == ["<안녕하세요.>"]
    request = call.requests[0]
    assert request["output_format"] is None
    assert request["messages"][0]["content"] == "안녕하세요."
    assert "Korean into Japanese" in request["system"] and "translation only" in request["system"]


def test_claude_names_both_chinese_scripts_and_unknown_codes():
    assert "Traditional Chinese" in t.claude_translation_request(["x"], source="ko", target="zh-TW")["system"]
    assert "Simplified Chinese" in t.claude_translation_request(["x"], source="zh-CN", target="en")["system"]
    assert "code 'xx'" in t.claude_translation_request(["x"], source="ko", target="xx")["system"]


def test_max_tokens_grows_with_the_text_but_is_capped():
    assert t.claude_translation_request(["가" * 10], source="ko", target="en")["max_tokens"] == 296
    assert t.claude_translation_request(["가" * 5000], source="ko", target="en")["max_tokens"] == 8192
