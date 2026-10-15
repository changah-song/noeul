"""Pure request-limit and cache-key helpers for the backend.

Kept free of FastAPI / httpx imports so the CI test job (requirements-ci.txt)
can exercise them directly. main.py turns the results into HTTP responses.
"""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata

# ─── /explain_in_context/ input limits ────────────────────────────────────────
# A tapped word is a single token; 64 characters covers long compounds and
# German-style words with plenty of room.
EXPLAIN_WORD_MAX_CHARS = 64
# The context the model sees. Real sentences are far shorter; anything longer is
# clipped to a window around the word (see clip_sentence_around_word) so old app
# builds that send a whole OCR block or an unpunctuated paragraph keep working.
EXPLAIN_SENTENCE_MAX_CHARS = 1_000
# Above this the request is refused outright (413) instead of being clipped.
EXPLAIN_SENTENCE_HARD_MAX_CHARS = 8_000
# Hanja / word origin for the tapped word (e.g. 學校). Longer values are not hanja.
HANJA_MAX_CHARS = 16


def strip_control_chars(text: str) -> str:
    """Drop control and format characters (Cc/Cf: newlines, NUL, bidi marks, ZW*)."""
    return "".join(ch for ch in text if unicodedata.category(ch) not in ("Cc", "Cf"))


def sanitize_hanja(raw) -> str | None:
    """Client-supplied hanja/origin, cleaned for the prompt.

    Returns None for non-strings, empty values and anything longer than
    HANJA_MAX_CHARS after cleaning (a value that long is not a word's hanja, and a
    truncated origin would mislead the model).
    """
    if not isinstance(raw, str):
        return None
    cleaned = " ".join(strip_control_chars(unicodedata.normalize("NFC", raw)).split())
    if not cleaned or len(cleaned) > HANJA_MAX_CHARS:
        return None
    return cleaned


