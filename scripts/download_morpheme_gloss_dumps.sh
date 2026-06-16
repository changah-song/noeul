#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

download_if_missing() {
  local label="$1"
  local url="$2"
  local output="$3"

  if [[ -f "$output" || -f "$output.gz" ]]; then
    echo "Kaikki $label JSONL already exists: $output"
    return
  fi

  echo "Downloading Kaikki $label JSONL to $output"
  if command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  elif command -v curl >/dev/null 2>&1; then
    curl -L --fail --retry 3 -o "$output" "$url"
  else
    echo "Neither wget nor curl is installed. Install one of them and rerun this script." >&2
    exit 1
  fi
}

download_if_missing \
  "Latin" \
  "https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl" \
  "$SCRIPT_DIR/kaikki.org-dictionary-Latin.jsonl"

download_if_missing \
  "Ancient Greek" \
  "https://kaikki.org/dictionary/Ancient%20Greek/kaikki.org-dictionary-AncientGreek.jsonl" \
  "$SCRIPT_DIR/kaikki.org-dictionary-AncientGreek.jsonl"

echo "Kaikki morpheme gloss source dumps are ready."
