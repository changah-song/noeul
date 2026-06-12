import argparse
import gzip
import re
import sqlite3
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "zh_dict.db"
DEFAULT_CEDICT_PATH = ROOT / "scripts" / "cedict_ts.u8"
BATCH_SIZE = 10_000

CEDICT_RE = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.*)/$")
VOWELS = "aeiouv\u00fc"
TONE_MARKS = {
    "a": ["a", "\u0101", "\u00e1", "\u01ce", "\u00e0"],
    "e": ["e", "\u0113", "\u00e9", "\u011b", "\u00e8"],
    "i": ["i", "\u012b", "\u00ed", "\u01d0", "\u00ec"],
    "o": ["o", "\u014d", "\u00f3", "\u01d2", "\u00f2"],
    "u": ["u", "\u016b", "\u00fa", "\u01d4", "\u00f9"],
    "\u00fc": ["\u00fc", "\u01d6", "\u01d8", "\u01da", "\u01dc"],
}


def tone_target_index(syllable: str) -> int | None:
    lower = syllable.lower()
    for preferred in ("a", "e"):
        index = lower.find(preferred)
        if index >= 0:
            return index

    ou_index = lower.find("ou")
    if ou_index >= 0:
        return ou_index

    for index in range(len(syllable) - 1, -1, -1):
        if lower[index] in VOWELS:
            return index

    return None


def mark_syllable(raw_syllable: str) -> str:
    syllable = raw_syllable.replace("u:", "\u00fc").replace("v", "\u00fc")
    match = re.search(r"([1-5])", syllable)
    if not match:
        return syllable

    tone = int(match.group(1))
    syllable = re.sub(r"[1-5]", "", syllable)
    if tone == 5:
        return syllable

    index = tone_target_index(syllable)
    if index is None:
        return syllable

    char = syllable[index]
    marked = TONE_MARKS.get(char.lower(), [char])[tone]
    if char.isupper():
        marked = marked.upper()

    return f"{syllable[:index]}{marked}{syllable[index + 1:]}"


def pinyin_numbers_to_marks(pinyin: str) -> str:
    return " ".join(mark_syllable(part) for part in pinyin.split())


def parse_cedict_line(line: str):
    match = CEDICT_RE.match(line.strip())
    if not match:
        return None

    traditional, simplified, pinyin_numbers, raw_definitions = match.groups()
    definitions = [
        definition.strip()
        for definition in raw_definitions.split("/")
        if definition.strip()
    ]
    if not simplified or not traditional or not definitions:
        return None

    return {
        "simplified": simplified,
        "traditional": traditional,
        "pinyin_numbers": pinyin_numbers.strip(),
        "pinyin": pinyin_numbers_to_marks(pinyin_numbers.strip()),
        "definition": "; ".join(definitions),
    }


def iter_cedict_lines(input_path: Path):
    suffixes = [suffix.lower() for suffix in input_path.suffixes]
    if suffixes[-1:] == [".zip"]:
        with zipfile.ZipFile(input_path) as archive:
            text_names = [
                name
                for name in archive.namelist()
                if not name.endswith("/") and name.lower().endswith((".u8", ".txt"))
            ]
            if not text_names:
                raise SystemExit(f"No CC-CEDICT text file found in ZIP: {input_path}")

            with archive.open(text_names[0]) as handle:
                for raw_line in handle:
                    yield raw_line.decode("utf-8")
        return

    if suffixes[-1:] == [".gz"]:
        with gzip.open(input_path, mode="rt", encoding="utf-8") as handle:
            yield from handle
        return

    with input_path.open(encoding="utf-8") as handle:
        yield from handle


def build_database(input_path: Path, db_path: Path):
    if not input_path.exists():
        raise SystemExit(f"Missing CC-CEDICT input file: {input_path}")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("DROP TABLE IF EXISTS zh_dictionary")
    conn.execute("""
        CREATE TABLE zh_dictionary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            simplified TEXT NOT NULL,
            traditional TEXT NOT NULL,
            pinyin_numbers TEXT,
            pinyin TEXT,
            definition TEXT,
            frequency_rank INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX idx_zh_dictionary_simplified ON zh_dictionary(simplified)")
    conn.execute("CREATE INDEX idx_zh_dictionary_traditional ON zh_dictionary(traditional)")

    rows = []
    inserted = 0
    scanned = 0
    for line in iter_cedict_lines(input_path):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        scanned += 1
        entry = parse_cedict_line(stripped)
        if not entry:
            continue

        inserted += 1
        rows.append((
            entry["simplified"],
            entry["traditional"],
            entry["pinyin_numbers"],
            entry["pinyin"],
            entry["definition"],
            inserted,
        ))

        if len(rows) >= BATCH_SIZE:
            conn.executemany(
                """
                INSERT INTO zh_dictionary
                (simplified, traditional, pinyin_numbers, pinyin, definition, frequency_rank)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
            rows.clear()
            print(f"Scanned {scanned:,} entries; inserted {inserted:,} rows")

    if rows:
        conn.executemany(
            """
            INSERT INTO zh_dictionary
            (simplified, traditional, pinyin_numbers, pinyin, definition, frequency_rank)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

    conn.commit()
    conn.execute("PRAGMA journal_mode=DELETE")
    conn.execute("VACUUM")
    conn.close()
    print(f"Done. Inserted {inserted:,} rows. DB size: {db_path.stat().st_size / 1e6:.1f}MB")


def main():
    parser = argparse.ArgumentParser(description="Build backend/zh_dict.db from CC-CEDICT")
    parser.add_argument(
        "input",
        nargs="?",
        default=str(DEFAULT_CEDICT_PATH),
        help="Path to CC-CEDICT cedict_ts.u8",
    )
    parser.add_argument(
        "--db",
        default=str(DB_PATH),
        help="Output SQLite path",
    )
    args = parser.parse_args()

    build_database(Path(args.input), Path(args.db))


if __name__ == "__main__":
    main()
