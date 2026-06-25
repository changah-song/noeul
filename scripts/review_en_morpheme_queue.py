#!/usr/bin/env python3
"""
Review English morpheme decomposition candidates with the Anthropic Batch API.

Input:  scripts/en_morpheme_review_queue.jsonl
Output: scripts/en_morpheme_review_decisions.jsonl

Usage:
  1. Set ANTHROPIC_API_KEY in your environment.
  2. Preview selected queue rows:
       python scripts/review_en_morpheme_queue.py --count
  3. Submit the AI review batch:
       python scripts/review_en_morpheme_queue.py --submit
  4. Check status:
       python scripts/review_en_morpheme_queue.py --status
  5. Merge completed AI results into review decisions:
       python scripts/review_en_morpheme_queue.py --merge
  6. Import approved rows:
       python scripts/build_en_dict_db.py --import-morpheme-review-decisions --dry-run
       python scripts/build_en_dict_db.py --import-morpheme-review-decisions

Only model approvals with high confidence become "approve" rows by default. Medium
model approvals are kept as "pending" so the database importer ignores them.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"
DEFAULT_QUEUE_PATH = SCRIPTS_DIR / "en_morpheme_review_queue.jsonl"
DEFAULT_RETRY_QUEUE_PATH = SCRIPTS_DIR / "en_morpheme_review_retry_queue.jsonl"
DEFAULT_DECISIONS_PATH = SCRIPTS_DIR / "en_morpheme_review_decisions.jsonl"
DEFAULT_BATCH_ID_FILE = SCRIPTS_DIR / ".en_morpheme_review_batch_ids.json"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
MAX_BATCH_REQUESTS = 95_000
MAX_PROMPT_TEXT_CHARS = 1200

CUSTOM_ID_WORD_RE = re.compile(r"[^a-z0-9]+")
FENCED_JSON_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.IGNORECASE | re.DOTALL)


REVIEW_INSTRUCTIONS = """You are reviewing one proposed English word breakdown for a reading app.

The app decomposes an English word into familiar prefixes, suffixes, free bases, and curated Latin/Greek bound roots. The goal is a short, educational breakdown that is both morphologically plausible and useful for a reader.

Decision rules:
- Candidate rank 0 is the proposed best candidate. Approve it only when it is a high-confidence breakdown of this word.
- Use etymology as strong evidence when present. Definition compatibility is useful evidence, but spelling alone is not enough.
- Reject candidates that are accidental spellings, over-segmented in a misleading way, or semantically unrelated to the word.
- If rank 0 is not right but one listed competing candidate is clearly better, use approve_competing and give that candidate's rank.
- If the answer needs human judgment, use unsure. Do not approve medium-confidence guesses.
- Do not invent a new decomposition. Choose only from the listed candidates.

Return exactly one JSON object and no prose:
{
  "decision": "approve" | "approve_competing" | "reject" | "unsure",
  "confidence": "high" | "medium" | "low",
  "approved_candidate_rank": 0,
  "reason": "one concise sentence"
}

