"""One-round-trip Korean word lookup.

A word tap used to cost the app two sequential requests: GET /okt_morphs/ to
stem the tapped surface (갔다 -> 가다), then POST /krdict_search/ with those
stems. Each request is a full phone <-> Railway round trip, so the panel waited
for both. POST /krdict_lookup/ does the stemming and the dictionary search in
one request; this module holds its framework-free core so CI (which installs
only requirements-ci.txt, no FastAPI or Kiwi) can test it.
"""

import asyncio
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
