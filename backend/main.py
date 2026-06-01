from fastapi import FastAPI, HTTPException
from konlpy.tag import Okt
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import httpx
import asyncio
import json
import xml.etree.ElementTree as ET
from typing import Any, Optional
import os
from functools import partial
from uuid import uuid4
from dotenv import load_dotenv
from hanja_router import router as hanja_router

try:
    from koroman import romanize as koroman_romanize
except ImportError:
    koroman_romanize = None

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ─── Rate Limit Config ────────────────────────────────────────────────────────
# Set ENABLE_RATE_LIMIT_DELAY = True in production to be polite to the KRDICT API.
# Keep False during local testing so preprocessing finishes quickly.
ENABLE_RATE_LIMIT_DELAY = False
RATE_LIMIT_DELAY_SECONDS = 0.1  # 100ms between KRDICT calls when enabled

# Maximum unique stems to process per book.
# None = no cap (process every stem in the book). This can be overridden per-request
# by passing max_stems in the request body.
MAX_STEMS_DEFAULT = None
KRDICT_CONCURRENCY_LIMIT = 10
JOB_PROGRESS_LOG_INTERVAL = 25
KRDICT_API_URL = "https://krdict.korean.go.kr/api/search"
LRCLIB_BASE_URL = "https://lrclib.net/api"
LRCLIB_HEADERS = {
    "User-Agent": os.getenv("LRCLIB_USER_AGENT", "FluentFable/0.1")
}

# ─── Server-Side Cache DB ─────────────────────────────────────────────────────
# This SQLite database lives on the backend server and persists across app restarts.
# It prevents re-calling KRDICT for words that have already been looked up in any book.
CACHE_DB_PATH = os.path.join(os.path.dirname(__file__), "cache.db")


def get_db_connection():
    """Open a connection to the server-side SQLite cache database."""
    conn = sqlite3.connect(CACHE_DB_PATH)
    conn.row_factory = sqlite3.Row  # Rows accessible as dicts
    return conn


