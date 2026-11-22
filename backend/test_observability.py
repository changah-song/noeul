import sqlite3
import sys
import types

import observability


def _make_db(path, table=None):
    conn = sqlite3.connect(path)
    if table:
        conn.execute(f"CREATE TABLE {table} (id INTEGER)")
        conn.executemany(f"INSERT INTO {table} VALUES (?)", [(1,), (2,), (3,)])
    else:
        conn.execute("CREATE TABLE t (id INTEGER)")
    conn.commit()
    conn.close()


def test_health_ok_reports_cache_rows(tmp_path):
    cache = tmp_path / "cache.db"
    ko = tmp_path / "ko.db"
    _make_db(cache, "dictionary_cache")
    _make_db(ko)
    healthy, body = observability.health_report(str(cache), {"ko_dict": str(ko)})
    assert healthy
    assert body["status"] == "ok"
    assert body["checks"]["cache_db"] == {"ok": True, "dictionary_rows": 3}
    assert body["checks"]["ko_dict"] == {"ok": True}


def test_health_degraded_when_a_database_is_missing(tmp_path):
    cache = tmp_path / "cache.db"
    _make_db(cache, "dictionary_cache")
    healthy, body = observability.health_report(str(cache), {"ko_dict": str(tmp_path / "missing.db")})
    assert not healthy
    assert body["status"] == "degraded"
    assert body["checks"]["ko_dict"]["ok"] is False


def test_health_degraded_when_cache_table_is_missing(tmp_path):
    cache = tmp_path / "cache.db"
    _make_db(cache)
    healthy, body = observability.health_report(str(cache), {})
    assert not healthy
    assert body["checks"]["cache_db"]["ok"] is False


def test_scrub_event_drops_bodies_auth_and_ip():
    event = {
        "request": {
            "data": "a whole chapter of a book",
            "cookies": {"a": "b"},
            "headers": {"Authorization": "Bearer x", "User-Agent": "okhttp"},
            "env": {"REMOTE_ADDR": "1.2.3.4"},
        },
        "user": {"id": "u1", "ip_address": "1.2.3.4", "email": "a@b.c"},
    }
    scrubbed = observability.scrub_event(event)
    assert "data" not in scrubbed["request"]
    assert "cookies" not in scrubbed["request"]
    assert scrubbed["request"]["headers"] == {"User-Agent": "okhttp"}
    assert scrubbed["request"]["env"] == {}
    assert scrubbed["user"] == {"id": "u1"}


def test_release_name_prefers_railway_commit(monkeypatch):
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abcdef1234567890")
    monkeypatch.setenv("APP_RELEASE", "manual")
    assert observability.release_name() == "noeul-backend@abcdef123456"
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA")
    assert observability.release_name() == "manual"


def test_init_sentry_is_a_no_op_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert observability.init_sentry() is False


def test_report_handled_error_sends_only_when_sentry_is_configured(monkeypatch):
    sent = []
    monkeypatch.setitem(sys.modules, "sentry_sdk", types.SimpleNamespace(capture_exception=sent.append))
    error = RuntimeError("cache busy")

    monkeypatch.delenv("SENTRY_DSN", raising=False)
    observability.report_handled_error(error)
    assert sent == []

    monkeypatch.setenv("SENTRY_DSN", "https://key@example.invalid/1")
    observability.report_handled_error(error)
    assert sent == [error]


def test_optional_databases_are_reported_but_never_unhealthy(tmp_path):
    cache = tmp_path / "cache.db"
    zh = tmp_path / "zh.db"
    _make_db(cache, "dictionary_cache")
    _make_db(zh)
    healthy, body = observability.health_report(
        str(cache), {}, {"zh_dict": str(zh), "levels": str(tmp_path / "missing.db")}
    )
    assert healthy
    assert body["checks"]["zh_dict"] == {"ok": True, "present": True}
    assert body["checks"]["levels"] == {"ok": True, "present": False}
    assert not (tmp_path / "missing.db").exists()
