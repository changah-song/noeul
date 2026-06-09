#!/usr/bin/env python3
"""
Translate hanja_words definition_english into 9 languages using the Anthropic Batch API.

Input:  scripts/hanja_words.json
Output: scripts/hanja_words_multilingual.json

Adds definition_fr, definition_es, definition_zh, definition_ar, definition_mn,
definition_vi, definition_th, definition_id, definition_ru to every word entry.

Usage:
  1. Set ANTHROPIC_API_KEY in your environment
  2. python translate_hanja_words.py --submit
  3. python translate_hanja_words.py --merge <batch_id>   (run after batch completes)

Note: 22,451 words × 9 languages = ~202,000 requests.
At the Batch API rate this costs roughly $8–15 depending on definition length.
The batch will take several hours. Check the Anthropic console for status.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import anthropic

ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"
INPUT_PATH = SCRIPTS_DIR / "hanja_words.json"
OUTPUT_PATH = SCRIPTS_DIR / "hanja_words_multilingual.json"
BATCH_ID_FILE = SCRIPTS_DIR / ".hanja_words_batch_id"

LANGUAGES = {
    "fr": "French",
    "es": "Spanish",
    "zh": "Chinese (Simplified)",
    "ar": "Arabic",
    "mn": "Mongolian",
    "vi": "Vietnamese",
    "th": "Thai",
    "id": "Indonesian",
    "ru": "Russian",
}

PROMPT = (
    "Translate this Korean dictionary definition into {language}. "
    "It is a short definition of a Korean word written in hanja (Chinese characters). "
    "Keep the translation concise and natural — match the style of a dictionary entry. "
    "Definition: {definition}\n"
    "Return only the translated definition, nothing else."
)

# Words with very short/unhelpful English definitions (romanizations like '-ga')
# still get translated so the column is populated, but the result will be similarly short.


def make_request_id(word_id: str, lang: str) -> str:
    return f"word_{word_id}_{lang}"


def build_requests(entries: list[dict]) -> list[dict]:
    requests = []
    for entry in entries:
        word_id = entry["id"]
        definition_english = entry.get("definition_english", "").strip()
        if not definition_english:
            continue

        for lang, language_name in LANGUAGES.items():
            prompt = PROMPT.format(
                language=language_name,
                definition=definition_english,
            )
            requests.append({
                "custom_id": make_request_id(word_id, lang),
                "params": {
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 150,
                    "messages": [{"role": "user", "content": prompt}],
                },
            })

    return requests


def submit(client: anthropic.Anthropic, entries: list[dict]) -> str:
    requests = build_requests(entries)
    print(f"Submitting {len(requests)} requests ({len(entries)} words × {len(LANGUAGES)} languages)...")
    print("Estimated cost: $8–15 depending on definition lengths.")

    # Batch API has a limit of 100,000 requests per batch — split if needed
    batches = []
    CHUNK_SIZE = 95_000
    chunks = [requests[i:i + CHUNK_SIZE] for i in range(0, len(requests), CHUNK_SIZE)]

    for i, chunk in enumerate(chunks):
        if i < 1:  # skip chunk 0, already submitted
            print(f"  Skipping chunk {i+1} (already submitted)")
            continue
        batch = client.messages.batches.create(requests=chunk)
        batches.append(batch.id)
        print(f"  Batch {i+1}/{len(chunks)} submitted: {batch.id} ({len(chunk)} requests)")

    existing = json.loads(BATCH_ID_FILE.read_text()) if BATCH_ID_FILE.exists() else []
    BATCH_ID_FILE.write_text(json.dumps(existing + batches))
    
    print(f"Batch IDs saved to {BATCH_ID_FILE}")
    print("Check status at https://console.anthropic.com or run --merge when done.")
    return batches[0]


def collect_batch(client: anthropic.Anthropic, batch_id: str) -> dict[str, str] | None:
    batch = client.messages.batches.retrieve(batch_id)
    print(f"  {batch_id}: {batch.processing_status} "
          f"(succeeded={batch.request_counts.succeeded}, "
          f"errored={batch.request_counts.errored}, "
          f"processing={batch.request_counts.processing})")

    if batch.processing_status != "ended":
        return None

    results = {}
    for result in client.messages.batches.results(batch_id):
        if result.result.type == "succeeded":
            text = result.result.message.content[0].text.strip()
            results[result.custom_id] = text
        else:
            print(f"    FAILED: {result.custom_id}")

    return results


def merge(entries: list[dict], results: dict[str, str]) -> list[dict]:
    merged = []
    missing = 0
    for entry in entries:
        word_id = entry["id"]
        new_entry = dict(entry)

        for lang in LANGUAGES:
            request_id = make_request_id(word_id, lang)
            translation = results.get(request_id)
            if translation:
                new_entry[f"definition_{lang}"] = translation
            else:
                # Fall back to English
                new_entry[f"definition_{lang}"] = entry.get("definition_english", "")
                missing += 1

        merged.append(new_entry)

    if missing:
        print(f"Warning: {missing} translations missing, fell back to English.")

    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Translate hanja word definitions via Batch API")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--submit", action="store_true", help="Submit batch job(s)")
    group.add_argument("--merge", action="store_true", help="Collect results and merge into output JSON")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    if not INPUT_PATH.exists():
        print(f"Error: input file not found: {INPUT_PATH}")
        sys.exit(1)

    with INPUT_PATH.open("r", encoding="utf-8") as f:
        entries = json.load(f)

    print(f"Loaded {len(entries)} word entries from {INPUT_PATH}")

    if args.submit:
        submit(client, entries)

    elif args.merge:
        if not BATCH_ID_FILE.exists():
            print(f"Error: no batch ID file found at {BATCH_ID_FILE}. Run --submit first.")
            sys.exit(1)

        batch_ids = json.loads(BATCH_ID_FILE.read_text())
        if isinstance(batch_ids, str):
            batch_ids = [batch_ids]

        print(f"Collecting results from {len(batch_ids)} batch(es)...")
        all_results: dict[str, str] = {}

        for batch_id in batch_ids:
            results = collect_batch(client, batch_id)
            if results is None:
                print(f"Batch {batch_id} not complete yet. Re-run --merge later.")
                sys.exit(0)
            all_results.update(results)

        print(f"Total translations collected: {len(all_results)}")

        merged = merge(entries, all_results)

        with OUTPUT_PATH.open("w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)

        print(f"Merged output written to {OUTPUT_PATH}")
        print("Next: update build_hanja_db.py to read the new definition_* columns.")


if __name__ == "__main__":
    main()
