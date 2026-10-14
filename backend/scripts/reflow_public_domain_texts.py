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
- Front and back matter listed in FRONT_MATTER (series headings, title lines
  that don't exactly match the catalog, translator credits and bios, footnote
  apparatus, source citations, page-rule dashes) is dropped. This also covers
  the Chinese books, which are otherwise left as they are (no reflow).

Every file is checked to contain exactly the same non-whitespace characters as
before (apart from the dropped headings and front/back matter).

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


ANDERSEN_HEAD = ("[Andersen 단편선]",)
# "역1": the translator credit plus footnote 1, which points at her bio below.
ANDERSEN_CREDIT = "김선희 역1"
ANDERSEN_BIO = (
    "옮긴이 약력 : 김선희는 한국외국어대학교를 졸업하고, 대학원에서 '외국어로서의 한국어 교육'을 공부했습니다. "
    "소설 『십자수』로 근로자문화예술제에서 대상을 받았으며, 뮌헨국제청소년도서관(IYL)에서 펠로십(Fellowship)으로 "
    "어린이 및 청소년 문학을 공부했습니다. 현재 <김선희's 언택트 번역교실>을 진행하며 번역가로 활동하고 있습니다. "
    "그동안 펴낸 책으로는 『토머스 모어가 상상한 꿈의 나라, 유토피아』 등이 있으며, 옮긴 책으로는 「윔피 키드」 "
    "「드래곤 길들이기」 「위저드 오브원스」 「멀린」 시리즈, 『생리를 시작한 너에게』 『팍스』 『두리틀 박사의 바다 여행』 "
    "『공부의 배신』 『난생처음 북클럽』 『베서니와 괴물의 묘약』등 200여 권이 있습니다."
)
ANDERSEN_TAIL = (
    ANDERSEN_BIO,
    "블로그 : https://blog.naver.com/thinkwalden",
    "인스타 : https://www.instagram.com/h_translator_sunhee/",
    "1 역자 약력은 원고 말미에 기재하였습니다.",
    "---------------",
    "------------------------------------------------------------",
    "--",
    "-1-",
)

# Exact paragraphs to drop, per file:
# - "head": dropped from the start, in order, while the first paragraph is the
#   next one listed (so a rerun drops nothing).
# - "tail": dropped from the end. Walking back from the last paragraph, every
#   paragraph in "tail" is dropped and every one in "keep" is stepped over and
#   kept; the walk stops at the first paragraph in neither.
# Anything that might be story text, or the author's own dating, is not listed.
FRONT_MATTER: dict[str, dict[str, tuple[str, ...]]] = {
    "little_match_girl.txt": {"head": (*ANDERSEN_HEAD, "성냥팔이 소녀", ANDERSEN_CREDIT), "tail": ANDERSEN_TAIL},
    "little_mermaid.txt": {
        "head": (*ANDERSEN_HEAD, "인어 공주", ANDERSEN_CREDIT),
        "tail": ANDERSEN_TAIL,
        # The translator's glosses for 삭구2 and 태피스트리3 in the story.
        "keep": (
            "2 배의 돛대·활대·돛 따위를 다루기 위한 밧줄·쇠사슬 등-옮긴이",
            "3 색색의 실로 수놓은 벽걸이나 실내장식용 비단",
        ),
    },
    "snow_queen.txt": {"head": (*ANDERSEN_HEAD, "눈의 여왕", ANDERSEN_CREDIT), "tail": ANDERSEN_TAIL},
    "thumbelina.txt": {
        "head": (*ANDERSEN_HEAD, "엄지 공주", ANDERSEN_CREDIT),
        "tail": ANDERSEN_TAIL,
        # The translator's gloss for 12페니2 in the story.
        "keep": ("2 옛 영국의 화폐단위 12페니가 1실링(shilling)이었다. _옮긴이",),
    },
    "ugly_duckling.txt": {"head": (*ANDERSEN_HEAD, "미운 아기 오리", ANDERSEN_CREDIT), "tail": ANDERSEN_TAIL},
    # Title lines that differ from the catalog title (hanja, brackets, spelling).
    "chisuk.txt": {"head": ("치숙(痴叔)",)},
    "city_and_ghost.txt": {"head": ("도시와 유령",)},
    "crime_and_punishment_lee_muyeong.txt": {
        "head": ("죄(罪)와 벌(罰)",),
        "tail": ("〈「 자유 문학 」24호, 1959년 3월 〉",),
    },
    "heosaengjeon.txt": {"head": ("許生傳[허생전]",)},
    "mister_bang.txt": {"head": ("미스터 방",), "tail": ("출전:대조2(1946.7)",)},
    "taepyeongcheonha.txt": {"head": ("太　平　天　下[태평천하]",)},
    "tears_of_blood.txt": {"head": ("혈(血)의 누(淚)",), "tail": ("출전:만세보(1906.7.22~1906.10.10)",)},
    "when_buckwheat_flowers_bloom.txt": {"head": ("메밀꽃 필 무렵",)},
    # Source citations at the end.
    "b_sagam_and_love_letter.txt": {
        "tail": ("(『조선문단』,1925. 2.)",),
        "keep": ("(1925년 1월 4일)",),  # the author's own dating
    },
    "butterflys_dream.txt": {"tail": ("<《어린이》, 1923년, 《소파 전집》(박문 서관 간) 대조>",)},
    "camellia_flower.txt": {"tail": ("출전:조광7(1936.5)",)},
    "gwangyeom_sonata.txt": {"tail": ("출전:중외일보(1929.1.1~12)",)},
    "potato.txt": {"tail": ("출전:조선문단 4(1925.1)",)},
    "spring_spring.txt": {"tail": ("출전:조광2(1935.12)",)},
    # Chinese books: title (and author) lines; na_han's 自序 heading is doubled.
    "ah_q_true_story.txt": {"head": ("阿Q正传",)},
    "chen_lun_yu_dafu.txt": {"head": ("沉沦_(郁达夫)",)},
    "kong_yiji_lu_xun.txt": {"head": ("孔乙己",)},
    "madmans_diary_lu_xun.txt": {"head": ("狂人日记",)},
    "na_han_lu_xun.txt": {"head": ("自序",), "keep": ("自序",)},
}


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


