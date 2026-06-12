from fastapi import Depends, FastAPI, Header, HTTPException
from konlpy.tag import Okt
from fastapi.middleware.cors import CORSMiddleware
import jwt
from jwt import PyJWKClient
import sqlite3
import ssl
import httpx
import asyncio
import xml.etree.ElementTree as ET
from typing import Any, Optional
import os
import re
import time
from datetime import datetime, timezone
from functools import partial
from uuid import uuid4
import certifi
from dotenv import load_dotenv

try:
    from koroman import romanize as koroman_romanize
except ImportError:
    koroman_romanize = None

try:
    import spacy
except ImportError:
    spacy = None

try:
    import jieba.posseg as zh_pseg
except ImportError:
    zh_pseg = None

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ─── Rate Limit Config ────────────────────────────────────────────────────────
ENABLE_RATE_LIMIT_DELAY = True
RATE_LIMIT_DELAY_SECONDS = 0.1  # 100ms between KRDICT calls when enabled

# Maximum unique stems to process per book.
# None = no cap (process every stem in the book). This can be overridden per-request
# by passing max_stems in the request body.
MAX_STEMS_DEFAULT = None
KRDICT_CONCURRENCY_LIMIT = 10
JOB_PROGRESS_LOG_INTERVAL = 25
KRDICT_API_URL = "https://krdict.korean.go.kr/api/search"
KRDICT_INTERFACE_LANGUAGES = {
    "en": "1",
    "fr": "3",
    "es": "4",
    "ar": "5",
    "mn": "6",
    "vi": "7",
    "th": "8",
    "id": "9",
    "ru": "10",
    "zh": "11",
}
DEFAULT_INTERFACE_LANGUAGE = "en"
GOOGLE_TRANSLATE_RAPIDAPI_URL = "https://google-translator9.p.rapidapi.com/v2"
GOOGLE_TRANSLATE_RAPIDAPI_HOST = "google-translator9.p.rapidapi.com"
MAX_TEXT_LENGTH = 500_000

AUTHENTICATED_LIMITS = {
    "max_text_chars_per_request": 500_000,
    "max_translate_chars_per_request": 4_000,
    "max_krdict_queries_per_request": 25,
    "max_stems_per_preprocess_job": 5_000,
    "max_active_jobs": 3,
    "daily_quota": 1_000,
}
ANONYMOUS_LIMITS = {
    "max_text_chars_per_request": 150_000,
    "max_translate_chars_per_request": 1_500,
    "max_krdict_queries_per_request": 10,
    "max_stems_per_preprocess_job": 1_000,
    "max_active_jobs": 1,
    "daily_quota": 300,
}
PREPROCESS_TERMINAL_STATUSES = {"completed", "failed"}
PREPROCESS_JOB_TTL_SECONDS = 300
PREPROCESS_JOB_READ_TTL_SECONDS = 60
PREPROCESS_ACTIVE_JOB_TTL_SECONDS = 60 * 60

# ─── Server-Side Cache DB ─────────────────────────────────────────────────────
# This SQLite database lives on the backend server and persists across app restarts.
# It prevents re-calling KRDICT for words that have already been looked up in any book.
CACHE_DB_PATH = os.path.join(os.path.dirname(__file__), "cache.db")
EN_DICT_DB_PATH = os.path.join(os.path.dirname(__file__), "en_dict.db")
ZH_DICT_DB_PATH = os.path.join(os.path.dirname(__file__), "zh_dict.db")


def get_db_connection():
    """Open a connection to the server-side SQLite cache database."""
    conn = sqlite3.connect(CACHE_DB_PATH)
    conn.row_factory = sqlite3.Row  # Rows accessible as dicts
    return conn


