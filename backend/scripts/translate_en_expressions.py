#!/usr/bin/env python3
"""Translate the multi-word expressions' gloss and senses (data/en_expressions.tsv,
written and reviewed by hand) into the other interface languages, into
data/en_expressions_i18n.tsv.

    GOOGLE_CLOUD_TRANSLATE_API_KEY=... python scripts/translate_en_expressions.py

The source is the reviewed meaning, never the bare headword: a phrase is not
the sum of its words ("give up" is not "give" + "up"). Each gloss item and
each sense is sent on its own:

  --source en (default)  gloss_en (the Korean gloss's meaning in plain English,
                         a paraphrase where the expression itself would come
                         out literal) and definition_en, which line up with the
                         Korean sense by sense.
  --source ko            gloss_ko and definition_ko, Korean to the target. Tried
                         first; Google mistranslates short Korean glosses out of
                         context far more often (돌보다 "look after" read as
                         돌 "stone" + 보다 "than"; 라면 좋을 텐데 as "ramen"),
                         so English is the default.

The "~" slot marks of the Korean ("~에도 불구하고") are dropped before sending.

Rows marked `hand` in the output file are corrections made by hand and are
never overwritten. A rerun translates only what is missing, unless --refresh
is given (which still keeps the hand rows). build_en_learner_dict.py reads the
file into en_learner.db (en_equivalents and en_sense_translations).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
import en_expressions  # noqa: E402

GOOGLE_URL = "https://translation.googleapis.com/language/translate/v2"
GOOGLE_TARGETS = {"zh": "zh-CN", "zh-Hant": "zh-TW"}
BATCH_ITEMS = 100


def source_text(text: str) -> str:
    """The text as sent: without the Korean "~" slot marks."""
    return re.sub(r"\s+", " ", text.replace("~", " ")).strip()


def clean_translation(text: str) -> str:
    text = text.replace("&#39;", "'").replace("&quot;", '"').replace("&amp;", "&")
    return re.sub(r"\s+", " ", text.replace("~", " ")).strip()


def translate(texts: list[str], source: str, target: str, key: str) -> list[str]:
    out: list[str] = []
    for start in range(0, len(texts), BATCH_ITEMS):
        batch = texts[start:start + BATCH_ITEMS]
        body = json.dumps({"q": batch, "source": source, "target": target, "format": "text"}).encode()
        request = urllib.request.Request(
            f"{GOOGLE_URL}?key={key}", data=body, headers={"content-type": "application/json"}, method="POST"
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = json.load(response)
                out += [clean_translation(item["translatedText"]) for item in payload["data"]["translations"]]
                break
            except urllib.error.HTTPError as error:
                if error.code in (429, 500, 503) and attempt < 3:
                    time.sleep(2 ** attempt * 5)
                    continue
                raise SystemExit(f"translation failed: HTTP {error.code} {error.read().decode()[:300]}")
        else:
            raise SystemExit("translation failed after retries")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=en_expressions.TRANSLATIONS_PATH)
    parser.add_argument("--lang", action="append", help="only these languages (default: all)")
    parser.add_argument("--refresh", action="store_true", help="retranslate machine rows too")
    parser.add_argument("--source", choices=("en", "ko"), default="en")
    parser.add_argument("--only", help="comma-separated expressions to (re)translate, e.g. after editing gloss_en")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    def source_items(expression: en_expressions.Expression) -> tuple[tuple[str, ...], tuple[str, ...]]:
        if args.source == "ko":
            return expression.gloss_ko, expression.senses_ko
        return expression.gloss_en, expression.senses_en

    expressions = en_expressions.load_expressions()
    rows = {(row.expression, row.language): row for row in en_expressions.read_translation_rows(args.out)}
    languages = args.lang or list(en_expressions.TRANSLATED_LANGUAGES)
    only = {text.strip() for text in (args.only or "").split(",") if text.strip()}

    jobs: dict[str, list[en_expressions.Expression]] = {}
    for language in languages:
        for expression in expressions:
            if only and expression.text not in only:
                continue
            existing = rows.get((expression.text, language))
            if existing and (existing.source == "hand" or not (args.refresh or only)):
                continue
            jobs.setdefault(language, []).append(expression)

    texts_per_language = {
        language: [source_text(text) for expression in todo for text in (*source_items(expression)[0], *source_items(expression)[1])]
        for language, todo in jobs.items()
    }
    chars = sum(len(text) for texts in texts_per_language.values() for text in texts)
    calls = sum(-(-len(texts) // BATCH_ITEMS) for texts in texts_per_language.values())
    print(f"[translate_en_expressions] {sum(len(t) for t in jobs.values())} expression rows, "
          f"{chars:,} characters in {calls} requests (~${chars / 1e6 * 20:.2f} at $20/M)")
    if args.dry_run or not jobs:
        return 0
    key = os.environ.get("GOOGLE_CLOUD_TRANSLATE_API_KEY", "")
    if not key:
        raise SystemExit("GOOGLE_CLOUD_TRANSLATE_API_KEY is not set")

    for language, todo in jobs.items():
        translated = iter(translate(
            texts_per_language[language], args.source, GOOGLE_TARGETS.get(language, language), key,
        ))
        for expression in todo:
            gloss_source, senses_source = source_items(expression)
            gloss = [next(translated) for _ in gloss_source]
            senses = [next(translated) for _ in senses_source]
            rows[(expression.text, language)] = en_expressions.TranslationRow(
                expression=expression.text,
                language=language,
                gloss=tuple(dict.fromkeys(item for item in gloss if item)),
                senses=tuple(senses),
                source="machine",
                note="" if args.source == "en" else "from the Korean",
            )
        print(f"  {language}: {len(todo)}", flush=True)

    en_expressions.write_translation_rows(args.out, rows.values(), [e.text for e in expressions])
    return 0


if __name__ == "__main__":
    sys.exit(main())
