"""The KRDICT grade fallback table in proficiency_levels.db.

The Noeul reading levels lack the most basic Korean words; without a level
the reader drew them as hardest (red) at any ability. These checks pin that
the fallback table ships and covers them.
"""
import os
import sqlite3

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proficiency_levels.db")


def grades(terms):
    conn = sqlite3.connect(DB)
    try:
        placeholders = ",".join("?" * len(terms))
        return dict(conn.execute(
            f"SELECT term, level_rank FROM korean_krdict_grades WHERE term IN ({placeholders})", terms
        ).fetchall())
    finally:
        conn.close()


def test_basic_words_missing_from_the_reading_levels_have_a_krdict_grade():
    found = grades(["있다", "하다", "가다", "먹다", "좋다", "사람", "그렇다", "손가락"])
    assert found == {term: 1 for term in ["있다", "하다", "가다", "먹다", "좋다", "사람", "그렇다", "손가락"]}


def test_grades_map_to_the_lower_half_of_each_band_pair():
    conn = sqlite3.connect(DB)
    try:
        by_grade = dict(conn.execute(
            "SELECT grade, MIN(level_rank) FROM korean_krdict_grades GROUP BY grade"
        ).fetchall())
        total = conn.execute("SELECT COUNT(*) FROM korean_krdict_grades").fetchone()[0]
    finally:
        conn.close()
    assert by_grade == {"초급": 1, "중급": 3, "고급": 5}
    assert total > 9000
