#!/usr/bin/env python3
"""Book levels (with band distributions) for the remote public library.

The bundled Korean and Chinese books get theirs from
generate_catalog_levels.py. English books live in Supabase (table
public_library, bucket public-library), so this downloads each EPUB, runs its
full text through the same pipeline chapter preprocessing uses (the English
tokenizer and CEFR levels from proficiency_levels.db) and scores it with
score_vocabulary_level. The app uses the distribution to place every book in
a reading-ease group for the reader (frontend/services/bookEase.js).

Run from the backend venv (spaCy required), with the app's public Supabase
settings in the environment (the anon key reads the public table and bucket):

    EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \\
        python scripts/generate_public_library_levels.py

Output: frontend/assets/data/public-domain/library-levels.generated.json,
keyed by public_library.id.
"""

from __future__ import annotations

import html
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
OUTPUT_PATH = Path(os.environ.get("LIBRARY_LEVELS_OUT") or REPO_ROOT / "frontend" / "assets" / "data" / "public-domain" / "library-levels.generated.json")
BUCKET = "public-library"
# spaCy handles at most 1M characters at a time; books go through in chunks.
CHUNK_CHARS = 200_000

sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402

TAG_RE = re.compile(r"<[^>]+>")
BODY_RE = re.compile(r"<body[^>]*>(.*?)</body>", re.S | re.I)
SKIP_RE = re.compile(r"(toc|nav|cover|title|copyright|colophon|imprint|uncopyright|endnotes|loi)\b", re.I)


def fetch(url: str, key: str) -> bytes:
    request = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def epub_text(data: bytes) -> str:
    """The book's reading text: every XHTML document's body, minus the
    front and back matter (cover, table of contents, colophon)."""
    parts: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        for name in sorted(book.namelist()):
            if not name.lower().endswith((".xhtml", ".html", ".htm")) or SKIP_RE.search(name.rsplit("/", 1)[-1]):
                continue
            raw = book.read(name).decode("utf-8", errors="ignore")
            body = BODY_RE.search(raw)
            text = TAG_RE.sub(" ", body.group(1) if body else raw)
            parts.append(html.unescape(text))
    return re.sub(r"[ \t]+", " ", "\n".join(parts))


def book_level(text: str) -> dict:
    stems: list[str] = []
    seen: set[str] = set()
    pos_by_stem: dict[str, str] = {}
    for start in range(0, len(text), CHUNK_CHARS):
        chunk_stems, _surfaces, chunk_pos = main.extract_en_lookup_tokens(text[start:start + CHUNK_CHARS])
        for stem in chunk_stems:
            if stem not in seen:
                seen.add(stem)
                stems.append(stem)
        pos_by_stem.update(chunk_pos)
    # Names aren't vocabulary: leave them out entirely, like the reader does.
    stems = [stem for stem in stems if pos_by_stem.get(stem) != "name" and not stem[:1].isupper()]
    levels = main.lookup_english_cefr_levels(stems, pos_by_stem)
    entries = [levels.get(stem) or {} for stem in stems]
    return main.score_vocabulary_level("en", entries, sample_size=max(len(entries), 1))


def main_cli() -> int:
    url = os.environ.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY", "")
    if not url or not key:
        raise SystemExit("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set")
    rows = json.loads(fetch(f"{url}/rest/v1/public_library?select=id,title,storage_path,target_language", key))
    # Books already leveled are kept; the file is saved after every book, so
    # an interrupted run picks up where it stopped. --force redoes them all.
    levels: dict[str, dict] = {}
    if OUTPUT_PATH.exists() and "--force" not in sys.argv:
        levels = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    ids = {row["id"] for row in rows}
    levels = {book_id: payload for book_id, payload in levels.items() if book_id in ids}
    failed: list[str] = []
    for row in rows:
        path = (row.get("storage_path") or "").lstrip("/")
        if not path.lower().endswith(".epub"):
            print(f"[skip] {row.get('title')}: not an EPUB")
            continue
        language = (row.get("target_language") or "").split("-")[0].lower()
        if language != "en":
            print(f"[skip] {row.get('title')}: {language} is leveled by generate_catalog_levels.py")
            continue
        if row["id"] in levels:
            continue
        try:
            data = fetch(f"{url}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(path)}", key)
        except urllib.error.HTTPError as error:
            # The app can't download it either; report it rather than stop.
            print(f"[fail] {row.get('title')}: download failed (HTTP {error.code}) for {path}")
            failed.append(row.get("title") or path)
            continue
        payload = book_level(epub_text(data))
        payload["title"] = row.get("title")
        levels[row["id"]] = payload
        save(levels)
        print(f"[ok] {row.get('title')}: {payload['level']}, {payload['matched_count']}/{payload['sample_size']} "
              f"matched, distribution {[(item['rank'], item['count']) for item in payload['distribution']]}")
    empty = sorted(levels[book]["title"] for book in levels if not levels[book].get("matched_count"))
    if empty:
        raise SystemExit("No words matched for: " + ", ".join(empty) + " (is spaCy installed?)")
    save(levels)
    print(f"\nwrote {len(levels)} book levels -> {OUTPUT_PATH}")
    if failed:
        print("could not download: " + ", ".join(failed))
    return 0


def save(levels: dict[str, dict]) -> None:
    OUTPUT_PATH.write_text(json.dumps(levels, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main_cli())