For reject or unsure, set approved_candidate_rank to null.
"""


def read_jsonl(path: Path):
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                yield line_number, json.loads(stripped)
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSON at {path}:{line_number}: {error}") from error


def selected_queue_records(
    queue_path: Path,
    start_line: int = 1,
    limit: int = 0,
    reasons: set[str] | None = None,
) -> list[tuple[int, dict[str, Any]]]:
    if not queue_path.exists():
        raise FileNotFoundError(f"Review queue not found: {queue_path}")

    records: list[tuple[int, dict[str, Any]]] = []
    for line_number, record in read_jsonl(queue_path):
        if line_number < start_line:
            continue
        if reasons and record.get("reason") not in reasons:
            continue
        records.append((line_number, record))
        if limit and len(records) >= limit:
            break
    return records


def make_request_id(line_number: int, record: dict[str, Any]) -> str:
    word = str(record.get("word") or "word").lower()
    word_slug = CUSTOM_ID_WORD_RE.sub("_", word).strip("_")[:24] or "word"
    return f"morph_{line_number:06d}_{word_slug}"


def compact_text(value: Any, max_chars: int = MAX_PROMPT_TEXT_CHARS) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars].rsplit(' ', 1)[0].rstrip()}..."


def compact_part(part: dict[str, Any]) -> dict[str, Any]:
    compact = {
        "display": part.get("display"),
        "type": part.get("type"),
    }
    for key in ("meaning", "canonical", "note"):
        if part.get(key):
            compact[key] = part[key]
    return {key: value for key, value in compact.items() if value not in (None, "")}


def compact_candidate(rank: int, candidate: dict[str, Any]) -> dict[str, Any]:
    compact = {
        "rank": rank,
        "source_text": candidate.get("source_text"),
        "score": candidate.get("score"),
        "central_type": candidate.get("central_type"),
        "central_spelling": candidate.get("central_spelling"),
        "suffix_spellings": candidate.get("suffix_spellings") or [],
        "parts": [
            compact_part(part)
            for part in candidate.get("parts") or []
            if isinstance(part, dict)
        ],
    }
    return {key: value for key, value in compact.items() if value not in (None, "", [])}


def candidate_list(record: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    best = record.get("best_candidate")
    if isinstance(best, dict):
        candidates.append(best)
    for candidate in record.get("competing_candidates") or []:
        if isinstance(candidate, dict):
            candidates.append(candidate)
    return candidates


def compact_review_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "word": record.get("word"),
        "part_of_speech": record.get("pos"),
        "queue_reason": record.get("reason"),
        "score": record.get("score"),
        "margin": record.get("margin"),
        "candidate_count": record.get("candidate_count"),
        "definition": compact_text(record.get("definition")),
        "etymology": compact_text(record.get("etymology")),
        "candidates": [
            compact_candidate(rank, candidate)
            for rank, candidate in enumerate(candidate_list(record))
        ],
    }


def build_prompt(record: dict[str, Any]) -> str:
    payload = compact_review_payload(record)
    return (
        f"{REVIEW_INSTRUCTIONS}\n\n"
        "Review record:\n"
        f"{json.dumps(payload, ensure_ascii=False, sort_keys=True)}"
    )


def build_requests(
    records: list[tuple[int, dict[str, Any]]],
    model: str,
) -> list[dict[str, Any]]:
    requests = []
    for line_number, record in records:
        requests.append({
            "custom_id": make_request_id(line_number, record),
            "params": {
                "model": model,
                "max_tokens": 240,
                "temperature": 0,
                "messages": [
                    {
                        "role": "user",
                        "content": build_prompt(record),
                    }
                ],
            },
        })
    return requests


def load_anthropic_client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    try:
        import anthropic
    except ModuleNotFoundError:
        print("Error: Python package 'anthropic' is not installed in this environment")
        sys.exit(1)

    return anthropic.Anthropic(api_key=api_key)


def load_batch_id_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"runs": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {
            "runs": [
                {
                    "created_at": None,
                    "batches": [
                        {"id": batch_id}
                        for batch_id in data
                    ],
                }
            ]
        }
    if isinstance(data, str):
        return {
            "runs": [
                {
                    "created_at": None,
                    "batches": [{"id": data}],
                }
            ]
        }
    if isinstance(data, dict):
        if "runs" in data:
            return data
        if "batches" in data:
            return {"runs": [data]}
    raise ValueError(f"Unrecognized batch id file format: {path}")


def save_batch_run(
    path: Path,
    queue_path: Path,
    model: str,
    selected_count: int,
    batch_infos: list[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = load_batch_id_file(path)
    data.setdefault("runs", []).append({
        "created_at": datetime.now(timezone.utc).isoformat(),
        "queue_path": str(queue_path),
        "model": model,
        "selected_count": selected_count,
        "batches": batch_infos,
    })
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_batch_ids(batch_ids: list[str] | None, batch_id_file: Path) -> list[str]:
    if batch_ids:
        return batch_ids
    if not batch_id_file.exists():
        raise FileNotFoundError(f"No batch id file found: {batch_id_file}")
    data = load_batch_id_file(batch_id_file)
    runs = data.get("runs") or []
    if not runs:
        raise ValueError(f"No batch runs found in {batch_id_file}")
    latest = runs[-1]
    ids = [
        str(batch["id"])
        for batch in latest.get("batches") or []
        if isinstance(batch, dict) and batch.get("id")
    ]
    if not ids:
        raise ValueError(f"No batch ids found in latest run in {batch_id_file}")
    return ids


def request_chunks(requests: list[dict[str, Any]], chunk_size: int = MAX_BATCH_REQUESTS) -> list[list[dict[str, Any]]]:
    return [
        requests[index:index + chunk_size]
        for index in range(0, len(requests), chunk_size)
    ]


def submit(args: argparse.Namespace) -> None:
    records = selected_queue_records(
        Path(args.queue_path),
        start_line=args.start_line,
        limit=args.limit,
        reasons=set(args.reason or []),
    )
    requests = build_requests(records, args.model)
    if not requests:
        print("No review queue rows selected.")
        return

    chunks = request_chunks(requests, args.chunk_size)
    print(f"Selected {len(records):,} review rows.")
    print(f"Built {len(requests):,} batch requests in {len(chunks):,} batch(es).")
    print(f"Model: {args.model}")

    if args.dry_run:
        first = requests[0]
        print(f"Dry run only. First request id: {first['custom_id']}")
        return

    client = load_anthropic_client()
    batch_infos: list[dict[str, Any]] = []
    for chunk_index, chunk in enumerate(chunks, start=1):
        batch = client.messages.batches.create(requests=chunk)
        batch_infos.append({
            "id": batch.id,
            "request_count": len(chunk),
        })
        print(f"Submitted batch {chunk_index:,}/{len(chunks):,}: {batch.id} ({len(chunk):,} requests)")

    save_batch_run(
        Path(args.batch_id_file),
        Path(args.queue_path),
        args.model,
        len(records),
        batch_infos,
    )
    print(f"Batch IDs saved to {args.batch_id_file}")
    print("Run this later to check progress: python scripts/review_en_morpheme_queue.py --status")


def print_count(args: argparse.Namespace) -> None:
    records = selected_queue_records(
        Path(args.queue_path),
        start_line=args.start_line,
        limit=args.limit,
        reasons=set(args.reason or []),
    )
    reason_counts = Counter(record.get("reason") for _, record in records)
    confidence_counts = Counter(record.get("suggested_confidence") for _, record in records)
    print(f"Selected {len(records):,} review rows from {args.queue_path}")
    if records:
        print("Reasons:")
        for reason, count in sorted(reason_counts.items()):
            print(f"  {reason}: {count:,}")
        print("Suggested confidence:")
        for confidence, count in sorted(confidence_counts.items()):
            print(f"  {confidence}: {count:,}")
        first_line, first_record = records[0]
        print(f"First request id: {make_request_id(first_line, first_record)}")


def status(args: argparse.Namespace) -> None:
    client = load_anthropic_client()
    batch_ids = resolve_batch_ids(args.batch_id, Path(args.batch_id_file))

    while True:
        all_ended = True
        for batch_id in batch_ids:
            batch = client.messages.batches.retrieve(batch_id)
            counts = batch.request_counts
            if batch.processing_status != "ended":
                all_ended = False
            print(
                f"{batch_id}: {batch.processing_status} "
                f"(succeeded={counts.succeeded}, errored={counts.errored}, "
                f"processing={counts.processing}, canceled={counts.canceled}, "
                f"expired={counts.expired})"
            )
            print(f"  created_at: {getattr(batch, 'created_at', None)}")
            print(f"  expires_at: {getattr(batch, 'expires_at', None)}")
            print(f"  ended_at:   {getattr(batch, 'ended_at', None)}")
            print(f"  cancel_initiated_at: {getattr(batch, 'cancel_initiated_at', None)}")
            print(f"  results_url:{' ready' if getattr(batch, 'results_url', None) else ' not ready'}")

        if not args.watch or all_ended:
            return

        print(f"Waiting {args.poll_seconds} seconds before polling again...")
        time.sleep(args.poll_seconds)


def cancel(args: argparse.Namespace) -> None:
    client = load_anthropic_client()
    batch_ids = resolve_batch_ids(args.batch_id, Path(args.batch_id_file))
    for batch_id in batch_ids:
        batch = client.messages.batches.cancel(batch_id)
        counts = batch.request_counts
        print(
            f"{batch_id}: {batch.processing_status} "
            f"(succeeded={counts.succeeded}, errored={counts.errored}, "
            f"processing={counts.processing}, canceled={counts.canceled}, "
            f"expired={counts.expired})"
        )
        print(f"  cancel_initiated_at: {getattr(batch, 'cancel_initiated_at', None)}")
    print("Poll until the canceled batch reaches ended:")
    print("  python scripts/review_en_morpheme_queue.py --status --watch")


def queue_index(queue_path: Path) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for line_number, record in read_jsonl(queue_path):
        indexed[make_request_id(line_number, record)] = record
    return indexed


def response_text_from_result(result: Any) -> str | None:
    message = getattr(result.result, "message", None)
    if message is None:
        return None
    content = getattr(message, "content", None) or []
    pieces = []
    for block in content:
        text = getattr(block, "text", None)
        if text:
            pieces.append(text)
    return "\n".join(pieces).strip() or None


def parse_model_json(text: str) -> dict[str, Any] | None:
    cleaned = text.strip()
    fenced = FENCED_JSON_RE.match(cleaned)
    if fenced:
        cleaned = fenced.group(1).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def normalize_confidence(value: Any) -> str:
    confidence = str(value or "").strip().lower()
    return confidence if confidence in {"high", "medium", "low"} else "low"


def normalize_decision(value: Any) -> str:
    decision = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "approve_best": "approve",
        "accept": "approve",
        "accept_best": "approve",
        "approve_other": "approve_competing",
        "accept_competing": "approve_competing",
        "reject_candidate": "reject",
        "no": "reject",
        "uncertain": "unsure",
        "pending": "unsure",
    }
    return aliases.get(decision, decision)


def model_candidate_rank(parsed: dict[str, Any], decision: str) -> int | None:
    raw_rank = parsed.get("approved_candidate_rank")
    if raw_rank is None:
        raw_rank = parsed.get("candidate_rank")
    if raw_rank is None and decision == "approve":
        return 0
    try:
        rank = int(raw_rank)
    except (TypeError, ValueError):
        return None
    return rank if rank >= 0 else None


def decision_record_base(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "word": record.get("word"),
        "pos": record.get("pos"),
        "reason": record.get("reason"),
        "score": record.get("score"),
        "margin": record.get("margin"),
        "candidate_count": record.get("candidate_count"),
        "definition": record.get("definition"),
        "etymology": record.get("etymology"),
        "best_candidate": record.get("best_candidate"),
        "competing_candidates": record.get("competing_candidates") or [],
    }


def decision_from_model_response(
    custom_id: str,
    record: dict[str, Any],
    response_text: str | None,
    model: str,
    accept_medium: bool = False,
) -> tuple[dict[str, Any], str]:
    decision_record = decision_record_base(record)
    decision_record.update({
        "decision": "pending",
        "review_model": model,
        "review_custom_id": custom_id,
        "review_note": "",
    })

    if not response_text:
        decision_record["review_note"] = "No model response text."
        return decision_record, "pending"

    parsed = parse_model_json(response_text)
    if parsed is None:
        decision_record["review_note"] = f"Could not parse model JSON: {response_text[:500]}"
        return decision_record, "pending"

    model_decision = normalize_decision(parsed.get("decision"))
    model_confidence = normalize_confidence(parsed.get("confidence"))
    rank = model_candidate_rank(parsed, model_decision)
    reason = compact_text(parsed.get("reason"), max_chars=500) or ""

    decision_record.update({
        "model_decision": model_decision,
        "model_confidence": model_confidence,
        "model_candidate_rank": rank,
        "review_note": reason,
    })

    if model_decision == "reject":
        decision_record["decision"] = "reject"
        return decision_record, "reject"

    if model_decision not in {"approve", "approve_competing"}:
        return decision_record, "pending"

    can_auto_approve = model_confidence == "high" or (
        accept_medium and model_confidence in {"high", "medium"}
    )
    if not can_auto_approve:
        if reason:
            decision_record["review_note"] = (
                f"Model returned {model_decision} with {model_confidence} confidence; "
                f"held for review. {reason}"
            )
        return decision_record, "pending"

    candidates = candidate_list(record)
    if rank is None or rank >= len(candidates):
        decision_record["review_note"] = (
            f"Model approval had invalid candidate rank {rank}. {reason}".strip()
        )
        return decision_record, "pending"

    if model_decision == "approve_competing" and rank == 0:
        decision_record["review_note"] = (
            f"Model used approve_competing but selected rank 0. {reason}".strip()
        )
        return decision_record, "pending"

    decision_record["decision"] = "approve"
    decision_record["approved_candidate_rank"] = rank
    decision_record["approved_candidate"] = candidates[rank]
    return decision_record, "approve"


def result_type(result: Any) -> str:
    return str(getattr(result.result, "type", "unknown"))


def collect_batch_results(args: argparse.Namespace) -> list[dict[str, Any]]:
    client = load_anthropic_client()
    batch_ids = resolve_batch_ids(args.batch_id, Path(args.batch_id_file))
    records_by_id = queue_index(Path(args.queue_path))
    all_decisions: list[dict[str, Any]] = []
    final_counts: Counter[str] = Counter()
    missing_queue_records = 0
    failed_results = 0

    for batch_id in batch_ids:
        batch = client.messages.batches.retrieve(batch_id)
        counts = batch.request_counts
        print(
            f"{batch_id}: {batch.processing_status} "
            f"(succeeded={counts.succeeded}, errored={counts.errored}, "
            f"processing={counts.processing})"
        )
        if batch.processing_status != "ended":
            print("Batch is not complete yet. Re-run --merge later.")
            sys.exit(0)

        for result in client.messages.batches.results(batch_id):
            record = records_by_id.get(result.custom_id)
            if record is None:
                missing_queue_records += 1
                continue

            if result_type(result) != "succeeded":
                failed_results += 1
                decision_record = decision_record_base(record)
                decision_record.update({
                    "decision": "pending",
                    "review_model": args.model,
                    "review_custom_id": result.custom_id,
                    "review_note": f"Batch result did not succeed: {result_type(result)}",
                })
                all_decisions.append(decision_record)
                final_counts["pending"] += 1
                continue

            decision_record, final_decision = decision_from_model_response(
                result.custom_id,
                record,
                response_text_from_result(result),
                args.model,
                accept_medium=args.accept_medium,
            )
            all_decisions.append(decision_record)
            final_counts[final_decision] += 1

    if missing_queue_records:
        print(f"Warning: {missing_queue_records:,} results did not match the current queue file.")
    if failed_results:
        print(f"Warning: {failed_results:,} batch results failed and were written as pending.")

    print(
        "Merged model decisions: "
        f"{final_counts['approve']:,} approve, "
        f"{final_counts['reject']:,} reject, "
        f"{final_counts['pending']:,} pending."
    )
    return all_decisions


def write_retry_queue_from_results(args: argparse.Namespace) -> None:
    client = load_anthropic_client()
    batch_ids = resolve_batch_ids(args.batch_id, Path(args.batch_id_file))
    records_by_id = queue_index(Path(args.queue_path))
    retry_path = Path(args.retry_queue_path)
    retry_path.parent.mkdir(parents=True, exist_ok=True)

    total_results = 0
    retry_records = 0
    result_counts: Counter[str] = Counter()
    missing_queue_records = 0

    if retry_path.exists() and not args.overwrite:
        print(f"Error: {retry_path} already exists. Use --overwrite to replace it.")
        sys.exit(1)

    with retry_path.open("w", encoding="utf-8") as handle:
        for batch_id in batch_ids:
            batch = client.messages.batches.retrieve(batch_id)
            counts = batch.request_counts
            print(
                f"{batch_id}: {batch.processing_status} "
                f"(succeeded={counts.succeeded}, errored={counts.errored}, "
                f"processing={counts.processing}, canceled={counts.canceled}, "
                f"expired={counts.expired})"
            )
            if batch.processing_status != "ended":
                print("Batch is not complete or fully canceled yet. Re-run after status is ended.")
                sys.exit(0)

            for result in client.messages.batches.results(batch_id):
                total_results += 1
                kind = result_type(result)
                result_counts[kind] += 1
                if kind == "succeeded":
                    continue

                record = records_by_id.get(result.custom_id)
                if record is None:
                    missing_queue_records += 1
                    continue

                retry_record = dict(record)
                retry_record["retry_source_batch_id"] = batch_id
                retry_record["retry_source_custom_id"] = result.custom_id
                retry_record["retry_source_result"] = kind
                handle.write(json.dumps(retry_record, ensure_ascii=False, sort_keys=True))
                handle.write("\n")
                retry_records += 1

    print(f"Scanned {total_results:,} batch results.")
    for kind, count in sorted(result_counts.items()):
        print(f"  {kind}: {count:,}")
    if missing_queue_records:
        print(f"Warning: {missing_queue_records:,} non-succeeded results did not match the queue file.")
    print(f"Wrote {retry_records:,} retry rows to {retry_path}.")
    if retry_records:
        print("Submit the retry queue with:")
        print(f"  python scripts/review_en_morpheme_queue.py --queue-path {retry_path} --submit")


def write_decisions(
    decisions: list[dict[str, Any]],
    output_path: Path,
    append: bool = False,
    overwrite: bool = False,
) -> None:
    if output_path.exists() and not append and not overwrite:
        print(
            f"Error: {output_path} already exists. Use --overwrite to replace it "
            "or --append to add to it."
        )
        sys.exit(1)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if append else "w"
    with output_path.open(mode, encoding="utf-8") as handle:
        for decision in decisions:
            handle.write(json.dumps(decision, ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    action = "Appended" if append else "Wrote"
    print(f"{action} {len(decisions):,} review decisions to {output_path}")


def merge(args: argparse.Namespace) -> None:
    decisions = collect_batch_results(args)
    write_decisions(
        decisions,
        Path(args.decisions_path),
        append=args.append,
        overwrite=args.overwrite,
    )
    print("Next dry run:")
    print("  python scripts/build_en_dict_db.py --import-morpheme-review-decisions --dry-run")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AI-review English morpheme review queue rows.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--count", action="store_true", help="Count queue rows selected for review.")
    group.add_argument("--submit", action="store_true", help="Submit selected rows to the Batch API.")
    group.add_argument("--status", action="store_true", help="Show status for submitted batch IDs.")
    group.add_argument("--cancel", action="store_true", help="Cancel submitted batch IDs.")
    group.add_argument("--merge", action="store_true", help="Collect completed batch results into decisions JSONL.")
    group.add_argument("--write-retry-queue", action="store_true", help="Write non-succeeded batch results to a retry queue.")
    parser.add_argument("--queue-path", default=str(DEFAULT_QUEUE_PATH), help="Input review queue JSONL path.")
    parser.add_argument("--retry-queue-path", default=str(DEFAULT_RETRY_QUEUE_PATH), help="Retry queue JSONL output path.")
    parser.add_argument("--decisions-path", default=str(DEFAULT_DECISIONS_PATH), help="Output decisions JSONL path.")
    parser.add_argument("--batch-id-file", default=str(DEFAULT_BATCH_ID_FILE), help="Batch ID state file path.")
    parser.add_argument("--batch-id", action="append", help="Batch ID to use instead of the latest saved run. Can repeat.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Anthropic model for review requests.")
    parser.add_argument("--limit", type=int, default=0, help="Limit selected queue rows. Use 0 for all.")
    parser.add_argument("--start-line", type=int, default=1, help="Start at this 1-based queue file line.")
    parser.add_argument("--chunk-size", type=int, default=MAX_BATCH_REQUESTS, help="Maximum requests per submitted batch.")
    parser.add_argument("--reason", action="append", help="Only select queue rows with this reason. Can repeat.")
    parser.add_argument("--dry-run", action="store_true", help="With --submit, build requests but do not submit.")
    parser.add_argument("--accept-medium", action="store_true", help="Convert medium-confidence model approvals to approve rows.")
    parser.add_argument("--append", action="store_true", help="With --merge, append to the decisions file.")
    parser.add_argument("--overwrite", action="store_true", help="With --merge, replace an existing decisions file.")
    parser.add_argument("--watch", action="store_true", help="With --status, poll until all batches have ended.")
    parser.add_argument("--poll-seconds", type=int, default=60, help="Polling interval for --status --watch.")
    args = parser.parse_args()

    if args.limit < 0:
        parser.error("--limit must be >= 0")
    if args.start_line < 1:
        parser.error("--start-line must be >= 1")
    if args.chunk_size < 1 or args.chunk_size > MAX_BATCH_REQUESTS:
        parser.error(f"--chunk-size must be between 1 and {MAX_BATCH_REQUESTS}")
    if args.append and args.overwrite:
        parser.error("--append and --overwrite cannot be used together")
    if args.dry_run and not args.submit:
        parser.error("--dry-run only applies to --submit")
    if args.accept_medium and not args.merge:
        parser.error("--accept-medium only applies to --merge")
    if args.append and not args.merge:
        parser.error("--append only applies to --merge")
    if args.overwrite and not (args.merge or args.write_retry_queue):
        parser.error("--overwrite only applies to --merge or --write-retry-queue")
    if args.watch and not args.status:
        parser.error("--watch only applies to --status")
    if args.poll_seconds < 10:
        parser.error("--poll-seconds must be >= 10")

    return args


def main() -> None:
    args = parse_args()
    try:
        if args.count:
            print_count(args)
        elif args.submit:
            submit(args)
        elif args.status:
            status(args)
        elif args.cancel:
            cancel(args)
        elif args.merge:
            merge(args)
        elif args.write_retry_queue:
            write_retry_queue_from_results(args)
    except (FileNotFoundError, ValueError) as error:
        print(f"Error: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
