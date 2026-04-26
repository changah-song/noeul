from fastapi import FastAPI, HTTPException
from konlpy.tag import Okt
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import httpx
import asyncio
import xml.etree.ElementTree as ET
from typing import Optional
import os
from functools import partial
from uuid import uuid4
from dotenv import load_dotenv

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

KRDICT_CLIENT_ID = os.getenv("KOREAN_DICTIONARY_CLIENT_ID", "").strip()

preprocess_jobs: dict[str, dict] = {}
preprocess_jobs_lock = asyncio.Lock()


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


def build_surface_index(
    raw_surface_morphs: list[tuple[str, str]],
    raw_stem_morphs: list[tuple[str, str]],
    allowed_pos: set[str],
) -> list[dict]:
    merged_pairs: list[tuple[str, str, str]] = []
    pair_count = min(len(raw_surface_morphs), len(raw_stem_morphs))
    index = 0

    while index < pair_count:
        surface_word, surface_pos = raw_surface_morphs[index]
        stem_word, stem_pos = raw_stem_morphs[index]

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
        #
        # We keep the noun stem as the canonical lookup target, but add one or
        # more cumulative surface forms when the noun is immediately followed by
        # Josa tokens. This keeps storage bounded to forms actually seen in the
        # text rather than generating theoretical grammar variants.
        if stem_pos == 'Noun':
            combined_surface = surface_word
            lookahead = index + 1

            while lookahead < pair_count:
                next_surface_word, next_surface_pos = raw_surface_morphs[lookahead]
                _next_stem_word, next_stem_pos = raw_stem_morphs[lookahead]

                if next_surface_pos != 'Josa' and next_stem_pos != 'Josa':
                    break

                combined_surface += next_surface_word
                merged_pairs.append((combined_surface, stem_word, 'Noun'))
                lookahead += 1

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

    allowed_pos = ['Noun', 'Verb', 'Adverb', 'Adjective']
    filtered_stems = [word for word, pos in raw_morphs if pos in allowed_pos]
    print(f"[main] Filtered stems (first 20): {filtered_stems[:20]}")
    return {"result": filtered_stems}


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
            trans_el = item.find(".//trans_word")
            results.append({
                "word": word_el.text if word_el is not None and word_el.text else query,
                "origin": origin_el.text if origin_el is not None and origin_el.text else "N/A",
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

    stem_pos_map: dict[str, str] = {}
    for word, pos in merged_stem_morphs:
        if pos in allowed_pos and word not in stem_pos_map:
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
