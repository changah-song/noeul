#!/usr/bin/env python3
"""Build ko_dict.db from the KRDICT 한국어기초사전 (Korean Basic Dictionary) export.

The bundled snapshot lets the backend resolve Korean lookups offline, the same
way en_dict.db / zh_dict.db do for English and Chinese, instead of hitting the
live KRDICT API for every word. See get_ko_dict_db_connection /
lookup_ko_dictionary_entries in main.py for the read side.

Source
------
Download the 한국어기초사전 export from https://krdict.korean.go.kr (the "사전 전체
내려받기" popup: https://krdict.korean.go.kr/download/downloadPopup) — the learner
dictionary, NOT 우리말샘/표준국어대사전, which are far larger. It ships under
CC BY-SA 2.0 KR, the same license family as the Wiktionary data already in
en_dict.db, so attribution + share-alike carry over unchanged.

The official download is a ZIP of underscore-named XML parts; unzip it and point
--src at the directory. A ready-made mirror of the same files also lives at
github.com/spellcheck-ko/korean-dict-nikl-krdict (5000.xml … 51947.xml).

Format
------
The dump is **LMF** (Lexical Markup Framework), the DTD referenced at the top of
each file (DTD_LMF_REV_16.dtd). Everything is `<feat att="…" val="…"/>` pairs:

    <LexicalEntry att="id" val="27733">
      <feat att="partOfSpeech" val="명사" />
      <feat att="origin" val="哥" />              <!-- hanja, when present -->
      <feat att="subjectCategory" val="…" />       <!-- domain, when present -->
      <Lemma><feat att="writtenForm" val="가" /></Lemma>
      <Sense att="id" val="1">
        <feat att="definition" val="… Korean monolingual def …" />
        <Equivalent>
          <feat att="language" val="영어" />
          <feat att="lemma" val="edge; verge" />   <!-- English gloss we keep -->
          <feat att="definition" val="The perimeter …" />
        </Equivalent>
        <Equivalent><feat att="language" val="일본어" />…</Equivalent>
      </Sense>
    </LexicalEntry>

Homographs are repeated LexicalEntry elements sharing one writtenForm (가격 加擊
"hitting" and 가격 價格 "price"; 눈 "eye" and 눈 "snow"). The dump lists them in
homonym-number order, which is not frequency order: 加擊 comes before 價格. So the
importer collects every entry first, then for each headword stably sorts its
entries by the entry's learner vocabulary grade —

    <feat att="vocabularyLevel" val="초급" />   <!-- 초급 < 중급 < 고급 < 없음 -->

— and only then assigns sense_no as a running counter across the sorted entries
(primary sense = 1). Entries with the same grade keep dump order, and each
entry's own senses keep their dictionary order. The dump has no per-entry
frequency field, so the grade is the only commonness signal used. Entries can
span file boundaries, so ordering happens after all files are read.

Scope
-----
Every translation language in the dump. ko_dictionary holds the English gloss
(the Equivalent whose language == 영어) plus the entry's pos/hanja/domain, and
its sense_no numbering is the one the app has always used. The other
languages' glosses go in ko_dictionary_translations, keyed on the same
(stem, sense_no) plus an interface_language code (KRDICT_LANGUAGE_CODES), so a
Vietnamese or Japanese user gets their language offline instead of a live
KRDICT call. Senses with no English equivalent are skipped in every language,
which keeps the numbering identical across the two tables.

Usage
-----
    python scripts/import_ko_dict.py --src ./krdict_xml --out ko_dict.db
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sqlite3
import xml.etree.ElementTree as ET

# Equivalent language name in the dump -> the app's interface language code.
# The 2023+ dumps carry no Chinese (중국어) equivalents; it is mapped anyway so a
# dump that has them is picked up.
KRDICT_LANGUAGE_CODES = {
    "영어": "en",
    "일본어": "ja",
    "프랑스어": "fr",
    "스페인어": "es",
    "아랍어": "ar",
    "몽골어": "mn",
    "베트남어": "vi",
    "타이어": "th",
    "인도네시아어": "id",
    "러시아어": "ru",
    "중국어": "zh",
}

# XML 1.0 forbids the C0 control chars (everything below 0x20 except tab/LF/CR).
# Some KRDICT files embed a stray \x08 backspace inside non-English (e.g. Arabic)
# definitions, which makes expat reject the whole file. Strip them before parsing;
# they are never part of a gloss, so no data we keep is lost.
INVALID_XML_CHARS = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")

# Some non-English glosses contain raw "<" / ">" inside attribute values (e.g. a
# French definition with "<système de chauffage par le sol>"), which expat rejects
# as not well-formed. Attribute values can never hold a raw double quote, so
# escaping angle brackets inside val="..." is safe and only touches text.
UNESCAPED_ATTR_VALUE = re.compile(r'val="([^"]*)"')


def escape_attr_angle_brackets(text: str) -> str:
    return UNESCAPED_ATTR_VALUE.sub(
        lambda m: 'val="' + m.group(1).replace("<", "&lt;").replace(">", "&gt;") + '"',
        text,
    )

# KRDICT's own data misspells the domain attribute in some rows; accept both.
DOMAIN_ATTS = ("subjectCategory", "subjectCategiory")

SCHEMA = """
DROP TABLE IF EXISTS ko_dictionary;
CREATE TABLE ko_dictionary (
    stem       TEXT NOT NULL,      -- dictionary headword: 공부하다, 사과
    sense_no   INTEGER DEFAULT 1,  -- 1 = primary/most popular sense
    pos        TEXT,               -- 품사 (동사, 명사, …)
    hanja      TEXT,               -- 원어 / origin (工夫), nullable
    definition TEXT,               -- English trans_word gloss
    domain     TEXT,               -- 전문 분야 / semantic category, nullable
    PRIMARY KEY (stem, sense_no)
);

