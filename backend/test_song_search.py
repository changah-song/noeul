from song_search import (
    SongSearchCache,
    genius_hit_to_song,
    lrclib_result_to_song,
    merge_song_results,
    normalize_song_query,
)


def test_normalize_song_query_collapses_whitespace_and_rejects_short_input():
    assert normalize_song_query("  봄날   방탄소년단 ") == "봄날 방탄소년단"
    assert normalize_song_query("a") == ""
    assert normalize_song_query(None) == ""
    assert len(normalize_song_query("x" * 500)) == 200


def test_lrclib_result_maps_to_the_client_shape():
    song = lrclib_result_to_song({
        "id": 9584202, "trackName": "봄날", "artistName": "방탄소년단",
        "albumName": "YOU NEVER WALK ALONE", "duration": 273.0, "instrumental": False,
        "plainLyrics": "보고 싶다\n이렇게 말하니까", "syncedLyrics": "[00:12.00] 보고 싶다",
    })
    assert song == {
        "id": "lrclib:9584202", "title": "봄날", "artist": "방탄소년단",
        "album": "YOU NEVER WALK ALONE", "duration": 273.0,
        "lyrics": "보고 싶다\n이렇게 말하니까", "synced": True, "instrumental": False,
        "source": "lrclib",
    }
    assert lrclib_result_to_song({"artistName": "x"}) is None
    assert lrclib_result_to_song("junk") is None


def test_genius_hit_maps_without_lyrics():
    song = genius_hit_to_song({"result": {"id": 1, "title": "Spring Day", "primary_artist": {"name": "BTS"}}})
    assert song["id"] == "genius:1" and song["artist"] == "BTS" and song["lyrics"] == ""
    assert genius_hit_to_song({"result": {}}) is None


def test_merge_drops_repeats_instrumentals_and_lyricless_and_caps_results():
    with_lyrics = [
        {"title": "봄날", "artist": "BTS", "lyrics": "x", "instrumental": False},
        {"title": "봄날", "artist": "bts", "lyrics": "y", "instrumental": False},  # repeat (case)
        {"title": "Inst", "artist": "BTS", "lyrics": "z", "instrumental": True},
        {"title": "Empty", "artist": "BTS", "lyrics": "", "instrumental": False},
    ]
    later = [{"title": "봄날", "artist": "BTS", "lyrics": "w"}, {"title": "DNA", "artist": "BTS", "lyrics": "v"}]
    merged = merge_song_results(with_lyrics, later, limit=2)
    assert [s["title"] for s in merged] == ["봄날", "DNA"]
    assert merged[0]["lyrics"] == "x"


def test_cache_expires_and_evicts_oldest():
    cache = SongSearchCache(ttl_seconds=10, max_entries=2)
    cache.put("a", [{"title": "A"}], now=0)
    assert cache.get("a", now=5) == [{"title": "A"}]
    assert cache.get("a", now=11) is None
    cache.put("b", [], now=20)
    cache.put("c", [], now=21)
    cache.put("d", [], now=22)  # evicts b, the oldest
    assert cache.get("b", now=23) is None
    assert cache.get("c", now=23) == []
