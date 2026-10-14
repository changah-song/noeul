#!/usr/bin/env python3
"""Rejoin the sentence fragments in the bundled Chinese public-domain texts.

The Chinese books came from Wikisource pages where every linked name (鲁镇,
咸亨酒店, 孔乙己, 阿Q ...) became its own paragraph when the HTML was turned
into text. The reader shows each paragraph on its own line, so sentences break
mid-way:

    我从十二岁起，便在镇口的 / 咸亨酒店 / 里当伙计，...

This rejoins those fragments. Chinese has no spaces between words, so joining
only removes paragraph breaks; every file is checked to contain exactly the
same characters as before.

A paragraph joins the one before it when that one does not end a sentence.
Headings always stand alone: chapter markers (第一章…, 一, 二, 自序) and, in
呐喊, the story titles where they actually start a story.

Run from the repo root:  python3 backend/scripts/rejoin_chinese_link_fragments.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BOOKS_DIR = REPO_ROOT / "frontend" / "assets" / "data" / "public-domain" / "books"

FILES = [
    "ah_q_true_story.txt",
    "kong_yiji_lu_xun.txt",
    "madmans_diary_lu_xun.txt",
    "na_han_lu_xun.txt",
]

# Characters a finished paragraph (sentence) ends with.
TERMINAL = set("。！？…」』”）)》")

CHAPTER_HEADING = re.compile(r"^(第[一二三四五六七八九十百]+章.*|[一二三四五六七八九十]+|自序)$")
# A story ends with a date line such as （一九一八年四月。） or 一九二二年十月.
STORY_END = re.compile(r"^[（(].*[）)]$|^[一二三四五六七八九〇零]+年[一二三四五六七八九十]+月")

# Story titles in 呐喊. Most of them also occur inside the text as linked
# names (孔乙己, 阿Q正传 ...), so a title only counts as a heading right after a
# story ends, or when it occurs just once in the book.
NA_HAN_TITLES = {
    "狂人日记", "孔乙己", "药", "明天", "一件小事", "头发的故事", "风波", "故乡",
    "阿Q正传", "端午节", "白光", "兔和猫", "鸭的喜剧", "社戏",
}
STORY_TITLES = {"na_han_lu_xun.txt": NA_HAN_TITLES}


def headings(name: str, paragraphs: list[str]) -> set[int]:
    titles = STORY_TITLES.get(name, set())
    counts: dict[str, int] = {}
    for paragraph in paragraphs:
        counts[paragraph] = counts.get(paragraph, 0) + 1

    found = set()
    for index, paragraph in enumerate(paragraphs):
        if CHAPTER_HEADING.match(paragraph):
            found.add(index)
        elif paragraph in titles:
            previous = paragraphs[index - 1] if index > 0 else ""
            after_story = index == 0 or STORY_END.match(previous) or previous.endswith(("）", ")"))
            finished = not previous or previous[-1] in TERMINAL
            if after_story or (finished and counts[paragraph] == 1):
                found.add(index)
    return found


def rejoin(name: str, paragraphs: list[str]) -> list[str]:
    heading_indexes = headings(name, paragraphs)
    groups: list[str] = []
    current: str | None = None

    for index, paragraph in enumerate(paragraphs):
        if index in heading_indexes:
            if current is not None:
                groups.append(current)
                current = None
            groups.append(paragraph)
            continue
        if current is not None and current[-1] not in TERMINAL:
            current += paragraph
        else:
            if current is not None:
                groups.append(current)
            current = paragraph

    if current is not None:
        groups.append(current)
    return groups


def main() -> None:
    for name in FILES:
        path = BOOKS_DIR / name
        original = path.read_text(encoding="utf-8")
        paragraphs = [p.strip() for p in original.split("\n\n") if p.strip()]
        joined = rejoin(name, paragraphs)
        output = "\n\n".join(joined) + "\n"

        strip = lambda value: re.sub(r"\s", "", value)
        if strip(output) != strip(original):
            sys.exit(f"{name}: rejoining changed the text's characters; nothing written")

        if output != original:
            path.write_text(output, encoding="utf-8")
        print(f"{name}: {len(paragraphs)} -> {len(joined)} paragraphs")


if __name__ == "__main__":
    main()