def drop_front_matter(
    paragraphs: list[str], spec: dict[str, tuple[str, ...]]
) -> tuple[list[str], list[str], list[str]]:
    """Drop the exact front/back-matter paragraphs FRONT_MATTER lists for a file.

    Returns the remaining paragraphs, the dropped leading ones (in order) and
    the dropped trailing ones (last paragraph first).
    """
    paragraphs = list(paragraphs)
    head_dropped: list[str] = []
    tail, keep = set(spec.get("tail", ())), set(spec.get("keep", ()))
    for heading in spec.get("head", ()):
        if not paragraphs or paragraphs[0] != heading:
            continue
        # A heading also listed in "keep" is a doubled one: drop only the
        # extra copy, so reruns leave the other in place.
        if heading in keep and (len(paragraphs) < 2 or paragraphs[1] != heading):
            continue
        head_dropped.append(paragraphs.pop(0))
    tail_dropped: list[str] = []
    index = len(paragraphs) - 1
    while index >= 0 and (paragraphs[index] in tail or paragraphs[index] in keep):
        if paragraphs[index] in tail:
            tail_dropped.append(paragraphs.pop(index))
        index -= 1
    return paragraphs, head_dropped, tail_dropped


def main() -> None:
    kiwi = Kiwi()
    entries = catalog_entries()
    changed = 0
    for path in sorted(BOOKS_DIR.glob("*.txt")):
        original = path.read_text(encoding="utf-8").replace("\r\n", "\n").lstrip("﻿")
        spec = FRONT_MATTER.get(path.name, {})
        if HANGUL.search(original):
            title, author = entries.get(path.name, ("", ""))
            lines = original.split("\n")
            wrapped, width = is_hard_wrapped(lines)
            if wrapped:
                paragraphs, spaced, mid_word = reflow_wrapped(kiwi, lines, width)
            else:
                paragraphs = [line.strip() for line in lines if line.strip()]
                spaced = mid_word = 0
            paragraphs, dropped = drop_title_lines(paragraphs, title, author)
        elif spec:
            # The Chinese books are already one paragraph per blank-line block;
            # only their listed front/back matter is touched.
            paragraphs = original.strip("\n").split("\n\n")
            wrapped, width, spaced, mid_word, dropped = False, 0, 0, 0, []
        else:
            continue
        paragraphs, head_matter, tail_matter = drop_front_matter(paragraphs, spec)
        dropped += head_matter
        output = "\n\n".join(paragraphs) + "\n"

        # Safety: same characters as before, apart from the dropped headings
        # (taken off the start) and back matter (taken off the end).
        strip = lambda value: re.sub(r"\s", "", value)
        expected = strip(original)
        for heading in dropped:
            if not expected.startswith(strip(heading)):
                sys.exit(f"{path.name}: {heading!r} is not at the start; nothing written")
            expected = expected[len(strip(heading)):]
        for matter in tail_matter:  # last paragraph first
            at = expected.rfind(strip(matter))
            if at < 0:
                sys.exit(f"{path.name}: {matter!r} not found; nothing written")
            expected = expected[:at] + expected[at + len(strip(matter)):]
        dropped += tail_matter
        if strip(output) != expected:
            sys.exit(f"{path.name}: reflow changed the text's characters; nothing written")

        if output != original:
            path.write_text(output, encoding="utf-8")
            changed += 1
        layout = f"wrapped@{width}" if wrapped else "line-per-paragraph"
        print(
            f"{path.name}: {layout}, {len(paragraphs)} paragraphs, "
            f"{mid_word} mid-word joins, {spaced} space joins, dropped {dropped}"
        )
    print(f"\nrewrote {changed} files")


if __name__ == "__main__":
    main()
