"""Where a library book's main content starts and ends (scripts/epub_story.py).

The book's level is scored on that text alone and the reader opens a new book
at its start, so front matter (a teachers' preface, the contents) and back
matter (a word list, the licence) must be cut without cutting the story.
"""
import io
import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "scripts"))

import epub_story  # noqa: E402

PROSE = (
    "As stated on the preceding page, the foundation of this work is phonetic. The author believes that "
    "children may profitably learn many words without reference to their phonetic composition, and that "
    "among these certain key-words should be selected. The diacritical marks should not be taught. "
)
LESSON = "<div class='poem'><div class='stanza'><span class='i0'>I see a flag.</span><span class='i0'>The dog can run.</span></div></div>"


def xhtml(body: str, title: str = "x") -> str:
    return (
        "<?xml version='1.0' encoding='utf-8'?><html xmlns='http://www.w3.org/1999/xhtml'>"
        f"<head><title>{title}</title><style>p {{ margin: 0 }}</style></head><body>{body}</body></html>"
    )


def make_epub(files: dict[str, str], spine: list[tuple[str, str]], nav: list[tuple[str, str]]) -> bytes:
    """files: path (under OEBPS/) -> body; spine: (idref, path); nav: (title, href)."""
    manifest = "".join(
        f"<item id='{idref}' href='{path}' media-type='application/xhtml+xml'/>" for idref, path in spine
    )
    manifest += "<item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>"
    itemrefs = "".join(f"<itemref idref='{idref}'/>" for idref, _ in spine)
    opf = (
        "<?xml version='1.0'?><package xmlns='http://www.idpf.org/2007/opf' version='3.0'>"
        f"<manifest>{manifest}</manifest><spine>{itemrefs}</spine></package>"
    )
    links = "".join(f"<li><a href='{href}'>{title}</a></li>" for title, href in nav)
    nav_doc = xhtml(
        f"<nav epub:type='toc' xmlns:epub='http://www.idpf.org/2007/ops'><ol>{links}</ol></nav>"
        "<nav epub:type='page-list'><ol><li><a href='h-0.xhtml#Page_5'>5</a></li></ol></nav>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr(
            "META-INF/container.xml",
            "<container><rootfiles><rootfile full-path='OEBPS/content.opf'/></rootfiles></container>",
        )
        archive.writestr("OEBPS/content.opf", opf)
        archive.writestr("OEBPS/nav.xhtml", nav_doc)
        for path, body in files.items():
            archive.writestr(f"OEBPS/{path}", xhtml(body))
    return buffer.getvalue()


def brooks_epub() -> bytes:
    """The shape of Brooks's Readers, First Year (Gutenberg #41243): the
    lessons follow the teachers' notes in the same file with no heading."""
    front = (
        "<p><span class='x-ebookmaker-pageno' title='[Pg 1]' id='pg1'></span></p>"
        "<h1 id='t1'>BROOKS'S READERS</h1><h2 id='t2'>FIRST YEAR</h2><h4>BY<br/>STRATTON D BROOKS</h4>"
        "<h6>Copyright, 1906, by AMERICAN BOOK COMPANY.</h6>"
        "<hr class='chap'/><h2 id='contents'>CONTENTS</h2>"
        "<table><tr><td>SUGGESTIONS TO TEACHERS</td><td>4</td></tr><tr><td>A BUSY TIME</td><td>77</td></tr></table>"
        f"<p>The sole purpose of this book is to help the children to learn to read. {PROSE}</p>"
        f"<h4 id='teachers'>SUGGESTIONS TO TEACHERS</h4><p>{PROSE}</p>"
        "<table><tr><td>Page 5,</td><td>flag;</td><td>teach f, l, a, g.</td></tr></table>"
        f"<p>{PROSE}</p>"
    )
    lessons = (
        "<p><span class='x-ebookmaker-pageno' title='[Pg 5]' id='pgepubid00009'><a id='Page_5'></a></span></p>"
        "<div class='figcenter'><img alt='Stars_And_Stripes' src='flag.jpg' id='img_flag'/></div>"
        + LESSON * 40
        + "<h4 id='review'>REVIEW</h4>" + LESSON * 5
        + "<h4 id='busy'>A BUSY TIME</h4>" + LESSON * 10
    )
    end = (
        "<h4 id='tools'>THE BOX OF TOOLS</h4>" + LESSON * 10
        + "<h2 id='words'>WORD LIST</h2><p>acquisition phonetic diacritical</p>"
    )
    return make_epub(
        {"wrap0000.xhtml": "<img src='cover.jpg' alt='cover'/>", "h-0.xhtml": front + lessons, "h-1.xhtml": end},
        [("coverpage-wrapper", "wrap0000.xhtml"), ("pg-header", "h-0.xhtml"), ("item5", "h-1.xhtml")],
        [
            ("BROOKS'S READERS", "h-0.xhtml#t1"), ("FIRST YEAR", "h-0.xhtml#t2"), ("CONTENTS", "h-0.xhtml#contents"),
            ("SUGGESTIONS TO TEACHERS", "h-0.xhtml#teachers"), ("REVIEW", "h-0.xhtml#review"),
            ("A BUSY TIME", "h-0.xhtml#busy"), ("THE BOX OF TOOLS", "h-1.xhtml#tools"),
            ("WORD LIST", "h-1.xhtml#words"),
        ],
    )


