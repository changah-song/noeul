"""One-round-trip Korean word lookup.

A word tap used to cost the app two sequential requests: GET /okt_morphs/ to
stem the tapped surface (갔다 -> 가다), then POST /krdict_search/ with those
stems. Each request is a full phone <-> Railway round trip, so the panel waited
for both. POST /krdict_lookup/ does the stemming and the dictionary search in
one request; this module holds its framework-free core so CI (which installs
only requirements-ci.txt, no FastAPI or Kiwi) can test it.
"""

import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Iterable, Optional

# Mirrors STOP_STEMS in frontend/services/dictionaryLookup.js: grammatical
# stems the app never shows as the tapped word's meaning. Filtering them here
# saves a dictionary search (and quota) per tap.
LOOKUP_STOP_STEMS = frozenset({
    "하다",
    "되다",
    "있다",
    "없다",
    "이다",
    "아니다",
    "같다",
    "보다",
})


def select_lookup_stems(stems: Iterable, max_stems: Optional[int] = None) -> list[str]:
    """Clean, de-duplicate and drop stop stems, keeping the analyser's order."""
    selected: list[str] = []
    seen: set[str] = set()
    for stem in stems or []:
        cleaned = stem.strip() if isinstance(stem, str) else ""
        if not cleaned or cleaned in LOOKUP_STOP_STEMS or cleaned in seen:
            continue
        seen.add(cleaned)
        selected.append(cleaned)
    if max_stems is not None and max_stems >= 0:
        selected = selected[:max_stems]
    return selected


async def lookup_surface(
    surface: str,
    stem_fn: Callable[[str], Awaitable[list[str]]],
    search_fn: Callable[[str], Awaitable[list[dict]]],
    *,
    max_stems: Optional[int] = None,
    before_search: Optional[Callable[[list[str]], Awaitable[None]]] = None,
) -> dict:
    """Stem `surface`, then search every stem concurrently.

    Returns {"stems": [...], "results": [[entry, ...], ...]} with results[i]
    belonging to stems[i] -- the same per-query list shape /krdict_search/
    returns, so the app can reuse its parsing. `before_search` runs once the
    stems are known (quota enforcement) and may raise to abort the search.
    """
    cleaned_surface = surface.strip() if isinstance(surface, str) else ""
    if not cleaned_surface:
        return {"stems": [], "results": []}

    stems = select_lookup_stems(await stem_fn(cleaned_surface), max_stems)
    if before_search is not None:
        await before_search(stems)
    if not stems:
        return {"stems": [], "results": []}

    results = await asyncio.gather(*(search_fn(stem) for stem in stems))
    return {"stems": stems, "results": [list(entries or []) for entries in results]}


# --- English fallback when KRDICT is unavailable -----------------------------
# The bundled ko_dict.db snapshot only carries English senses, so a non-English
# interface language always needs the live KRDICT API. When KRDICT is slow or
# down those users used to get "No definition found"; instead they now get the
# snapshot's English senses, each marked `fallback_language: "en"` so the app
# can label them and keep them out of its per-language definition cache (once
# KRDICT recovers, the real translation is fetched). The field is additive:
# older app builds ignore it and just render the English text.
ENGLISH_FALLBACK_LANGUAGE = "en"
FALLBACK_LANGUAGE_FIELD = "fallback_language"


class KrdictUnavailableError(Exception):
    """KRDICT could not answer (network error, timeout, HTTP error, bad or
    error XML). Distinct from "answered with no entries", which is a genuine
    miss and must not trigger the English fallback."""


