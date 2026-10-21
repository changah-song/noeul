"""Clear broken per-language values in the bundled hanja.db.

The per-language hanja meanings (`hanja_characters.hun_*`) and word
definitions (`hanja_words.definition_*`) were machine-generated. A spot check
(docs/plans/content-localization.md) found:

- `hun_zh` is not a meaning at all for any row: it holds a comment comparing the
  Korean and Chinese senses ("韓文表義一致", "韩中含义相同", "水的基本含义相同" ...).
  The whole column is cleared.
- Other columns contain model chatter, wrong scripts or untranslated English
  ("ماهر في\\n(mahir fi)", "флuttering фазан", Turkish "düşman" in hun_mn ...).
  Those values are cleared.

A cleared (NULL) value is not shown as-is: the app machine-translates the
English meaning through the backend's /translate_content/ (cached) and, when
offline, shows the English labelled as English. See
frontend/services/contentTranslation.js and services/api/hanjaRelated.js.

Usage (from the repo root):
    python3 backend/scripts/clean_hanja_translations.py frontend/assets/data/hanja.db

Idempotent. Rewrites hanja_manifest.json next to the db so devices re-copy it.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

CJK_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
HANGUL_RE = re.compile(r"[가-힣ᄀ-ᇿ㄰-㆏]")
LATIN_RE = re.compile(r"[A-Za-zÀ-ɏ]")
SCRIPT_RE = {
    "ar": re.compile(r"[؀-ۿ]"),
    "th": re.compile(r"[฀-๿]"),
    "ru": re.compile(r"[Ѐ-ӿ]"),
    "mn": re.compile(r"[Ѐ-ӿ]"),
}
NON_LATIN_SCRIPT_RE = re.compile(r"[Ѐ-ӿ؀-ۿ฀-๿]")
LATIN_LANGUAGES = {"fr", "es", "id", "vi"}
# Korean/Chinese comparison commentary instead of a Chinese meaning.
ZH_COMMENTARY_RE = re.compile(r"韩|韓|含义|含義|相同|一致|引申|表义|表義|中文|汉语|漢語|对比|對比|区别|區別")

LANGUAGES = ("fr", "es", "zh", "ar", "mn", "vi", "th", "id", "ru")


def is_broken(language: str, value: str | None) -> bool:
    if value is None:
        return False
    text = value.strip()
    if not text:
        return True
    if "\n" in text or "**" in text or "→" in text or "->" in text:
        return True
    if language == "zh":
        # (hun_zh is cleared wholesale; ZH_COMMENTARY_RE documents why. For word
        # definitions 韩国 etc. are legitimate, so only script checks apply.)
        return bool(HANGUL_RE.search(text) or LATIN_RE.search(text))
    if CJK_RE.search(text) or HANGUL_RE.search(text):
        return True
    if language in SCRIPT_RE:
        return bool(LATIN_RE.search(text)) or not SCRIPT_RE[language].search(text)
    if language in LATIN_LANGUAGES:
        return bool(NON_LATIN_SCRIPT_RE.search(text))
    return False


def clean(db_path: str) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    counts: dict[str, int] = {}
    try:
        # hun_zh is commentary for every row: clear it outright.
        counts["hanja_characters.hun_zh"] = conn.execute(
            "UPDATE hanja_characters SET hun_zh = NULL WHERE hun_zh IS NOT NULL"
        ).rowcount
        for table, key, prefix in (
            ("hanja_characters", "rowid", "hun_"),
            ("hanja_words", "rowid", "definition_"),
        ):
            for language in LANGUAGES:
                column = f"{prefix}{language}"
                if column == "hun_zh":
                    continue
                rows = conn.execute(
                    f"SELECT {key}, {column} FROM {table} WHERE {column} IS NOT NULL"
                ).fetchall()
                broken = [(row_id,) for row_id, value in rows if is_broken(language, value)]
                conn.executemany(f"UPDATE {table} SET {column} = NULL WHERE {key} = ?", broken)
                counts[f"{table}.{column}"] = len(broken)
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()
    return counts


def update_manifest(db_path: str, counts: dict[str, int]) -> None:
    manifest_path = os.path.join(os.path.dirname(db_path), "hanja_manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except FileNotFoundError:
        manifest = {}
    manifest["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest["db_file_size_bytes"] = os.path.getsize(db_path)
    manifest["cleaned_by"] = "backend/scripts/clean_hanja_translations.py"
    manifest["cleared_values"] = {key: value for key, value in counts.items() if value}
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    db_path = argv[1]
    counts = clean(db_path)
    for key, value in counts.items():
        print(f"{key}: cleared {value}")
    update_manifest(db_path, counts)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
