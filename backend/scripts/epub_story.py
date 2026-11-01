"""Where the main content of an EPUB starts and ends.

Public-domain books carry a lot that isn't the book a learner came to read: a
cover, title pages, a contents list, a preface, "Suggestions to Teachers", a
word list, the Project Gutenberg licence. Two things need them told apart:

* the book's level (generate_public_library_levels.py) is scored on the main
  content only, so a teachers' preface full of "phonetic" and "diacritical"
  can't push a first-year primer up to B1;
* the reader opens a new book at the start of the main content and counts the
  percentage over it (frontend/services/storyRange.js reads the bounds this
  module writes into library-story.generated.json).

The rule, by sections (the book's contents entries, plus spine files whose
name says what they are):

* front matter is a section whose title or file name reads like it
  ("Contents", "Preface", "Suggestions to Teachers", "Copyright", ...);
  back matter likewise ("Word List", "Notes", "Gutenberg licence", ...);
* the story starts where the last front-matter section near the start of the
  book ends. A front-matter section ends at the next contents entry, or
  earlier where its own text visibly stops: a heading at its own rank or
  above, or, after some prose, a picture or a chapter rule. Old school
  readers put their first lessons right after the teachers' notes with no
  heading of their own (Brooks's Readers), which is what that catches;
* with no front matter, the story starts at the first chapter ("Chapter 1",
  "I. The Monkey", "Book One") or else at the start of the book;
* the story ends where the run of back-matter sections at the end begins.

Uses only the standard library (html.parser, which also copes with the
not-quite-XML some EPUBs ship), so it is testable without the backend.
"""

from __future__ import annotations

import io
import math
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import unquote

# Keep in step with FRONT_WORDS / BACK_WORDS in frontend/services/storyRange.js.
FRONT_WORDS = [
    "cover", "coverpage", "title", "titlepage", "halftitle", "half-title", "halftitlepage", "imprint", "copyright",
    "public-domain", "public domain", "dedication", "epigraph", "contents", "table of contents", "toc", "preface",
    "foreword", "introduction", "intro", "prologue", "prolog", "frontmatter", "front matter", "loi",
    "list of illustrations", "illustrations", "translator's note", "translators note", "editor's note",
    "editors note", "publisher's note", "publishers note", "author's preface", "note on the text", "a note on",
    "transcriber", "transcriber's note", "about this edition", "acknowledgments", "acknowledgements", "praise",
    "also by", "dramatis personae", "persons of the play", "scenes of the play", "the scenes", "frontispiece",
    "note to the", "etymology", "extracts", "notice", "explanatory", "bibliography", "to the teacher",
    "to teachers", "suggestions to teachers", "note to teachers", "notes to teachers", "teachers' notes",
    "for the teacher", "to parents", "a word to", "how to use this book",
]

BACK_WORDS = [
    "endnotes", "notes", "footnotes", "colophon", "uncopyright", "donate", "acknowledgments", "acknowledgements",
    "afterword", "appendix", "glossary", "index", "about the author", "biography", "bibliography", "author's note",
    "authors note", "backmatter", "back matter", "license", "licence", "gutenberg", "pg-footer", "footer",
    "further reading", "chronology", "credits", "imprint", "loi", "word list", "list of words", "vocabulary list",
    "transcriber", "transcriber's note", "phonetic key", "pronouncing vocabulary",
]

CHAPTER_RE = re.compile(
    r"^(chapter|book|part|act|scene|canto|stave|letter|volume|fable|story|tale|lesson)\b"
    # A bare number is a chapter; a year ("1908" on a title page) isn't.
    r"|^[ivxlc]+\.?$|^\d{1,3}\.?$"
    r"|^[ivxlc]+[.:]\s+\S|^\d+[.:]\s+\S",
    re.I,
)

BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "caption", "dd", "div", "dl", "dt", "figcaption",
    "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "nav", "ol", "p", "pre", "section",
    "table", "tbody", "thead", "tr", "ul",
}
# The reader sets a table row on one line, its cells joined by " · ".
CELL_TAGS = {"td", "th"}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SKIP_TAGS = {"head", "script", "style", "title"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Page numbers set into the text by the transcriber, not part of it.
PAGE_NUMBER_CLASS_RE = re.compile(r"\b(pagenum|pageno|page-number|x-ebookmaker-pageno)\b", re.I)
# Gutenberg verse: each line a <span class="i0">.
VERSE_LINE_CLASS_RE = re.compile(r"^i\d+", re.I)

# A rough page-ish weight for a block: one line per ~45 characters (a phone's
# measure), a picture about eight lines. The reader paginates; this is close
# enough to put the start of the story at the right share of its chapter.
CHARS_PER_LINE = 45
IMAGE_LINES = 8
# A front-matter section's own prose must reach this before a picture or a
# chapter rule counts as its end (a drop-cap image in its first line doesn't).
MIN_FRONT_PROSE_CHARS = 200
# ...and what follows that point before the next contents entry must be this
# much text: real content hiding behind the front matter, not the tail of a
# copyright page after its logo.
MIN_HIDDEN_CONTENT_CHARS = 1000
# Front matter only counts near the start of the book (when it has no
# chapters to go by).
LEADING_SHARE = 0.5


def _norm(value: str) -> str:
    text = str(value or "").lower()
    text = re.sub(r"\.(x?html?|xml|txt)$", "", text)
    text = text.replace("’", "'")
    return re.sub(r"[_\s]+", " ", text).strip()


def _matches(words: list[str], *labels: str) -> bool:
    for label in labels:
        text = _norm(label)
        if not text:
            continue
        for word in words:
            if re.search(r"(^|[^a-z])" + re.escape(word) + r"([^a-z]|$)", text):
                return True
    return False


def _file_stem(path: str) -> str:
    name = str(path or "").rsplit("/", 1)[-1]
    return re.sub(r"\s*\d+$", "", _norm(name.replace("-", " ").replace("_", " ")))


def is_chapter_title(title: str) -> bool:
    return bool(CHAPTER_RE.search(str(title or "").strip()))


@dataclass
class Block:
    kind: str  # "text", "heading", "image", "rule"
    text: str = ""
    level: int = 0  # heading rank (1-6)
    ids: list[str] = field(default_factory=list)
    lines: int = 0
    css_class: str = ""

    @property
    def weight(self) -> float:
        if self.kind == "image":
            return IMAGE_LINES
        if self.kind == "rule":
            return 0.5
        return max(self.lines, 1) + (1 if self.kind == "heading" else 0)


class _BlockParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self.pending_ids: list[str] = []
        # Open tags, each with whether its text is dropped (page numbers).
        self.stack: list[tuple[str, bool]] = []
        self.skip_depth = 0
        self.parts: list[str] = []
        self.line_lengths: list[int] = [0]

    # The text gathered since the last block boundary becomes one block.
    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self.parts)).strip()
        if text:
            heading = next((tag for tag, _ in reversed(self.stack) if tag in HEADING_TAGS), None)
            lines = sum(max(1, math.ceil(length / CHARS_PER_LINE)) for length in self.line_lengths if length > 0)
            self.blocks.append(Block(
                kind="heading" if heading else "text",
                text=text,
                level=int(heading[1]) if heading else 0,
                ids=self.pending_ids,
                lines=max(lines, 1),
            ))
            self.pending_ids = []
        self.parts = []
        self.line_lengths = [0]

    def _line_break(self) -> None:
        if self.line_lengths[-1] > 0:
            self.line_lengths.append(0)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower().rsplit(":", 1)[-1]
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if tag in SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        css_class = attributes.get("class", "")
        if tag in BLOCK_TAGS:
            self._flush()
        if tag in CELL_TAGS and "".join(self.parts).strip():
            self.parts.append(" · ")
            self.line_lengths[-1] += 3
        if attributes.get("id"):
            self.pending_ids.append(attributes["id"])
        if tag in ("img", "image"):
            self._flush()
            self.blocks.append(Block(kind="image", text=attributes.get("alt", ""), ids=self.pending_ids))
            self.pending_ids = []
            return
        if tag == "hr":
            self._flush()
            self.blocks.append(Block(kind="rule", ids=self.pending_ids, css_class=css_class))
            self.pending_ids = []
            return
        if tag == "br":
            self._line_break()
            return
        if tag == "span" and VERSE_LINE_CLASS_RE.search(css_class):
            self._line_break()
        if tag in VOID_TAGS:
            return
        hidden = self._hidden() or bool(PAGE_NUMBER_CLASS_RE.search(css_class))
        self.stack.append((tag, hidden))

    def _hidden(self) -> bool:
        return bool(self.stack) and self.stack[-1][1]

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        tag = tag.lower().rsplit(":", 1)[-1]
        if tag not in VOID_TAGS and tag not in SKIP_TAGS and not self.skip_depth:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower().rsplit(":", 1)[-1]
        if tag in SKIP_TAGS:
            self.skip_depth = max(self.skip_depth - 1, 0)
            return
        if self.skip_depth or tag in VOID_TAGS:
            return
        if tag in BLOCK_TAGS:
            self._flush()
        if any(open_tag == tag for open_tag, _ in self.stack):
            # Close everything opened inside it too (unclosed inline tags).
            while self.stack:
                closed, _ = self.stack.pop()
                if closed == tag:
                    break
        if tag == "span":
            self._line_break()

    def handle_data(self, data):
        if self.skip_depth or self._hidden():
            return
        self.parts.append(data)
        self.line_lengths[-1] += len(re.sub(r"\s+", " ", data).strip())

    def close(self):
        super().close()
        self._flush()
        if self.pending_ids:
            # Ids after the last text (an empty trailing anchor) land on a
            # marker so a contents link to them still resolves.
            self.blocks.append(Block(kind="rule", ids=self.pending_ids))
            self.pending_ids = []


