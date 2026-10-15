"""Song suggestions for the song editor.

Two sources, both queried by the ``/songs/search/`` endpoint in main.py:

- LRCLIB (https://lrclib.net): free, no key, crowd-sourced lyrics with good
  Korean / Chinese coverage. Its search matches track name, artist and album —
  not lines of lyrics — and it rate-limits sharply, so results are cached here
  for a while and the client debounces typing.
- Genius (optional, ``GENIUS_ACCESS_TOKEN``): its search also matches lines of
  lyrics. It never returns lyrics text, so each Genius hit is completed with
  LRCLIB's lyrics for that title + artist.

The functions here are pure (they take the raw provider payloads); the HTTP
calls live in main.py so they can share its client and limits.
"""
from __future__ import annotations

import time
from typing import Any

LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"
LRCLIB_USER_AGENT = "Noeul/1.0 (https://github.com/changah-song/noeul)"
GENIUS_SEARCH_URL = "https://api.genius.com/search"

SONG_SEARCH_MAX_RESULTS = 8
SONG_SEARCH_MIN_QUERY_CHARS = 2
SONG_SEARCH_MAX_QUERY_CHARS = 200
SONG_SEARCH_CACHE_TTL_SECONDS = 15 * 60
SONG_SEARCH_CACHE_MAX_ENTRIES = 2_000


def normalize_song_query(query: Any) -> str:
    """Collapse whitespace; the provider does the rest. Empty when too short."""
    text = " ".join(str(query or "").split())
    if len(text) < SONG_SEARCH_MIN_QUERY_CHARS:
        return ""
    return text[:SONG_SEARCH_MAX_QUERY_CHARS]


def _clean(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def lrclib_result_to_song(item: dict[str, Any]) -> dict[str, Any] | None:
    """One LRCLIB search hit → the client's song shape, or None without a title."""
    if not isinstance(item, dict):
        return None
    title = _clean(item.get("trackName")) or _clean(item.get("name"))
    if not title:
        return None
    lyrics = _clean(item.get("plainLyrics"))
    duration = item.get("duration")
    return {
        "id": f"lrclib:{item.get('id')}",
        "title": title,
        "artist": _clean(item.get("artistName")),
        "album": _clean(item.get("albumName")),
        "duration": float(duration) if isinstance(duration, (int, float)) else None,
        "lyrics": lyrics,
        "synced": bool(_clean(item.get("syncedLyrics"))),
        "instrumental": bool(item.get("instrumental")),
        "source": "lrclib",
    }


def genius_hit_to_song(hit: dict[str, Any]) -> dict[str, Any] | None:
    """One Genius search hit → the song shape without lyrics (LRCLIB fills them)."""
    result = hit.get("result") if isinstance(hit, dict) else None
    if not isinstance(result, dict):
        return None
    title = _clean(result.get("title"))
    if not title:
        return None
    artist = result.get("primary_artist") if isinstance(result.get("primary_artist"), dict) else {}
    return {
        "id": f"genius:{result.get('id')}",
        "title": title,
        "artist": _clean(artist.get("name")),
        "album": "",
        "duration": None,
        "lyrics": "",
        "synced": False,
        "instrumental": False,
        "source": "genius",
    }


def _song_key(song: dict[str, Any]) -> str:
    return f"{song.get('title', '').casefold()}|{song.get('artist', '').casefold()}"


def merge_song_results(*groups: list[dict[str, Any]], limit: int = SONG_SEARCH_MAX_RESULTS) -> list[dict[str, Any]]:
    """Concatenate result groups in order, dropping repeats of the same
    title + artist (the first occurrence wins, so a group with lyrics should
    come first) and anything instrumental or without lyrics, up to ``limit``."""
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for group in groups:
        for song in group or []:
            if not song or song.get("instrumental") or not song.get("lyrics"):
                continue
            key = _song_key(song)
            if key in seen:
                continue
            seen.add(key)
            merged.append(song)
            if len(merged) >= limit:
                return merged
    return merged


class SongSearchCache:
    """Tiny in-memory TTL cache keyed by the normalized query, so repeated
    keystrokes and users asking for the same song do not hit LRCLIB's rate limit."""

    def __init__(self, ttl_seconds: float = SONG_SEARCH_CACHE_TTL_SECONDS, max_entries: int = SONG_SEARCH_CACHE_MAX_ENTRIES):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    def get(self, key: str, now: float | None = None) -> list[dict[str, Any]] | None:
        current = time.monotonic() if now is None else now
        entry = self._entries.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if current - stored_at > self.ttl_seconds:
            self._entries.pop(key, None)
            return None
        return value

    def put(self, key: str, value: list[dict[str, Any]], now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        if len(self._entries) >= self.max_entries:
            oldest = min(self._entries.items(), key=lambda item: item[1][0])[0]
            self._entries.pop(oldest, None)
        self._entries[key] = (current, value)
