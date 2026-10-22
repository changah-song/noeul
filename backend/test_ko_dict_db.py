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


@pytest.mark.parametrize(
    "stem, expected",
    [
        # Homographs (separate KRDICT entries sharing one spelling) are ordered
        # by learner grade, so the basic word wins sense 1 over the rare one
        # that happens to come first in the dump.
        ("가격", "price"),  # 價格 (초급) before 加擊 "hitting" (없음)
        ("묻다", "ask"),  # 초급 "ask" before 중급 "be stained" / "bury"
        ("내", "I"),  # 초급 pronoun before ungraded "creek"
        # Same grade keeps dump order: these stay as they were.
        ("눈", "eye"),  # eye and snow are both 초급; eye comes first
        ("사과", "apple"),  # 초급 apple before 중급 apology
        ("밤", "night"),  # 초급 night before 중급 chestnut
        ("차", "tea"),  # tea and car are both 초급; tea comes first
    ],
)
def test_homographs_put_the_basic_word_first(conn, stem, expected):
    row = conn.execute(
        "SELECT definition FROM ko_dictionary WHERE stem = ? AND sense_no = 1", (stem,)
    ).fetchone()
    assert row is not None, f"{stem} is missing"
    assert expected in row[0]


def test_homograph_senses_stay_reachable(conn):
    definitions = [
        row[0]
        for row in conn.execute(
            "SELECT definition FROM ko_dictionary WHERE stem = '가격' ORDER BY sense_no"
        )
    ]
    assert definitions[0] == "price"
    assert any("hitting" in d for d in definitions[1:])


def test_translations_cover_krdicts_other_languages(conn):
    languages = {
        row[0]
        for row in conn.execute("SELECT DISTINCT interface_language FROM ko_dictionary_translations")
    }
    assert {"ja", "fr", "es", "ar", "mn", "vi", "th", "id", "ru"} <= languages
    assert "en" not in languages  # English lives in ko_dictionary


def test_translations_share_ko_dictionary_sense_numbers(conn):
    orphans = conn.execute(
        """
        SELECT COUNT(*) FROM ko_dictionary_translations t
        LEFT JOIN ko_dictionary d ON d.stem = t.stem AND d.sense_no = t.sense_no
        WHERE d.stem IS NULL
        """
    ).fetchone()[0]
    assert orphans == 0


@pytest.mark.parametrize(
    "stem, language, expected",
    [
        ("가격", "vi", "giá"),  # sense 1 is 價格 "price", as in English
        ("사람", "vi", "người"),
        ("학교", "ja", "学校"),
        ("학교", "fr", "école"),
    ],
)
def test_primary_sense_is_translated(conn, stem, language, expected):
    row = conn.execute(
        """
        SELECT definition FROM ko_dictionary_translations
        WHERE stem = ? AND interface_language = ? AND sense_no = 1
        """,
        (stem, language),
    ).fetchone()
    assert row is not None, f"{stem} has no {language} gloss"
    assert expected in row[0]