class KrdictFetchGuard:
    """Bounds the live KRDICT fan-out of one chapter preprocess.

    Most of a chapter resolves from the bundled dictionary; only the long tail
    goes to KRDICT. When KRDICT is slow or unreachable from the server, each of
    those calls waits out its own timeout and the chapter took over a minute,
    past the app's request timeout, so the whole chapter was lost. The guard
    gives the live fetches a time budget and stops calling KRDICT after a few
    failures in a row. A shared cooldown (``trip_until``, module-level state in
    the caller) then skips KRDICT for later chapters until it has had time to
    recover. Skipped stems are not cached, so a later run retries them.

    Pure bookkeeping: the caller passes the clock in.
    """

    def __init__(self, now: float, budget_seconds: float, max_consecutive_failures: int, cooldown_until: float = 0.0):
        self.deadline = now + budget_seconds
        self.max_consecutive_failures = max_consecutive_failures
        self.cooldown_until = cooldown_until
        self.consecutive_failures = 0
        self.tripped = now < cooldown_until

    def remaining(self, now: float) -> float:
        return max(0.0, self.deadline - now)

    def should_fetch(self, now: float) -> bool:
        return not self.tripped and now < self.deadline

    def record(self, ok: bool) -> None:
        if ok:
            self.consecutive_failures = 0
            return
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.max_consecutive_failures:
            self.tripped = True


def parse_krdict_search_items(status_code: int, text: str) -> list:
    """Return the <item> elements of a KRDICT search response.

    Raises KrdictUnavailableError when the response is not a usable answer:
    non-200 status, unparseable XML, or KRDICT's own <error> document (sent with
    HTTP 200 for e.g. an exhausted daily key quota).
    """
    if status_code != 200:
        raise KrdictUnavailableError(f"HTTP {status_code}")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise KrdictUnavailableError(f"unparseable XML: {error}") from error
    if root.tag == "error":
        code = (root.findtext("error_code") or "").strip()
        message = (root.findtext("message") or "").strip()
        raise KrdictUnavailableError(f"KRDICT error {code} {message}".strip())
    return root.findall(".//item")


def mark_english_fallback(entries: Iterable[dict]) -> list[dict]:
    return [
        {**entry, FALLBACK_LANGUAGE_FIELD: ENGLISH_FALLBACK_LANGUAGE}
        for entry in entries or []
        if isinstance(entry, dict)
    ]


async def search_with_english_fallback(
    query: str,
    interface_language: str,
    live_search: Callable[[str], Awaitable[list[dict]]],
    english_search: Callable[[str], Awaitable[list[dict]]],
    *,
    on_fallback: Optional[Callable[[str, Exception, int], None]] = None,
) -> list[dict]:
    """Search KRDICT live; if it is unavailable, serve English snapshot senses.

    `live_search` raises (KrdictUnavailableError, a timeout, ...) when KRDICT
    cannot answer; an empty list is a real miss and is returned as is. English
    interface requests never fall back here: their snapshot lookup already ran
    before the live call, so a failure stays [] as before.
    """
    try:
        return list(await live_search(query) or [])
    except Exception as error:  # noqa: BLE001 - any live failure means "unavailable"
        if interface_language == ENGLISH_FALLBACK_LANGUAGE:
            return []
        try:
            entries = await english_search(query)
        except Exception:  # noqa: BLE001 - the fallback must never break a lookup
            entries = []
        fallback = mark_english_fallback(entries)
        if on_fallback is not None:
            on_fallback(query, error, len(fallback))
        return fallback


# --- Machine-translated Korean glosses -----------------------------------------
# KRDICT only translates into its 11 languages. For an interface language it
# does not cover (Portuguese), Korean entries are fetched in English and their
# glosses machine-translated, the way Chinese and English-target definitions
# already are. A gloss that cannot be translated (no provider, budget, error)
# stays English and is marked fallback_language="en", so the app labels it and
# does not cache it under the interface language.
MACHINE_TRANSLATED_FIELD = "machine_translated"
_UNTRANSLATABLE_GLOSSES = {"", "N/A"}


