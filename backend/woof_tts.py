"""Listen mode's natural English voice: Underdog Woof ("Juno"), run on the server.

Woof is a small English text-to-speech model that runs on a CPU with numpy
only (https://huggingface.co/ConwayResearch/Underdog-Woof). The app asks for
one sentence at a time and plays the audio it gets back, so nothing is added
to the app's download size.

The model is not in this repository. `python woof_tts.py` downloads it (about
41 MB, pinned to one revision) into WOOF_MODEL_DIR; the Dockerfile runs that at
build time. Without the model, `available()` is False and the endpoint answers
503, and the app falls back to the phone's own voice.

Licence: Underdog Non-Commercial License 1.0. Free for non-commercial use with
the credit "Voice by Underdog Woof" shown in the app; anything that earns
money needs a commercial licence from Underdog.
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import sys
import threading
import unicodedata
import urllib.request
import wave

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.getenv("WOOF_MODEL_DIR") or os.path.join(BACKEND_DIR, "woof_model")
CACHE_DIR = os.getenv("WOOF_CACHE_DIR") or os.path.join(BACKEND_DIR, "woof_cache")

# The Hugging Face revision the files come from. Changing it changes every
# cache key, so old audio is never served for a new model.
MODEL_REPO = "ConwayResearch/Underdog-Woof"
MODEL_REVISION = "be702960539777fc3f698e54335276a8391b00f9"
MODEL_FILES = (
    "woof_int8.npz",
    "underdog_woof/__init__.py",
    "underdog_woof/__main__.py",
    "underdog_woof/normalize.py",
    "underdog_woof/respell.py",
    "underdog_woof/respell.tsv",
    "underdog_woof/runtime.py",
    "underdog_woof/textsplit.py",
    "LICENSE",
    "NOTICE",
)

# Only Juno: in a one-page trial the second voice (Mira) left a 26-second
# silence in the middle and took three times as long to generate.
VOICES = ("juno",)
DEFAULT_VOICE = "juno"

# One request is one sentence (or a short run of them).
MAX_TEXT_CHARS = 1_000
# Characters a user may have generated per day. Cached audio is free; this
# only counts text the server had to synthesize. About three hours of speech.
DAILY_CHARS = 200_000

SAMPLE_RATE = 24_000
MP3_KBPS = 48

# Oldest files are dropped once the cache passes this size.
CACHE_MAX_BYTES = int(os.getenv("WOOF_CACHE_MAX_BYTES") or 500 * 1024 * 1024)
_CACHE_PRUNE_EVERY = 200

_lock = threading.Lock()
_models: dict[str, object] = {}
_writes_since_prune = 0


def clean_text(text) -> str:
    """The text as it is synthesized and cached: control characters dropped,
    runs of whitespace collapsed to one space."""
    if not isinstance(text, str):
        return ""
    visible = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in text)
    return re.sub(r"\s+", " ", visible).strip()


def normalize_voice(voice) -> str | None:
    name = str(voice or DEFAULT_VOICE).strip().lower()
    return name if name in VOICES else None


def available() -> bool:
    return all(os.path.isfile(os.path.join(MODEL_DIR, name)) for name in MODEL_FILES[:8])


def cache_key(text: str, voice: str) -> str:
    raw = f"{MODEL_REVISION}\n{voice}\n{text}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _cache_paths(key: str) -> list[tuple[str, str]]:
    folder = os.path.join(CACHE_DIR, key[:2])
    return [
        (os.path.join(folder, f"{key}.mp3"), "audio/mpeg"),
        (os.path.join(folder, f"{key}.wav"), "audio/wav"),
    ]


def cached_audio(text: str, voice: str) -> tuple[bytes, str] | None:
    """(audio bytes, media type) for text already synthesized, else None."""
    for path, media_type in _cache_paths(cache_key(text, voice)):
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError:
            continue
        if data:
            try:
                os.utime(path)  # recently used files are pruned last
            except OSError:
                pass
            return data, media_type
    return None


def _prune_cache() -> None:
    entries = []
    total = 0
    for root, _dirs, files in os.walk(CACHE_DIR):
        for name in files:
            path = os.path.join(root, name)
            try:
                stat = os.stat(path)
            except OSError:
                continue
            entries.append((stat.st_mtime, stat.st_size, path))
            total += stat.st_size
    if total <= CACHE_MAX_BYTES:
        return
    # Down to 80% so a full cache is not pruned on every write.
    target = CACHE_MAX_BYTES * 0.8
    for _mtime, size, path in sorted(entries):
        if total <= target:
            break
        try:
            os.remove(path)
            total -= size
        except OSError:
            pass


def _store(key: str, data: bytes, media_type: str) -> None:
    global _writes_since_prune
    path = next(p for p, kind in _cache_paths(key) if kind == media_type)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        temporary = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
        with open(temporary, "wb") as handle:
            handle.write(data)
        os.replace(temporary, path)
    except OSError:
        return  # the cache is best effort; the audio is still returned
    _writes_since_prune += 1
    if _writes_since_prune >= _CACHE_PRUNE_EVERY:
        _writes_since_prune = 0
        _prune_cache()


def _pcm16(samples) -> bytes:
    import numpy as np

    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def encode_audio(samples) -> tuple[bytes, str]:
    """MP3 when the encoder is installed (about a tenth of the size), else WAV."""
    pcm = _pcm16(samples)
    try:
        import lameenc
    except ImportError:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(SAMPLE_RATE)
            out.writeframes(pcm)
        return buffer.getvalue(), "audio/wav"
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    encoder.silence()
    return bytes(encoder.encode(pcm)) + bytes(encoder.flush()), "audio/mpeg"


def _model(voice: str):
    model = _models.get(voice)
    if model is None:
        if MODEL_DIR not in sys.path:
            sys.path.insert(0, MODEL_DIR)
        from underdog_woof import Woof

        model = Woof(voice=voice)
        _models[voice] = model
    return model


def synthesize(text: str, voice: str = DEFAULT_VOICE) -> tuple[bytes, str]:
    """(audio bytes, media type) for cleaned `text`, from the cache when it has
    been spoken before. One sentence is generated at a time: the model keeps a
    process-wide random generator, and a second thread would only slow both."""
    hit = cached_audio(text, voice)
    if hit:
        return hit
    with _lock:
        hit = cached_audio(text, voice)
        if hit:
            return hit
        # The same seed every time: the same sentence always sounds the same.
        samples = _model(voice)(text, seed=0)
        data, media_type = encode_audio(samples)
        _store(cache_key(text, voice), data, media_type)
        return data, media_type


def _ssl_context():
    """certifi's certificates when installed: python.org's macOS Python has
    none of its own until its Install Certificates script is run."""
    import ssl

    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def download_model(target: str = MODEL_DIR) -> None:
    """Fetch the pinned model files from Hugging Face into `target`."""
    for name in MODEL_FILES:
        destination = os.path.join(target, name)
        if os.path.isfile(destination) and os.path.getsize(destination) > 0:
            continue
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{name}"
        print(f"[woof_tts] downloading {name}")
        temporary = f"{destination}.part"
        with urllib.request.urlopen(url, timeout=120, context=_ssl_context()) as response, open(temporary, "wb") as out:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
        os.replace(temporary, destination)


if __name__ == "__main__":
    download_model()
    print(f"[woof_tts] model ready in {MODEL_DIR}")
