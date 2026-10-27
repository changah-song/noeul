#!/usr/bin/env python3
"""Machine-translate English dictionary senses into an interface language and
store them in en_learner.db (table en_sense_translations), so lookups show
definitions in the learner's language without a translation call.

    GOOGLE_CLOUD_TRANSLATE_API_KEY=... python scripts/translate_en_senses.py --lang ko

Scope (the defaults): the FIRST sense of each word's two most common entries,
for words with a wordfreq Zipf frequency of at least 3.0 (about 19k words,
1.7M characters for Korean, roughly $34 on Google Cloud Translation). Other
senses and rarer words are translated at preprocess time and cached on the
server (main.translate_en_missing_senses).

Rows are keyed by the English sense text, so a dictionary rebuild keeps them
(build_en_learner_dict.py carries the table over) and a rerun only sends what
is missing. --limit and --dry-run size a run before paying for it.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(BACKEND_DIR, "en_learner.db")
GOOGLE_URL = "https://translation.googleapis.com/language/translate/v2"
# Google's v2 limits: 128 strings per request; keep requests well under 30k chars.
BATCH_ITEMS = 100
BATCH_CHARS = 20_000
# Google wants zh-CN / zh-TW; the app's codes are zh / zh-Hant.
GOOGLE_TARGETS = {"zh": "zh-CN", "zh-Hant": "zh-TW"}


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS en_sense_translations (
            interface_language TEXT NOT NULL,
            source             TEXT NOT NULL,  -- the English sense, as in en_entries.senses
            text               TEXT NOT NULL,  -- its translation
            PRIMARY KEY (interface_language, source)
        ) WITHOUT ROWID
        """
    )


def pending_senses(conn, lang: str, min_zipf: float, max_entry: int, senses_per_entry: int) -> list[str]:
    done = {row[0] for row in conn.execute(
        "SELECT source FROM en_sense_translations WHERE interface_language = ?", (lang,)
    )}
    out: list[str] = []
    seen: set[str] = set()
    rows = conn.execute(
        """
        SELECT e.senses FROM en_entries e JOIN en_words w USING (word)
        WHERE w.zipf >= ? AND e.entry_no <= ?
        ORDER BY w.zipf DESC, e.word, e.entry_no
        """,
        (min_zipf, max_entry),
    )
    for (raw,) in rows:
        for sense in json.loads(raw)[:senses_per_entry]:
            if sense and sense not in done and sense not in seen:
                seen.add(sense)
                out.append(sense)
    return out


def batches(texts: list[str]):
    batch: list[str] = []
    chars = 0
    for text in texts:
        if batch and (len(batch) >= BATCH_ITEMS or chars + len(text) > BATCH_CHARS):
            yield batch
            batch, chars = [], 0
        batch.append(text)
        chars += len(text)
    if batch:
        yield batch


def translate(texts: list[str], target: str, key: str) -> list[str]:
    body = json.dumps({"q": texts, "source": "en", "target": target, "format": "text"}).encode()
    request = urllib.request.Request(
        f"{GOOGLE_URL}?key={key}", data=body, headers={"content-type": "application/json"}, method="POST"
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
            return [item["translatedText"] for item in payload["data"]["translations"]]
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 503) and attempt < 3:
                time.sleep(2 ** attempt * 5)
                continue
            raise SystemExit(f"translation failed: HTTP {error.code} {error.read().decode()[:300]}")
    raise SystemExit("translation failed after retries")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lang", required=True, help="interface language code (ko, ja, zh, zh-Hant, …)")
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--min-zipf", type=float, default=3.0)
    parser.add_argument("--max-entry", type=int, default=2)
    parser.add_argument("--senses", type=int, default=1, help="senses per entry")
    parser.add_argument("--limit", type=int, default=0, help="translate at most this many senses")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    ensure_table(conn)
    texts = pending_senses(conn, args.lang, args.min_zipf, args.max_entry, args.senses)
    if args.limit:
        texts = texts[: args.limit]
    chars = sum(len(text) for text in texts)
    print(f"[translate_en_senses] {len(texts)} senses, {chars:,} characters "
          f"(~${chars / 1e6 * 20:.2f} at $20/M) -> {args.lang}")
    if args.dry_run or not texts:
        return 0

    key = os.environ.get("GOOGLE_CLOUD_TRANSLATE_API_KEY", "")
    if not key:
        raise SystemExit("GOOGLE_CLOUD_TRANSLATE_API_KEY is not set")
    target = GOOGLE_TARGETS.get(args.lang, args.lang)
    sent = 0
    for batch in batches(texts):
        translated = translate(batch, target, key)
        conn.executemany(
            "INSERT OR REPLACE INTO en_sense_translations VALUES (?, ?, ?)",
            [(args.lang, source, text) for source, text in zip(batch, translated) if text],
        )
        conn.commit()
        sent += sum(len(text) for text in batch)
        print(f"  {sent:,} / {chars:,} characters", flush=True)
    conn.execute("VACUUM")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