async def translate_entry_glosses(
    entries: Iterable[dict],
    interface_language: str,
    translate: Callable[[str], Awaitable[Optional[str]]],
) -> list[dict]:
    """Translate each entry's English `transWord` into `interface_language`.

    `translate` maps one English string to its translation (or None on
    failure); each distinct gloss is translated once. Entries that already
    carry fallback_language="en" (KRDICT down, snapshot senses) are still
    translated: English is what they hold either way.
    """
    entries = [entry for entry in entries or [] if isinstance(entry, dict)]
    glosses = list(dict.fromkeys(
        (entry.get("transWord") or "").strip()
        for entry in entries
        if (entry.get("transWord") or "").strip() not in _UNTRANSLATABLE_GLOSSES
    ))

    async def safe_translate(text: str) -> Optional[str]:
        try:
            translated = await translate(text)
        except Exception:  # noqa: BLE001 - a failed translation keeps English
            return None
        return translated.strip() if isinstance(translated, str) and translated.strip() else None

    translations = dict(zip(glosses, await asyncio.gather(*(safe_translate(g) for g in glosses))))

    out: list[dict] = []
    for entry in entries:
        gloss = (entry.get("transWord") or "").strip()
        translated = translations.get(gloss)
        base = {key: value for key, value in entry.items() if key != FALLBACK_LANGUAGE_FIELD}
        if translated:
            out.append({
                **base,
                "transWord": translated,
                "interface_language": interface_language,
                MACHINE_TRANSLATED_FIELD: True,
            })
        elif gloss in _UNTRANSLATABLE_GLOSSES:
            out.append(dict(entry))
        else:
            out.append({**base, FALLBACK_LANGUAGE_FIELD: ENGLISH_FALLBACK_LANGUAGE})
    return out


# --- Chapter preprocessing: first-entry parse + negative-cache freshness ------
# /preprocess_chapter/ caches each live-fetched stem in cache.db, including a
# NULL-definition row for "KRDICT has no entry". That row must only ever record a
# genuine miss: a timeout, HTTP error or KRDICT's quota <error> document used to
# be cached the same way, permanently blanking those words for every user. So
# the first-entry parse raises KrdictUnavailableError on failure (the caller
# skips caching), and NULL rows expire after NEGATIVE_CACHE_MAX_AGE_DAYS so rows
# poisoned before this fix -- indistinguishable from genuine misses -- are
# re-fetched, and genuine misses are re-checked as KRDICT adds words.
NEGATIVE_CACHE_MAX_AGE_DAYS = 7


def parse_krdict_first_entry(status_code: int, text: str) -> Optional[dict]:
    """Return {hanja, definition, pos} for KRDICT's top search result.

    None means KRDICT answered and has no entry (safe to cache as a miss).
    Raises KrdictUnavailableError when KRDICT could not answer (never cache).
    """
    items = parse_krdict_search_items(status_code, text)
    if not items:
        return None
    item = items[0]
    origin_el = item.find("origin")
    trans_el = item.find(".//trans_word")
    pos_el = item.find("pos")

    definition = "N/A"
    if trans_el is not None and trans_el.text:
        definition = trans_el.text.strip()
        # KRDICT appends "^" as a separator artifact -- strip it
        if definition.endswith("^"):
            definition = definition[:-1].strip()

    return {
        "hanja": origin_el.text if origin_el is not None and origin_el.text else "N/A",
        "definition": definition,
        "pos": pos_el.text if pos_el is not None and pos_el.text else "Unknown",
    }


def _parse_sqlite_timestamp(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    # SQLite CURRENT_TIMESTAMP is naive UTC.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_reusable_cache_row(
    definition,
    last_updated,
    now: datetime,
    max_negative_age_days: float = NEGATIVE_CACHE_MAX_AGE_DAYS,
) -> bool:
    """Whether a cached preprocessing row can be served instead of re-fetching.

    Rows with a definition are always reusable. A NULL-definition ("no entry")
    row is reusable only while younger than `max_negative_age_days`; a missing
    or unparseable timestamp counts as stale.
    """
    if definition is not None:
        return True
    updated = _parse_sqlite_timestamp(last_updated)
    if updated is None:
        return False
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now - updated < timedelta(days=max_negative_age_days)
