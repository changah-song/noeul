"""Error reporting (Sentry) and the /health check.

Kept free of FastAPI imports so the CI test job can exercise it; sentry_sdk is
imported only when a DSN is configured.
"""

from __future__ import annotations

import os
import sqlite3
import time

from limits import parse_positive_int_env

STARTED_AT = time.time()

# Request bodies carry book text and writing entries: never send them.
_SCRUBBED_REQUEST_KEYS = ("data", "cookies")
_SCRUBBED_HEADERS = {"authorization", "cookie", "x-api-key"}


def release_name() -> str | None:
    """The deployed commit (Railway sets RAILWAY_GIT_COMMIT_SHA), else APP_RELEASE."""
    sha = (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "").strip()
    if sha:
        return f"noeul-backend@{sha[:12]}"
    release = (os.getenv("APP_RELEASE") or "").strip()
    return release or None


def scrub_event(event: dict, _hint=None) -> dict:
    """Drop request bodies, cookies, auth headers and the client IP from an event."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in _SCRUBBED_REQUEST_KEYS:
            request.pop(key, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                name: value for name, value in headers.items() if name.lower() not in _SCRUBBED_HEADERS
            }
        env = request.get("env")
        if isinstance(env, dict):
            env.pop("REMOTE_ADDR", None)
    user = event.get("user")
    if isinstance(user, dict):
        user.pop("ip_address", None)
        user.pop("email", None)
    return event


def init_sentry() -> bool:
    """Start Sentry when SENTRY_DSN is set. Returns whether it started."""
    dsn = (os.getenv("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    import sentry_sdk

    traces_per_mille = parse_positive_int_env(os.getenv("SENTRY_TRACES_PER_MILLE"), 20)
    sentry_sdk.init(
        dsn=dsn,
        environment=(os.getenv("SENTRY_ENVIRONMENT") or "production").strip(),
        release=release_name(),
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=min(traces_per_mille, 1000) / 1000,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
    )
    return True


def report_handled_error(error: BaseException) -> None:
    """Send Sentry an error the request recovered from (a cache save that failed
    while the reader still got an answer), so it stays visible. Does nothing
    without a DSN."""
    if not (os.getenv("SENTRY_DSN") or "").strip():
        return
    try:
        import sentry_sdk
    except ImportError:
        return
    sentry_sdk.capture_exception(error)


def set_sentry_user(user_id: str | None) -> None:
    """Tag the current request's events with the account id (no email, no IP)."""
    if not user_id or not (os.getenv("SENTRY_DSN") or "").strip():
        return
    try:
        import sentry_sdk
    except ImportError:
        return
    sentry_sdk.set_user({"id": str(user_id)})


# /health key -> cache.db table. Counts only: no user ids, no amounts.
# daily_usage holds today's counters (older days are pruned at startup).
CACHE_DB_ACTIVITY_TABLES = {
    "ai_lookup_rows": "lookup_cache",
    "translation_rows": "translate_cache",
    "usage_rows_today": "daily_usage",
}


def _count_rows(path: str, table: str) -> int:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


def _readable(path: str) -> bool:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    try:
        conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone()
        return True
    finally:
        conn.close()


def health_report(
    cache_db_path: str,
    bundled_dbs: dict[str, str],
    optional_dbs: dict[str, str] | None = None,
    extra: dict | None = None,
) -> tuple[bool, dict]:
    """Run the health checks. Returns (healthy, body).

    - cache_db: the server cache opens and answers. Its row counts show whether a
      deploy wiped it (cache.db must sit on a persistent volume).
    - bundled_dbs: required dictionaries, present and readable.
    - optional_dbs: reported (present or not) but never make the server unhealthy;
      the features that use them switch off when they are missing.
    """
    checks: dict[str, dict] = {}
    healthy = True

    try:
        checks["cache_db"] = {
            "ok": True,
            "dictionary_rows": _count_rows(cache_db_path, "dictionary_cache"),
        }
        # The tables written most often. dictionary_cache can stay empty for
        # days (most lookups are answered by the bundled dictionaries), so
        # these are what shows whether the file survived a deploy. A table an
        # older cache.db does not have yet is left out.
        for key, table in CACHE_DB_ACTIVITY_TABLES.items():
            try:
                checks["cache_db"][key] = _count_rows(cache_db_path, table)
            except sqlite3.OperationalError:
                pass
    except Exception as error:  # noqa: BLE001 - any failure means unhealthy
        healthy = False
        checks["cache_db"] = {"ok": False, "error": type(error).__name__}

    for name, path in bundled_dbs.items():
        try:
            checks[name] = {"ok": _readable(path)}
        except Exception as error:  # noqa: BLE001
            healthy = False
            checks[name] = {"ok": False, "error": type(error).__name__}

    for name, path in (optional_dbs or {}).items():
        try:
            present = os.path.exists(path) and _readable(path)
        except Exception:  # noqa: BLE001
            present = False
        checks[name] = {"ok": True, "present": present}

    body = {
        "status": "ok" if healthy else "degraded",
        "release": release_name(),
        "uptime_seconds": int(time.time() - STARTED_AT),
        "checks": checks,
    }
    if extra:
        body.update(extra)
    return healthy, body
