from song_video import (
    candidates_from_payloads,
    parse_iso_duration,
    pick_video,
    song_video_key,
    song_video_query,
)


def _search(*items):
    return {
        "items": [
            {"id": {"videoId": vid}, "snippet": {"title": title, "channelTitle": channel}}
            for vid, title, channel in items
        ]
    }


def _videos(**durations):
    return {
        "items": [
            {"id": vid, "contentDetails": {"duration": duration}, "status": {"embeddable": True}}
            for vid, duration in durations.items()
        ]
    }


def test_parse_iso_duration():
    assert parse_iso_duration("PT3M45S") == 225.0
    assert parse_iso_duration("PT1H2S") == 3602.0
    assert parse_iso_duration("PT45S") == 45.0
    assert parse_iso_duration("") is None
    assert parse_iso_duration("P") is None
    assert parse_iso_duration("nonsense") is None


def test_key_and_query():
    assert song_video_key("  Through the  Night ", "IU") == "through the night|iu"
    assert song_video_key("", "IU") == ""
    assert song_video_query("밤편지", "아이유") == "아이유 밤편지"


def test_prefers_topic_audio_matching_the_lyrics_duration():
    candidates = candidates_from_payloads(
        _search(
            ("mv", "[MV] IU(아이유) _ Through the Night(밤편지)", "1theK (원더케이)"),
            ("topic", "Through the Night", "IU - Topic"),
            ("live", "IU - Through the Night (Live)", "IU Official"),
        ),
        _videos(mv="PT4M58S", topic="PT4M14S", live="PT4M30S"),
    )
    video = pick_video(candidates, "Through the Night", "IU", 254.0)
    assert video["id"] == "topic"
    assert video["duration"] == 254.0


def test_skips_covers_and_far_off_durations():
    candidates = candidates_from_payloads(
        _search(
            ("cover", "Ditto - NewJeans (cover by someone)", "Someone"),
            ("long", "NewJeans Ditto 1 hour loop", "Loops"),
        ),
        _videos(cover="PT3M05S", long="PT1H"),
    )
    assert pick_video(candidates, "Ditto", "NewJeans", 185.0) is None


def test_html_entities_in_titles_are_decoded():
    candidates = candidates_from_payloads(
        _search(("a", "Don&#39;t Know Why", "Norah Jones - Topic")),
        _videos(a="PT3M06S"),
    )
    assert candidates[0]["title"] == "Don't Know Why"
    assert pick_video(candidates, "Don't Know Why", "Norah Jones", 186.0)["id"] == "a"


def test_not_embeddable_is_skipped():
    candidates = candidates_from_payloads(
        _search(("a", "Song", "Artist - Topic")),
        {"items": [{"id": "a", "contentDetails": {"duration": "PT3M"}, "status": {"embeddable": False}}]},
    )
    assert pick_video(candidates, "Song", "Artist", 180.0) is None
