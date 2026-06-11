#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMP_GZ="$SCRIPT_DIR/kaikki.org-dictionary-English.jsonl.gz"
DUMP_JSONL="$SCRIPT_DIR/kaikki.org-dictionary-English.jsonl"

if [[ -f "$DUMP_JSONL" ]]; then
  echo "Kaikki English JSONL already exists: $DUMP_JSONL"
  exit 0
fi

if [[ ! -f "$DUMP_GZ" ]]; then
  if command -v wget >/dev/null 2>&1; then
    wget -O "$DUMP_GZ" "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
  elif command -v curl >/dev/null 2>&1; then
    curl -L --fail --retry 3 -o "$DUMP_GZ" "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
  else
    echo "Neither wget nor curl is installed. Install one of them and rerun this script." >&2
    exit 1
  fi
fi

gunzip "$DUMP_GZ"
echo "Downloaded and extracted: $DUMP_JSONL"
