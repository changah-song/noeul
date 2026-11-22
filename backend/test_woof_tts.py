"""Listen-mode voice helpers that need no model: text cleaning, cache keys,
the audio cache and the WAV/MP3 encoding."""

import numpy as np

import woof_tts


def test_clean_text_collapses_whitespace_and_drops_control_characters():
    assert woof_tts.clean_text("  Hello,\n\tworld\u0000!  ") == "Hello, world !"
    assert woof_tts.clean_text(None) == ""


def test_only_juno_is_offered():
    assert woof_tts.normalize_voice(None) == "juno"
    assert woof_tts.normalize_voice(" Juno ") == "juno"
    assert woof_tts.normalize_voice("mira") is None


def test_cache_key_depends_on_text_and_voice():
    assert woof_tts.cache_key("Hello.", "juno") == woof_tts.cache_key("Hello.", "juno")
    assert woof_tts.cache_key("Hello.", "juno") != woof_tts.cache_key("Hello!", "juno")
    assert woof_tts.cache_key("Hello.", "juno") != woof_tts.cache_key("Hello.", "other")


def test_stored_audio_is_served_from_the_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(woof_tts, "CACHE_DIR", str(tmp_path))
    assert woof_tts.cached_audio("Hello.", "juno") is None
    woof_tts._store(woof_tts.cache_key("Hello.", "juno"), b"mp3-bytes", "audio/mpeg")
    assert woof_tts.cached_audio("Hello.", "juno") == (b"mp3-bytes", "audio/mpeg")


def test_cache_is_pruned_oldest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(woof_tts, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(woof_tts, "CACHE_MAX_BYTES", 250)
    import os

    for index, text in enumerate(["one", "two", "three"]):
        key = woof_tts.cache_key(text, "juno")
        woof_tts._store(key, b"x" * 100, "audio/mpeg")
        path = woof_tts._cache_paths(key)[0][0]
        os.utime(path, (1_000 + index, 1_000 + index))
    woof_tts._prune_cache()
    assert woof_tts.cached_audio("one", "juno") is None
    assert woof_tts.cached_audio("three", "juno") is not None


def test_encode_audio_returns_playable_bytes():
    samples = np.sin(np.linspace(0, 440 * 2 * np.pi, woof_tts.SAMPLE_RATE)).astype(np.float32) * 0.2
    data, media_type = woof_tts.encode_audio(samples)
    assert media_type in ("audio/mpeg", "audio/wav")
    assert len(data) > 1_000
    if media_type == "audio/wav":
        assert data[:4] == b"RIFF"


def test_warm_up_makes_one_line_without_caching_it(tmp_path, monkeypatch):
    monkeypatch.setattr(woof_tts, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(woof_tts, "available", lambda: True)
    heard = []

    def fake_model(text, seed=None):
        heard.append(text)
        return np.zeros(2400, dtype=np.float32)

    monkeypatch.setattr(woof_tts, "_model", lambda voice: fake_model)
    woof_tts.warm_up()
    assert heard == ["Hello there."]
    assert list(tmp_path.iterdir()) == []


def test_warm_up_does_nothing_without_the_model(monkeypatch):
    monkeypatch.setattr(woof_tts, "available", lambda: False)
    monkeypatch.setattr(woof_tts, "_model", lambda voice: (_ for _ in ()).throw(AssertionError("loaded")))
    woof_tts.warm_up()


def test_warm_up_survives_a_failing_model(monkeypatch, capsys):
    monkeypatch.setattr(woof_tts, "available", lambda: True)

    def broken(voice):
        raise RuntimeError("weights missing")

    monkeypatch.setattr(woof_tts, "_model", broken)
    woof_tts.warm_up()
    assert "warm-up failed" in capsys.readouterr().out
