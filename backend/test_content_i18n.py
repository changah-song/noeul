"""Interface-language plumbing, coded errors and the writing-feedback prompt.

Pure-module tests (no FastAPI needed) plus, when FastAPI is installed, a small
app exercising the middleware and the ApiError handler the way main.py wires
them.
"""

import asyncio

import pytest

import content_i18n as ci
from writing_assessment import (
    ANNOTATION_TYPES,
    LANGUAGE_DISPLAY_NAMES,
    build_assessment_system_prompt,
    feedback_language_for,
)


# ─── interface language ──────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("ja", "ja"),
        ("pt-BR", "pt"),
        ("PT_br", "pt"),
        ("zh-TW", "zh-Hant"),
        ("zh-Hant", "zh-Hant"),
        ("zh-CN", "zh"),
        ("ko", "ko"),
        ("de", "en"),  # unsupported -> default
        ("", "en"),
        (None, "en"),
    ],
)
def test_normalize_supported_interface_language(raw, expected):
    assert ci.normalize_supported_interface_language(raw) == expected


def test_all_fourteen_languages_supported_and_named():
    assert len(ci.SUPPORTED_INTERFACE_LANGUAGES) == 14
    for code in ci.SUPPORTED_INTERFACE_LANGUAGES:
        assert ci.normalize_supported_interface_language(code) == code
        assert code in LANGUAGE_DISPLAY_NAMES


def test_request_language_prefers_explicit_then_header():
    token = ci.set_request_interface_language("th")
    try:
        assert ci.request_interface_language(None) == "th"
        assert ci.request_interface_language("") == "th"
        assert ci.request_interface_language("vi") == "vi"
    finally:
        ci.reset_request_interface_language(token)
    assert ci.request_interface_language(None) == "en"


def test_middleware_sets_and_resets_context():
    seen = {}

    async def app(scope, receive, send):
        seen["language"] = ci.request_interface_language()

    middleware = ci.InterfaceLanguageMiddleware(app)
    scope = {"type": "http", "headers": [(b"x-interface-language", b"zh-TW")]}
    asyncio.run(middleware(scope, None, None))
    assert seen["language"] == "zh-Hant"
    assert ci.request_interface_language() == "en"


# ─── coded errors ────────────────────────────────────────────────────────────

def test_api_error_body_has_code_and_params():
    error = ci.ApiError(429, "explain_daily_limit", "You've used all 250 ...", {"limit": 250})
    assert error.status_code == 429
    assert ci.api_error_body(error) == {
        "detail": "You've used all 250 ...",
        "code": "explain_daily_limit",
        "params": {"limit": 250},
    }


def test_api_error_rejects_unknown_code():
    with pytest.raises(ValueError):
        ci.ApiError(400, "not_a_code", "x")


def test_entry_length_errors_are_coded_per_unit():
    short = ci.entry_length_error(10, "words", 30, 500)
    assert short.code == "entry_too_short_words"
    assert short.params == {"length": 10, "min": 30}
    long_chars = ci.entry_length_error(1200, "characters", 50, 1000)
    assert long_chars.code == "entry_too_long_characters"
    assert long_chars.params == {"length": 1200, "max": 1000}
    assert ci.entry_length_error(100, "words", 30, 500) is None


def test_every_code_is_mapped_in_the_app():
    """frontend/i18n/contentStrings.js must have a message for every code."""
    import os
    import re

    path = os.path.join(os.path.dirname(__file__), "..", "frontend", "i18n", "contentStrings.js")
    if not os.path.exists(path):
        pytest.skip("frontend not checked out")
    source = open(path, encoding="utf-8").read()
    keys = set(re.findall(r'"error\.([a-z_]+)"', source))
    # request_too_large is mapped to error.invalid_request in errorKeyForCode.
    assert (ci.ERROR_CODES - {"request_too_large"}) <= keys


# ─── /translate_content/ validation ─────────────────────────────────────────

