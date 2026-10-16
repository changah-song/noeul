"""Add KRDICT's learner vocabulary grades to proficiency_levels.db.

The Noeul reading levels (korean_nikl_vocab) are missing the most basic
Korean words: 있다, 하다, 가다, 먹다, 좋다, 사람, 그렇다 and 손가락 are not in it,
and its beginner bands hold only ~1,100 words. A word with no level is drawn
as "hardest" by the reader, so those basics were underlined in red at any
ability. KRDICT marks every learner entry 초급 / 중급 / 고급 (10,022 headwords,
including all of the above), so the server falls back to that grade for a
stem the reading levels lack (main.lookup_korean_nikl_levels).

Grades map onto the 6 reading levels at the lower (more common) half of each
grade's span — a learner-list word that the frequency-ordered reading levels
missed is a common one: 초급 -> 1, 중급 -> 3, 고급 -> 5. A headword with several
entries keeps its most basic grade.

Source: the KRDICT LMF XML dump (github.com/spellcheck-ko/korean-dict-nikl-krdict).

Usage:
  python3 backend/scripts/import_krdict_grades.py --src <dir of KRDICT .xml files>
"""
from __future__ import annotations

import argparse
import glob
import os
import sqlite3
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_ko_dict as krdict  # noqa: E402  (shares the dump's XML clean-up helpers)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "proficiency_levels.db")

GRADE_ORDER = {"초급": 0, "중급": 1, "고급": 2}
GRADE_LEVEL_RANK = {"초급": 1, "중급": 3, "고급": 5}

SCHEMA = """
DROP TABLE IF EXISTS korean_krdict_grades;
CREATE TABLE korean_krdict_grades (
    term       TEXT PRIMARY KEY,
    grade      TEXT NOT NULL,
    level_rank INTEGER NOT NULL
);
"""


def read_grades(src: str) -> dict[str, str]:
    best: dict[str, str] = {}
    paths = sorted(glob.glob(os.path.join(src, "*.xml")))
    if not paths:
        raise SystemExit(f"No .xml files found under {src!r}")
    for path in paths:
        text = krdict.INVALID_XML_CHARS.sub("", open(path, encoding="utf-8").read())
        root = ET.fromstring(krdict.escape_attr_angle_brackets(text))
        for entry in root.iter("LexicalEntry"):
            term = krdict.feat(entry.find("Lemma"), "writtenForm")
            grade = krdict.feat(entry, "vocabularyLevel")
            if not term or grade not in GRADE_ORDER:
                continue
            term = term.strip()
            previous = best.get(term)
            if previous is None or GRADE_ORDER[grade] < GRADE_ORDER[previous]:
                best[term] = grade
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", required=True, help="directory of KRDICT .xml files")
    parser.add_argument("--db", default=DB_PATH, help="proficiency_levels.db path")
    args = parser.parse_args()

    grades = read_grades(args.src)
    conn = sqlite3.connect(args.db)
    try:
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT INTO korean_krdict_grades (term, grade, level_rank) VALUES (?, ?, ?)",
            [(term, grade, GRADE_LEVEL_RANK[grade]) for term, grade in sorted(grades.items())],
        )
        conn.commit()
    finally:
        conn.close()

    counts = {grade: sum(1 for g in grades.values() if g == grade) for grade in GRADE_ORDER}
    print(f"korean_krdict_grades: {len(grades)} terms {counts} -> {args.db}")


if __name__ == "__main__":
    main()