def test_brooks_starts_at_the_first_lesson_after_the_teachers_notes():
    book = epub_story.read_epub(brooks_epub())
    payload = epub_story.bounds_payload(book)
    assert payload["start"]["href"] == "OEBPS/h-0.xhtml"
    # The ids that lead to the first lesson's picture, as the reader's blocks carry them.
    assert payload["start"]["anchors"] == ["pgepubid00009", "Page_5", "img_flag"]
    assert 0 < payload["start"]["fraction"] < 0.5
    # The word list at the end of the last file isn't the story.
    assert payload["end"]["href"] == "OEBPS/h-1.xhtml"
    assert 0 < payload["end"]["fraction"] < 1


def test_brooks_level_text_is_the_lessons_only():
    book = epub_story.read_epub(brooks_epub())
    text = epub_story.story_text(book)
    assert text.startswith("Stars_And_Stripes") is False  # a picture's alt text isn't text
    assert text.startswith("I see a flag.")
    assert "A BUSY TIME" in text and "THE BOX OF TOOLS" in text
    for front_or_back in ("phonetic", "diacritical", "CONTENTS", "Copyright", "WORD LIST", "teach f"):
        assert front_or_back not in text


def standard_ebook(extra_front: str = "") -> bytes:
    chapter = "<p>" + "It was a dark and stormy night; the rain fell in torrents. " * 40 + "</p>"
    files = {
        "cover.xhtml": "<img src='cover.jpg' alt='Cover'/>",
        "titlepage.xhtml": "<h1>The Book</h1><p>By Someone</p>",
        "public-domain.xhtml": f"<p>{PROSE}</p><img src='logo.png' alt='Public domain library logo'/><p>Thanks.</p>",
        "halftitlepage.xhtml": "<h2>The Book</h2>",
        "chapter-1.xhtml": f"<h2 id='chapter-1'>I</h2>{chapter}",
        "chapter-2.xhtml": f"<h2 id='chapter-2'>II</h2>{chapter}",
        "endnotes.xhtml": "<h2>Endnotes</h2><ol><li><p>A note.</p></li></ol>",
        "colophon.xhtml": "<h2>Colophon</h2><p>Made by volunteers.</p>",
    }
    names = list(files)
    spine = [(name, name) for name in names]
    nav = [
        ("Titlepage", "titlepage.xhtml"), ("Public domain", "public-domain.xhtml"), ("The Book", "halftitlepage.xhtml"),
        ("I", "chapter-1.xhtml"), ("II", "chapter-2.xhtml"), ("Endnotes", "endnotes.xhtml"), ("Colophon", "colophon.xhtml"),
    ]
    return make_epub(files, spine, nav)


def test_standard_ebooks_start_at_chapter_one_and_end_before_the_endnotes():
    book = epub_story.read_epub(standard_ebook())
    payload = epub_story.bounds_payload(book)
    # Not the public-domain page's tail after its logo, nor the half-title.
    assert payload["start"] == {"href": "OEBPS/chapter-1.xhtml", "anchors": ["chapter-1"], "fraction": 0.0, "text": "I"}
    assert payload["end"] == {"href": "OEBPS/chapter-2.xhtml", "fraction": 1.0}
    text = epub_story.story_text(book)
    assert "stormy night" in text and "phonetic" not in text and "A note." not in text


