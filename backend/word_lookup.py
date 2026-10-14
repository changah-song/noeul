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
