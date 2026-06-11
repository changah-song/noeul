import sqlite3
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = ROOT_DIR / "backend" / "en_dict.db"


def clean_etymology(value):
    if not isinstance(value, str) or not value.strip():
        return None

    lines = [line.strip() for line in value.strip().splitlines() if line.strip()]
    clean = lines[-1] if lines else None
    if clean and (clean.startswith("From") or clean.startswith("from") or "+" in clean):
        return clean
    return None


def main():
    if not DB_PATH.exists():
        raise SystemExit(f"Missing English dictionary DB: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT word, etymology FROM en_dictionary WHERE etymology IS NOT NULL"
    ).fetchall()

    updates = [
        (clean_etymology(etymology), word)
        for word, etymology in rows
    ]
    conn.executemany("UPDATE en_dictionary SET etymology = ? WHERE word = ?", updates)
    conn.commit()
    conn.close()

    print(f"Cleaned {len(updates)} etymology entries")


if __name__ == "__main__":
    main()