def test_a_publishers_note_before_numbered_tales():
    # Jataka Tales: cover wrapper, title, foreword, contents, publisher's note, then "I. THE MONKEY ...".
    tale = "<p>" + "Once upon a time a monkey lived on the bank of a river. " * 30 + "</p>"
    files = {
        "wrap0000.xhtml": "<img src='c.jpg' alt='cover'/>",
        "h-1.xhtml": "<p>The Project Gutenberg eBook of Jataka Tales</p>",
        "h-2.xhtml": "<h1 id='t'>Jataka Tales</h1>",
        "h-5.xhtml": f"<h2 id='f'>FOREWORD</h2><p>{PROSE}</p>",
        "h-6.xhtml": "<h2 id='c'>CONTENTS</h2><p>I. THE MONKEY AND THE CROCODILE</p>",
        "h-7.xhtml": f"<h2 id='n'>PUBLISHER'S NOTE</h2><p>{PROSE}</p><hr class='chap'/>",
        "h-9.xhtml": f"<h2 id='I'>I. THE MONKEY AND THE CROCODILE</h2>{tale}",
        "h-10.xhtml": f"<h2 id='II'>II. HOW THE TURTLE SAVED HIS OWN LIFE</h2>{tale}",
    }
    spine = [("coverpage-wrapper" if name == "wrap0000.xhtml" else name, name) for name in files]
    nav = [
        ("Jataka Tales", "h-2.xhtml#t"), ("FOREWORD", "h-5.xhtml#f"), ("CONTENTS", "h-6.xhtml#c"),
        ("PUBLISHER'S NOTE", "h-7.xhtml#n"), ("I. THE MONKEY AND THE CROCODILE", "h-9.xhtml#I"),
        ("II. HOW THE TURTLE SAVED HIS OWN LIFE", "h-10.xhtml#II"),
    ]
    book = epub_story.read_epub(make_epub(files, spine, nav))
    payload = epub_story.bounds_payload(book)
    assert payload["start"]["href"] == "OEBPS/h-9.xhtml"
    assert payload["start"]["anchors"] == ["I"]
    assert "Project Gutenberg" not in epub_story.story_text(book)


def test_a_picture_book_with_no_front_matter_starts_at_its_title():
    # The Tale of Jemima Puddle-Duck: a year on the title page isn't a chapter,
    # and the Gutenberg line before the title isn't the story.
    story = "<p>" + "What a funny sight it is to see a brood of ducklings with a hen! " * 20 + "</p>"
    files = {
        "wrap0000.xhtml": "<img src='c.jpg' alt='cover'/>",
        "h-0.xhtml": (
            "<p>The Project Gutenberg eBook, The Tale of Jemima Puddle-Duck</p><hr/>"
            "<h1 id='a'>THE TALE OF JEMIMA PUDDLE-DUCK</h1><h2 id='b'>BEATRIX POTTER</h2><h3 id='c'>1908</h3>"
            + story
        ),
    }
    nav = [("THE TALE OF JEMIMA PUDDLE-DUCK", "h-0.xhtml#a"), ("BEATRIX POTTER", "h-0.xhtml#b"), ("1908", "h-0.xhtml#c")]
    book = epub_story.read_epub(make_epub(files, [("coverpage-wrapper", "wrap0000.xhtml"), ("pg-header", "h-0.xhtml")], nav))
    start, _end = epub_story.story_bounds(book)
    assert epub_story.bounds_payload(book)["start"]["anchors"] == ["a"]
    assert not epub_story.is_chapter_title("1908")
    assert epub_story.is_chapter_title("12") and epub_story.is_chapter_title("IV: Energy")
    assert "ducklings" in epub_story.story_text(book, (start, _end))


def test_a_short_drop_cap_preface_does_not_end_at_its_first_picture():
    # A picture in a preface's first lines (a drop cap) isn't where the story
    # starts; the story is the chapter after it.
    chapter = "<p>" + "The story itself goes on for a good long while here. " * 40 + "</p>"
    files = {
        "preface.xhtml": f"<h2 id='p'>Preface</h2><img src='dropcap.png' alt='T'/><p>{PROSE * 3}</p>",
        "chapter-1.xhtml": f"<h2 id='c1'>Chapter 1</h2>{chapter}",
    }
    nav = [("Preface", "preface.xhtml#p"), ("Chapter 1", "chapter-1.xhtml#c1")]
    book = epub_story.read_epub(make_epub(files, [(name, name) for name in files], nav))
    assert epub_story.bounds_payload(book)["start"]["href"] == "OEBPS/chapter-1.xhtml"
