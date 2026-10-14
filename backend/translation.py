"""Text translation through Google Translate, with a fallback provider.

Providers, in order:
1. The official Google Cloud Translation API (Basic / v2), when
   GOOGLE_CLOUD_TRANSLATE_API_KEY is set.
2. The "google-translator9" RapidAPI listing (a reseller of the same v2 API),
   when GOOGLE_TRANSLATE_RAPIDAPI_KEY is set. Kept as a fallback for when the
   official API fails.

Both take the same v2 request body ({q, source, target, format}) and return
{"data": {"translations": [{"translatedText": ...}, ...]}} with one
translation per input string, in order. This module has no FastAPI import so CI
can test it; main.py owns the endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

GOOGLE_CLOUD_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
RAPIDAPI_TRANSLATE_URL = "https://google-translator9.p.rapidapi.com/v2"
RAPIDAPI_TRANSLATE_HOST = "google-translator9.p.rapidapi.com"

# The v2 API takes at most 128 strings per request.
MAX_STRINGS_PER_REQUEST = 128


class TranslationError(Exception):
    """Every configured provider failed. `timed_out` is True when the last one timed out."""

    def __init__(self, message: str, *, timed_out: bool = False):
        super().__init__(message)
        self.timed_out = timed_out


@dataclass(frozen=True)
class Provider:
    name: str
    url: str
    headers: dict[str, str]
    params: dict[str, str]


def configured_providers(google_cloud_key: str = "", rapidapi_key: str = "") -> list[Provider]:
    providers = []
    if google_cloud_key:
        providers.append(Provider(
            name="google-cloud",
            url=GOOGLE_CLOUD_TRANSLATE_URL,
            headers={"content-type": "application/json"},
            params={"key": google_cloud_key},
        ))
    if rapidapi_key:
        providers.append(Provider(
            name="rapidapi",
            url=RAPIDAPI_TRANSLATE_URL,
            headers={
                "content-type": "application/json",
                "X-RapidAPI-Key": rapidapi_key,
                "X-RapidAPI-Host": RAPIDAPI_TRANSLATE_HOST,
            },
            params={},
        ))
    return providers


def normalize_language_code(value: Any, fallback: str) -> str:
    """Map app/locale codes to what Google's v2 API accepts: base codes, except
    Chinese keeps its script (zh-TW for Traditional, zh-CN otherwise)."""
    raw = str(value or "").strip().replace("_", "-").lower()
    if not raw:
        return fallback
    if raw in ("zh-hant", "zh-tw", "zh-hk", "zh-mo"):
        return "zh-TW"
    if raw in ("zh", "zh-hans", "zh-cn", "zh-sg"):
        return "zh-CN"
    return raw.split("-")[0] or fallback


def _translations_from(payload: Any) -> list[str | None]:
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    items = data.get("translations", []) if isinstance(data, dict) else []
    out: list[str | None] = []
    for item in items:
        text = item.get("translatedText") if isinstance(item, dict) else None
        out.append(text.strip() or None if isinstance(text, str) else None)
    return out


async def translate_texts(
    client: Any,
    providers: list[Provider],
    texts: list[str],
    *,
    source: str,
    target: str,
    timeout: float,
) -> list[str | None]:
    """Translate `texts` (at most MAX_STRINGS_PER_REQUEST) with the first provider
    that answers with one translation per input. Raises TranslationError when no
    provider is configured or all of them fail."""
    if not providers:
        raise TranslationError("No translation provider is configured")
    if len(texts) > MAX_STRINGS_PER_REQUEST:
        raise ValueError(f"at most {MAX_STRINGS_PER_REQUEST} strings per request")

    body = {"q": list(texts), "source": source, "target": target, "format": "text"}
    last_error: Exception | None = None
    timed_out = False
    for provider in providers:
        try:
            response = await client.post(
                provider.url,
                params=provider.params or None,
                headers=provider.headers,
                json=body,
                timeout=timeout,
            )
            response.raise_for_status()
            results = _translations_from(response.json())
            if len(results) != len(texts):
                raise TranslationError(
                    f"{provider.name} returned {len(results)} translations for {len(texts)} strings"
                )
            return results
        except Exception as error:  # try the next provider
            last_error = error
            timed_out = "Timeout" in type(error).__name__
            # Never log the request: the Google Cloud key is in its query string.
            print(f"[translation] {provider.name} failed: {type(error).__name__}")
    raise TranslationError(f"All translation providers failed: {type(last_error).__name__}", timed_out=timed_out)
