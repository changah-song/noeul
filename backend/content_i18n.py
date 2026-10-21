"""User-language plumbing shared by every endpoint.

Three pieces live here so they can be unit-tested without importing main.py
(which loads the NLP models):

1. **Interface language.** The app sends the learner's interface language as
   `interface_language` in request bodies/query strings and, since
   loc/backend, as an `X-Interface-Language` header on every request.
   `InterfaceLanguageMiddleware` stores the header in a context variable so
   any endpoint can fall back to it with `request_interface_language()`.

2. **Stable error codes.** `ApiError` is an `HTTPException` that also carries a
   machine-readable `code` (plus `params` for the numbers in the message). The
   JSON body is `{"detail": <English text>, "code": ..., "params": {...}}`.
   `detail` stays English for logs and for old app builds; the app maps
   `code` to text in the user's language (frontend/i18n/contentStrings.js).

3. **Content translation request validation** for `/translate_content/`,
   which machine-translates short English content strings (hanja meanings,
   Chinese character definitions/hints, radical names) into the interface
   language and caches them server-side.
"""

from __future__ import annotations

import contextvars
from typing import Any, Optional

try:
    from fastapi import HTTPException
except ImportError:  # CI's test job installs only requirements-ci.txt (no FastAPI)
    class HTTPException(Exception):  # type: ignore[no-redef]
        def __init__(self, status_code: int, detail: Any = None, headers: Optional[dict] = None):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail
            self.headers = headers

DEFAULT_INTERFACE_LANGUAGE = "en"

# Every interface language the app offers (frontend/constants/languages.js).
SUPPORTED_INTERFACE_LANGUAGES = (
    "en",
    "zh",
    "zh-Hant",
    "ko",
    "fr",
    "es",
    "ar",
    "mn",
    "vi",
    "th",
    "id",
    "ru",
    "ja",
    "pt",
)
_SUPPORTED_SET = frozenset(SUPPORTED_INTERFACE_LANGUAGES)

INTERFACE_LANGUAGE_HEADER = "x-interface-language"

_request_language: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "noeul_interface_language", default=None
)


def normalize_supported_interface_language(value: Any, default: str = DEFAULT_INTERFACE_LANGUAGE) -> str:
    """Map any locale-ish code to one of SUPPORTED_INTERFACE_LANGUAGES.

    Keeps Traditional Chinese distinct ("zh-TW", "zh-Hant" -> "zh-Hant"),
    reduces regional codes to their base ("pt-BR" -> "pt"), and returns
    `default` for anything unsupported or empty.
    """
    raw = str(value or "").strip().replace("_", "-").lower()
    if not raw:
        return default
    if raw in {"zh-hant", "zh-tw", "zh-hk", "zh-mo"}:
        return "zh-Hant"
    base = raw.split("-")[0]
    return base if base in _SUPPORTED_SET else default


def request_interface_language(explicit: Any = None, default: str = DEFAULT_INTERFACE_LANGUAGE) -> str:
    """The interface language for this request.

    An explicit value (body/query `interface_language`) wins; otherwise the
    `X-Interface-Language` header captured by the middleware; otherwise
    `default`.
    """
    if explicit not in (None, ""):
        return normalize_supported_interface_language(explicit, default)
    header_value = _request_language.get()
    if header_value:
        return normalize_supported_interface_language(header_value, default)
    return default


def set_request_interface_language(value: Optional[str]):
    """Set the context value directly (tests); returns the reset token."""
    return _request_language.set(value)


def reset_request_interface_language(token) -> None:
    _request_language.reset(token)