def parse_blocks(markup: str) -> list[Block]:
    parser = _BlockParser()
    parser.feed(markup)
    parser.close()
    return parser.blocks


@dataclass
class SpineDoc:
    path: str
    idref: str
    blocks: list[Block]

    @property
    def weight(self) -> float:
        return sum(block.weight for block in self.blocks)

    def block_for_anchor(self, anchor: str | None) -> int | None:
        if not anchor:
            return 0
        for index, block in enumerate(self.blocks):
            if anchor in block.ids:
                return index
        return None


@dataclass
class TocEntry:
    title: str
    path: str
    anchor: str | None


@dataclass
class Section:
    spine: int
    block: int
    title: str
    labels: tuple[str, ...]

    @property
    def is_front(self) -> bool:
        return not is_chapter_title(self.title) and _matches(FRONT_WORDS, *self.labels)

    @property
    def is_back(self) -> bool:
        return not is_chapter_title(self.title) and _matches(BACK_WORDS, *self.labels)

    @property
    def is_chapter(self) -> bool:
        return is_chapter_title(self.title)


@dataclass
class Book:
    spine: list[SpineDoc]
    toc: list[TocEntry]


@dataclass(frozen=True)
class Position:
    spine: int
    block: int


class _AttrCollector(HTMLParser):
    """Start tags (name, attributes) and the text inside chosen tags, in order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[tuple] = []

    def handle_starttag(self, tag, attrs):
        self.events.append(("start", tag.lower().rsplit(":", 1)[-1], {k.lower(): (v or "") for k, v in attrs}))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        self.events.append(("end", tag.lower().rsplit(":", 1)[-1], {}))

    def handle_data(self, data):
        self.events.append(("text", data, {}))


def _events(markup: str) -> list[tuple]:
    collector = _AttrCollector()
    collector.feed(markup)
    collector.close()
    return collector.events


def _resolve(base_dir: str, href: str) -> str:
    path = unquote(href.split("#", 1)[0])
    return posixpath.normpath(posixpath.join(base_dir, path)) if base_dir else posixpath.normpath(path)


def _nav_entries(markup: str, base_dir: str) -> list[TocEntry]:
    events = _events(markup)
    # The <nav epub:type="toc"> (else the first <nav>): its links, in order.
    navs: list[tuple[int, int, bool]] = []
    depth = 0
    start = None
    is_toc = False
    for index, (kind, tag, attrs) in enumerate(events):
        if kind == "start" and tag == "nav":
            if depth == 0:
                start = index
                is_toc = "toc" in (attrs.get("epub:type", "") + " " + attrs.get("type", "")).split()
            depth += 1
        elif kind == "end" and tag == "nav" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                navs.append((start, index, is_toc))
    if not navs:
        return []
    begin, end, _ = next((nav for nav in navs if nav[2]), navs[0])
    entries: list[TocEntry] = []
    href = None
    text: list[str] = []
    for kind, tag, attrs in events[begin:end]:
        if kind == "start" and tag == "a":
            href = attrs.get("href", "")
            text = []
        elif kind == "text" and href is not None:
            text.append(tag)
        elif kind == "end" and tag == "a" and href is not None:
            title = re.sub(r"\s+", " ", "".join(text)).strip()
            if href and title:
                entries.append(TocEntry(title, _resolve(base_dir, href), _fragment(href)))
            href = None
    return entries


def _ncx_entries(markup: str, base_dir: str) -> list[TocEntry]:
    events = _events(markup)
    entries: list[TocEntry] = []
    in_map = False
    in_label = False
    label: list[str] = []
    for kind, tag, attrs in events:
        if tag == "navmap":
            in_map = kind == "start"
        if not in_map:
            continue
        if kind == "start" and tag == "navlabel":
            in_label, label = True, []
        elif kind == "end" and tag == "navlabel":
            in_label = False
        elif kind == "text" and in_label:
            label.append(tag)
        elif kind == "start" and tag == "content":
            src = attrs.get("src", "")
            title = re.sub(r"\s+", " ", "".join(label)).strip()
            if src and title:
                entries.append(TocEntry(title, _resolve(base_dir, src), _fragment(src)))
    return entries


def _fragment(href: str) -> str | None:
    if "#" not in href:
        return None
    return unquote(href.split("#", 1)[1]).strip() or None


def read_epub(data: bytes) -> Book:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = {name: name for name in archive.namelist()}
        lowered = {name.lower(): name for name in archive.namelist()}

        def read(path: str) -> str | None:
            name = names.get(path) or lowered.get(path.lower())
            return archive.read(name).decode("utf-8", errors="ignore") if name else None

        container = read("META-INF/container.xml") or ""
        match = re.search(r'full-path\s*=\s*"([^"]+)"', container)
        opf_path = match.group(1) if match else next((n for n in names if n.lower().endswith(".opf")), "")
        opf_dir = posixpath.dirname(opf_path)
        manifest: dict[str, dict] = {}
        spine_refs: list[str] = []
        for kind, tag, attrs in _events(read(opf_path) or ""):
            if kind != "start":
                continue
            if tag == "item" and attrs.get("id"):
                manifest[attrs["id"]] = {
                    "path": _resolve(opf_dir, attrs.get("href", "")),
                    "type": attrs.get("media-type", ""),
                    "properties": attrs.get("properties", ""),
                }
            elif tag == "itemref" and attrs.get("linear", "yes").lower() != "no":
                spine_refs.append(attrs.get("idref", ""))
        spine: list[SpineDoc] = []
        for idref in spine_refs:
            item = manifest.get(idref)
            if not item:
                continue
            markup = read(item["path"])
            if markup is None:
                continue
            spine.append(SpineDoc(path=item["path"], idref=idref, blocks=parse_blocks(markup)))
        toc: list[TocEntry] = []
        nav = next((item for item in manifest.values() if "nav" in item["properties"].split()), None)
        if nav and read(nav["path"]):
            toc = _nav_entries(read(nav["path"]) or "", posixpath.dirname(nav["path"]))
        if not toc:
            ncx = next((item for item in manifest.values() if item["type"] == "application/x-dtbncx+xml"), None)
            if ncx and read(ncx["path"]):
                toc = _ncx_entries(read(ncx["path"]) or "", posixpath.dirname(ncx["path"]))
    return Book(spine=spine, toc=toc)


def sections(book: Book) -> list[Section]:
    """The book's sections in reading order: its contents entries, plus spine
    files with no entry whose name says what they are (a cover wrapper, a
    Gutenberg footer)."""
    found: dict[tuple[int, int], Section] = {}
    by_path = {doc.path: index for index, doc in enumerate(book.spine)}
    for entry in book.toc:
        if entry.title.startswith("[Pg") or entry.title.lower() in ("pages", "page list"):
            continue
        spine_index = by_path.get(entry.path)
        if spine_index is None:
            continue
        doc = book.spine[spine_index]
        block = doc.block_for_anchor(entry.anchor)
        if block is None:
            block = 0
        key = (spine_index, block)
        if key not in found:
            found[key] = Section(spine_index, block, entry.title, (entry.title, _file_stem(doc.path)))
    listed = {key[0] for key in found}
    for spine_index, doc in enumerate(book.spine):
        if spine_index in listed:
            continue
        labels = (_file_stem(doc.path), doc.idref)
        if _matches(FRONT_WORDS, *labels) or _matches(BACK_WORDS, *labels):
            found[(spine_index, 0)] = Section(spine_index, 0, "", labels)
    return [found[key] for key in sorted(found)]


def _cumulative(book: Book) -> list[float]:
    """Weight of the book before each spine document."""
    totals = [0.0]
    for doc in book.spine:
        totals.append(totals[-1] + doc.weight)
    return totals


def _offset(book: Book, totals: list[float], position: Position) -> float:
    doc = book.spine[position.spine]
    return totals[position.spine] + sum(block.weight for block in doc.blocks[:position.block])


def _next_position(book: Book, position: Position) -> Position:
    if position.block + 1 < len(book.spine[position.spine].blocks):
        return Position(position.spine, position.block + 1)
    return Position(position.spine + 1, 0)


def _front_section_end(book: Book, section: Section, until: Position) -> Position:
    """Where a front-matter section's own text stops: at `until` (the next
    section), or at a sibling heading, or (after some prose) at a picture or
    a chapter rule, whichever comes first."""
    position = Position(section.spine, section.block)
    first = book.spine[section.spine].blocks[section.block] if book.spine[section.spine].blocks else None
    own_level = first.level if first is not None and first.kind == "heading" else 0
    prose = 0
    position = _next_position(book, position)
    while position.spine < len(book.spine) and (position.spine, position.block) < (until.spine, until.block):
        blocks = book.spine[position.spine].blocks
        if position.block >= len(blocks):
            position = Position(position.spine + 1, 0)
            continue
        block = blocks[position.block]
        if block.kind == "heading" and own_level and block.level <= own_level:
            return position
        if prose >= MIN_FRONT_PROSE_CHARS and (
            block.kind == "image" or (block.kind == "rule" and "chap" in block.css_class.lower())
        ) and len(_text_between(book, position, until)) >= MIN_HIDDEN_CONTENT_CHARS:
            return position
        if block.kind in ("text", "heading"):
            prose += len(block.text)
        position = _next_position(book, position)
    return until


def _settle(book: Book, position: Position) -> Position:
    """Past the end of a file: the start of the next one with any blocks."""
    spine, block = position.spine, position.block
    while spine < len(book.spine) and block >= len(book.spine[spine].blocks):
        spine, block = spine + 1, 0
    return Position(spine, block)


def story_bounds(book: Book) -> tuple[Position, Position]:
    """(start, end) of the main content: start is its first block, end the
    first block after it (Position(len(spine), 0) when it runs to the end)."""
    book_end = Position(len(book.spine), 0)
    if not book.spine:
        return Position(0, 0), book_end
    found = sections(book)
    totals = _cumulative(book)
    total = max(totals[-1], 1.0)

    def share(section: Section) -> float:
        return _offset(book, totals, Position(section.spine, section.block)) / total

    first_chapter = next((index for index, section in enumerate(found) if section.is_chapter), None)
    leading = found[:first_chapter] if first_chapter is not None else [s for s in found if share(s) < LEADING_SHARE]
    front = [index for index, section in enumerate(found[:len(leading)]) if section.is_front]

    if front:
        last = front[-1]
        until = Position(found[last + 1].spine, found[last + 1].block) if last + 1 < len(found) else book_end
        start = _settle(book, _front_section_end(book, found[last], until))
        # What's left before the first chapter, when it's only a title-page
        # leftover (a half-title), isn't the story either.
        if first_chapter is not None:
            chapter = Position(found[first_chapter].spine, found[first_chapter].block)
            if len(_text_between(book, start, chapter)) < MIN_HIDDEN_CONTENT_CHARS:
                start = chapter
    elif first_chapter is not None:
        start = Position(found[first_chapter].spine, found[first_chapter].block)
    else:
        start = _settle(book, Position(0, 0))

    end = book_end
    for section in reversed(found):
        position = Position(section.spine, section.block)
        if (position.spine, position.block) <= (start.spine, start.block):
            break
        if not section.is_back:
            break
        end = position
    return start, end


def _text_between(book: Book, start: Position, end: Position) -> str:
    parts: list[str] = []
    for spine_index in range(start.spine, min(end.spine, len(book.spine) - 1) + 1):
        blocks = book.spine[spine_index].blocks
        first = start.block if spine_index == start.spine else 0
        last = end.block if spine_index == end.spine else len(blocks)
        parts.extend(block.text for block in blocks[first:last] if block.kind in ("text", "heading"))
    return "\n".join(parts)


def story_text(book: Book, bounds: tuple[Position, Position] | None = None) -> str:
    """The main content's text, one block per line."""
    start, end = bounds or story_bounds(book)
    return _text_between(book, start, end)


