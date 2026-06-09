#!/usr/bin/env python3
"""
Translate hanja_characters hun_english into 9 languages using the Anthropic Batch API.

Input:  scripts/hanja_translated.json
Output: scripts/hanja_translated_multilingual.json

The output adds hun_fr, hun_es, hun_zh, hun_ar, hun_mn, hun_vi, hun_th, hun_id, hun_ru
to every character entry. Chinese (zh) gets a special prompt — see note below.

Usage:
  1. Set ANTHROPIC_API_KEY in your environment
  2. Run once to submit the batch:       python translate_hanja_characters.py --submit
  3. Run later to collect results:       python translate_hanja_characters.py --collect <batch_id>
  4. Run to merge into final JSON:       python translate_hanja_characters.py --merge <batch_id>

The batch will take 1–24 hours. Check status in the Anthropic console or re-run --collect.
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
INPUT_PATH = SCRIPTS_DIR / "hanja_translated.json"
OUTPUT_PATH = SCRIPTS_DIR / "hanja_translated_multilingual.json"
BATCH_ID_FILE = SCRIPTS_DIR / ".hanja_characters_batch_id"

LANGUAGES = {
    "fr": "French",
    "es": "Spanish",
    "zh": "Chinese",
    "ar": "Arabic",
    "mn": "Mongolian",
    "vi": "Vietnamese",
    "th": "Thai",
    "id": "Indonesian",
    "ru": "Russian",
}

# Chinese gets a different prompt — Chinese speakers learning Korean already know
# the character. Show them how the Korean usage compares to modern Chinese instead.
ZH_PROMPT = (
    "This hanja character is used in Korean. Its Korean keyword meaning is: {hun_english}\n"
    "In one short phrase in Chinese (Simplified), briefly note how this character's "
    "meaning in Korean relates to or differs from its usage in modern Chinese. "
    "Return only the Chinese phrase, nothing else."
)

DEFAULT_PROMPT = (
    "Translate this hanja character keyword meaning into {language}. "
    "It is a single short keyword or phrase (1-4 words) used as a mnemonic meaning "
    "for a Chinese character used in Korean. "
    "Korean keyword: {hun_english}\n"
    "Return only the translated keyword, nothing else. No punctuation unless essential."
)

def make_request_id(character: str, eum: str, lang: str) -> str:
    char_cp = ord(character)
    eum_cp = ord(eum) if len(eum) == 1 else sum(ord(c) for c in eum)
    return f"char_{char_cp}_{eum_cp}_{lang}"


def build_requests(entries: list[dict]) -> list[dict]:
    requests = []
    for entry in entries:
        character = entry["character"]
        eum = entry["eum"]
        hun_english = entry.get("hun_english", "").strip()
        if not hun_english:
            continue  # skip entries with no English keyword

        for lang, language_name in LANGUAGES.items():
            if lang == "zh":
                prompt = ZH_PROMPT.format(hun_english=hun_english)
            else:
                prompt = DEFAULT_PROMPT.format(
                    language=language_name,
                    hun_english=hun_english,
                )

            requests.append({
                "custom_id": make_request_id(character, eum, lang),
                "params": {
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 50,
                    "messages": [{"role": "user", "content": prompt}],
                },
            })

    return requests


def submit(client: anthropic.Anthropic, entries: list[dict]) -> str:
    requests = build_requests(entries)
    print(f"Submitting {len(requests)} requests ({len(entries)} characters × {len(LANGUAGES)} languages)...")

    batch = client.messages.batches.create(requests=requests)
    batch_id = batch.id
    BATCH_ID_FILE.write_text(batch_id)
    print(f"Batch submitted: {batch_id}")
    print(f"Batch ID saved to {BATCH_ID_FILE}")
    print("Check status at https://console.anthropic.com or run --collect when done.")
    return batch_id


def collect(client: anthropic.Anthropic, batch_id: str) -> dict[str, str]:
    batch = client.messages.batches.retrieve(batch_id)
    print(f"Batch status: {batch.processing_status}")
    print(f"  succeeded: {batch.request_counts.succeeded}")
    print(f"  errored:   {batch.request_counts.errored}")
    print(f"  processing:{batch.request_counts.processing}")

    if batch.processing_status != "ended":
        print("Batch not complete yet. Re-run --collect later.")
        sys.exit(0)

    results: dict[str, str] = {}
    for result in client.messages.batches.results(batch_id):
        if result.result.type == "succeeded":
            text = result.result.message.content[0].text.strip()
            results[result.custom_id] = text
        else:
            print(f"  FAILED: {result.custom_id} — {result.result.type}")

    print(f"Collected {len(results)} successful translations.")
    return results


def merge(entries: list[dict], results: dict[str, str]) -> list[dict]:
    merged = []
    for entry in entries:
        character = entry["character"]
        eum = entry["eum"]
        new_entry = dict(entry)

        for lang in LANGUAGES:
            request_id = make_request_id(character, eum, lang)
            translation = results.get(request_id)
            if translation:
                new_entry[f"hun_{lang}"] = translation
            else:
                # Fall back to English if translation missing
                new_entry[f"hun_{lang}"] = entry.get("hun_english", "")

        merged.append(new_entry)

    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Translate hanja character keywords via Batch API")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--submit", action="store_true", help="Submit batch job")
    group.add_argument("--collect", metavar="BATCH_ID", help="Collect results for batch ID")
    group.add_argument("--merge", metavar="BATCH_ID", help="Collect + merge into output JSON")
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

    print(f"Loaded {len(entries)} character entries from {INPUT_PATH}")

    if args.submit:
        submit(client, entries)

    elif args.collect:
        results = collect(client, args.collect)
        results_path = SCRIPTS_DIR / f".hanja_characters_results_{args.collect}.json"
        results_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(f"Results saved to {results_path}")

    elif args.merge:
        results_path = SCRIPTS_DIR / f".hanja_characters_results_{args.merge}.json"
        if not results_path.exists():
            # Try collecting first
            results = collect(client, args.merge)
            results_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        else:
            with results_path.open("r", encoding="utf-8") as f:
                results = json.load(f)

        merged = merge(entries, results)

        with OUTPUT_PATH.open("w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)

        print(f"Merged output written to {OUTPUT_PATH}")
        print("Next: update build_hanja_db.py to read the new hun_* columns and add them to hanja_characters table.")


if __name__ == "__main__":
    main()