def init_cache_db():
    """
    Create the dictionary_cache table on startup if it doesn't already exist.
    This table stores one row per unique Korean stem, with its KRDICT definition.
    """
    print("[main] Initializing server-side cache database at:", CACHE_DB_PATH)
    conn = get_db_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dictionary_cache (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            stem        TEXT UNIQUE NOT NULL,
            definition  TEXT,
            hanja       TEXT,
            pos         TEXT,
            domain      TEXT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Index on stem for O(1) lookups when checking cache hits
    conn.execute("CREATE INDEX IF NOT EXISTS idx_stem ON dictionary_cache(stem)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS song_cache (
            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT,
            duration REAL,
            instrumental INTEGER DEFAULT 0,
            plain_lyrics TEXT,
            synced_lyrics TEXT,
            source_payload TEXT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (provider, provider_id)
        )
    """)
    conn.commit()
    conn.close()
    print("[main] Server-side cache database initialized.")


# Run on module load (executes when uvicorn starts the server)
init_cache_db()

# ─── App + NLP Setup ──────────────────────────────────────────────────────────
app = FastAPI()
okt = Okt()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hanja_router)

KRDICT_CLIENT_ID = os.getenv("KOREAN_DICTIONARY_CLIENT_ID", "").strip()

preprocess_jobs: dict[str, dict] = {}
preprocess_jobs_lock = asyncio.Lock()

LOOKUP_ALLOWED_POS = {"Noun", "Verb", "Adverb", "Adjective"}
TRAILING_ENDING_FRAGMENTS = {
    "고요",
    "군요",
    "네요",
    "나요",
    "대요",
    "데요",
    "라고요",
    "다고요",
    "죠",
    "지요",
    "요",
}
COPULA_STEMS = {"이다"}


def romanize_korean_text(text: str) -> str:
    global koroman_romanize

    if not text:
        return ""

    if koroman_romanize is None:
        try:
            from koroman import romanize as lazy_romanize
            koroman_romanize = lazy_romanize
        except ImportError:
            return ""

    try:
        return koroman_romanize(text, casing_option="lowercase").strip()
    except Exception as error:
        print(f"[main] Error romanizing {text!r}: {error}")
        return ""


async def update_preprocess_job(job_id: str, **updates):
    async with preprocess_jobs_lock:
        existing = preprocess_jobs.get(job_id)
        if not existing:
            return
        existing.update(updates)


async def create_preprocess_job():
    job_id = str(uuid4())
    async with preprocess_jobs_lock:
        preprocess_jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "stage": "queued",
            "message": "Job queued",
            "stats": {},
            "results": None,
            "surface_index": None,
            "error": None,
        }
    return job_id


async def get_preprocess_job(job_id: str):
    async with preprocess_jobs_lock:
        job = preprocess_jobs.get(job_id)
        return dict(job) if job else None


def merge_noun_hada(morphs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    merged_morphs: list[tuple[str, str]] = []
    index = 0

    while index < len(morphs):
        word, pos = morphs[index]
        if (
            pos == 'Noun'
            and index + 1 < len(morphs)
            and morphs[index + 1] == ('하다', 'Verb')
        ):
            merged_morphs.append((word + '하다', 'Verb'))
            index += 2
            continue

        merged_morphs.append((word, pos))
        index += 1

    return merged_morphs


def is_trailing_ending_fragment(word: str, pos: str) -> bool:
    return word in TRAILING_ENDING_FRAGMENTS and pos in {"Noun", "Josa", "Eomi", "Suffix"}


def should_skip_lookup_morph(
    morphs: list[tuple[str, str]],
    index: int,
    *,
    single_eojeol: bool,
) -> bool:
    word, pos = morphs[index]

    if word in COPULA_STEMS:
        return True

    if index == 0:
        return False

    if not is_trailing_ending_fragment(word, pos):
        return False

    previous_word, previous_pos = morphs[index - 1]
    return (
        single_eojeol
        or previous_pos in {"Josa", "Determiner"}
        or previous_word in COPULA_STEMS
    )


def filter_lookup_morphs(morphs: list[tuple[str, str]], text: str) -> list[tuple[str, str]]:
    single_eojeol = not any(char.isspace() for char in text.strip())
    filtered_morphs: list[tuple[str, str]] = []

    for index, (word, pos) in enumerate(morphs):
        if pos not in LOOKUP_ALLOWED_POS:
            continue

        if should_skip_lookup_morph(morphs, index, single_eojeol=single_eojeol):
            continue

        filtered_morphs.append((word, pos))

    return filtered_morphs


def filter_lookup_stems(morphs: list[tuple[str, str]], text: str) -> list[str]:
    return [word for word, _pos in filter_lookup_morphs(morphs, text)]


def should_skip_surface_index_morph(
    raw_stem_morphs: list[tuple[str, str]],
    index: int,
) -> bool:
    word, pos = raw_stem_morphs[index]

    if word in COPULA_STEMS:
        return True

    if index == 0 or not is_trailing_ending_fragment(word, pos):
        return False

    previous_word, previous_pos = raw_stem_morphs[index - 1]
    return previous_pos in {"Josa", "Determiner"} or previous_word in COPULA_STEMS


def is_noun_surface_connector(
    surface_word: str,
    surface_pos: str,
    stem_word: str,
    stem_pos: str,
    next_stem: tuple[str, str] | None = None,
) -> bool:
    if surface_pos == "Josa" or stem_pos == "Josa":
        return True

    if stem_word in COPULA_STEMS:
        return True

    if surface_word == "이" and surface_pos == "Determiner":
        if next_stem:
            next_stem_word, next_stem_pos = next_stem
            return is_trailing_ending_fragment(next_stem_word, next_stem_pos)
        return True

    return False


def build_surface_index(
    raw_surface_morphs: list[tuple[str, str]],
    raw_stem_morphs: list[tuple[str, str]],
    allowed_pos: set[str],
) -> list[dict]:
    merged_pairs: list[tuple[str, str, str]] = []
    skip_indices: set[int] = set()
    pair_count = min(len(raw_surface_morphs), len(raw_stem_morphs))
    index = 0

    while index < pair_count:
        if index in skip_indices:
            index += 1
            continue

        surface_word, surface_pos = raw_surface_morphs[index]
        stem_word, stem_pos = raw_stem_morphs[index]

        if should_skip_surface_index_morph(raw_stem_morphs, index):
            index += 1
            continue

        if (
            stem_pos == 'Noun'
            and index + 1 < pair_count
            and raw_stem_morphs[index + 1] == ('하다', 'Verb')
        ):
            next_surface_word, _next_surface_pos = raw_surface_morphs[index + 1]
            merged_pairs.append((surface_word + next_surface_word, stem_word + '하다', 'Verb'))
            index += 2
            continue

        merged_pairs.append((surface_word, stem_word, stem_pos))

        # Preserve noun + particle surface forms exactly as they appear in the
        # book so book_index can later resolve taps/highlights like:
        #   제목을 -> 제목
        #   우리에 -> 우리
        #   꾀와 -> 꾀
        #   일품이고요 -> 일품
        #
        # We keep the noun stem as the canonical lookup target, but add one or
        # more cumulative surface forms when the noun is immediately followed by
        # particles/copula endings. This keeps storage bounded to forms actually
        # seen in the text rather than generating theoretical grammar variants.
        if stem_pos == 'Noun':
            combined_surface = surface_word
            lookahead = index + 1
            saw_connector = False

            while lookahead < pair_count:
                next_surface_word, next_surface_pos = raw_surface_morphs[lookahead]
                next_stem_word, next_stem_pos = raw_stem_morphs[lookahead]
                following_stem = raw_stem_morphs[lookahead + 1] if lookahead + 1 < pair_count else None

                if is_noun_surface_connector(
                    next_surface_word,
                    next_surface_pos,
                    next_stem_word,
                    next_stem_pos,
                    following_stem,
                ):
                    saw_connector = True
                    combined_surface += next_surface_word
                    merged_pairs.append((combined_surface, stem_word, 'Noun'))
                    if next_stem_word in COPULA_STEMS:
                        skip_indices.add(lookahead)
                    lookahead += 1
                    continue

                if saw_connector and is_trailing_ending_fragment(next_stem_word, next_stem_pos):
                    combined_surface += next_surface_word
                    merged_pairs.append((combined_surface, stem_word, 'Noun'))
                    skip_indices.add(lookahead)
                    lookahead += 1
                    continue

                break

        index += 1

    seen_pairs: set[tuple[str, str]] = set()
    surface_index: list[dict] = []

    for surface, stem, pos in merged_pairs:
        if pos not in allowed_pos:
            continue

        normalized_surface = surface.strip()
        normalized_stem = stem.strip()
        if not normalized_surface or not normalized_stem:
            continue

        pair = (normalized_surface, normalized_stem)
        if pair in seen_pairs:
            continue

        seen_pairs.add(pair)
        surface_index.append({
            "surface": normalized_surface,
            "stem": normalized_stem,
        })

    return surface_index


# ─── Existing Endpoint: Single-text Stemming ─────────────────────────────────
@app.get("/okt_morphs/")
async def get_okt_morphs(text: str):
    """
    Stem a single text query (used during real-time word taps when a word
    isn't in the book's preprocessed cache yet).
    """
    print(f"[main] /okt_morphs/ | text: {text!r}")
    raw_morphs = merge_noun_hada(okt.pos(text, stem=True))
    print(f"[main] Raw morphs ({len(raw_morphs)} total): {raw_morphs}")

    filtered_stems = filter_lookup_stems(raw_morphs, text)
    print(f"[main] Filtered stems (first 20): {filtered_stems[:20]}")
    return {"result": filtered_stems}


@app.get("/romanize/")
async def romanize_text(text: str):
    normalized = text.strip() if isinstance(text, str) else ""
    if not normalized:
        return {"romanization": ""}

    if koroman_romanize is None:
        raise HTTPException(status_code=503, detail="koroman is not installed on the backend")

    return {"romanization": romanize_korean_text(normalized)}


@app.get("/songs/search")
async def search_songs(q: str = "", limit: int = 10):
    query = q.strip() if isinstance(q, str) else ""
    if not query:
        return {"results": []}

    result_limit = max(1, min(limit, 25))

    try:
        async with httpx.AsyncClient(headers=LRCLIB_HEADERS) as client:
            response = await client.get(
                f"{LRCLIB_BASE_URL}/search",
                params={"q": query},
                timeout=10.0,
            )
    except httpx.RequestError as error:
        print(f"[main] LRCLIB search failed for {query!r}: {error}")
        raise HTTPException(status_code=502, detail="Lyrics provider request failed") from error

    if response.status_code != 200:
        print(f"[main] LRCLIB search HTTP {response.status_code} for {query!r}: {response.text[:200]}")
        raise HTTPException(status_code=502, detail="Lyrics provider request failed")

    try:
        payload = response.json()
    except ValueError as error:
        print(f"[main] LRCLIB search returned invalid JSON for {query!r}: {error}")
        raise HTTPException(status_code=502, detail="Lyrics provider returned invalid data") from error

    raw_results = payload if isinstance(payload, list) else payload.get("data", [])
    if not isinstance(raw_results, list):
        raw_results = []

    results: list[dict[str, Any]] = []
    for raw_song in raw_results:
        if not isinstance(raw_song, dict):
            continue

        normalized = normalize_lrclib_song(raw_song)
        if not normalized["id"] or not song_has_lyrics(normalized):
            continue

        results.append(normalized)
        cache_lrclib_song(normalized, raw_song)

        if len(results) >= result_limit:
            break

    return {"results": results}


@app.get("/songs/{song_id}")
async def get_song(song_id: str):
    normalized_song_id = song_id.strip() if isinstance(song_id, str) else ""
    if not normalized_song_id:
        raise HTTPException(status_code=404, detail="Song not found")

    cached_song = get_cached_lrclib_song(normalized_song_id)
    if cached_song and song_has_lyrics(cached_song):
        return cached_song

    try:
        async with httpx.AsyncClient(headers=LRCLIB_HEADERS) as client:
            response = await client.get(
                f"{LRCLIB_BASE_URL}/get/{normalized_song_id}",
                timeout=10.0,
            )
    except httpx.RequestError as error:
        print(f"[main] LRCLIB get failed for {normalized_song_id!r}: {error}")
        raise HTTPException(status_code=502, detail="Lyrics provider request failed") from error

    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Song lyrics not found")

    if response.status_code != 200:
        print(f"[main] LRCLIB get HTTP {response.status_code} for {normalized_song_id!r}: {response.text[:200]}")
        raise HTTPException(status_code=502, detail="Lyrics provider request failed")

    try:
        payload = response.json()
    except ValueError as error:
        print(f"[main] LRCLIB get returned invalid JSON for {normalized_song_id!r}: {error}")
        raise HTTPException(status_code=502, detail="Lyrics provider returned invalid data") from error

    if not isinstance(payload, dict):
        raise HTTPException(status_code=404, detail="Song lyrics not found")

    normalized = normalize_lrclib_song(payload)
    if not normalized["id"] or not song_has_lyrics(normalized):
        raise HTTPException(status_code=404, detail="Song lyrics not found")

    cache_lrclib_song(normalized, payload)
    return normalized


# ─── KRDICT Helper ────────────────────────────────────────────────────────────
async def lookup_stem_in_krdict(
    client: httpx.AsyncClient,
    stem: str,
    krdict_key: str
) -> Optional[dict]:
    """
    Call the KRDICT API for a single Korean stem.
    Parses the XML response and returns the first definition entry.
    Returns None if the word is not found or the request fails.
    """
    try:
        response = await client.get(
            KRDICT_API_URL,
            params={
                "key": krdict_key,
                "q": stem,
                "sort": "popular",
                "translated": "y",
                "trans_lang": "1",  # English translation
            },
            timeout=10.0
        )

        if response.status_code != 200:
            print(f"[main] KRDICT returned HTTP {response.status_code} for '{stem}'")
            return None

        root = ET.fromstring(response.text)
        item = root.find(".//item")

        if item is None:
            # Word not in dictionary (proper nouns, slang, etc.)
            print(f"[main] No KRDICT entry for '{stem}'")
            return None

        # Extract the top definition fields
        origin_el  = item.find("origin")
        trans_el   = item.find(".//trans_word")
        pos_el     = item.find("pos")

        definition = "N/A"
        if trans_el is not None and trans_el.text:
            definition = trans_el.text.strip()
            # KRDICT appends "^" as a separator artifact — strip it
            if definition.endswith("^"):
                definition = definition[:-1].strip()

        result = {
            "stem":       stem,
            "hanja":      origin_el.text if origin_el is not None and origin_el.text else "N/A",
            "definition": definition,
            "pos":        pos_el.text if pos_el is not None and pos_el.text else "Unknown",
            "romanization": romanize_korean_text(stem),
        }
        print(f"[main] KRDICT '{stem}' → '{result['definition'][:60]}'")
        return result

    except Exception as e:
        print(f"[main] Error looking up '{stem}' in KRDICT: {e}")
        return None


async def search_krdict_entries(
    client: httpx.AsyncClient,
    query: str,
    krdict_key: str,
) -> list[dict]:
    try:
        response = await client.get(
            KRDICT_API_URL,
            params={
                "key": krdict_key,
                "q": query,
                "sort": "popular",
                "translated": "y",
                "trans_lang": "1",
            },
            timeout=10.0,
        )

        if response.status_code != 200:
            print(f"[main] KRDICT search returned HTTP {response.status_code} for '{query}'")
            return []

        root = ET.fromstring(response.text)
        items = root.findall(".//item")
        results = []
        for item in items:
            word_el = item.find("word")
            origin_el = item.find("origin")
            pos_el = item.find("pos")
            pronunciation_el = item.find("pronunciation")
            trans_el = item.find(".//trans_word")
            word_text = word_el.text if word_el is not None and word_el.text else query
            results.append({
                "word": word_text,
                "origin": origin_el.text if origin_el is not None and origin_el.text else "N/A",
                "pos": pos_el.text if pos_el is not None and pos_el.text else None,
                "pronunciation": (
                    pronunciation_el.text
                    if pronunciation_el is not None and pronunciation_el.text
                    else None
                ),
                "romanization": romanize_korean_text(word_text),
                "transWord": (
                    trans_el.text.strip().rstrip("^").strip()
                    if trans_el is not None and trans_el.text
                    else "N/A"
                ),
            })
        return results
    except Exception as error:
        print(f"[main] Error searching KRDICT for '{query}': {error}")
        return []


def get_lrclib_field(raw: dict, camel_key: str, snake_key: str, default=None):
    if camel_key in raw:
        return raw.get(camel_key)
    return raw.get(snake_key, default)


def strip_synced_lyric_timestamps(synced_lyrics: str) -> str:
    lines = []
    for raw_line in str(synced_lyrics or "").splitlines():
        line = raw_line.strip()
        while line.startswith("[") and "]" in line:
            line = line[line.find("]") + 1:].strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def count_nonempty_lyric_lines(plain_lyrics: str, synced_lyrics: str) -> int:
    source = plain_lyrics or strip_synced_lyric_timestamps(synced_lyrics)
    return len([line for line in str(source or "").splitlines() if line.strip()])


def normalize_lrclib_song(raw: dict[str, Any]) -> dict[str, Any]:
    plain_lyrics = get_lrclib_field(raw, "plainLyrics", "plain_lyrics") or ""
    synced_lyrics = get_lrclib_field(raw, "syncedLyrics", "synced_lyrics") or ""
    provider_id = get_lrclib_field(raw, "id", "id")

    return {
        "id": str(provider_id) if provider_id is not None else "",
        "provider": "lrclib",
        "title": get_lrclib_field(raw, "trackName", "track_name") or raw.get("title") or "",
        "artist": get_lrclib_field(raw, "artistName", "artist_name") or raw.get("artist") or "",
        "album": get_lrclib_field(raw, "albumName", "album_name") or raw.get("album") or "",
        "duration": get_lrclib_field(raw, "duration", "duration"),
        "instrumental": bool(get_lrclib_field(raw, "instrumental", "instrumental", False)),
        "plainLyrics": plain_lyrics,
        "syncedLyrics": synced_lyrics,
        "hasSyncedLyrics": bool(synced_lyrics),
        "linesCount": count_nonempty_lyric_lines(plain_lyrics, synced_lyrics),
    }


def normalize_cached_song(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["provider_id"]),
        "provider": row["provider"],
        "title": row["title"] or "",
        "artist": row["artist"] or "",
        "album": row["album"] or "",
        "duration": row["duration"],
        "instrumental": bool(row["instrumental"]),
        "plainLyrics": row["plain_lyrics"] or "",
        "syncedLyrics": row["synced_lyrics"] or "",
        "hasSyncedLyrics": bool(row["synced_lyrics"]),
        "linesCount": count_nonempty_lyric_lines(row["plain_lyrics"] or "", row["synced_lyrics"] or ""),
    }


def cache_lrclib_song(song: dict[str, Any], source_payload: dict[str, Any] | None = None):
    if not song.get("id"):
        return

    conn = get_db_connection()
    conn.execute(
        """
        INSERT INTO song_cache (
            provider, provider_id, title, artist, album, duration, instrumental,
            plain_lyrics, synced_lyrics, source_payload, last_updated
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(provider, provider_id) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            duration = excluded.duration,
            instrumental = excluded.instrumental,
            plain_lyrics = excluded.plain_lyrics,
            synced_lyrics = excluded.synced_lyrics,
            source_payload = excluded.source_payload,
            last_updated = CURRENT_TIMESTAMP
        """,
        [
            "lrclib",
            song["id"],
            song.get("title", ""),
            song.get("artist", ""),
            song.get("album", ""),
            song.get("duration"),
            1 if song.get("instrumental") else 0,
            song.get("plainLyrics", ""),
            song.get("syncedLyrics", ""),
            json.dumps(source_payload or song, ensure_ascii=False),
        ],
    )
    conn.commit()
    conn.close()


def get_cached_lrclib_song(song_id: str) -> Optional[dict[str, Any]]:
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT provider, provider_id, title, artist, album, duration, instrumental,
               plain_lyrics, synced_lyrics
        FROM song_cache
        WHERE provider = ? AND provider_id = ?
        """,
        ["lrclib", song_id],
    ).fetchone()
    conn.close()

    if not row:
        return None

    return normalize_cached_song(row)


def song_has_lyrics(song: dict[str, Any]) -> bool:
    return bool(song.get("plainLyrics") or song.get("syncedLyrics") or song.get("instrumental"))


async def run_preprocess_pipeline(job_id: str, text: str, krdict_key: str, max_stems):
    print(f"[main] preprocess job {job_id} started")
    await update_preprocess_job(
        job_id,
        status="running",
        stage="stemming",
        message="Analyzing book text",
    )

    allowed_pos = {"Noun", "Verb", "Adverb", "Adjective"}
    loop = asyncio.get_event_loop()
    raw_surface_morphs, raw_stem_morphs = await asyncio.gather(
        loop.run_in_executor(None, partial(okt.pos, text, stem=False)),
        loop.run_in_executor(None, partial(okt.pos, text, stem=True)),
    )
    print(
        f"[main] Okt returned {len(raw_surface_morphs)} unstemmed morphs and "
        f"{len(raw_stem_morphs)} stemmed morphs"
    )

    merged_stem_morphs = merge_noun_hada(raw_stem_morphs)
    surface_index = build_surface_index(raw_surface_morphs, raw_stem_morphs, allowed_pos)

    filtered_stem_morphs = filter_lookup_morphs(merged_stem_morphs, text)

    stem_pos_map: dict[str, str] = {}
    for word, pos in filtered_stem_morphs:
        if word not in stem_pos_map:
            stem_pos_map[word] = pos

    unique_stems = list(stem_pos_map.keys()) if not max_stems else list(stem_pos_map.keys())[:max_stems]
    processed_stems = set(unique_stems)
    surface_index = [entry for entry in surface_index if entry["stem"] in processed_stems]
    print(f"[main] {len(stem_pos_map)} unique stems found, processing {len(unique_stems)}")
    print(f"[main] surface_index contains {len(surface_index)} unique surface→stem pairs")

    if not unique_stems:
        stats = {"total_stems": 0, "cache_hits": 0, "new_fetched": 0}
        await update_preprocess_job(
            job_id,
            status="completed",
            stage="completed",
            message="No stems found",
            stats=stats,
            results=[],
            surface_index=surface_index,
        )
        return

    await update_preprocess_job(
        job_id,
        stage="checking_cache",
        message="Checking cached dictionary entries",
        stats={"total_stems": len(unique_stems)},
    )

    conn = get_db_connection()
    placeholders = ",".join(["?"] * len(unique_stems))
    cached_rows = conn.execute(
        f"SELECT stem, definition, hanja, pos, domain FROM dictionary_cache WHERE stem IN ({placeholders})",
        unique_stems
    ).fetchall()
    conn.close()

    cached_stems = {row["stem"] for row in cached_rows}
    cached_results = [dict(row) for row in cached_rows]
    missing_stems = [s for s in unique_stems if s not in cached_stems]

    print(f"[main] Cache hits: {len(cached_stems)} | Stems to fetch from KRDICT: {len(missing_stems)}")
    await update_preprocess_job(
        job_id,
        stage="fetching_krdict" if missing_stems else "finalizing",
        message=(
            "Fetching missing dictionary entries"
            if missing_stems
            else "Finalizing cached preprocessing results"
        ),
        stats={
            "total_stems": len(unique_stems),
            "cache_hits": len(cached_stems),
            "new_fetched": 0,
            "missing_stems": len(missing_stems),
            "fetched_stems": 0,
        },
    )

    new_results: list[dict] = []
    no_entry_results: list[dict] = []

    if missing_stems:
        print(f"[main] Fetching {len(missing_stems)} stems from KRDICT "
              f"({'with' if ENABLE_RATE_LIMIT_DELAY else 'without'} rate-limit delay)...")

        semaphore = asyncio.Semaphore(KRDICT_CONCURRENCY_LIMIT)
        completed_fetches = 0

        async def fetch_missing_stem(client: httpx.AsyncClient, stem: str, index: int):
            nonlocal completed_fetches
            async with semaphore:
                if ENABLE_RATE_LIMIT_DELAY:
                    await asyncio.sleep(RATE_LIMIT_DELAY_SECONDS)

                result = await lookup_stem_in_krdict(client, stem, krdict_key)

                if ENABLE_RATE_LIMIT_DELAY:
                    await asyncio.sleep(RATE_LIMIT_DELAY_SECONDS)

                completed_fetches += 1
                if (
                    completed_fetches % JOB_PROGRESS_LOG_INTERVAL == 0
                    or completed_fetches == len(missing_stems)
                ):
                    print(f"[main] KRDICT progress: {completed_fetches}/{len(missing_stems)} stems")
                    await update_preprocess_job(
                        job_id,
                        stage="fetching_krdict",
                        message=f"Fetching dictionary entries ({completed_fetches}/{len(missing_stems)})",
                        stats={
                            "total_stems": len(unique_stems),
                            "cache_hits": len(cached_stems),
                            "new_fetched": 0,
                            "missing_stems": len(missing_stems),
                            "fetched_stems": completed_fetches,
                        },
                    )

                return result

        async with httpx.AsyncClient() as client:
            ordered_results = await asyncio.gather(
                *(fetch_missing_stem(client, stem, index) for index, stem in enumerate(missing_stems))
            )

        new_results = [result for result in ordered_results if result]

        fetched_stems = {r["stem"] for r in new_results}
        no_entry_results = [
            {"stem": s, "definition": None, "hanja": None, "pos": None, "domain": None}
            for s in missing_stems if s not in fetched_stems
        ]

        rows_to_insert = new_results + no_entry_results
        if rows_to_insert:
            conn = get_db_connection()
            conn.executemany(
                """INSERT OR IGNORE INTO dictionary_cache (stem, definition, hanja, pos, domain)
                   VALUES (:stem, :definition, :hanja, :pos, :domain)""",
                rows_to_insert
            )
            conn.commit()
            conn.close()
            print(f"[main] Cached {len(new_results)} found + {len(no_entry_results)} no-entry stems")

    all_results = cached_results + new_results + no_entry_results
    stats = {
        "total_stems": len(unique_stems),
        "cache_hits": len(cached_stems),
        "new_fetched": len(new_results),
    }
    print(f"[main] /preprocess_book/ complete | {stats}")
    await update_preprocess_job(
        job_id,
        status="completed",
        stage="completed",
        message="Preprocessing complete",
        stats=stats,
        results=all_results,
        surface_index=surface_index,
    )


# ─── New Endpoint: Full Book Preprocessing ────────────────────────────────────
@app.post("/preprocess_book/")
async def preprocess_book(payload: dict):
    """
    Full preprocessing pipeline for a book's raw text content.
    Intended to be called once per book, after text is extracted on the client.

    Pipeline:
      1. Stem all text with Okt (Nouns, Verbs, Adverbs, Adjectives)
      2. Check server-side dictionary_cache for already-known stems
      3. Call KRDICT for stems that are missing from cache
         (with optional 100ms rate-limit delay between calls)
      4. INSERT OR IGNORE new results into server-side cache
      5. Return all {stem, hanja, definition, pos} for the caller to store locally

    Request body (JSON):
        text       (str): Raw extracted text from the EPUB
        max_stems  (int, optional): Cap on unique stems to process (default 2000)
                   Prevents runaway processing for extremely long books.

    Response:
        job_id (str): Background preprocessing job identifier
        status (str): Initial job status
    """
    text       = payload.get("text", "")
    max_stems  = payload.get("max_stems", MAX_STEMS_DEFAULT)

    if not text:
        print("[main] /preprocess_book/ called with empty text")
        return {"error": "No text provided", "job_id": None, "status": "failed"}
    if not KRDICT_CLIENT_ID:
        print("[main] /preprocess_book/ called without backend KRDICT key")
        return {"error": "No KRDICT key configured on server", "job_id": None, "status": "failed"}

    print(f"[main] /preprocess_book/ | text length: {len(text):,} chars | max_stems: {max_stems}")
    job_id = await create_preprocess_job()
    asyncio.create_task(run_preprocess_job(job_id, text, KRDICT_CLIENT_ID, max_stems))
    return {"job_id": job_id, "status": "queued"}


async def run_preprocess_job(job_id: str, text: str, krdict_key: str, max_stems):
    try:
        await run_preprocess_pipeline(job_id, text, krdict_key, max_stems)
    except Exception as error:
        print(f"[main] preprocess job {job_id} failed: {error}")
        await update_preprocess_job(
            job_id,
            status="failed",
            stage="failed",
            message="Preprocessing failed",
            error=str(error),
            results=[],
            surface_index=[],
        )


@app.get("/preprocess_status/{job_id}")
async def preprocess_status(job_id: str):
    job = await get_preprocess_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown preprocessing job")

    return job


@app.post("/krdict_search/")
async def krdict_search(payload: dict):
    queries = payload.get("queries", [])
    if not KRDICT_CLIENT_ID:
        raise HTTPException(status_code=500, detail="No KRDICT key configured on server")

    normalized_queries = [
        query.strip()
        for query in queries
        if isinstance(query, str) and query.strip()
    ]

    if not normalized_queries:
        return {"results": []}

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *(search_krdict_entries(client, query, KRDICT_CLIENT_ID) for query in normalized_queries)
        )

    return {"results": results}