def get_kaikki_db_connection():
    """Open a read-only connection to the local Kaikki English dictionary DB."""
    if not os.path.exists(EN_DICT_DB_PATH):
        raise HTTPException(status_code=503, detail="English dictionary database is not installed")

    conn = sqlite3.connect(f"file:{EN_DICT_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def get_zh_dict_db_connection():
    """Open a read-only connection to the local CC-CEDICT Chinese dictionary DB."""
    if not os.path.exists(ZH_DICT_DB_PATH):
        raise HTTPException(status_code=503, detail="Chinese dictionary database is not installed")

    conn = sqlite3.connect(f"file:{ZH_DICT_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def is_zh_dict_db_installed() -> bool:
    return os.path.exists(ZH_DICT_DB_PATH)


def create_dictionary_cache_table(conn: sqlite3.Connection, table_name: str = "dictionary_cache"):
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            stem               TEXT NOT NULL,
            language           TEXT NOT NULL DEFAULT 'ko',
            interface_language TEXT NOT NULL DEFAULT 'en',
            definition         TEXT,
            gloss              TEXT,
            hanja              TEXT,
            pos                TEXT,
            domain             TEXT,
            ipa                TEXT,
            etymology          TEXT,
            derived            TEXT,
            related            TEXT,
            last_updated       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(stem, language, interface_language)
        )
    """)


def _dictionary_cache_columns(conn: sqlite3.Connection) -> list[str]:
    return [row[1] for row in conn.execute("PRAGMA table_info(dictionary_cache)").fetchall()]


def _dictionary_cache_has_old_unique_stem_index(conn: sqlite3.Connection) -> bool:
    for index_row in conn.execute("PRAGMA index_list(dictionary_cache)").fetchall():
        # PRAGMA index_list columns: seq, name, unique, origin, partial
        if not index_row[2]:
            continue

        index_name = index_row[1]
        index_columns = [
            column_row[2]
            for column_row in conn.execute(f"PRAGMA index_info({index_name})").fetchall()
        ]
        if index_columns == ["stem"]:
            return True

    return False


def _sql_column_or_default(existing_columns: list[str], column: str, default_sql: str) -> str:
    return column if column in existing_columns else default_sql


def init_cache_db():
    """
    Create the dictionary_cache table on startup if it doesn't already exist.
    This table stores one row per dictionary stem, target language, and UI language.
    """
    print("[main] Initializing server-side cache database at:", CACHE_DB_PATH)
    conn = get_db_connection()
    create_dictionary_cache_table(conn)
    conn.commit()
    conn.close()
    print("[main] Server-side cache database initialized.")


def migrate_cache_db():
    """
    Upgrade older server cache DBs from UNIQUE(stem) to
    UNIQUE(stem, language, interface_language).

    SQLite cannot drop the old UNIQUE(stem) constraint in place, so when we
    detect the old schema we rebuild the table and copy rows forward.
    """
    conn = get_db_connection()
    try:
        existing_columns = _dictionary_cache_columns(conn)
        required_columns = {
            "stem",
            "language",
            "interface_language",
            "definition",
            "gloss",
            "hanja",
            "pos",
            "domain",
            "ipa",
            "etymology",
            "derived",
            "related",
            "last_updated",
        }
        needs_rebuild = (
            not required_columns.issubset(set(existing_columns))
            or _dictionary_cache_has_old_unique_stem_index(conn)
        )

        if needs_rebuild:
            print("[main] Migrating dictionary_cache schema for language-aware cache keys")
            conn.execute("DROP TABLE IF EXISTS dictionary_cache_new")
            create_dictionary_cache_table(conn, "dictionary_cache_new")

            select_stem = _sql_column_or_default(existing_columns, "stem", "NULL")
            select_language = (
                "COALESCE(NULLIF(TRIM(language), ''), 'ko')"
                if "language" in existing_columns
                else "'ko'"
            )
            select_interface_language = (
                "COALESCE(NULLIF(TRIM(interface_language), ''), 'en')"
                if "interface_language" in existing_columns
                else "'en'"
            )
            select_definition = _sql_column_or_default(existing_columns, "definition", "NULL")
            select_gloss = _sql_column_or_default(existing_columns, "gloss", "NULL")
            select_hanja = _sql_column_or_default(existing_columns, "hanja", "NULL")
            select_pos = _sql_column_or_default(existing_columns, "pos", "NULL")
            select_domain = _sql_column_or_default(existing_columns, "domain", "NULL")
            select_ipa = _sql_column_or_default(existing_columns, "ipa", "NULL")
            select_etymology = _sql_column_or_default(existing_columns, "etymology", "NULL")
            select_derived = _sql_column_or_default(existing_columns, "derived", "NULL")
            select_related = _sql_column_or_default(existing_columns, "related", "NULL")
            select_last_updated = _sql_column_or_default(existing_columns, "last_updated", "CURRENT_TIMESTAMP")

            conn.execute(f"""
                INSERT OR IGNORE INTO dictionary_cache_new
                    (stem, language, interface_language, definition, gloss, hanja, pos, domain,
                     ipa, etymology, derived, related, last_updated)
                SELECT
                    {select_stem},
                    {select_language},
                    {select_interface_language},
                    {select_definition},
                    {select_gloss},
                    {select_hanja},
                    {select_pos},
                    {select_domain},
                    {select_ipa},
                    {select_etymology},
                    {select_derived},
                    {select_related},
                    {select_last_updated}
                FROM dictionary_cache
                WHERE stem IS NOT NULL AND TRIM(stem) != ''
                ORDER BY id ASC
            """)
            conn.execute("DROP TABLE dictionary_cache")
            conn.execute("ALTER TABLE dictionary_cache_new RENAME TO dictionary_cache")

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stem_lang "
            "ON dictionary_cache(stem, language, interface_language)"
        )
        conn.commit()
    finally:
        conn.close()


# Run on module load (executes when uvicorn starts the server)
init_cache_db()
migrate_cache_db()

# ─── App + NLP Setup ──────────────────────────────────────────────────────────
app = FastAPI()
okt = Okt()
nlp_en = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

KRDICT_CLIENT_ID = os.getenv("KOREAN_DICTIONARY_CLIENT_ID", "").strip()
GOOGLE_TRANSLATE_RAPIDAPI_KEY = os.getenv("GOOGLE_TRANSLATE_RAPIDAPI_KEY", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_JWT_AUDIENCE = os.getenv("SUPABASE_JWT_AUDIENCE", "").strip() or "authenticated"
SUPABASE_ISSUER = f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else ""
SUPABASE_JWKS_URL = f"{SUPABASE_ISSUER}/.well-known/jwks.json" if SUPABASE_ISSUER else ""
SUPABASE_JWT_ALGORITHMS = ["ES256", "RS256"]
SUPABASE_JWKS_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
supabase_jwks_client = (
    PyJWKClient(SUPABASE_JWKS_URL, ssl_context=SUPABASE_JWKS_SSL_CONTEXT)
    if SUPABASE_JWKS_URL
    else None
)

preprocess_jobs: dict[str, dict] = {}
preprocess_jobs_lock = asyncio.Lock()
daily_usage: dict[tuple[str, str], int] = {}
daily_usage_lock = asyncio.Lock()

LOOKUP_ALLOWED_POS = {"Noun", "Verb", "Adverb", "Adjective"}
EN_LOOKUP_ALLOWED_POS = {"NOUN", "PROPN", "VERB", "ADJ", "ADV", "NUM"}
ZH_LOOKUP_ALLOWED_POS_PREFIXES = ("n", "v", "a", "d")
ZH_SEARCH_RESULT_LIMIT = 6
ZH_FALLBACK_MAX_WORD_LEN = 8
DEFAULT_CHINESE_SCRIPT = "zh-Hans"
ZH_CJK_BLOCK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
ZH_POS_LABELS = {
    "n": "Noun",
    "nr": "Proper noun",
    "ns": "Place noun",
    "nt": "Organization noun",
    "nz": "Proper noun",
    "v": "Verb",
    "vd": "Adverbial verb",
    "vn": "Verb noun",
    "a": "Adjective",
    "ad": "Adverbial adjective",
    "an": "Adjectival noun",
    "d": "Adverb",
}

# Okt occasionally mislabels these as Noun in eojeol-final position.
# Verified against 563k chars of public domain Korean text (22 books):
# removing this filter adds exactly 2 bogus lookup stems: 요 (63 hits) and 고요 (4 hits).
# Everything else in the original list is already excluded by Okt's POS tags.
TRAILING_ENDING_FRAGMENTS = {
    "요",   # politeness marker — mislabeled as Noun ~63x per 563k chars
    "고요", # emphatic politeness form — mislabeled as Noun ~4x per 563k chars
}

COPULA_STEMS = {"이다"}


def get_en_nlp():
    global nlp_en

    if spacy is None:
        raise HTTPException(status_code=503, detail="spaCy is not installed on the backend")

    if nlp_en is None:
        try:
            nlp_en = spacy.load("en_core_web_sm")
        except OSError:
            raise HTTPException(status_code=503, detail="spaCy English model en_core_web_sm is not installed")

    return nlp_en


def require_zh_segmenter():
    if zh_pseg is None:
        raise HTTPException(status_code=503, detail="jieba is not installed on the backend")

    return zh_pseg


def normalize_short_language_code(value, default=DEFAULT_INTERFACE_LANGUAGE) -> str:
    normalized = (
        str(value or default)
        .strip()
        .lower()
        .replace("_", "-")
        .split("-")[0]
    )
    return normalized or default


def normalize_chinese_script(value=DEFAULT_CHINESE_SCRIPT) -> str:
    raw = str(value or DEFAULT_CHINESE_SCRIPT).strip().lower().replace("_", "-")
    if raw in {"zh-hant", "hant", "traditional", "trad", "tc"}:
        return "zh-Hant"
    return "zh-Hans"


def verify_supabase_token(authorization: str = Header(default="")) -> dict[str, Any]:
    if not supabase_jwks_client:
        print("[auth] Supabase auth is not configured")
        raise HTTPException(status_code=500, detail="Supabase auth is not configured")

    if not authorization.startswith("Bearer "):
        print("[auth] Missing bearer token")
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        print("[auth] Empty bearer token")
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        signing_key = supabase_jwks_client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=SUPABASE_JWT_ALGORITHMS,
            audience=SUPABASE_JWT_AUDIENCE,
            issuer=SUPABASE_ISSUER,
            options={"require": ["sub", "exp"]},
        )
    except jwt.ExpiredSignatureError:
        print("[auth] Token expired")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.PyJWKClientConnectionError as error:
        print(f"[auth] JWKS fetch failed: {error.__class__.__name__}: {error}")
        raise HTTPException(status_code=503, detail="Unable to fetch Supabase signing keys")
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as error:
        print(f"[auth] Invalid token: {error.__class__.__name__}: {error}")
        raise HTTPException(status_code=401, detail="Invalid token")

    if claims.get("role") != "authenticated":
        print(f"[auth] Forbidden token role: {claims.get('role')!r}")
        raise HTTPException(status_code=403, detail="Forbidden")

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        print("[auth] Token missing valid sub claim")
        raise HTTPException(status_code=401, detail="Invalid token")

    return {
        "user_id": user_id,
        "is_anonymous": bool(claims.get("is_anonymous", False)),
        "claims": claims,
    }


def get_auth_limits(auth_or_is_anonymous) -> dict[str, int]:
    if isinstance(auth_or_is_anonymous, dict):
        is_anonymous = bool(auth_or_is_anonymous.get("is_anonymous", False))
    else:
        is_anonymous = bool(auth_or_is_anonymous)

    return ANONYMOUS_LIMITS if is_anonymous else AUTHENTICATED_LIMITS


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def cleanup_preprocess_jobs_locked(now_ts: Optional[float] = None):
    now_ts = now_ts if now_ts is not None else time.time()
    expired_job_ids = [
        job_id
        for job_id, job in preprocess_jobs.items()
        if (
            (
                job.get("status") in PREPROCESS_TERMINAL_STATUSES
                and now_ts - float(job.get("updated_at_ts", now_ts)) > PREPROCESS_JOB_TTL_SECONDS
            )
            or (
                job.get("status") not in PREPROCESS_TERMINAL_STATUSES
                and now_ts - float(job.get("created_at_ts", now_ts)) > PREPROCESS_ACTIVE_JOB_TTL_SECONDS
            )
        )
    ]

    for job_id in expired_job_ids:
        del preprocess_jobs[job_id]


async def cleanup_preprocess_job_later(job_id: str, delay_seconds: int):
    await asyncio.sleep(delay_seconds)
    async with preprocess_jobs_lock:
        job = preprocess_jobs.pop(job_id, None)

    if job:
        print(f"[main] cleaned up preprocess job {job_id}")


def schedule_preprocess_job_cleanup(job_id: str, delay_seconds: int):
    asyncio.create_task(cleanup_preprocess_job_later(job_id, delay_seconds))


async def schedule_preprocess_job_read_cleanup(job_id: str, user_id: str):
    should_schedule = False
    async with preprocess_jobs_lock:
        job = preprocess_jobs.get(job_id)
        if (
            job
            and job.get("user_id") == user_id
            and job.get("status") in PREPROCESS_TERMINAL_STATUSES
            and not job.get("read_cleanup_scheduled")
        ):
            job["read_cleanup_scheduled"] = True
            job["read_cleanup_scheduled_at"] = utc_now_iso()
            should_schedule = True

    if should_schedule:
        schedule_preprocess_job_cleanup(job_id, PREPROCESS_JOB_READ_TTL_SECONDS)


def enforce_text_limit(
    text: str,
    auth: dict[str, Any],
    *,
    field_name: str = "text",
    limit_key: str = "max_text_chars_per_request",
):
    limit = get_auth_limits(auth)[limit_key]
    if len(text) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"{field_name} exceeds {limit} characters",
        )


def enforce_preprocess_text_limit(text: str):
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"Text too long: {len(text)} chars")


def limited_preprocess_max_stems(max_stems, auth: dict[str, Any]):
    limit = get_auth_limits(auth)["max_stems_per_preprocess_job"]
    if max_stems is None:
        return limit

    if isinstance(max_stems, bool):
        raise HTTPException(status_code=400, detail="max_stems must be a positive integer")

    try:
        normalized = int(max_stems)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="max_stems must be a positive integer")

    if normalized <= 0:
        raise HTTPException(status_code=400, detail="max_stems must be a positive integer")

    return min(normalized, limit)


async def enforce_daily_quota(auth: dict[str, Any], amount: int = 1):
    normalized_amount = max(1, int(amount or 1))
    limit = get_auth_limits(auth)["daily_quota"]
    user_id = auth["user_id"]
    today = datetime.now(timezone.utc).date().isoformat()

    async with daily_usage_lock:
        stale_keys = [key for key in daily_usage if key[1] != today]
        for key in stale_keys:
            del daily_usage[key]

        key = (user_id, today)
        used = daily_usage.get(key, 0)
        if used + normalized_amount > limit:
            raise HTTPException(status_code=429, detail="Daily backend quota exceeded")

        daily_usage[key] = used + normalized_amount


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
        updates["updated_at"] = utc_now_iso()
        updates["updated_at_ts"] = time.time()
        existing.update(updates)


async def create_preprocess_job(user_id: str, is_anonymous: bool):
    job_id = str(uuid4())
    now_ts = time.time()
    now_iso = utc_now_iso()
    limits = get_auth_limits(is_anonymous)

    async with preprocess_jobs_lock:
        cleanup_preprocess_jobs_locked(now_ts)
        active_job_count = sum(
            1
            for job in preprocess_jobs.values()
            if (
                job.get("user_id") == user_id
                and job.get("status") not in PREPROCESS_TERMINAL_STATUSES
            )
        )

        if active_job_count >= limits["max_active_jobs"]:
            raise HTTPException(status_code=429, detail="Too many active preprocessing jobs")

        preprocess_jobs[job_id] = {
            "job_id": job_id,
            "user_id": user_id,
            "is_anonymous": is_anonymous,
            "status": "queued",
            "stage": "queued",
            "message": "Job queued",
            "created_at": now_iso,
            "updated_at": now_iso,
            "created_at_ts": now_ts,
            "updated_at_ts": now_ts,
            "stats": {},
            "results": None,
            "surface_index": None,
            "error": None,
        }
    return job_id


async def get_preprocess_job(job_id: str):
    async with preprocess_jobs_lock:
        cleanup_preprocess_jobs_locked()
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


def extract_en_lookup_tokens(text: str) -> tuple[list[str], list[dict]]:
    doc = get_en_nlp()(text)
    seen_lemmas: set[str] = set()
    seen_surface_pairs: set[tuple[str, str]] = set()
    lemmas: list[str] = []
    surface_index: list[dict] = []

    for token in doc:
        lemma = token.lemma_.strip().lower()
        raw_surface = token.text.strip()
        lower_surface = raw_surface.lower()

        if (
            token.pos_ not in EN_LOOKUP_ALLOWED_POS
            or (token.is_stop and token.pos_ != "NUM")
            or token.is_punct
            or token.is_space
            or len(lemma) <= 1
        ):
            continue

        if lemma not in seen_lemmas:
            seen_lemmas.add(lemma)
            lemmas.append(lemma)

        for surface in dict.fromkeys([raw_surface, lower_surface]):
            if len(surface) > 1:
                pair = (surface, lemma)
                if pair not in seen_surface_pairs:
                    seen_surface_pairs.add(pair)
                    surface_index.append({
                        "surface": surface,
                        "stem": lemma,
                    })

    return lemmas, surface_index


def en_dictionary_no_entry(stem: str) -> dict:
    return {
        "stem": stem,
        "word": stem,
        "definition": None,
        "gloss": None,
        "hanja": None,
        "pos": None,
        "domain": None,
        "ipa": None,
        "etymology": None,
        "derived": "[]",
        "related": "[]",
        "language": "en",
        "interface_language": "en",
    }


def build_en_definition_gloss(definition: str | None) -> str | None:
    raw_definition = definition.strip() if isinstance(definition, str) else ""
    if not raw_definition:
        return None

    short = raw_definition.split(",")[0].split(";")[0].strip()
    return short if short and len(short) <= 40 else None


def en_dictionary_row_to_result(row: sqlite3.Row) -> dict:
    data = dict(row)
    word = (data.get("word") or "").strip().lower()
    return {
        "stem": word,
        "word": word,
        "definition": data.get("definition"),
        "gloss": build_en_definition_gloss(data.get("definition")),
        "hanja": None,
        "pos": data.get("pos"),
        "domain": None,
        "ipa": data.get("ipa"),
        "etymology": data.get("etymology"),
        "derived": data.get("derived") or "[]",
        "related": data.get("related") or "[]",
        "language": "en",
        "interface_language": "en",
    }


def is_likely_untranslated_english_definition(definition: str | None, interface_language: str) -> bool:
    text = definition.strip() if isinstance(definition, str) else ""
    normalized_language = (
        interface_language.strip().lower().replace("_", "-").split("-")[0]
        if isinstance(interface_language, str)
        else ""
    )
    has_latin = any(("a" <= char.lower() <= "z") for char in text)

    if not text or not has_latin:
        return False

    if normalized_language == "ko":
        has_korean = any(
            "\uac00" <= char <= "\ud7a3"
            or "\u1100" <= char <= "\u11ff"
            or "\u3130" <= char <= "\u318f"
            for char in text
        )
        return not has_korean

    if normalized_language == "zh":
        has_cjk = any("\u4e00" <= char <= "\u9fff" for char in text)
        return not has_cjk

    return False


def lookup_en_dictionary_entries(stems: list[str]) -> tuple[list[dict], int]:
    normalized_stems = [
        stem.strip().lower()
        for stem in stems
        if isinstance(stem, str) and stem.strip()
    ]
    if not normalized_stems:
        return [], 0

    conn = get_kaikki_db_connection()
    placeholders = ",".join(["?"] * len(normalized_stems))
    rows = conn.execute(
        f"""
        SELECT word, pos, ipa, definition, etymology, derived, related
        FROM en_dictionary
        WHERE word IN ({placeholders})
        """,
        normalized_stems,
    ).fetchall()
    conn.close()

    rows_by_word = {
        row["word"].strip().lower(): en_dictionary_row_to_result(row)
        for row in rows
        if row["word"]
    }

    results = [
        rows_by_word.get(stem, en_dictionary_no_entry(stem))
        for stem in normalized_stems
    ]
    return results, len(rows_by_word)


def zh_pos_label(flag: str | None) -> str | None:
    normalized = flag.strip().lower() if isinstance(flag, str) else ""
    if not normalized:
        return None

    return ZH_POS_LABELS.get(normalized) or ZH_POS_LABELS.get(normalized[0]) or normalized


def append_zh_lookup_token(
    word: str,
    pos: str | None,
    *,
    seen_words: set[str],
    seen_surface_pairs: set[tuple[str, str]],
    words: list[str],
    surface_index: list[dict],
    pos_by_word: dict[str, str],
):
    normalized_word = word.strip() if isinstance(word, str) else ""
    if not normalized_word or len(normalized_word) <= 1:
        return

    if normalized_word not in seen_words:
        seen_words.add(normalized_word)
        words.append(normalized_word)
        if pos:
            pos_by_word[normalized_word] = pos

    pair_key = (normalized_word, normalized_word)
    if pair_key not in seen_surface_pairs:
        seen_surface_pairs.add(pair_key)
        surface_index.append({
            "surface": normalized_word,
            "stem": normalized_word,
        })


def extract_zh_lookup_tokens_with_jieba(text: str) -> tuple[list[str], list[dict], dict[str, str]]:
    segmenter = zh_pseg
    seen_words: set[str] = set()
    seen_surface_pairs: set[tuple[str, str]] = set()
    words: list[str] = []
    surface_index: list[dict] = []
    pos_by_word: dict[str, str] = {}

    if segmenter is None:
        return words, surface_index, pos_by_word

    for pair in segmenter.cut(text):
        word = getattr(pair, "word", "").strip()
        flag = getattr(pair, "flag", "").strip()
        if (
            not word
            or len(word) <= 1
            or not flag.startswith(ZH_LOOKUP_ALLOWED_POS_PREFIXES)
        ):
            continue

        append_zh_lookup_token(
            word,
            zh_pos_label(flag),
            seen_words=seen_words,
            seen_surface_pairs=seen_surface_pairs,
            words=words,
            surface_index=surface_index,
            pos_by_word=pos_by_word,
        )

    return words, surface_index, pos_by_word


def fetch_zh_dictionary_candidate_words(candidates: set[str]) -> set[str]:
    if not candidates or not is_zh_dict_db_installed():
        return set()

    conn = get_zh_dict_db_connection()
    found_words: set[str] = set()
    candidate_list = list(candidates)
    batch_size = 450

    try:
        for start in range(0, len(candidate_list), batch_size):
            batch = candidate_list[start:start + batch_size]
            placeholders = ",".join(["?"] * len(batch))
            rows = conn.execute(
                f"""
                SELECT simplified, traditional
                FROM zh_dictionary
                WHERE simplified IN ({placeholders})
                   OR traditional IN ({placeholders})
                """,
                [*batch, *batch],
            ).fetchall()
            for row in rows:
                simplified = (row["simplified"] or "").strip()
                traditional = (row["traditional"] or "").strip()
                if simplified:
                    found_words.add(simplified)
                if traditional:
                    found_words.add(traditional)
    finally:
        conn.close()

    return found_words


def extract_zh_lookup_tokens_with_dictionary(text: str) -> tuple[list[str], list[dict], dict[str, str]]:
    seen_words: set[str] = set()
    seen_surface_pairs: set[tuple[str, str]] = set()
    words: list[str] = []
    surface_index: list[dict] = []
    pos_by_word: dict[str, str] = {}
    blocks = [match.group(0) for match in ZH_CJK_BLOCK_RE.finditer(text)]
    candidates: set[str] = set()

    for block in blocks:
        block_length = len(block)
        for start in range(block_length):
            max_end = min(block_length, start + ZH_FALLBACK_MAX_WORD_LEN)
            for end in range(start + 2, max_end + 1):
                candidates.add(block[start:end])

    dictionary_words = fetch_zh_dictionary_candidate_words(candidates)

    for block in blocks:
        index = 0
        while index < len(block):
            match = ""
            max_end = min(len(block), index + ZH_FALLBACK_MAX_WORD_LEN)
            for end in range(max_end, index + 1, -1):
                candidate = block[index:end]
                if candidate in dictionary_words:
                    match = candidate
                    break

            if match:
                append_zh_lookup_token(
                    match,
                    None,
                    seen_words=seen_words,
                    seen_surface_pairs=seen_surface_pairs,
                    words=words,
                    surface_index=surface_index,
                    pos_by_word=pos_by_word,
                )
                index += len(match)
                continue

            index += 1

    return words, surface_index, pos_by_word


def extract_zh_lookup_tokens(text: str) -> tuple[list[str], list[dict], dict[str, str]]:
    if zh_pseg is not None:
        return extract_zh_lookup_tokens_with_jieba(text)

    print("[main] jieba unavailable; using dictionary-based Chinese tokenizer fallback")
    return extract_zh_lookup_tokens_with_dictionary(text)


def zh_definition_gloss(definition: str | None) -> str | None:
    raw_definition = definition.strip() if isinstance(definition, str) else ""
    if not raw_definition:
        return None

    short = raw_definition.split(";")[0].split(",")[0].strip()
    return short if short and len(short) <= 40 else None


def zh_dictionary_no_entry(
    stem: str,
    script: str,
    pos: str | None = None,
    interface_language: str = "en",
) -> dict:
    return {
        "stem": stem,
        "word": stem,
        "simplified": stem if script == "zh-Hans" else None,
        "traditional": stem if script == "zh-Hant" else None,
        "definition": None,
        "gloss": None,
        "hanja": None,
        "pos": pos,
        "domain": None,
        "pinyin": None,
        "ipa": None,
        "etymology": None,
        "derived": "[]",
        "related": "[]",
        "language": "zh",
        "interface_language": interface_language,
    }


def zh_dictionary_row_to_result(
    row: sqlite3.Row,
    *,
    script: str = DEFAULT_CHINESE_SCRIPT,
    interface_language: str = "en",
    pos: str | None = None,
) -> dict:
    data = dict(row)
    simplified = (data.get("simplified") or "").strip()
    traditional = (data.get("traditional") or "").strip()
    word = traditional if script == "zh-Hant" and traditional else simplified
    definition = (data.get("definition") or "").strip() or None
    pinyin = (data.get("pinyin") or "").strip() or None

    return {
        "stem": word,
        "word": word,
        "simplified": simplified or None,
        "traditional": traditional or None,
        "definition": definition,
        "gloss": zh_definition_gloss(definition),
        "hanja": None,
        "pos": pos,
        "domain": None,
        "pinyin": pinyin,
        "ipa": pinyin,
        "etymology": None,
        "derived": "[]",
        "related": "[]",
        "language": "zh",
        "interface_language": interface_language,
    }


def lookup_zh_dictionary_entries(
    stems: list[str],
    *,
    script: str = DEFAULT_CHINESE_SCRIPT,
    interface_language: str = "en",
    pos_by_stem: dict[str, str] | None = None,
    limit_per_stem: int | None = 1,
    allow_missing_db: bool = False,
) -> tuple[list[list[dict]], int]:
    normalized_stems = [
        stem.strip()
        for stem in stems
        if isinstance(stem, str) and stem.strip()
    ]
    if not normalized_stems:
        return [], 0

    if not is_zh_dict_db_installed():
        if not allow_missing_db:
            raise HTTPException(status_code=503, detail="Chinese dictionary database is not installed")

        print("[main] Chinese dictionary database missing; returning segmentation-only Chinese results")
        return [
            [
                zh_dictionary_no_entry(
                    stem,
                    script,
                    (pos_by_stem or {}).get(stem),
                    interface_language,
                )
            ]
            for stem in normalized_stems
        ], 0

    conn = get_zh_dict_db_connection()
    unique_stems = list(dict.fromkeys(normalized_stems))
    placeholders = ",".join(["?"] * len(unique_stems))
    rows = conn.execute(
        f"""
        SELECT simplified, traditional, pinyin, definition
        FROM zh_dictionary
        WHERE simplified IN ({placeholders})
           OR traditional IN ({placeholders})
        ORDER BY frequency_rank ASC, id ASC
        """,
        [*unique_stems, *unique_stems],
    ).fetchall()
    conn.close()

    rows_by_lookup: dict[str, list[sqlite3.Row]] = {stem: [] for stem in unique_stems}
    for row in rows:
        simplified = (row["simplified"] or "").strip()
        traditional = (row["traditional"] or "").strip()
        if simplified in rows_by_lookup:
            rows_by_lookup[simplified].append(row)
        if traditional in rows_by_lookup and traditional != simplified:
            rows_by_lookup[traditional].append(row)

    found_count = sum(1 for stem in unique_stems if rows_by_lookup.get(stem))
    results: list[list[dict]] = []
    for stem in normalized_stems:
        stem_rows = rows_by_lookup.get(stem, [])
        if limit_per_stem is not None:
            stem_rows = stem_rows[:limit_per_stem]

        if not stem_rows:
            results.append([
                zh_dictionary_no_entry(
                    stem,
                    script,
                    (pos_by_stem or {}).get(stem),
                    interface_language,
                )
            ])
            continue

        results.append([
            zh_dictionary_row_to_result(
                row,
                script=script,
                interface_language=interface_language,
                pos=(pos_by_stem or {}).get(stem),
            )
            for row in stem_rows
        ])

    return results, found_count


async def translate_zh_results(results: list[dict], interface_language: str) -> list[dict]:
    normalized_lang = normalize_short_language_code(interface_language, "en")
    if normalized_lang == "en":
        return results

    async def translate_entry(entry: dict) -> dict:
        definition = entry.get("definition")
        if not definition:
            return {
                **entry,
                "interface_language": normalized_lang,
            }

        translated_definition, translated_gloss = await asyncio.gather(
            _translate_text(definition, source="en", target=normalized_lang),
            _translate_text(entry.get("word") or entry.get("stem") or "", source="zh", target=normalized_lang),
        )
        return {
            **entry,
            "definition": translated_definition or definition,
            "gloss": translated_gloss or entry.get("gloss"),
            "interface_language": normalized_lang,
        }

    return await asyncio.gather(*(translate_entry(entry) for entry in results))


async def _preprocess_en_core(
    text: str,
    max_stems=None,
    progress_callback=None,
    interface_language: str = "en",
) -> dict:
    async def report(event: str, **data):
        if progress_callback:
            await progress_callback(event, data)

    loop = asyncio.get_event_loop()
    unique_stems, surface_index = await loop.run_in_executor(None, extract_en_lookup_tokens, text)
    if max_stems:
        processed_stems = set(unique_stems[:max_stems])
        unique_stems = unique_stems[:max_stems]
        surface_index = [entry for entry in surface_index if entry["stem"] in processed_stems]

    await report(
        "stemmed",
        candidate_stems=len(unique_stems),
        total_stems=len(unique_stems),
        surface_count=len(surface_index),
    )

    if not unique_stems:
        return {
            "results": [],
            "surface_index": surface_index,
            "stats": {"total_stems": 0, "cache_hits": 0, "new_fetched": 0},
        }

    results, found_count = await loop.run_in_executor(None, lookup_en_dictionary_entries, unique_stems)
    normalized_interface_language = (
        interface_language.strip().lower().replace("_", "-").split("-")[0]
        if isinstance(interface_language, str) and interface_language.strip()
        else "en"
    )
    if normalized_interface_language != "en":
        results = [
            {
                **result,
                "definition": None,
                "gloss": None,
                "interface_language": normalized_interface_language,
            }
            for result in results
        ]
    return {
        "results": results,
        "surface_index": surface_index,
        "stats": {
            "total_stems": len(unique_stems),
            "cache_hits": found_count,
            "new_fetched": 0,
        },
    }


async def _preprocess_zh_core(
    text: str,
    max_stems=None,
    progress_callback=None,
    interface_language: str = "en",
    script: str = DEFAULT_CHINESE_SCRIPT,
) -> dict:
    async def report(event: str, **data):
        if progress_callback:
            await progress_callback(event, data)

    normalized_script = normalize_chinese_script(script)
    normalized_interface_language = normalize_short_language_code(interface_language, "en")
    loop = asyncio.get_event_loop()
    unique_lookup_words, surface_index, pos_by_word = await loop.run_in_executor(
        None,
        extract_zh_lookup_tokens,
        text,
    )
    if max_stems:
        processed_words = set(unique_lookup_words[:max_stems])
        unique_lookup_words = unique_lookup_words[:max_stems]
        surface_index = [entry for entry in surface_index if entry["stem"] in processed_words]

    await report(
        "stemmed",
        candidate_stems=len(unique_lookup_words),
        total_stems=len(unique_lookup_words),
        surface_count=len(surface_index),
    )

    if not unique_lookup_words:
        return {
            "results": [],
            "surface_index": surface_index,
            "stats": {"total_stems": 0, "cache_hits": 0, "new_fetched": 0},
        }

    result_groups, found_count = await loop.run_in_executor(
        None,
        partial(
            lookup_zh_dictionary_entries,
            unique_lookup_words,
            script=normalized_script,
            interface_language=normalized_interface_language,
            pos_by_stem=pos_by_word,
            limit_per_stem=1,
            allow_missing_db=True,
        ),
    )

    results = [group[0] for group in result_groups if group]
    lookup_to_result_stem = {
        lookup_word: result.get("stem") or lookup_word
        for lookup_word, result in zip(unique_lookup_words, results)
    }
    surface_index = [
        {
            **entry,
            "stem": lookup_to_result_stem.get(entry["stem"], entry["stem"]),
        }
        for entry in surface_index
    ]

    if normalized_interface_language != "en":
        results = [
            {
                **result,
                "definition": None,
                "gloss": None,
                "interface_language": normalized_interface_language,
            }
            for result in results
        ]

    return {
        "results": results,
        "surface_index": surface_index,
        "stats": {
            "total_stems": len(unique_lookup_words),
            "cache_hits": found_count,
            "new_fetched": 0,
        },
    }


# ─── Existing Endpoint: Single-text Stemming ─────────────────────────────────
@app.get("/okt_morphs/")
async def get_okt_morphs(text: str, auth: dict[str, Any] = Depends(verify_supabase_token)):
    """
    Stem a single text query (used during real-time word taps when a word
    isn't in the book's preprocessed cache yet).
    """
    normalized_text = text if isinstance(text, str) else ""
    enforce_text_limit(normalized_text, auth)
    await enforce_daily_quota(auth)
    print(f"[main] /okt_morphs/ | text: {text!r}")
    raw_morphs = merge_noun_hada(okt.pos(normalized_text, stem=True))
    print(f"[main] Raw morphs ({len(raw_morphs)} total): {raw_morphs}")

    filtered_stems = filter_lookup_stems(raw_morphs, normalized_text)
    print(f"[main] Filtered stems (first 20): {filtered_stems[:20]}")
    return {"result": filtered_stems}


@app.get("/en_morphs/")
async def get_en_morphs(text: str, auth: dict[str, Any] = Depends(verify_supabase_token)):
    normalized_text = text if isinstance(text, str) else ""
    enforce_text_limit(normalized_text, auth)
    await enforce_daily_quota(auth)
    print(f"[main] /en_morphs/ | text: {text!r}")

    lemmas, _surface_index = extract_en_lookup_tokens(normalized_text)
    print(f"[main] English lemmas (first 20): {lemmas[:20]}")
    return {"result": lemmas}


@app.get("/zh_morphs/")
async def get_zh_morphs(text: str, auth: dict[str, Any] = Depends(verify_supabase_token)):
    normalized_text = text if isinstance(text, str) else ""
    enforce_text_limit(normalized_text, auth)
    await enforce_daily_quota(auth)
    print(f"[main] /zh_morphs/ | text: {text!r}")

    words, _surface_index, _pos_by_word = extract_zh_lookup_tokens(normalized_text)
    print(f"[main] Chinese tokens (first 20): {words[:20]}")
    return {"result": words}


@app.get("/romanize/")
async def romanize_text(text: str, auth: dict[str, Any] = Depends(verify_supabase_token)):
    normalized = text.strip() if isinstance(text, str) else ""
    if not normalized:
        return {"romanization": ""}

    enforce_text_limit(normalized, auth)
    await enforce_daily_quota(auth)

    if koroman_romanize is None:
        raise HTTPException(status_code=503, detail="koroman is not installed on the backend")

    return {"romanization": romanize_korean_text(normalized)}


async def _translate_text(text: str, source: str = "en", target: str = "en") -> str | None:
    cleaned_text = text.strip() if isinstance(text, str) else ""
    normalized_source = source.strip() if isinstance(source, str) and source.strip() else "en"
    normalized_target = target.strip() if isinstance(target, str) and target.strip() else "en"

    if not cleaned_text or normalized_source == normalized_target or not GOOGLE_TRANSLATE_RAPIDAPI_KEY:
        return None

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GOOGLE_TRANSLATE_RAPIDAPI_URL,
                headers={
                    "content-type": "application/json",
                    "X-RapidAPI-Key": GOOGLE_TRANSLATE_RAPIDAPI_KEY,
                    "X-RapidAPI-Host": GOOGLE_TRANSLATE_RAPIDAPI_HOST,
                },
                json={
                    "q": cleaned_text,
                    "source": normalized_source,
                    "target": normalized_target,
                    "format": "text",
                },
                timeout=8.0,
            )
            response.raise_for_status()
            data = response.json()
            response_data = data.get("data", {}) if isinstance(data, dict) else {}
            translations = response_data.get("translations", []) if isinstance(response_data, dict) else []
            first_translation = translations[0] if translations else {}
            translated_text = (
                first_translation.get("translatedText", "")
                if isinstance(first_translation, dict)
                else ""
            )
            return translated_text.strip() if isinstance(translated_text, str) else None
    except Exception as error:
        print(f"[main] Internal translation failed: {error}")
        return None


@app.post("/translate/")
async def translate_text(payload: dict, auth: dict[str, Any] = Depends(verify_supabase_token)):
    query = payload.get("query", payload.get("q", ""))
    cleaned_query = query.strip() if isinstance(query, str) else ""
    source = payload.get("source", "ko")
    target = payload.get("target", "en-US")

    if not cleaned_query:
        return {"translatedText": ""}

    enforce_text_limit(
        cleaned_query,
        auth,
        field_name="query",
        limit_key="max_translate_chars_per_request",
    )
    await enforce_daily_quota(auth)

    if not GOOGLE_TRANSLATE_RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="No Google Translate RapidAPI key configured on server")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GOOGLE_TRANSLATE_RAPIDAPI_URL,
                headers={
                    "content-type": "application/json",
                    "X-RapidAPI-Key": GOOGLE_TRANSLATE_RAPIDAPI_KEY,
                    "X-RapidAPI-Host": GOOGLE_TRANSLATE_RAPIDAPI_HOST,
                },
                json={
                    "q": cleaned_query,
                    "source": source if isinstance(source, str) and source.strip() else "ko",
                    "target": target if isinstance(target, str) and target.strip() else "en-US",
                    "format": "text",
                },
                timeout=8.0,
            )
            response.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Google Translate request timed out")
    except httpx.HTTPStatusError as error:
        print(f"[main] Google Translate returned HTTP {error.response.status_code}")
        raise HTTPException(status_code=502, detail="Google Translate request failed")
    except httpx.RequestError as error:
        print(f"[main] Google Translate request error: {error}")
        raise HTTPException(status_code=502, detail="Google Translate request failed")

    try:
        data = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Google Translate returned an invalid response")

    response_data = data.get("data", {}) if isinstance(data, dict) else {}
    translations = response_data.get("translations", []) if isinstance(response_data, dict) else []
    first_translation = translations[0] if translations else {}
    translated_text = first_translation.get("translatedText", "") if isinstance(first_translation, dict) else ""
    if isinstance(translated_text, str):
        translated_text = translated_text.strip()
    else:
        translated_text = ""

    return {"translatedText": translated_text}


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
    interface_language: str = DEFAULT_INTERFACE_LANGUAGE,
) -> list[dict]:
    trans_lang = KRDICT_INTERFACE_LANGUAGES.get(
        interface_language,
        KRDICT_INTERFACE_LANGUAGES[DEFAULT_INTERFACE_LANGUAGE],
    )

    try:
        response = await client.get(
            KRDICT_API_URL,
            params={
                "key": krdict_key,
                "q": query,
                "sort": "popular",
                "translated": "y",
                "trans_lang": trans_lang,
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


async def _preprocess_core(text: str, krdict_key: str, max_stems=None, progress_callback=None) -> dict:
    async def report(event: str, **data):
        if progress_callback:
            await progress_callback(event, data)

    allowed_pos = LOOKUP_ALLOWED_POS
    loop = asyncio.get_event_loop()
    raw_surface_morphs, raw_stem_morphs = await asyncio.gather(
        loop.run_in_executor(None, partial(okt.pos, text, stem=False)),
        loop.run_in_executor(None, partial(okt.pos, text, stem=True)),
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

    await report(
        "stemmed",
        raw_surface_count=len(raw_surface_morphs),
        raw_stem_count=len(raw_stem_morphs),
        candidate_stems=len(stem_pos_map),
        total_stems=len(unique_stems),
        surface_count=len(surface_index),
    )

    if not unique_stems:
        return {
            "results": [],
            "surface_index": surface_index,
            "stats": {"total_stems": 0, "cache_hits": 0, "new_fetched": 0},
        }

    await report("checking_cache", total_stems=len(unique_stems))

    conn = get_db_connection()
    placeholders = ",".join(["?"] * len(unique_stems))
    cached_rows = conn.execute(
        f"""
        SELECT stem, definition, hanja, pos, domain
        FROM dictionary_cache
        WHERE language = 'ko'
          AND interface_language = ?
          AND stem IN ({placeholders})
        """,
        [DEFAULT_INTERFACE_LANGUAGE, *unique_stems],
    ).fetchall()
    conn.close()

    cached_stems = {row["stem"] for row in cached_rows}
    cached_results = [dict(row) for row in cached_rows]
    missing_stems = [stem for stem in unique_stems if stem not in cached_stems]

    await report(
        "cache_checked",
        total_stems=len(unique_stems),
        cache_hits=len(cached_stems),
        missing_stems=len(missing_stems),
        fetched_stems=0,
    )

    new_results: list[dict] = []
    no_entry_results: list[dict] = []

    if missing_stems:
        await report("fetch_started", missing_stems=len(missing_stems))
        semaphore = asyncio.Semaphore(KRDICT_CONCURRENCY_LIMIT)
        completed_fetches = 0

        async def fetch_missing_stem(client: httpx.AsyncClient, stem: str):
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
                    await report(
                        "fetch_progress",
                        total_stems=len(unique_stems),
                        cache_hits=len(cached_stems),
                        missing_stems=len(missing_stems),
                        fetched_stems=completed_fetches,
                    )

                return result

        async with httpx.AsyncClient() as client:
            ordered_results = await asyncio.gather(
                *(fetch_missing_stem(client, stem) for stem in missing_stems)
            )

        new_results = [result for result in ordered_results if result]
        fetched_stems = {row["stem"] for row in new_results}
        no_entry_results = [
            {
                "stem": stem,
                "definition": None,
                "hanja": None,
                "pos": None,
                "domain": None,
                "language": "ko",
                "interface_language": DEFAULT_INTERFACE_LANGUAGE,
            }
            for stem in missing_stems if stem not in fetched_stems
        ]

        rows_to_insert = [
            {
                "stem": row.get("stem"),
                "definition": row.get("definition"),
                "hanja": row.get("hanja"),
                "pos": row.get("pos"),
                "domain": row.get("domain"),
                "language": "ko",
                "interface_language": DEFAULT_INTERFACE_LANGUAGE,
            }
            for row in new_results + no_entry_results
        ]
        if rows_to_insert:
            conn = get_db_connection()
            conn.executemany(
                """INSERT OR IGNORE INTO dictionary_cache
                   (stem, language, interface_language, definition, hanja, pos, domain)
                   VALUES (:stem, :language, :interface_language, :definition, :hanja, :pos, :domain)""",
                rows_to_insert,
            )
            conn.commit()
            conn.close()

        await report(
            "cached_inserted",
            new_fetched=len(new_results),
            no_entry_count=len(no_entry_results),
        )

    all_results = cached_results + new_results + no_entry_results
    return {
        "results": all_results,
        "surface_index": surface_index,
        "stats": {
            "total_stems": len(unique_stems),
            "cache_hits": len(cached_stems),
            "new_fetched": len(new_results),
        },
    }


async def preprocess_text_for_dictionary(text: str, krdict_key: str, max_stems=None) -> dict:
    return await _preprocess_core(text, krdict_key, max_stems)


async def run_preprocess_pipeline(job_id: str, text: str, krdict_key: str, max_stems):
    print(f"[main] preprocess job {job_id} started")
    await update_preprocess_job(
        job_id,
        status="running",
        stage="stemming",
        message="Analyzing book text",
    )

    async def update_progress(event: str, data: dict):
        if event == "stemmed":
            print(
                f"[main] Okt returned {data['raw_surface_count']} unstemmed morphs and "
                f"{data['raw_stem_count']} stemmed morphs"
            )
            print(
                f"[main] {data['candidate_stems']} unique stems found, "
                f"processing {data['total_stems']}"
            )
            print(f"[main] surface_index contains {data['surface_count']} unique surface→stem pairs")
        elif event == "checking_cache":
            await update_preprocess_job(
                job_id,
                stage="checking_cache",
                message="Checking cached dictionary entries",
                stats={"total_stems": data["total_stems"]},
            )
        elif event == "cache_checked":
            print(
                f"[main] Cache hits: {data['cache_hits']} | "
                f"Stems to fetch from KRDICT: {data['missing_stems']}"
            )
            await update_preprocess_job(
                job_id,
                stage="fetching_krdict" if data["missing_stems"] else "finalizing",
                message=(
                    "Fetching missing dictionary entries"
                    if data["missing_stems"]
                    else "Finalizing cached preprocessing results"
                ),
                stats={
                    "total_stems": data["total_stems"],
                    "cache_hits": data["cache_hits"],
                    "new_fetched": 0,
                    "missing_stems": data["missing_stems"],
                    "fetched_stems": data["fetched_stems"],
                },
            )
        elif event == "fetch_started":
            print(
                f"[main] Fetching {data['missing_stems']} stems from KRDICT "
                f"({'with' if ENABLE_RATE_LIMIT_DELAY else 'without'} rate-limit delay)..."
            )
        elif event == "fetch_progress":
            print(f"[main] KRDICT progress: {data['fetched_stems']}/{data['missing_stems']} stems")
            await update_preprocess_job(
                job_id,
                stage="fetching_krdict",
                message=f"Fetching dictionary entries ({data['fetched_stems']}/{data['missing_stems']})",
                stats={
                    "total_stems": data["total_stems"],
                    "cache_hits": data["cache_hits"],
                    "new_fetched": 0,
                    "missing_stems": data["missing_stems"],
                    "fetched_stems": data["fetched_stems"],
                },
            )
        elif event == "cached_inserted":
            print(f"[main] Cached {data['new_fetched']} found + {data['no_entry_count']} no-entry stems")

    result = await _preprocess_core(text, krdict_key, max_stems, progress_callback=update_progress)
    stats = result["stats"]
    print(f"[main] /preprocess_book/ complete | {stats}")
    await update_preprocess_job(
        job_id,
        status="completed",
        stage="completed",
        message="No stems found" if stats["total_stems"] == 0 else "Preprocessing complete",
        stats=stats,
        results=result["results"],
        surface_index=result["surface_index"],
    )


# ─── Endpoint: Chapter Preprocessing ──────────────────────────────────────────
@app.post("/preprocess_chapter/")
async def preprocess_chapter(payload: dict, auth: dict[str, Any] = Depends(verify_supabase_token)):
    text = payload.get("text", "")
    book_uri = payload.get("book_uri", "")
    spine_index = payload.get("spine_index", None)
    max_stems = limited_preprocess_max_stems(payload.get("max_stems", MAX_STEMS_DEFAULT), auth)

    if not isinstance(spine_index, int):
        raise HTTPException(status_code=400, detail="spine_index must be an integer")

    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text must be a string")

    if not text:
        return {
            "book_uri": book_uri,
            "spine_index": spine_index,
            "results": [],
            "surface_index": [],
            "stats": {"total_stems": 0, "cache_hits": 0, "new_fetched": 0},
        }

    enforce_preprocess_text_limit(text)
    await enforce_daily_quota(auth)

    if not KRDICT_CLIENT_ID:
        raise HTTPException(status_code=500, detail="No KRDICT key configured on server")

    print(
        f"[main] /preprocess_chapter/ | spine={spine_index} "
        f"text length={len(text):,} chars | max_stems={max_stems}"
    )
    result = await preprocess_text_for_dictionary(text, KRDICT_CLIENT_ID, max_stems)
    return {
        "book_uri": book_uri,
        "spine_index": spine_index,
        **result,
    }


@app.get("/en_dict_search/")
async def en_dict_search(
    stem: str,
    interface_language: str = "en",
    auth: dict[str, Any] = Depends(verify_supabase_token),
):
    normalized_stem = stem.strip().lower() if isinstance(stem, str) else ""
    normalized_lang = (
        interface_language.strip().lower().replace("_", "-").split("-")[0]
        if isinstance(interface_language, str) and interface_language.strip()
        else "en"
    )
    if not normalized_stem:
        return {"result": None}

    enforce_text_limit(normalized_stem, auth, field_name="stem")
    await enforce_daily_quota(auth)

    conn = get_db_connection()
    cached = conn.execute(
        """
        SELECT id, stem, language, interface_language, definition, gloss, hanja, pos, domain,
               ipa, etymology, derived, related, last_updated
        FROM dictionary_cache
        WHERE stem = ?
          AND language = 'en'
          AND interface_language = ?
        LIMIT 1
        """,
        (normalized_stem, normalized_lang),
    ).fetchone()
    conn.close()

    if cached:
        cached_result = dict(cached)
        is_stale_fallback = is_likely_untranslated_english_definition(
            cached_result.get("definition"),
            normalized_lang,
        )
        if not is_stale_fallback:
            if not cached_result.get("gloss"):
                cached_result["gloss"] = (
                    build_en_definition_gloss(cached_result.get("definition"))
                    if normalized_lang == "en"
                    else await _translate_text(normalized_stem, source="en", target=normalized_lang)
                )
                if cached_result.get("gloss"):
                    conn = get_db_connection()
                    conn.execute(
                        """
                        UPDATE dictionary_cache
                        SET gloss = ?, last_updated = CURRENT_TIMESTAMP
                        WHERE stem = ? AND language = 'en' AND interface_language = ?
                        """,
                        (cached_result["gloss"], normalized_stem, normalized_lang),
                    )
                    conn.commit()
                    conn.close()
            cached_result["word"] = cached_result.get("stem")
            return {"result": cached_result}

    results, _found_count = lookup_en_dictionary_entries([normalized_stem])
    entry = dict(results[0]) if results else None

    if not entry or not entry.get("definition"):
        return {"result": None}

    entry["language"] = "en"
    entry["interface_language"] = normalized_lang

    translation_failed = False
    if normalized_lang != "en":
        translated, translated_gloss = await asyncio.gather(
            _translate_text(entry["definition"], source="en", target=normalized_lang),
            _translate_text(normalized_stem, source="en", target=normalized_lang),
        )
        if translated:
            entry["definition"] = translated
        else:
            translation_failed = True
        entry["gloss"] = translated_gloss
    else:
        entry["gloss"] = build_en_definition_gloss(entry.get("definition"))

    if not translation_failed:
        conn = get_db_connection()
        conn.execute(
            """
            INSERT INTO dictionary_cache
                (stem, language, interface_language, definition, gloss, hanja, pos, domain,
                 ipa, etymology, derived, related)
            VALUES (?, 'en', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(stem, language, interface_language) DO UPDATE SET
                definition = excluded.definition,
                gloss = excluded.gloss,
                hanja = excluded.hanja,
                pos = excluded.pos,
                domain = excluded.domain,
                ipa = excluded.ipa,
                etymology = excluded.etymology,
                derived = excluded.derived,
                related = excluded.related,
                last_updated = CURRENT_TIMESTAMP
            """,
            (
                normalized_stem,
                normalized_lang,
                entry.get("definition"),
                entry.get("gloss"),
                entry.get("hanja"),
                entry.get("pos"),
                entry.get("domain"),
                entry.get("ipa"),
                entry.get("etymology"),
                entry.get("derived"),
                entry.get("related"),
            ),
        )
        conn.commit()
        conn.close()

    return {"result": entry}


@app.get("/zh_dict_search/")
async def zh_dict_search(
    stem: str,
    interface_language: str = "en",
    script: str = DEFAULT_CHINESE_SCRIPT,
    auth: dict[str, Any] = Depends(verify_supabase_token),
):
    normalized_stem = stem.strip() if isinstance(stem, str) else ""
    normalized_lang = normalize_short_language_code(interface_language, "en")
    normalized_script = normalize_chinese_script(script)
    if not normalized_stem:
        return {"result": None, "results": []}

    enforce_text_limit(normalized_stem, auth, field_name="stem")
    await enforce_daily_quota(auth)

    if not is_zh_dict_db_installed():
        print("[main] /zh_dict_search/ called before Chinese dictionary database is installed")
        return {
            "result": None,
            "results": [],
            "dictionary_available": False,
            "message": "Chinese dictionary database is not installed",
        }

    result_groups, _found_count = lookup_zh_dictionary_entries(
        [normalized_stem],
        script=normalized_script,
        interface_language=normalized_lang,
        limit_per_stem=ZH_SEARCH_RESULT_LIMIT,
    )
    entries = result_groups[0] if result_groups else []
    entries = [entry for entry in entries if entry.get("definition")]
    if not entries:
        return {"result": None, "results": [], "dictionary_available": True}

    cached_result = None
    if normalized_lang != "en":
        conn = get_db_connection()
        cached = conn.execute(
            """
            SELECT id, stem, language, interface_language, definition, gloss, hanja, pos, domain,
                   ipa, etymology, derived, related, last_updated
            FROM dictionary_cache
            WHERE stem = ?
              AND language = 'zh'
              AND interface_language = ?
            LIMIT 1
            """,
            (entries[0]["stem"], normalized_lang),
        ).fetchone()
        conn.close()
        if cached and cached["definition"]:
            cached_result = {
                **entries[0],
                **dict(cached),
                "word": entries[0]["word"],
                "simplified": entries[0].get("simplified"),
                "traditional": entries[0].get("traditional"),
                "pinyin": cached["ipa"] or entries[0].get("pinyin"),
            }

    if cached_result:
        entries = [cached_result, *entries[1:]]
    else:
        entries = await translate_zh_results(entries, normalized_lang)

        first_entry = entries[0]
        if first_entry.get("definition"):
            conn = get_db_connection()
            conn.execute(
                """
                INSERT INTO dictionary_cache
                    (stem, language, interface_language, definition, gloss, hanja, pos, domain,
                     ipa, etymology, derived, related)
                VALUES (?, 'zh', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(stem, language, interface_language) DO UPDATE SET
                    definition = excluded.definition,
                    gloss = excluded.gloss,
                    hanja = excluded.hanja,
                    pos = excluded.pos,
                    domain = excluded.domain,
                    ipa = excluded.ipa,
                    etymology = excluded.etymology,
                    derived = excluded.derived,
                    related = excluded.related,
                    last_updated = CURRENT_TIMESTAMP
                """,
                (
                    first_entry.get("stem"),
                    normalized_lang,
                    first_entry.get("definition"),
                    first_entry.get("gloss"),
                    None,
                    first_entry.get("pos"),
                    first_entry.get("domain"),
                    first_entry.get("pinyin"),
                    first_entry.get("etymology"),
                    first_entry.get("derived"),
                    first_entry.get("related"),
                ),
            )
            conn.commit()
            conn.close()

    return {"result": entries[0], "results": entries, "dictionary_available": True}


@app.post("/preprocess_chapter_en/")
async def preprocess_chapter_en(payload: dict, auth: dict[str, Any] = Depends(verify_supabase_token)):
    text = payload.get("text", "")
    book_uri = payload.get("book_uri", "")
    spine_index = payload.get("spine_index", None)
    raw_interface_language = payload.get("interface_language", payload.get("language", "en"))
    interface_language = (
        str(raw_interface_language or "en")
        .strip()
        .lower()
        .replace("_", "-")
        .split("-")[0]
    )
    max_stems = limited_preprocess_max_stems(payload.get("max_stems", MAX_STEMS_DEFAULT), auth)

    if not isinstance(spine_index, int):
        raise HTTPException(status_code=400, detail="spine_index must be an integer")

    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text must be a string")

    if not text:
        return {
            "book_uri": book_uri,
            "spine_index": spine_index,
            "results": [],
            "surface_index": [],
            "stats": {"total_stems": 0, "cache_hits": 0, "new_fetched": 0},
        }

    enforce_preprocess_text_limit(text)
    await enforce_daily_quota(auth)

    print(
        f"[main] /preprocess_chapter_en/ | spine={spine_index} "
        f"text length={len(text):,} chars | interface_language={interface_language} "
        f"max_stems={max_stems}"
    )
    result = await _preprocess_en_core(
        text,
        max_stems,
        interface_language=interface_language,
    )
    return {
        "book_uri": book_uri,
        "spine_index": spine_index,
        **result,
    }


@app.post("/preprocess_chapter_zh/")
async def preprocess_chapter_zh(payload: dict, auth: dict[str, Any] = Depends(verify_supabase_token)):
    text = payload.get("text", "")
    book_uri = payload.get("book_uri", "")
    spine_index = payload.get("spine_index", None)
    raw_interface_language = payload.get("interface_language", payload.get("language", "en"))
    interface_language = normalize_short_language_code(raw_interface_language, "en")
    script = normalize_chinese_script(payload.get("script", DEFAULT_CHINESE_SCRIPT))
    max_stems = limited_preprocess_max_stems(payload.get("max_stems", MAX_STEMS_DEFAULT), auth)

    if not isinstance(spine_index, int):
        raise HTTPException(status_code=400, detail="spine_index must be an integer")

    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text must be a string")

    if not text:
        return {
            "book_uri": book_uri,
            "spine_index": spine_index,
            "results": [],
            "surface_index": [],
            "stats": {"total_stems": 0, "cache_hits": 0, "new_fetched": 0},
        }

    enforce_preprocess_text_limit(text)
    await enforce_daily_quota(auth)

    print(
        f"[main] /preprocess_chapter_zh/ | spine={spine_index} "
        f"text length={len(text):,} chars | interface_language={interface_language} "
        f"script={script} max_stems={max_stems}"
    )
    result = await _preprocess_zh_core(
        text,
        max_stems,
        interface_language=interface_language,
        script=script,
    )
    return {
        "book_uri": book_uri,
        "spine_index": spine_index,
        **result,
    }


@app.post("/preprocess_book/")
async def preprocess_book(payload: dict, auth: dict[str, Any] = Depends(verify_supabase_token)):
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
    max_stems  = limited_preprocess_max_stems(payload.get("max_stems", MAX_STEMS_DEFAULT), auth)

    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text must be a string")

    if not text:
        print("[main] /preprocess_book/ called with empty text")
        return {"error": "No text provided", "job_id": None, "status": "failed"}
    enforce_preprocess_text_limit(text)
    await enforce_daily_quota(auth)

    if not KRDICT_CLIENT_ID:
        print("[main] /preprocess_book/ called without backend KRDICT key")
        return {"error": "No KRDICT key configured on server", "job_id": None, "status": "failed"}

    print(f"[main] /preprocess_book/ | text length: {len(text):,} chars | max_stems: {max_stems}")
    job_id = await create_preprocess_job(auth["user_id"], auth["is_anonymous"])
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
    finally:
        schedule_preprocess_job_cleanup(job_id, PREPROCESS_JOB_TTL_SECONDS)


@app.get("/preprocess_status/{job_id}")
async def preprocess_status(job_id: str, auth: dict[str, Any] = Depends(verify_supabase_token)):
    job = await get_preprocess_job(job_id)
    if not job or job.get("user_id") != auth["user_id"]:
        raise HTTPException(status_code=404, detail="Unknown preprocessing job")

    if job.get("status") in PREPROCESS_TERMINAL_STATUSES:
        await schedule_preprocess_job_read_cleanup(job_id, auth["user_id"])

    return {
        key: value
        for key, value in job.items()
        if key not in {
            "user_id",
            "is_anonymous",
            "created_at_ts",
            "updated_at_ts",
            "read_cleanup_scheduled",
            "read_cleanup_scheduled_at",
        }
    }


@app.post("/krdict_search/")
async def krdict_search(payload: dict, auth: dict[str, Any] = Depends(verify_supabase_token)):
    queries = payload.get("queries", [])
    raw_language = payload.get("language", payload.get("lang", DEFAULT_INTERFACE_LANGUAGE))
    interface_language = (
        str(raw_language or DEFAULT_INTERFACE_LANGUAGE)
        .strip()
        .lower()
        .replace("_", "-")
        .split("-")[0]
    )
    if interface_language not in KRDICT_INTERFACE_LANGUAGES:
        interface_language = DEFAULT_INTERFACE_LANGUAGE

    if not KRDICT_CLIENT_ID:
        raise HTTPException(status_code=500, detail="No KRDICT key configured on server")

    if not isinstance(queries, list):
        raise HTTPException(status_code=400, detail="queries must be an array")

    normalized_queries = [
        query.strip()
        for query in queries
        if isinstance(query, str) and query.strip()
    ]

    if not normalized_queries:
        return {"results": []}

    query_limit = get_auth_limits(auth)["max_krdict_queries_per_request"]
    if len(normalized_queries) > query_limit:
        raise HTTPException(status_code=413, detail=f"Too many KRDICT queries; max {query_limit}")

    for query in normalized_queries:
        enforce_text_limit(query, auth, field_name="query")

    await enforce_daily_quota(auth, amount=len(normalized_queries))

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *(
                search_krdict_entries(
                    client,
                    query,
                    KRDICT_CLIENT_ID,
                    interface_language,
                )
                for query in normalized_queries
            )
        )

    return {"results": results}
