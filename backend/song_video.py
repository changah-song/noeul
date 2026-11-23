"""Find a song's YouTube video for the song reader's player.

``/songs/video/`` in main.py calls the YouTube Data API (search.list, then
videos.list for durations) once per title + artist and keeps the answer in
cache.db for every user, so the 10,000-unit daily quota (a search is 100 units)
goes a long way. The functions here are pure (they take the raw API payloads);
the HTTP calls live in main.py.

Which video: the synced lyrics (LRCLIB) are timed to the album audio, so a
YouTube Music "Artist - Topic" upload or an "official audio" video lines up
best. A music video often has a longer intro, so it only wins when nothing
closer is there. Live versions, covers, reactions and the like are skipped.
"""
from __future__ import annotations

import html
import re
from typing import Any

YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
YOUTUBE_SEARCH_MAX_RESULTS = 10
# YouTube's daily quota is 10,000 units; a lookup costs 101 (search 100 +
# videos 1). Keep a margin for retries and other uses of the key.
YOUTUBE_DAILY_LOOKUPS = 90
# Per user per day, so one account can't use up the shared allowance.
YOUTUBE_USER_DAILY_LOOKUPS = 20
# Cached answers: a found video for 90 days, "nothing found" for a day.
SONG_VIDEO_FOUND_TTL_DAYS = 90
SONG_VIDEO_MISSING_TTL_DAYS = 1

_SKIP_WORDS = (
    "live", "cover", "reaction", "karaoke", "instrumental", "inst.", "remix",
    "sped up", "slowed", "nightcore", "8d", "piano", "guitar", "dance practice",
    "concert", "직캠", "fancam", "teaser", "lesson", "tutorial", "react",
    "커버", "라이브", "反应", "翻唱", "现场", "伴奏",
)
_AUDIO_WORDS = ("official audio", "audio", "lyric", "가사", "歌词", "歌詞")
_DURATION_PATTERN = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def song_video_key(title: Any, artist: Any) -> str:
    """Cache key: title + artist, case and spacing folded. Empty without a title."""
    clean_title = _clean(title).casefold()
    if not clean_title:
        return ""
    return f"{clean_title}|{_clean(artist).casefold()}"[:300]


def song_video_query(title: Any, artist: Any) -> str:
    return " ".join(part for part in (_clean(artist), _clean(title)) if part)[:200]


def parse_iso_duration(value: Any) -> float | None:
    """'PT3M45S' -> 225.0; None when it isn't an ISO 8601 duration."""
    match = _DURATION_PATTERN.match(str(value or ""))
    if not match or not any(match.groups()):
        return None
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return float(((days * 24 + hours) * 60 + minutes) * 60 + seconds)


def _words_in(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)


def score_video(candidate: dict[str, Any], title: str, artist: str, duration: float | None) -> float | None:
    """Higher is better; None when the video should not be used at all."""
    video_title = _clean(candidate.get("title")).casefold()
    channel = _clean(candidate.get("channel")).casefold()
    clean_title = _clean(title).casefold()
    clean_artist = _clean(artist).casefold()
    if not candidate.get("embeddable", True):
        return None
    skip_in_title = _words_in(video_title, _SKIP_WORDS) and not _words_in(clean_title, _SKIP_WORDS)
    if skip_in_title:
        return None
    score = 0.0
    if clean_title and clean_title in video_title:
        score += 3
    if clean_artist and (clean_artist in video_title or clean_artist in channel):
        score += 2
    if channel.endswith(" - topic"):
        score += 4
    elif _words_in(video_title, _AUDIO_WORDS):
        score += 2
    video_duration = candidate.get("duration")
    if duration and video_duration:
        gap = abs(video_duration - duration)
        if gap <= 2:
            score += 5
        elif gap <= 6:
            score += 3
        elif gap <= 20:
            score += 1
        elif gap > 90:
            return None
        else:
            score -= 2
    return score


def candidates_from_payloads(search_payload: Any, videos_payload: Any) -> list[dict[str, Any]]:
    """search.list + videos.list responses -> [{id, title, channel, duration, embeddable}]."""
    details: dict[str, dict[str, Any]] = {}
    for item in (videos_payload or {}).get("items") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        content = item.get("contentDetails") or {}
        status = item.get("status") or {}
        details[item["id"]] = {
            "duration": parse_iso_duration(content.get("duration")),
            "embeddable": status.get("embeddable", True) is not False,
        }
    candidates = []
    for item in (search_payload or {}).get("items") or []:
        if not isinstance(item, dict):
            continue
        video_id = (item.get("id") or {}).get("videoId")
        snippet = item.get("snippet") or {}
        if not video_id:
            continue
        extra = details.get(video_id, {})
        candidates.append({
            "id": video_id,
            "title": html.unescape(_clean(snippet.get("title"))),
            "channel": html.unescape(_clean(snippet.get("channelTitle"))),
            "duration": extra.get("duration"),
            "embeddable": extra.get("embeddable", True),
        })
    return candidates


def pick_video(candidates: list[dict[str, Any]], title: str, artist: str, duration: float | None) -> dict[str, Any] | None:
    """The best candidate as {id, title, channel, duration}, or None."""
    best = None
    best_score = None
    for index, candidate in enumerate(candidates):
        score = score_video(candidate, title, artist, duration)
        if score is None:
            continue
        # YouTube's own ranking breaks ties.
        score -= index * 0.01
        if best_score is None or score > best_score:
            best, best_score = candidate, score
    if best is None or best_score < 2:
        return None
    return {key: best.get(key) for key in ("id", "title", "channel", "duration")}
