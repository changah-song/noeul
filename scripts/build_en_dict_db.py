import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "en_dict.db"
JSONL_PATH = ROOT / "scripts" / "kaikki.org-dictionary-English.jsonl"
BATCH_SIZE = 10_000


def first_ipa(entry):
    return next(
        (sound.get("ipa") for sound in entry.get("sounds", []) if sound.get("ipa")),
        None,
    )


def first_definition(entry):
    return next(
        (sense["glosses"][0] for sense in entry.get("senses", []) if sense.get("glosses")),
        None,
    )


def word_list(entry, key):
    return [
        item.get("word")
        for item in entry.get(key, [])
        if item.get("word")
    ][:20]


def main():
    if not JSONL_PATH.exists():
        raise SystemExit(f"Missing input JSONL: {JSONL_PATH}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS en_dictionary (
            word TEXT PRIMARY KEY,
            pos TEXT,
            ipa TEXT,
            definition TEXT,
            etymology TEXT,
            derived TEXT,
            related TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_word ON en_dictionary(word)")

    inserted = 0
    scanned = 0
    with JSONL_PATH.open(encoding="utf-8") as handle:
        for line in handle:
            scanned += 1
            try:
                entry = json.loads(line)
                if entry.get("lang_code") != "en":
                    continue

                word = entry.get("word", "").strip().lower()
                if not word:
                    continue

                before_changes = conn.total_changes
                conn.execute(
                    """
                    INSERT OR IGNORE INTO en_dictionary
                    (word, pos, ipa, definition, etymology, derived, related)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        word,
                        entry.get("pos"),
                        first_ipa(entry),
                        first_definition(entry),
                        entry.get("etymology_text"),
                        json.dumps(word_list(entry, "derived"), ensure_ascii=False),
                        json.dumps(word_list(entry, "related"), ensure_ascii=False),
                    ),
                )
                if conn.total_changes > before_changes:
                    inserted += 1

                if scanned % BATCH_SIZE == 0:
                    conn.commit()
                    print(f"Scanned {scanned:,} lines; inserted {inserted:,} words")
            except Exception:
                continue

    conn.commit()
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.execute("VACUUM")
    conn.close()
    print(f"Done. DB size: {DB_PATH.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
