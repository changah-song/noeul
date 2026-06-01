#!/usr/bin/env python3
"""
One-time Hanja data ingestion for FluentFable.
Run this from your local machine, NOT on the server.

What this does:
  Phase 1 — Parses hanja.csv into flattened (character, hun_korean, eum) rows
  Phase 2 — Translates unique Korean 훈 strings to English via Claude API
  Phase 3 — Fetches Sino-Korean vocabulary from KRDICT API (XML)
  Phase 4 — Seeds everything into Supabase

Prerequisites:
  pip install anthropic supabase requests pandas

Place hanja.csv in the same directory as this script.

Supabase setup — run these in your SQL editor first:

  CREATE TABLE IF NOT EXISTS hanja_characters (
      character   TEXT NOT NULL,
      hun_korean  TEXT NOT NULL,
      eum         TEXT NOT NULL,
      hun_english TEXT,
      PRIMARY KEY (character, eum)
  );

  CREATE TABLE IF NOT EXISTS hanja_words (
      id                  TEXT PRIMARY KEY,
      hangul              TEXT NOT NULL,
      hanja               TEXT,
      definition_korean   TEXT,
      definition_english  TEXT,
      pos                 TEXT
  );
"""

import ast
import json
import time
import sys
import xml.etree.ElementTree as ET
import anthropic
import requests
import pandas as pd
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv(os.path.join(os.path.dirname(__file__), "../backend/.env"))

# ── Config ─────────────────────────────────────────────────────────────────────
SUPABASE_URL                        = os.getenv("SUPABASE_URL")
SUPABASE_KEY                        = os.getenv("SUPABASE_KEY")
KOREAN_DICTIONARY_CLIENT_ID         = os.getenv("KOREAN_DICTIONARY_CLIENT_ID")
ANTHROPIC_KEY                       = os.getenv("ANTHROPIC_KEY")

HANJA_CSV_PATH      = "hanja.csv"
KRDICT_BASE_URL     = "https://krdict.korean.go.kr/api/search"
WORDS_PER_PAGE      = 100
MAX_PAGES           = 50
TRANSLATE_CHUNK     = 150
REQUEST_DELAY       = 0.3

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
claude   = anthropic.Anthropic(api_key=ANTHROPIC_KEY)


# ── Phase 1: Parse + flatten hanja.csv ────────────────────────────────────────
def parse_hanja_csv(path: str) -> list[dict]:
    print(f"\n[Phase 1] Parsing {path}...")
    df = pd.read_csv(path)

    rows = []
    for _, r in df.iterrows():
        try:
            meanings = ast.literal_eval(r["meaning"])
        except Exception:
            print(f"  Warning: could not parse meaning for {r['hanja']!r}, skipping.")
            continue

        for group in meanings:
            hun_list = group[0]
            eum_list = group[1]
            rows.append({
                "character": r["hanja"].strip(),
                "hun_korean": ", ".join(hun_list),
                "eum":        eum_list[0].strip(),
            })

    print(f"  {len(df)} CSV rows → {len(rows)} flattened (character, eum) pairs.")
    return rows


# ── Phase 2: Translate unique 훈 strings to English via Claude ─────────────────
def translate_hun_meanings(char_rows: list[dict]) -> list[dict]:
    unique_huns = list({r["hun_korean"] for r in char_rows})
    print(f"\n[Phase 2] Translating {len(unique_huns)} unique 훈 strings to English...")

    translation_map: dict[str, str] = {}
    chunks = [unique_huns[i:i+TRANSLATE_CHUNK] for i in range(0, len(unique_huns), TRANSLATE_CHUNK)]

    for idx, chunk in enumerate(chunks):
        print(f"  Chunk {idx + 1}/{len(chunks)} ({len(chunk)} strings)...")

        input_payload = [{"hun": h} for h in chunk]

        message = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{
                "role": "user",
                "content": (
                    "Translate these Korean Hanja 훈 (meaning gloss) strings to concise English. "
                    "Some entries have multiple huns joined by ', ' — translate the combined meaning naturally. "
                    "Return ONLY a JSON array, no markdown, no explanation. "
                    "Each item must have exactly: hun (original), hun_english (translation). "
                    "Keep translations short (1-4 words).\n\n"
                    f"{json.dumps(input_payload, ensure_ascii=False)}"
                )
            }]
        )

        raw = message.content[0].text.strip().lstrip("```json").lstrip("```").rstrip("```")
        translations = json.loads(raw)
        for t in translations:
            translation_map[t["hun"]] = t["hun_english"]

        time.sleep(0.5)

    for row in char_rows:
        row["hun_english"] = translation_map.get(row["hun_korean"], "")

    print(f"  Translation complete.")
    return char_rows


# ── Phase 3: Fetch vocabulary from KRDICT (XML) ────────────────────────────────
def parse_krdict_items(root) -> list[dict]:
    """Extract hanja word entries from a KRDICT XML response root."""
    results = []
    for item in root.findall(".//item"):
        origin_el = item.find("origin")
        hanja_str = origin_el.text.strip() if origin_el is not None and origin_el.text else ""

        # Skip entries with no real hanja characters
        if not hanja_str or not any("\u4e00" <= c <= "\u9fff" for c in hanja_str):
            continue

        word_el     = item.find("word")
        pos_el      = item.find("pos")
        trans_el    = item.find(".//trans_word")
        sense_el    = item.find(".//definition")
        target_code = item.find("target_code")

        english_def = ""
        if trans_el is not None and trans_el.text:
            english_def = trans_el.text.strip().rstrip("^").strip()

        hangul = word_el.text.strip() if word_el is not None and word_el.text else ""
        if not hangul:
            continue

        results.append({
            "id":                 target_code.text.strip() if target_code is not None and target_code.text else "",
            "hangul":             hangul,
            "hanja":              hanja_str,
            "definition_korean":  sense_el.text.strip() if sense_el is not None and sense_el.text else "",
            "definition_english": english_def,
            "pos":                pos_el.text.strip() if pos_el is not None and pos_el.text else "",
        })
    return results


