"""Text translation: a Claude model first, Google Translate as the fallback.

Claude (translate_with_claude): the reader's sentences go to a Claude model,
by default Haiku 5.5. On the 52-sentence test drawn from the bundled books it
made fewer mistakes than every other option tried, and it costs about
$0.55-0.80 per million source characters against Google's $20. The model call
is injected, so this module needs neither the Anthropic SDK nor FastAPI.

Google providers, in order (translate_texts):
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

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

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


# --- Translation by a Claude model -------------------------------------------
#
# Texts go to the model as a JSON list and come back as a JSON list of the same
# length (structured output), a chunk at a time so one long chapter turns into
# a few requests that run side by side. A single text goes as plain text. A chunk that fails in any way (error,
# refusal, cut off, wrong number of translations) leaves its texts as None, and
# the caller decides whether Google gets them.

CLAUDE_CHUNK_MAX_ITEMS = 25
CLAUDE_CHUNK_MAX_CHARS = 2_000
CLAUDE_MAX_CONCURRENT_CHUNKS = 6

# One model call: request -> (response text, stop reason, usage). The request
# holds "system", "messages", "max_tokens" and "output_format" (a JSON schema,
# or None for plain text); the caller adds the model and its own settings.
# Usage is only collected, for spend tracking.
ClaudeCaller = Callable[[dict], Awaitable["tuple[str, str | None, Any]"]]

# English names for the codes normalize_language_code returns, because the
# model is instructed in English.
LANGUAGE_NAMES = {
    "ar": "Arabic",
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "mn": "Mongolian (Cyrillic script)",
    "pt": "Brazilian Portuguese",
    "ru": "Russian",
    "th": "Thai",
    "vi": "Vietnamese",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
}

TRANSLATIONS_SCHEMA = {
    "type": "object",
    "properties": {"translations": {"type": "array", "items": {"type": "string"}}},
    "required": ["translations"],
    "additionalProperties": False,
}


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code) or f"the language with code '{code}'"


def claude_chunks(texts: list[str]) -> list[list[str]]:
    """Split `texts` into runs of at most CLAUDE_CHUNK_MAX_ITEMS texts and about
    CLAUDE_CHUNK_MAX_CHARS characters (a single longer text gets a chunk alone)."""
    chunks: list[list[str]] = []
    current: list[str] = []
    chars = 0
    for text in texts:
        if current and (len(current) >= CLAUDE_CHUNK_MAX_ITEMS or chars + len(text) > CLAUDE_CHUNK_MAX_CHARS):
            chunks.append(current)
            current, chars = [], 0
        current.append(text)
        chars += len(text)
    if current:
        chunks.append(current)
    return chunks


def claude_translation_request(texts: list[str], *, source: str, target: str) -> dict:
    """The request for one chunk. `source`/`target` are normalized codes.

    A lone text (a sentence a reader just opened) goes as plain text and comes
    back as plain text: measured on the test sentences, that is about twice as
    cheap and a third quicker than the JSON form a batch needs to stay aligned.
    "output_format" is None for it."""
    from_name, to_name = language_name(source), language_name(target)
    faithful = (
        "Translate faithfully: keep every detail, add nothing, keep people's names as names, "
        f"and keep the tone, including dialect and old-fashioned wording, as far as {to_name} allows."
    )
    intro = f"You translate {from_name} into {to_name} for someone reading a book in {from_name} to learn the language."
    chars = sum(len(text) for text in texts)
    # Generous: Korean or Thai output can take several tokens per source character.
    max_tokens = min(8_192, 256 + 4 * chars)
    if len(texts) == 1:
        return {
            "system": f"{intro} You get one text, usually a sentence from the book. {faithful} "
            "Reply with the translation only, without notes.",
            "messages": [{"role": "user", "content": texts[0]}],
            "max_tokens": max_tokens,
            "output_format": None,
        }
    return {
        "system": f"{intro} You get a JSON list of texts, usually sentences from the book, in reading order. {faithful} "
        "Return exactly one translation per text, in the same order. Never merge, split or skip a text, "
        "and never add notes.",
        "messages": [{"role": "user", "content": json.dumps({"texts": texts}, ensure_ascii=False)}],
        "max_tokens": max_tokens,
        "output_format": {"type": "json_schema", "schema": TRANSLATIONS_SCHEMA},
    }


def parse_claude_translations(text: str, expected: int) -> list[str | None]:
    """The translations in a structured answer, or ValueError when it is not
    exactly `expected` of them."""
    translations = json.loads(text).get("translations")
    if not isinstance(translations, list) or len(translations) != expected:
        got = len(translations) if isinstance(translations, list) else "no"
        raise ValueError(f"{got} translations for {expected} texts")
    return [value.strip() or None if isinstance(value, str) else None for value in translations]


async def translate_with_claude(
    call: ClaudeCaller,
    texts: list[str],
    *,
    source: str,
    target: str,
) -> tuple[list[str | None], list[Any]]:
    """Translate `texts` with a Claude model. Returns the translations aligned
    with `texts` (None where a chunk failed) and the usage of every call that
    completed, failed ones included, so all spend can be recorded."""
    chunks = claude_chunks(texts)
    semaphore = asyncio.Semaphore(CLAUDE_MAX_CONCURRENT_CHUNKS)
    usages: list[Any] = []

    async def translate_chunk(chunk: list[str]) -> list[str | None]:
        async with semaphore:
            try:
                answer, stop_reason, usage = await call(claude_translation_request(chunk, source=source, target=target))
            except Exception as error:  # the caller falls back
                print(f"[translation] claude failed: {type(error).__name__}")
                return [None] * len(chunk)
            usages.append(usage)
            if stop_reason != "end_turn":
                print(f"[translation] claude stopped early: {stop_reason}")
                return [None] * len(chunk)
            if len(chunk) == 1:
                return [answer.strip() or None]
            try:
                return parse_claude_translations(answer, len(chunk))
            except (ValueError, AttributeError) as error:
                print(f"[translation] claude answer unusable: {error}")
                return [None] * len(chunk)

    results = await asyncio.gather(*(translate_chunk(chunk) for chunk in chunks))
    return [value for chunk_result in results for value in chunk_result], usages
