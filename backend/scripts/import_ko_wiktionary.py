#!/usr/bin/env python3
"""Add Korean senses from English Wiktionary to ko_dict.db, as the table
ko_dictionary_extra, for what the KRDICT learner dictionary (ko_dictionary)
lacks.

KRDICT covers ~49k headwords of modern, everyday Korean. Older and literary
words and senses common in the bundled classics are missing: 부처 has Buddha,
a Buddhist statue and 部處 (ministry), not 夫妻 (married couple). English
Wiktionary has them, with English glosses already.

Source
------
kaikki.org's extract of English Wiktionary's Korean entries:
https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl.gz
(CC BY-SA 4.0 / GFDL, the same family as KRDICT's CC BY-SA 2.0 KR and the
Wiktionary data in en_learner.db.)

    backend/.venv/bin/python backend/scripts/import_ko_wiktionary.py \\
        --src kaikki.org-dictionary-Korean.jsonl.gz [--db backend/ko_dict.db]

What is added
-------------
- A headword KRDICT has: only the Wiktionary entries whose hanja is not among
  KRDICT's for it (a homograph KRDICT lacks: 부처 夫妻). Native-Korean senses
  of a known word are left out; they would mostly repeat KRDICT's.
- A headword KRDICT doesn't have: every sense.
- Senses Wiktionary marks archaic, dated, literary, formal, dialectal, etc.
  carry that label: "(formal) married couple, husband and wife".
- Not added: names, spelling pointers (alt-of, form-of), bare morphemes and
  roots, proverbs and phrases.

Read by main.py: lookup_ko_dictionary_search lists these senses after
KRDICT's, and lookup_ko_dictionary_entries uses the first one for a headword
KRDICT doesn't have.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sqlite3

POS_LABELS = {
    'noun': '명사',
    'verb': '동사',
    'adj': '형용사',
    'adv': '부사',
    'pron': '대명사',
    'num': '수사',
    'det': '관형사',
    'intj': '감탄사',
    'counter': '의존 명사',
    'particle': '조사',
    'conj': '부사',
}

SKIP_TAGS = {'alt-of', 'form-of', 'no-gloss', 'morpheme', 'abbreviation'}

# Wiktionary tag -> the label put in front of the gloss, in this order.
LABELS = [
    ('obsolete', 'obsolete'),
    ('archaic', 'archaic'),
    ('historical', 'historical'),
    ('dated', 'dated'),
    ('literary', 'literary'),
    ('formal', 'formal'),
    ('rare', 'rare'),
    ('dialectal', 'dialect'),
    ('North-Korea', 'North Korea'),
    ('slang', 'slang'),
    ('vulgar', 'vulgar'),
    ('derogatory', 'derogatory'),
]

HANGUL = re.compile(r'^[가-힣]+$')
HAN = re.compile(r'[㐀-鿿豈-﫿]')

SCHEMA = """
DROP TABLE IF EXISTS ko_dictionary_extra;
CREATE TABLE ko_dictionary_extra (
    stem       TEXT NOT NULL,      -- dictionary headword: 부처
    sense_no   INTEGER NOT NULL,   -- order within this table, 1 first
    pos        TEXT,               -- 품사, KRDICT's labels (명사, 동사, …)
    hanja      TEXT,               -- 夫妻, nullable
    definition TEXT NOT NULL,      -- English gloss, with a label: "(formal) …"
    source     TEXT NOT NULL,      -- 'wiktionary'
    PRIMARY KEY (stem, sense_no)
);
"""


def entry_hanja(entry: dict) -> str | None:
    for head in entry.get('head_templates') or []:
        value = (head.get('args') or {}).get('hanja')
        if value and HAN.search(value):
            return value.strip()
    for form in entry.get('forms') or []:
        if 'hanja' in (form.get('tags') or []) and HAN.search(form.get('form') or ''):
            return form['form'].strip()
    return None


def sense_gloss(sense: dict) -> str | None:
    tags = set(sense.get('tags') or [])
    if tags & SKIP_TAGS:
        return None
    glosses = [g for g in (sense.get('glosses') or []) if isinstance(g, str) and g.strip()]
    if not glosses:
        return None
    gloss = glosses[-1].strip()
    labels = [label for tag, label in LABELS if tag in tags]
    return f"({', '.join(labels)}) {gloss}" if labels else gloss


def wiktionary_entries(src: str):
    """Yield (stem, pos label, hanja, [glosses]) per Hangul entry, in file order."""
    with gzip.open(src, 'rt', encoding='utf-8') as handle:
        for line in handle:
            entry = json.loads(line)
            stem = (entry.get('word') or '').strip()
            pos = POS_LABELS.get(entry.get('pos'))
            if not pos or not HANGUL.match(stem):
                continue
            glosses = []
            for sense in entry.get('senses') or []:
                gloss = sense_gloss(sense)
                if gloss and gloss not in glosses:
                    glosses.append(gloss)
            if glosses:
                yield stem, pos, entry_hanja(entry), glosses


def build(src: str, db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    krdict_hanja: dict[str, set] = {}
    for stem, hanja in conn.execute('SELECT stem, hanja FROM ko_dictionary'):
        krdict_hanja.setdefault(stem, set()).add((hanja or '').strip())

    rows = []
    sense_no: dict[str, int] = {}
    added_to_known = 0
    new_headwords = set()
    for stem, pos, hanja, glosses in wiktionary_entries(src):
        known = krdict_hanja.get(stem)
        if known is not None:
            # A homograph KRDICT lacks, told apart by its hanja.
            if not hanja or hanja in known:
                continue
            added_to_known += 1
        else:
            new_headwords.add(stem)
        for gloss in glosses:
            sense_no[stem] = sense_no.get(stem, 0) + 1
            rows.append((stem, sense_no[stem], pos, hanja, gloss, 'wiktionary'))

    conn.executescript(SCHEMA)
    conn.executemany('INSERT INTO ko_dictionary_extra VALUES (?, ?, ?, ?, ?, ?)', rows)
    conn.commit()
    conn.execute('VACUUM')
    conn.close()
    return {
        'senses': len(rows),
        'new_headwords': len(new_headwords),
        'homographs_added_to_known_words': added_to_known,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--src', required=True, help='kaikki.org-dictionary-Korean.jsonl.gz')
    parser.add_argument('--db', default=os.path.join(os.path.dirname(__file__), '..', 'ko_dict.db'))
    args = parser.parse_args()
    print(build(args.src, args.db))


if __name__ == '__main__':
    main()