def fetch_krdict_words(char_rows: list[dict]) -> list[dict]:
    """
    Search KRDICT once per unique eum from our hanja dataset.
    KRDICT requires a q parameter — it won't do a bulk paginated dump.
    Using our own eums as queries is the most targeted approach and
    guarantees we find words relevant to the characters we actually have.
    """
    unique_eums = sorted({r["eum"] for r in char_rows})
    print(f"\n[Phase 3] Fetching KRDICT words for {len(unique_eums)} unique eums...")

    seen_ids: set[str] = set()
    words: list[dict] = []

    for idx, eum in enumerate(unique_eums):
        params = {
            "key":        KRDICT_KEY,
            "q":          eum,
            "translated": "y",
            "trans_lang": "1",
            "sort":       "popular",
            "num":        100,       # max per call
            "start":      1,
        }

        try:
            resp = requests.get(KRDICT_BASE_URL, params=params, timeout=10)
            resp.raise_for_status()
            root = ET.fromstring(resp.text)

            # Skip error responses
            if root.tag == "error":
                code = root.findtext("error_code", "")
                print(f"  [{idx+1}/{len(unique_eums)}] '{eum}' → API error {code}, skipping.")
                continue

            new_items = parse_krdict_items(root)

            # Deduplicate by target_code across all eum queries
            for item in new_items:
                if item["id"] and item["id"] not in seen_ids:
                    seen_ids.add(item["id"])
                    words.append(item)

            if (idx + 1) % 25 == 0 or (idx + 1) == len(unique_eums):
                print(f"  [{idx+1}/{len(unique_eums)}] '{eum}' → {len(words)} unique words so far.")

        except ET.ParseError as e:
            print(f"  [{idx+1}/{len(unique_eums)}] '{eum}' → XML parse error ({e}), skipping.")
        except Exception as e:
            print(f"  [{idx+1}/{len(unique_eums)}] '{eum}' → failed ({e}), skipping.")

        time.sleep(REQUEST_DELAY)

    print(f"  KRDICT fetch complete: {len(words)} unique words.")
    return words


# ── Phase 4: Seed Supabase ─────────────────────────────────────────────────────
def seed_supabase(char_rows: list[dict], word_rows: list[dict]):
    print(f"\n[Phase 4] Seeding Supabase...")
    BATCH = 500

    if char_rows:
        char_payload = [
            {
                "character":   r["character"],
                "hun_korean":  r["hun_korean"],
                "eum":         r["eum"],
                "hun_english": r.get("hun_english", ""),
            }
            for r in char_rows
        ]
        print(f"  Inserting {len(char_payload)} hanja_characters...")
        for i in range(0, len(char_payload), BATCH):
            supabase.table("hanja_characters").upsert(char_payload[i:i+BATCH]).execute()
            print(f"    {min(i + BATCH, len(char_payload))}/{len(char_payload)} done.")
    else:
        print("  Skipping hanja_characters (already seeded).")

    if word_rows:
        word_payload = [
            {
                "id":                 w["id"],
                "hangul":             w["hangul"],
                "hanja":              w["hanja"],
                "definition_korean":  w["definition_korean"],
                "definition_english": w["definition_english"],
                "pos":                w["pos"],
            }
            for w in word_rows
            if w["id"] and w["hangul"]
        ]
        print(f"  Inserting {len(word_payload)} hanja_words...")
        for i in range(0, len(word_payload), BATCH):
            supabase.table("hanja_words").upsert(word_payload[i:i+BATCH]).execute()
            print(f"    {min(i + BATCH, len(word_payload))}/{len(word_payload)} done.")
    else:
        print("  No hanja_words to insert.")

    print("  Seeding complete.")


# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=== FluentFable Hanja Ingestion Script ===")
    print("One-time operation. Do NOT run on the server.\n")

    try:
        # Resume from checkpoint if it exists — skip Phase 1 + 2
        checkpoint_path = "hanja_translated.json"
        try:
            with open(checkpoint_path, "r", encoding="utf-8") as f:
                char_rows = json.load(f)
            print(f"[Checkpoint] Loaded {len(char_rows)} rows from {checkpoint_path}")
            print("  Skipping Phase 1 + 2 (already complete).\n")
        except FileNotFoundError:
            # No checkpoint — run from scratch
            char_rows = parse_hanja_csv(HANJA_CSV_PATH)
            char_rows = translate_hun_meanings(char_rows)
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump(char_rows, f, ensure_ascii=False, indent=2)
            print(f"\n  Saved checkpoint → {checkpoint_path}")

        # Phase 3
        word_rows = fetch_krdict_words(char_rows)

        # Phase 4 — pass empty list for chars to skip re-seeding them
        seed_supabase([], word_rows)

        print("\n=== Done! ===")
        print(f"  hanja_characters: already seeded (6245 rows)")
        print(f"  hanja_words:      {len(word_rows)} rows")

    except KeyboardInterrupt:
        print("\nInterrupted. Re-run safely — upsert skips existing rows.")
        sys.exit(1)
    except Exception as e:
        print(f"\nFatal error: {e}")
        raise