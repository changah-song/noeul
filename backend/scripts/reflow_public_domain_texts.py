#!/usr/bin/env python3
"""Reflow the bundled Korean public-domain texts into clean paragraphs.

Why: many of the source files are hard-wrapped at a fixed width (~40-54
characters), often in the middle of a word. The app (publicDomainBooks.js)
splits paragraphs only at blank lines and joins the lines inside one with a
space, so a wrapped word like 심해지\\n기는 reached readers as "심해지 기는",
and lookups on it broke. Files without blank lines also became one giant
paragraph, which left chapter 1 holding only the title and author (a near-empty
title page that read "100%").

This rewrites each Korean book as one paragraph per line with a blank line
between paragraphs:

- Hard-wrapped files: a line continues the previous paragraph unless it's
  blank, indented, or follows a short (non-full-width) line. At each
  continuation, Kiwi decides from the surrounding characters whether the break
  stood for a space or fell mid-word. Only the break is decided; every other
  space stays exactly as the source has it.
- One-line-per-paragraph files: each line becomes its own paragraph.
- Leading title/author lines are dropped: the reader already renders the title
  and author as the book's heading.

Every file is checked to contain exactly the same non-whitespace characters as
before (apart from the dropped title/author lines).

Run from the backend venv (kiwipiepy required):

    backend/.venv/bin/python backend/scripts/reflow_public_domain_texts.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from kiwipiepy import Kiwi

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DOMAIN_DIR = REPO_ROOT / "frontend" / "assets" / "data" / "public-domain"
CATALOG_PATH = PUBLIC_DOMAIN_DIR / "catalog.js"
BOOKS_DIR = PUBLIC_DOMAIN_DIR / "books"

HANGUL = re.compile(r"[가-힣]")
INDENT = (" ", "\t", "　")
JOIN_CONTEXT = 12  # characters of context on each side of a line break

# One catalog entry: title, author and the text file it points at.
CATALOG_ENTRY = re.compile(
    r"title:\s*'(?P<title>[^']*)',\s*author:\s*'(?P<author>[^']*)',"
    r"[\s\S]*?textAsset:\s*require\('\./books/(?P<file>[^']+)'\)"
)


def catalog_entries() -> dict[str, tuple[str, str]]:
    text = CATALOG_PATH.read_text(encoding="utf-8")
    return {m["file"]: (m["title"], m["author"]) for m in CATALOG_ENTRY.finditer(text)}


def squash(value: str) -> str:
    return re.sub(r"[\s<>《》〈〉「」『』()\[\]]", "", value)


def is_hard_wrapped(lines: list[str]) -> tuple[bool, int]:
    lengths = sorted(len(line.rstrip()) for line in lines if line.strip())
    if not lengths:
        return False, 0
    width = lengths[int(len(lengths) * 0.9)]
    near_full = sum(1 for n in lengths if n >= width - 3) / len(lengths)
    # Wrapped prose: a narrow column most lines fill. Paragraph-per-line files
    # have a long tail of long lines and few lines near the 90th percentile.
    return width <= 60 and near_full >= 0.3, width


def break_is_space(kiwi: Kiwi, before: str, after: str) -> bool:
    """Did this line break stand for a space? Ask Kiwi about the join only."""
    if not before or not after:
        return True
    # Breaks next to non-Hangul (punctuation, quotes, Latin) are word breaks,
    # except a closing bracket followed by a particle, e.g. 신조(信條)에.
    if not HANGUL.match(after[0]):
        return True
    if not HANGUL.match(before[-1]) and before[-1] not in ")]」』":
        return True
    left = before[-JOIN_CONTEXT:]
    right = after[:JOIN_CONTEXT]
    spaced = kiwi.space(left + right, reset_whitespace=False)
    # Find where the join landed in Kiwi's output: walk the same number of
    # non-space characters as `left` holds, then see if a space follows.
    target = len(left.replace(" ", ""))
    seen = 0
    for index, char in enumerate(spaced):
        if char != " ":
            seen += 1
        if seen == target:
            return index + 1 < len(spaced) and spaced[index + 1] == " "
    return True


def reflow_wrapped(kiwi: Kiwi, lines: list[str], width: int) -> tuple[list[str], int, int]:
    paragraphs: list[str] = []
    current = ""
    previous_length = 0
    joined_with_space = joined_mid_word = 0
    for raw in lines:
        if not raw.strip():
            if current:
                paragraphs.append(current)
            current, previous_length = "", 0
            continue
        line = raw.strip()
        starts_paragraph = (
            not current
            or raw.startswith(INDENT)
            or previous_length < width - 6
        )
        if starts_paragraph:
            if current:
                paragraphs.append(current)
            current = line
        elif break_is_space(kiwi, current, line):
            current = f"{current} {line}"
            joined_with_space += 1
        else:
            current = f"{current}{line}"
            joined_mid_word += 1
        previous_length = len(raw.rstrip())
    if current:
        paragraphs.append(current)
    return paragraphs, joined_with_space, joined_mid_word


def drop_title_lines(paragraphs: list[str], title: str, author: str) -> tuple[list[str], list[str]]:
    """Drop leading short paragraphs that only repeat the title and/or author."""
    names = {squash(title), squash(author)} - {""}
    dropped = []
    while paragraphs and len(paragraphs[0]) <= 40:
        head = squash(paragraphs[0])
        remainder = head
        for name in sorted(names, key=len, reverse=True):
            remainder = remainder.replace(name, "")
        if head and not remainder:
            dropped.append(paragraphs.pop(0))
        else:
            break
    return paragraphs, dropped


def main() -> None:
    kiwi = Kiwi()
    entries = catalog_entries()
    changed = 0
    for path in sorted(BOOKS_DIR.glob("*.txt")):
        original = path.read_text(encoding="utf-8").replace("\r\n", "\n").lstrip("﻿")
        if not HANGUL.search(original):
            continue
        title, author = entries.get(path.name, ("", ""))
        lines = original.split("\n")
        wrapped, width = is_hard_wrapped(lines)
        if wrapped:
            paragraphs, spaced, mid_word = reflow_wrapped(kiwi, lines, width)
        else:
            paragraphs = [line.strip() for line in lines if line.strip()]
            spaced = mid_word = 0
        paragraphs, dropped = drop_title_lines(paragraphs, title, author)
        output = "\n\n".join(paragraphs) + "\n"

        # Safety: same characters as before, apart from the dropped headings.
        strip = lambda value: re.sub(r"\s", "", value)
        expected = strip(original)
        for heading in dropped:
            expected = expected.replace(strip(heading), "", 1)
        if strip(output) != expected:
            sys.exit(f"{path.name}: reflow changed the text's characters; nothing written")

        if output != original:
            path.write_text(output, encoding="utf-8")
            changed += 1
        layout = f"wrapped@{width}" if wrapped else "line-per-paragraph"
        print(
            f"{path.name}: {layout}, {len(paragraphs)} paragraphs, "
            f"{mid_word} mid-word joins, {spaced} space joins, dropped headings {dropped}"
        )
    print(f"\nrewrote {changed} files")


if __name__ == "__main__":
    main()
