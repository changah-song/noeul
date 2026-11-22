"""cache.db under write contention.

SQLite lets one writer in at a time. These tests hold that write lock from a
second connection (what another request, or another server process, looks like
to the code under test) and check that writers wait their turn, that a batch of
translations is one write, and that a cache that stays busy never fails the
request it was only trying to speed up.
"""

import asyncio
import sqlite3
import threading
from contextlib import contextmanager

import pytest

main = pytest.importorskip("main", reason="main.py needs the full backend requirements")


@pytest.fixture
def cache_db(tmp_path, monkeypatch):
    """A fresh cache.db with the real tables, used instead of the server's own."""
    path = str(tmp_path / "cache.db")
    monkeypatch.setattr(main, "CACHE_DB_PATH", path)
    main.init_cache_db()
    return path


@contextmanager
def write_lock_held(path):
    """Another connection in the middle of a write, for as long as the block runs."""
    other = sqlite3.connect(path)
    other.execute("BEGIN IMMEDIATE")
    try:
        yield
    finally:
        other.rollback()
        other.close()


def _hit_count(path, key):
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT hit_count FROM translate_cache WHERE key_hash=?", (key,)).fetchone()[0]
    finally:
        conn.close()


@pytest.fixture
def reported(monkeypatch):
    """Errors handed to Sentry as handled (the request recovered from them)."""
    errors = []
    monkeypatch.setattr(main.observability, "report_handled_error", errors.append)
    return errors


def test_put_many_saves_a_batch_and_skips_blanks(cache_db):
    main._translate_cache_put_many([
        ("k1", "uno"),
        ("k2", "dos"),
        ("k3", ""),       # nothing to save
        ("", "tres"),     # no key
        ("k1", "other"),  # a key keeps the first translation saved for it
    ])
    assert main._translate_cache_get_many(["k1", "k2", "k3"]) == {"k1": "uno", "k2": "dos"}


def test_put_many_opens_one_connection_for_the_whole_batch(cache_db, monkeypatch):
    opened = []
    real_connect = main.get_db_connection

    def counting_connect():
        opened.append(1)
        return real_connect()

    monkeypatch.setattr(main, "get_db_connection", counting_connect)
    main._translate_cache_put_many([(f"k{n}", f"v{n}") for n in range(200)])
    assert len(opened) == 1
    assert len(main._translate_cache_get_many([f"k{n}" for n in range(200)])) == 200


def test_put_many_trims_the_cache_to_its_row_limit(cache_db, monkeypatch):
    monkeypatch.setattr(main.limits, "TRANSLATE_CACHE_MAX_ROWS", 3)
    main._translate_cache_put_many([(f"k{n}", f"v{n}") for n in range(5)])
    assert len(main._translate_cache_get_many([f"k{n}" for n in range(5)])) == 3


def test_a_write_waits_for_another_writer_to_finish(cache_db):
    locked = threading.Event()

    def slow_writer():
        other = sqlite3.connect(cache_db)
        other.execute("BEGIN IMMEDIATE")
        locked.set()
        threading.Event().wait(0.4)  # hold the lock while the test writes
        other.commit()
        other.close()

    thread = threading.Thread(target=slow_writer)
    thread.start()
    try:
        assert locked.wait(5)
        # Starts while the lock is held; succeeds once the other writer commits.
        main._translate_cache_put_many([("k1", "uno")])
    finally:
        thread.join()
    assert main._translate_cache_get_many(["k1"]) == {"k1": "uno"}


def test_a_save_that_cannot_get_the_lock_does_not_fail_the_request(cache_db, monkeypatch, reported):
    monkeypatch.setattr(main, "CACHE_DB_BUSY_TIMEOUT_SECONDS", 0.2)
    with write_lock_held(cache_db):
        # Neither raises: the caller already has what it was about to cache.
        asyncio.run(main.cache_translations([("k1", "uno")]))
        asyncio.run(main.cache_lookup("lookup-1", {"explanation": "a word", "gloss": None, "lemma": None}))
    assert [type(error) for error in reported] == [sqlite3.OperationalError, sqlite3.OperationalError]
    assert "locked" in str(reported[0])
    # Nothing was saved, so the next request simply misses the cache.
    assert main._translate_cache_get_many(["k1"]) == {}
    assert main._lookup_cache_get("lookup-1") is None


def test_cache_translations_with_nothing_to_save_touches_nothing(cache_db, monkeypatch, reported):
    def no_connection():
        raise AssertionError("an empty batch must not open cache.db")

    monkeypatch.setattr(main, "get_db_connection", no_connection)
    asyncio.run(main.cache_translations([]))
    assert reported == []


def test_a_cached_read_still_answers_while_another_writer_holds_the_lock(cache_db):
    main._translate_cache_put_many([("k1", "uno")])
    with write_lock_held(cache_db):
        # Reading is never blocked; only the hit counter (a write) is skipped.
        assert main._translate_cache_get("k1") == "uno"
    assert _hit_count(cache_db, "k1") == 0
    assert main._translate_cache_get("k1") == "uno"
    assert _hit_count(cache_db, "k1") == 1


def test_every_connection_gets_the_shared_wait(cache_db, monkeypatch):
    monkeypatch.setattr(main, "CACHE_DB_BUSY_TIMEOUT_SECONDS", 7)
    conn = main.get_db_connection()
    try:
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 7000
    finally:
        conn.close()
