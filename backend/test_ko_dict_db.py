"""The bundled Korean dictionary must ship with the backend.

Tap lookups (search_krdict_entries) and chapter preprocessing read ko_dict.db
before calling the live KRDICT API. Without it, every Korean lookup depends on
KRDICT; when KRDICT stopped answering production on 2026-10-13, every lookup
took ~10.5 s and came back empty. These checks run in CI with only sqlite3.
"""

import sqlite3
from pathlib import Path

import pytest

DB_PATH = Path(__file__).resolve().parent / "ko_dict.db"


@pytest.fixture(scope="module")
def conn():
    assert DB_PATH.exists(), "backend/ko_dict.db is missing; lookups would all go to the live KRDICT API"
    connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    yield connection
    connection.close()


def test_has_the_columns_the_backend_queries(conn):
    columns = {row[1] for row in conn.execute("PRAGMA table_info(ko_dictionary)")}
    assert {"stem", "sense_no", "pos", "hanja", "definition", "domain"} <= columns


def test_covers_a_real_vocabulary(conn):
    stems = conn.execute("SELECT COUNT(DISTINCT stem) FROM ko_dictionary").fetchone()[0]
    assert stems > 40000


@pytest.mark.parametrize(
    "stem, expected",
    [
        ("사람", "human"),
        ("학교", "school"),
        ("총소리", "gunshot"),
        ("게으름", "laziness"),
    ],
)
def test_common_words_have_a_primary_english_sense(conn, stem, expected):
    row = conn.execute(
        "SELECT definition FROM ko_dictionary WHERE stem = ? AND sense_no = 1", (stem,)
    ).fetchone()
    assert row is not None, f"{stem} is missing"
    assert expected in row[0]