class InterfaceLanguageMiddleware:
    """Pure-ASGI middleware: copy the X-Interface-Language header into a
    context variable for the duration of the request."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        value = None
        for name, raw in scope.get("headers") or []:
            if name.decode("latin-1").lower() == INTERFACE_LANGUAGE_HEADER:
                value = raw.decode("latin-1", "replace").strip()[:16] or None
                break
        token = _request_language.set(value)
        try:
            await self.app(scope, receive, send)
        finally:
            _request_language.reset(token)


# ─── Error codes ──────────────────────────────────────────────────────────────
# Stable, documented codes. The app maps each to translated text
# (frontend/i18n/contentStrings.js, keys "error.<code>"). Never rename one;
# add new codes instead.
ERROR_CODES = frozenset(
    {
        "ai_budget_exhausted",       # global daily AI spend reached
        "daily_quota_exceeded",      # per-user general backend quota
        "explain_daily_limit",       # params: limit
        "assess_daily_limit",        # params: limit
        "translate_budget_exhausted",
        "translate_timeout",
        "translate_failed",
        "sign_in_required",
        "auth_failed",
        "forbidden",
        "service_unavailable",       # dependency/config missing on the server
        "ai_unavailable",
        "ai_bad_response",
        "song_search_unavailable",
        "text_too_long",             # params: limit
        "request_too_large",         # body over the byte cap (limits.py)
        "too_many_items",            # params: limit
        "invalid_request",
        "entry_required",
        "entry_too_short_words",     # params: length, min
        "entry_too_short_characters",
        "entry_too_long_words",      # params: length, max
        "entry_too_long_characters",
        "not_found",
    }
)


class ApiError(HTTPException):
    """HTTPException with a stable machine-readable code for the app."""

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ):
        if code not in ERROR_CODES:
            raise ValueError(f"unknown API error code: {code}")
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.params = dict(params or {})


def api_error_body(error: ApiError) -> dict[str, Any]:
    body: dict[str, Any] = {"detail": error.detail, "code": error.code}
    if error.params:
        body["params"] = error.params
    return body


def entry_length_error(entry_length: int, length_unit: str, min_length: int, max_length: int) -> Optional[ApiError]:
    """The coded 422 for a writing entry outside the length bounds, or None."""
    unit = "characters" if length_unit == "characters" else "words"
    if entry_length < min_length:
        return ApiError(
            422,
            f"entry_too_short_{unit}",
            f"Entry is too short ({entry_length} {length_unit}). Write at least {min_length} {length_unit}.",
            {"length": entry_length, "min": min_length},
        )
    if entry_length > max_length:
        return ApiError(
            422,
            f"entry_too_long_{unit}",
            f"Entry is too long ({entry_length} {length_unit}). Keep it under {max_length} {length_unit}.",
            {"length": entry_length, "max": max_length},
        )
    return None


# ─── Content translation (/translate_content/) ───────────────────────────────
CONTENT_TRANSLATE_MAX_TEXTS = 64
CONTENT_TRANSLATE_MAX_TEXT_CHARS = 400
CONTENT_TRANSLATE_MAX_TOTAL_CHARS = 6_000
# What the app asks to translate. Only used for logging/limits today; the
# cache is keyed on the text itself so the same string is shared across kinds.
CONTENT_TRANSLATE_KINDS = frozenset(
    {
        "hanja_meaning",
        "hanja_word_definition",
        "zh_character_definition",
        "zh_character_hint",
        "radical_name",
        "other",
    }
)


def parse_content_translate_payload(payload: Any) -> tuple[str, str, list[str]]:
    """Validate a /translate_content/ body.

    Returns (kind, interface_language, texts). Texts are stripped; empty ones
    are kept as "" so the response stays aligned with the request. Raises
    ApiError for malformed or oversized requests.
    """
    if not isinstance(payload, dict):
        raise ApiError(400, "invalid_request", "body must be an object")
    kind = str(payload.get("kind") or "other").strip().lower()
    if kind not in CONTENT_TRANSLATE_KINDS:
        kind = "other"
    texts = payload.get("texts")
    if not isinstance(texts, list):
        raise ApiError(400, "invalid_request", "texts must be an array")
    if len(texts) > CONTENT_TRANSLATE_MAX_TEXTS:
        raise ApiError(
            413,
            "too_many_items",
            f"Too many texts; max {CONTENT_TRANSLATE_MAX_TEXTS}",
            {"limit": CONTENT_TRANSLATE_MAX_TEXTS},
        )
    cleaned: list[str] = []
    total = 0
    for text in texts:
        value = text.strip() if isinstance(text, str) else ""
        if len(value) > CONTENT_TRANSLATE_MAX_TEXT_CHARS:
            raise ApiError(
                413,
                "text_too_long",
                f"text exceeds {CONTENT_TRANSLATE_MAX_TEXT_CHARS} characters",
                {"limit": CONTENT_TRANSLATE_MAX_TEXT_CHARS},
            )
        total += len(value)
        cleaned.append(value)
    if total > CONTENT_TRANSLATE_MAX_TOTAL_CHARS:
        raise ApiError(
            413,
            "text_too_long",
            f"texts exceed {CONTENT_TRANSLATE_MAX_TOTAL_CHARS} characters in total",
            {"limit": CONTENT_TRANSLATE_MAX_TOTAL_CHARS},
        )
    interface_language = request_interface_language(payload.get("interface_language"))
    return kind, interface_language, cleaned