def clip_sentence_around_word(sentence: str, word: str, max_chars: int = EXPLAIN_SENTENCE_MAX_CHARS) -> str:
    """Return at most `max_chars` of `sentence`, centred on the first `word` hit.

    Short sentences come back unchanged. When the word is not found the start of
    the sentence is kept.
    """
    if len(sentence) <= max_chars:
        return sentence
    index = sentence.find(word) if word else -1
    if index < 0:
        return sentence[:max_chars].strip()
    start = max(0, index + len(word) // 2 - max_chars // 2)
    start = min(start, len(sentence) - max_chars)
    return sentence[start:start + max_chars].strip()


def explain_grounding_fingerprint(hanja, dictionary_found, dictionary_senses) -> str:
    """Short stable hash of the client grounding that goes into the explain prompt.

    The explanation prompt includes the client's hanja and dictionary senses, so a
    cached answer is only valid for the same grounding. Returns "" when the client
    sent no grounding (older app builds), so their cache keys stay unchanged.
    Grounding is the same for every reader of a word (it comes from the bundled
    dictionary), so this keeps the cache shared across users.
    """
    senses = [
        [str(s.get("headword") or ""), str(s.get("pos") or ""), str(s.get("definition") or "")]
        for s in (dictionary_senses or [])
        if isinstance(s, dict)
    ]
    if not hanja and dictionary_found is None and not senses:
        return ""
    canonical = json.dumps(
        {"h": hanja or "", "f": dictionary_found, "s": senses},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(unicodedata.normalize("NFC", canonical).encode("utf-8")).hexdigest()[:16]


# ─── /translate/ cache + global budget ────────────────────────────────────────
TRANSLATE_CACHE_MAX_ROWS = 50_000


def translate_cache_key(text: str, source: str, target: str) -> str:
    """Cache key for one translation. Internal whitespace is kept (line breaks can
    change a translation); only NFC normalisation and outer trimming apply."""
    parts = "\x1f".join(
        [
            unicodedata.normalize("NFC", (text or "").strip()),
            (source or "").strip().lower(),
            (target or "").strip().lower(),
        ]
    )
    return hashlib.sha256(parts.encode("utf-8")).hexdigest()


def parse_positive_int_env(raw, default: int) -> int:
    """Parse an env var as a positive int, falling back to `default`."""
    try:
        value = int(str(raw).replace("_", "").strip())
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


# ─── Chapter preprocessing quota ──────────────────────────────────────────────
# One daily-quota unit per this many stems fetched live from KRDICT. Cached and
# bundled-snapshot stems are free. Measured on the bundled Korean books with an
# empty server cache (20k-character chapters): 50-300 live misses per chapter, so a
# first-ever read of a whole novel (taepyeongcheonha, 167k chars, 9 chapters) costs
# ~95 units: ~10% of a signed-in user's 1,000/day, ~32% of an anonymous 300/day.
# Re-reads and later readers hit the shared cache and pay 1 unit per chapter. The
# cap this enforces: at most ~20 KRDICT calls per quota unit (20k/day signed in),
# down from up to 5,000 calls for a single unit before.
PREPROCESS_STEMS_PER_QUOTA_UNIT = 20


def preprocess_live_fetch_quota_units(live_fetch_count: int) -> int:
    """Extra daily-quota units for a chapter that needs `live_fetch_count` KRDICT calls
    (on top of the 1 unit every preprocess request costs)."""
    if not live_fetch_count or live_fetch_count <= 0:
        return 0
    return math.ceil(live_fetch_count / PREPROCESS_STEMS_PER_QUOTA_UNIT)


# ─── /assess_entry/ length checks ─────────────────────────────────────────────
# Languages written without spaces between words: length is counted in characters.
CHARACTER_COUNTED_LANGUAGES = {"zh", "ja"}
ENTRY_MIN_WORDS = 30
ENTRY_MAX_WORDS = 500
# Roughly the same amount of writing as 30-500 words (about two characters per word).
ENTRY_MIN_CHARS = 50
ENTRY_MAX_CHARS = 1_000
# Hard caps applied before any counting, so a huge body is refused cheaply.
ENTRY_BODY_HARD_MAX_CHARS = 10_000
ENTRY_PROMPT_MAX_CHARS = 1_000
ENTRY_SANDBOX_WORD_MAX_CHARS = 40


def _is_cjk_char(ch: str) -> bool:
    code = ord(ch)
    return (
        0x3040 <= code <= 0x30FF  # Hiragana, Katakana
        or 0x3400 <= code <= 0x4DBF  # CJK Extension A
        or 0x4E00 <= code <= 0x9FFF  # CJK Unified Ideographs
        or 0xF900 <= code <= 0xFAFF  # CJK Compatibility Ideographs
        or 0x31F0 <= code <= 0x31FF  # Katakana phonetic extensions
        or 0xFF66 <= code <= 0xFF9F  # Half-width Katakana
        or 0x20000 <= code <= 0x3134F  # CJK Extensions B-G
    )


def count_entry_length(text: str, language: str) -> tuple[int, str]:
    """Length of a writing entry as (count, unit).

    Chinese and Japanese are counted in characters: each CJK character counts as
    one, and any run of other non-space text (Latin words, numbers) counts as one.
    Punctuation is not counted. Everything else is counted in whitespace words.
    """
    text = text or ""
    base_language = str(language or "").strip().lower().replace("_", "-").split("-")[0]
    if base_language not in CHARACTER_COUNTED_LANGUAGES:
        return len(text.split()), "words"
    count = 0
    in_other_run = False
    for ch in text:
        if _is_cjk_char(ch):
            count += 1
            in_other_run = False
        elif ch.isspace() or unicodedata.category(ch).startswith("P"):
            in_other_run = False
        elif not in_other_run:
            count += 1
            in_other_run = True
    return count, "characters"


def entry_length_bounds(unit: str) -> tuple[int, int]:
    return (ENTRY_MIN_CHARS, ENTRY_MAX_CHARS) if unit == "characters" else (ENTRY_MIN_WORDS, ENTRY_MAX_WORDS)


# ─── Request body size ────────────────────────────────────────────────────────
# The largest legitimate request is chapter preprocessing: up to 500,000
# characters (AUTHENTICATED_LIMITS["max_text_chars_per_request"]). Korean and
# Chinese text is 3 bytes per character in UTF-8, so that is ~1.5 MB of JSON;
# 3 MB leaves 2x headroom.
MAX_REQUEST_BODY_BYTES = 3 * 1024 * 1024


async def _send_413(send, limit: int) -> None:
    body = json.dumps({"detail": f"Request body exceeds {limit} bytes"}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    """Pure ASGI middleware that refuses request bodies larger than `max_bytes`
    with 413, before the app reads or parses them.

    A declared Content-Length over the limit is refused immediately. A body with
    no Content-Length (chunked) is read up to the limit and then replayed to the
    app, so memory stays bounded either way.
    """

    def __init__(self, app, max_bytes: int = MAX_REQUEST_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        content_length = None
        for name, value in scope.get("headers") or []:
            if name.lower() == b"content-length":
                try:
                    content_length = int(value)
                except ValueError:
                    content_length = None
                break

        if content_length is not None:
            if content_length > self.max_bytes:
                await _send_413(send, self.max_bytes)
                return
            await self.app(scope, receive, send)
            return

        method = (scope.get("method") or "GET").upper()
        if method in ("GET", "HEAD", "OPTIONS", "DELETE"):
            await self.app(scope, receive, send)
            return

        # No Content-Length: buffer up to the limit, then replay.
        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"") or b""
            total += len(chunk)
            if total > self.max_bytes:
                await _send_413(send, self.max_bytes)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay_receive():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay_receive, send)