DROP TABLE IF EXISTS ko_dictionary_translations;
CREATE TABLE ko_dictionary_translations (
    stem               TEXT NOT NULL,     -- same headword as ko_dictionary
    sense_no           INTEGER NOT NULL,  -- same numbering as ko_dictionary
    interface_language TEXT NOT NULL,     -- vi, ja, fr, … (never en)
    definition         TEXT NOT NULL,     -- that language's trans_word gloss
    PRIMARY KEY (interface_language, stem, sense_no)
) WITHOUT ROWID;
"""


def feat(node: ET.Element | None, att: str) -> str | None:
    """Value of the direct-child <feat att=... val=.../> with this att, or None."""
    if node is None:
        return None
    for child in node.findall("feat"):
        if child.get("att") == att:
            val = (child.get("val") or "").strip()
            return val or None
    return None


def feat_any(node: ET.Element | None, atts: tuple[str, ...]) -> str | None:
    for att in atts:
        val = feat(node, att)
        if val is not None:
            return val
    return None


def sense_glosses(sense: ET.Element) -> dict[str, str]:
    """{interface_language: lemma} for every Equivalent on this sense, e.g.
    {"en": "edge; verge", "vi": "mép, rìa", …}. The lemma matches what the live
    API returns as trans_word for that trans_lang."""
    glosses = {}
    for equivalent in sense.findall("Equivalent"):
        code = KRDICT_LANGUAGE_CODES.get(feat(equivalent, "language"))
        lemma = feat(equivalent, "lemma")
        if code and lemma and code not in glosses:
            glosses[code] = lemma
    return glosses


# Learner vocabulary grade per LexicalEntry: basic words first. Anything else
# (없음 = not in the learner word list, or a missing feat) sorts last.
VOCABULARY_LEVEL_RANK = {"초급": 0, "중급": 1, "고급": 2}
UNGRADED_RANK = len(VOCABULARY_LEVEL_RANK)


def vocabulary_rank(entry: ET.Element) -> int:
    return VOCABULARY_LEVEL_RANK.get(feat(entry, "vocabularyLevel"), UNGRADED_RANK)


def iter_entries(xml_path: str):
    """Yield (stem, rank, senses) per LexicalEntry in one LMF file, where senses
    is a list of (pos, hanja, glosses, domain) in dictionary order — one per
    sense with an English equivalent (glosses maps language code to lemma, see
    sense_glosses); senses without English are skipped. Entries
    with no English sense at all are still yielded (with an empty list) so the
    caller sees every entry; they contribute no rows.
    """
    text = INVALID_XML_CHARS.sub("", open(xml_path, encoding="utf-8").read())
    text = escape_attr_angle_brackets(text)
    root = ET.fromstring(text)
    for entry in root.iter("LexicalEntry"):
        lemma = entry.find("Lemma")
        stem = feat(lemma, "writtenForm")
        if not stem:
            continue

        pos = feat(entry, "partOfSpeech")
        hanja = feat(entry, "origin")
        domain = feat_any(entry, DOMAIN_ATTS)

        senses = []
        for sense in entry.findall("Sense"):
            glosses = sense_glosses(sense)
            if glosses.get("en"):
                senses.append((pos, hanja, glosses, domain))
        yield stem, vocabulary_rank(entry), senses


def number_senses(entries_by_stem: dict[str, list[tuple[int, list]]]):
    """Yield (stem, sense_no, pos, hanja, glosses, domain) rows. Each
    headword's entries (homographs) are stably sorted by vocabulary grade, then
    sense_no runs across them so sense 1 is the first sense of the most basic
    entry."""
    for stem, entries in entries_by_stem.items():
        sense_no = 0
        for _rank, senses in sorted(entries, key=lambda item: item[0]):
            for pos, hanja, glosses, domain in senses:
                sense_no += 1
                yield (stem, sense_no, pos, hanja, glosses, domain)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build ko_dict.db from KRDICT XML.")
    parser.add_argument("--src", required=True, help="directory of KRDICT .xml files")
    parser.add_argument("--out", default="ko_dict.db", help="output SQLite path")
    args = parser.parse_args()

    def numeric_key(path: str) -> tuple[int, str]:
        # Files are named by entry count (5000.xml … 51947.xml); sort numerically
        # so entries arrive in dump order, which breaks ties between homographs
        # of the same vocabulary grade.
        name = os.path.splitext(os.path.basename(path))[0]
        return (int(name), name) if name.isdigit() else (10**9, name)

    xml_files = sorted(glob.glob(os.path.join(args.src, "*.xml")), key=numeric_key)
    if not xml_files:
        raise SystemExit(f"No .xml files found under {args.src!r}")

    conn = sqlite3.connect(args.out)
    try:
        conn.executescript(SCHEMA)
        skipped = []
        # stem -> [(vocabulary rank, senses)] in dump order. Homographs can span
        # files, so every file is read before any sense_no is assigned.
        entries_by_stem: dict[str, list[tuple[int, list]]] = {}
        for xml_path in xml_files:
            try:
                entries = list(iter_entries(xml_path))
            except ET.ParseError as error:
                # One unparseable file shouldn't sink a 50-file import — warn,
                # skip, keep going, and report the casualties at the end.
                print(f"[import] SKIP {os.path.basename(xml_path)}: {error}")
                skipped.append(os.path.basename(xml_path))
                continue
            for stem, rank, senses in entries:
                entries_by_stem.setdefault(stem, []).append((rank, senses))
            print(f"[import] {os.path.basename(xml_path)}: {len(entries)} entries")

        dictionary_rows = []
        translation_rows = []
        for stem, sense_no, pos, hanja, glosses, domain in number_senses(entries_by_stem):
            dictionary_rows.append((stem, sense_no, pos, hanja, glosses["en"], domain))
            translation_rows.extend(
                (stem, sense_no, code, gloss)
                for code, gloss in glosses.items()
                if code != "en"
            )
        conn.executemany(
            "INSERT INTO ko_dictionary "
            "(stem, sense_no, pos, hanja, definition, domain) VALUES (?,?,?,?,?,?)",
            dictionary_rows,
        )
        conn.executemany(
            "INSERT INTO ko_dictionary_translations "
            "(stem, sense_no, interface_language, definition) VALUES (?,?,?,?)",
            translation_rows,
        )
        conn.commit()
        total = conn.execute("SELECT COUNT(*) FROM ko_dictionary").fetchone()[0]

        conn.execute("CREATE INDEX idx_ko_dictionary_stem ON ko_dictionary(stem)")
        conn.commit()

        headwords = conn.execute(
            "SELECT COUNT(DISTINCT stem) FROM ko_dictionary"
        ).fetchone()[0]
        print(f"[import] done — {total} sense rows across {headwords} headwords → {args.out}")
        for code, count in conn.execute(
            "SELECT interface_language, COUNT(*) FROM ko_dictionary_translations "
            "GROUP BY interface_language ORDER BY interface_language"
        ):
            print(f"[import]   {code}: {count} translated senses")
        conn.execute("VACUUM")
        if skipped:
            print(f"[import] WARNING: skipped {len(skipped)} unparseable file(s): {', '.join(skipped)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