def test_parse_content_translate_payload():
    kind, language, texts = ci.parse_content_translate_payload(
        {"texts": [" water ", "", None], "kind": "hanja_meaning", "interface_language": "ja"}
    )
    assert kind == "hanja_meaning"
    assert language == "ja"
    assert texts == ["water", "", ""]


def test_parse_content_translate_payload_limits():
    with pytest.raises(ci.ApiError) as too_many:
        ci.parse_content_translate_payload({"texts": ["a"] * (ci.CONTENT_TRANSLATE_MAX_TEXTS + 1)})
    assert too_many.value.code == "too_many_items"
    with pytest.raises(ci.ApiError) as too_long:
        ci.parse_content_translate_payload({"texts": ["a" * (ci.CONTENT_TRANSLATE_MAX_TEXT_CHARS + 1)]})
    assert too_long.value.code == "text_too_long"
    with pytest.raises(ci.ApiError) as bad:
        ci.parse_content_translate_payload({"texts": "water"})
    assert bad.value.code == "invalid_request"


def test_parse_content_translate_payload_uses_header_language():
    token = ci.set_request_interface_language("pt-BR")
    try:
        _kind, language, _texts = ci.parse_content_translate_payload({"texts": ["one"]})
    finally:
        ci.reset_request_interface_language(token)
    assert language == "pt"


# ─── writing feedback prompt ─────────────────────────────────────────────────

def test_assessment_feedback_in_interface_language():
    prompt = build_assessment_system_prompt("reflective", "ko", [], interface_language="th")
    assert "written in English" not in prompt
    assert "Write every \"explanation\"" in prompt
    assert "in Thai" in prompt
    # Corrections stay in the target language.
    assert "corrected version 1 in Korean" in prompt
    assert "write them in Korean, never in Thai" in prompt


def test_assessment_native_insert_does_not_assume_english():
    prompt = build_assessment_system_prompt("reflective", "zh", [], interface_language="es")
    native_line = next(line for line in prompt.splitlines() if line.startswith("- NATIVE_INSERT"))
    assert "English word/phrase" not in native_line
    assert "Spanish" in native_line
    assert ANNOTATION_TYPES == ("GRAMMAR", "DICTION", "NATIVE_INSERT", "UNNATURAL")


def test_assessment_defaults_to_english_feedback():
    prompt = build_assessment_system_prompt("persuasive", "ko", [])
    assert "The learner's own language (the language of the app they use) is English." in prompt


@pytest.mark.parametrize(
    "interface,target,expected",
    [
        ("ja", "ko", "ja"),
        ("zh-Hant", "ko", "zh-Hant"),
        ("ko", "zh", "ko"),
        ("zh-Hant", "zh", "en"),  # feedback must differ from the target language
        ("de", "ko", "en"),
        (None, "ko", "en"),
    ],
)
def test_feedback_language_for(interface, target, expected):
    assert feedback_language_for(interface, target) == expected


# ─── wired into a FastAPI app (skipped where FastAPI isn't installed) ────────

def test_fastapi_handler_returns_code():
    fastapi = pytest.importorskip("fastapi")
    from fastapi.responses import JSONResponse
    from fastapi.testclient import TestClient

    app = fastapi.FastAPI()
    app.add_middleware(ci.InterfaceLanguageMiddleware)

    @app.exception_handler(ci.ApiError)
    async def handler(_request, error):
        return JSONResponse(status_code=error.status_code, content=ci.api_error_body(error))

    @app.get("/boom")
    async def boom():
        raise ci.ApiError(429, "assess_daily_limit", "used all 5", {"limit": 5})

    @app.get("/lang")
    async def lang():
        return {"language": ci.request_interface_language()}

    client = TestClient(app)
    response = client.get("/boom")
    assert response.status_code == 429
    assert response.json() == {"detail": "used all 5", "code": "assess_daily_limit", "params": {"limit": 5}}
    assert client.get("/lang", headers={"X-Interface-Language": "mn"}).json() == {"language": "mn"}
    assert client.get("/lang").json() == {"language": "en"}
