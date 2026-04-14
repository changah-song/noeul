from fastapi import FastAPI
from konlpy.tag import Okt
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
import httpx
import asyncio
import xml.etree.ElementTree as ET
from typing import Optional
import os

# ─── Rate Limit Config ────────────────────────────────────────────────────────
# Set ENABLE_RATE_LIMIT_DELAY = True in production to be polite to the KRDICT API.
# Keep False during local testing so preprocessing finishes quickly.
ENABLE_RATE_LIMIT_DELAY = False
RATE_LIMIT_DELAY_SECONDS = 0.1  # 100ms between KRDICT calls when enabled

# Maximum unique stems to process per book.
# None = no cap (process every stem in the book). This can be overridden per-request
# by passing max_stems in the request body.
MAX_STEMS_DEFAULT = None

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


# ─── Existing Endpoint: Single-text Stemming ─────────────────────────────────
@app.get("/okt_morphs/")
async def get_okt_morphs(text: str):
    """
    Stem a single text query (used during real-time word taps when a word
    isn't in the book's preprocessed cache yet).
    """
    print(f"[main] /okt_morphs/ | text: {text!r}")
    raw_morphs = okt.pos(text, stem=True)
    print(f"[main] Raw morphs ({len(raw_morphs)} total): {raw_morphs}")

    # Merge noun + 하다 pairs into compound verbs (e.g. 정 + 하다 → 정하다).
    # Okt splits "정했다" into [('정', 'Noun'), ('하다', 'Verb')] but the real
    # dictionary entry is 정하다. Merging gives KRDICT a much better lookup target.
    merged_morphs = []
    i = 0
    while i < len(raw_morphs):
        word, pos = raw_morphs[i]
        if (pos == 'Noun'
                and i + 1 < len(raw_morphs)
                and raw_morphs[i + 1] == ('하다', 'Verb')):
            merged_morphs.append((word + '하다', 'Verb'))
            i += 2
        else:
            merged_morphs.append((word, pos))
            i += 1

    allowed_pos = ['Noun', 'Verb', 'Adverb', 'Adjective']
    filtered_stems = [word for word, pos in merged_morphs if pos in allowed_pos]
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
            "https://krdict.korean.go.kr/api/search",
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
        krdict_key (str): KRDICT API key — passed from the client env so the
                          backend doesn't need its own key config
        max_stems  (int, optional): Cap on unique stems to process (default 2000)
                   Prevents runaway processing for extremely long books.

    Response:
        results (list): [{stem, hanja, definition, pos}, ...]
        stats   (dict): {total_stems, cache_hits, new_fetched}
    """
    text       = payload.get("text", "")
    krdict_key = payload.get("krdict_key", "")
    max_stems  = payload.get("max_stems", MAX_STEMS_DEFAULT)

    if not text:
        print("[main] /preprocess_book/ called with empty text")
        return {"error": "No text provided", "results": [], "stats": {}}
    if not krdict_key:
        print("[main] /preprocess_book/ called without KRDICT key")
        return {"error": "No KRDICT key provided", "results": [], "stats": {}}

    print(f"[main] /preprocess_book/ | text length: {len(text):,} chars | max_stems: {max_stems}")

    # ── Step 1: Stem the full book text ───────────────────────────────────────
    print("[main] Running Okt stemming on book text...")
    allowed_pos = {"Noun", "Verb", "Adverb", "Adjective"}
    raw_morphs = okt.pos(text, stem=True)
    print(f"[main] Okt returned {len(raw_morphs)} total morphs")

    # Merge noun + 하다 pairs into compound verbs (same logic as /okt_morphs/)
    merged_morphs: list[tuple[str, str]] = []
    i = 0
    while i < len(raw_morphs):
        word, pos = raw_morphs[i]
        if (pos == 'Noun'
                and i + 1 < len(raw_morphs)
                and raw_morphs[i + 1] == ('하다', 'Verb')):
            merged_morphs.append((word + '하다', 'Verb'))
            i += 2
        else:
            merged_morphs.append((word, pos))
            i += 1

    # Build stem → first-seen POS mapping; deduplicate naturally via dict insertion order
    stem_pos_map: dict[str, str] = {}
    for word, pos in merged_morphs:
        if pos in allowed_pos and word not in stem_pos_map:
            stem_pos_map[word] = pos

    unique_stems = list(stem_pos_map.keys()) if not max_stems else list(stem_pos_map.keys())[:max_stems]
    print(f"[main] {len(stem_pos_map)} unique stems found, processing {len(unique_stems)}")

    # ── Step 2: Check server-side cache for known stems ───────────────────────
    conn = get_db_connection()
    placeholders = ",".join(["?"] * len(unique_stems))
    cached_rows = conn.execute(
        f"SELECT stem, definition, hanja, pos FROM dictionary_cache WHERE stem IN ({placeholders})",
        unique_stems
    ).fetchall()
    conn.close()

    cached_stems   = {row["stem"] for row in cached_rows}
    cached_results = [dict(row) for row in cached_rows]
    missing_stems  = [s for s in unique_stems if s not in cached_stems]

    print(f"[main] Cache hits: {len(cached_stems)} | Stems to fetch from KRDICT: {len(missing_stems)}")

    # ── Step 3: Call KRDICT for missing stems ─────────────────────────────────
    new_results: list[dict] = []
    no_entry_results: list[dict] = []
    if missing_stems:
        print(f"[main] Fetching {len(missing_stems)} stems from KRDICT "
              f"({'with' if ENABLE_RATE_LIMIT_DELAY else 'without'} rate-limit delay)...")

        async with httpx.AsyncClient() as client:
            for i, stem in enumerate(missing_stems):
                result = await lookup_stem_in_krdict(client, stem, krdict_key)
                if result:
                    new_results.append(result)

                # Optional rate limiting — set ENABLE_RATE_LIMIT_DELAY = True for production
                if ENABLE_RATE_LIMIT_DELAY:
                    await asyncio.sleep(RATE_LIMIT_DELAY_SECONDS)

                # Progress logging every 50 stems
                if (i + 1) % 50 == 0:
                    print(f"[main] KRDICT progress: {i + 1}/{len(missing_stems)} stems")

        # ── Step 4: Insert new results into server-side cache ─────────────────
        # Also store "no entry" stems with null definition so we never call
        # KRDICT for them again (and the client can cache them too).
        fetched_stems = {r["stem"] for r in new_results}
        no_entry_results = [
            {"stem": s, "definition": None, "hanja": None, "pos": None}
            for s in missing_stems if s not in fetched_stems
        ]

        rows_to_insert = new_results + no_entry_results
        if rows_to_insert:
            conn = get_db_connection()
            conn.executemany(
                """INSERT OR IGNORE INTO dictionary_cache (stem, definition, hanja, pos)
                   VALUES (:stem, :definition, :hanja, :pos)""",
                rows_to_insert
            )
            conn.commit()
            conn.close()
            print(f"[main] Cached {len(new_results)} found + {len(no_entry_results)} no-entry stems")

    # ── Step 5: Return combined cached + newly fetched + no-entry results ────
    # Including no-entry stems lets the client store them in its local SQLite
    # cache so future taps skip the API call and immediately show "no entry".
    all_results = cached_results + new_results + no_entry_results
    stats = {
        "total_stems": len(unique_stems),
        "cache_hits":  len(cached_stems),
        "new_fetched": len(new_results),
    }
    print(f"[main] /preprocess_book/ complete | {stats}")
    return {"results": all_results, "stats": stats}