def full_text(book: Book) -> str:
    return _text_between(book, Position(0, 0), Position(len(book.spine), 0))


def bounds_payload(book: Book, bounds: tuple[Position, Position] | None = None) -> dict:
    """The bounds as the app reads them (frontend/services/storyRange.js):
    for the start, the spine file, the element ids that lead to its first
    block and how far into the file it is (0..1, by rough page weight); for
    the end, the last story file and how far into it the story runs."""
    start, end = bounds or story_bounds(book)
    if not book.spine:
        return {}
    start = _settle(book, start)
    if start.spine >= len(book.spine):
        start = Position(0, 0)
    start_doc = book.spine[start.spine]
    start_block = start_doc.blocks[start.block] if start.block < len(start_doc.blocks) else None
    # The end, as the last story file and the share of it the story fills.
    if end.block == 0 or end.spine >= len(book.spine):
        end_spine = min(end.spine, len(book.spine)) - 1
        end_fraction = 1.0
    else:
        end_spine = end.spine
        end_fraction = _fraction(book.spine[end_spine], end.block)
    return {
        "start": {
            "href": start_doc.path,
            "anchors": list(start_block.ids) if start_block else [],
            "fraction": round(_fraction(start_doc, start.block), 4),
            "text": (start_block.text if start_block else "")[:80],
        },
        "end": {
            "href": book.spine[max(end_spine, 0)].path,
            "fraction": round(end_fraction, 4),
        },
    }


def _fraction(doc: SpineDoc, block: int) -> float:
    total = doc.weight
    if total <= 0:
        return 0.0
    return min(max(sum(b.weight for b in doc.blocks[:block]) / total, 0.0), 1.0)


def describe(book: Book) -> str:
    """A one-look summary for checking the detection by eye."""
    start, end = story_bounds(book)
    payload = bounds_payload(book, (start, end))
    lines = [f"sections: {len(sections(book))}, spine: {len(book.spine)}"]
    for section in sections(book):
        mark = "F" if section.is_front else "B" if section.is_back else "C" if section.is_chapter else " "
        lines.append(f"  [{mark}] {section.spine}:{section.block} {section.title[:50] or section.labels}")
    lines.append(f"start {start} -> {payload.get('start')}")
    lines.append(f"end {end} -> {payload.get('end')}")
    end_text = _text_between(book, Position(end.spine, max(end.block - 3, 0)), end) if end.spine < len(book.spine) else ""
    lines.append(f"  text before end: {end_text[-160:]!r}")
    return "\n".join(lines)
