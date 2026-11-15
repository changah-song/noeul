import { addLinkedSections, linksInMarkup, tocAncestors, tocGroups } from '../tocLinkedSections';
import { storyRange } from '../storyRange';

const spineOf = (paths) => paths.map((path, index) => ({ index, path }));
const entry = (title, spineIndex, depth = 0) => ({
    id: title, title, label: title, spineIndex, depth, href: '', disabled: false,
});
const reader = (files) => {
    const read = [];
    const readFile = async (path) => {
        read.push(path);
        return files[path] ?? null;
    };
    return { read, readFile };
};

describe('linksInMarkup', () => {
    it('reads each link with its text, tags and entities removed', () => {
        expect(linksInMarkup(
            '<p><a href="a.html#x">One &amp; <i>Two</i></a> <a class="n" href=\'b.html\'>3</a><a href="c.html"> </a></p>'
        )).toEqual([
            { href: 'a.html#x', label: 'One & Two' },
            { href: 'b.html', label: '3' },
        ]);
    });
});

describe('addLinkedSections', () => {
    // A Bible: the contents name the books; each book's page links its chapters.
    const spine = spineOf([
        'Front/Intro.html',
        'NLT/01-Gen-000.html', 'Intros/Gen.html', 'NLT/01-Gen-001.html', 'NLT/01-Gen-002.html',
        'NLT/02-Exod-000.html', 'NLT/02-Exod-001.html', 'NLT/02-Exod-002.html',
    ]);
    const toc = [entry('Introduction', 0), entry('Genesis', 1), entry('Exodus', 5)];
    const files = {
        'NLT/01-Gen-000.html': '<a href="00.html">GENESIS</a>'
            + '<a href="../Intros/Gen.html#top">Introduction</a>'
            + '<a href="01-Gen-001.html#vs-Gen.1.1">1</a><a href="01-Gen-002.html#vs-Gen.2.1">2</a>'
            + '<a href="02-Exod-001.html">Exodus 1</a>',
        'NLT/02-Exod-000.html': '<a href="02-Exod-001.html">1</a><a href="02-Exod-002.html">2</a>',
    };

    it('lists the files an entry\'s page links to under that entry', async () => {
        const { readFile } = reader(files);
        const out = await addLinkedSections(toc, spine, readFile);
        expect(out.map((item) => [item.title, item.spineIndex, item.depth])).toEqual([
            ['Introduction', 0, 0],
            ['Genesis', 1, 0],
            ['Introduction', 2, 1],
            ['Genesis 1', 3, 1],
            ['Genesis 2', 4, 1],
            ['Exodus', 5, 0],
            ['Exodus 1', 6, 1],
            ['Exodus 2', 7, 1],
        ]);
        // The link's own target is kept, so the jump lands where the book says.
        expect(out[3].href).toBe('NLT/01-Gen-001.html#vs-Gen.1.1');
        expect(out[3].disabled).toBe(false);
        // Numbered pages straight under an entry are the book's chapters.
        expect(out.map((item) => Boolean(item.chapter))).toEqual([false, false, false, true, true, false, true, true]);
    });

    it('measures progress over the numbered chapters, not the reference pages after them', async () => {
        const { readFile } = reader({
            ...files,
            'Notes/index.html': '<a href="gen.html">Genesis Notes</a><a href="exod.html">Exodus Notes</a>',
            'Notes/gen.html': '<a href="gen1.html">1</a><a href="gen2.html">2</a>',
        });
        const withNotes = spineOf([
            ...spine.map((item) => item.path),
            'Notes/index.html', 'Notes/gen.html', 'Notes/gen1.html', 'Notes/gen2.html', 'Notes/exod.html',
        ]);
        const out = await addLinkedSections([...toc, entry('Study Guide', 8)], withNotes, readFile);
        // From Genesis 1 (after the book's "Introduction") to Exodus 2.
        expect(storyRange(withNotes, out)).toEqual({ start: 3, end: 7 });
    });

    it('reads nothing when the contents already list every file', async () => {
        const { read, readFile } = reader(files);
        const full = spine.map((item) => entry(item.path, item.index));
        expect(await addLinkedSections(full, spine, readFile)).toBe(full);
        expect(read).toEqual([]);
    });

    it('does not treat one linked file as a list of chapters (a notes page)', async () => {
        const { readFile } = reader({ 'ch1.html': '<a href="notes.html#n1">1</a><a href="notes.html#n2">2</a>' });
        const out = await addLinkedSections(
            [entry('Chapter One', 0), entry('Chapter Two', 2)],
            spineOf(['ch1.html', 'notes.html', 'ch2.html']),
            readFile
        );
        expect(out.map((item) => item.title)).toEqual(['Chapter One', 'Chapter Two']);
    });

    it('places sections by reading order when the contents are out of order', async () => {
        const { readFile } = reader({ 'b.html': '<a href="b1.html">One</a><a href="b2.html">Two</a>' });
        const out = await addLinkedSections(
            [entry('B', 2), entry('A', 0)],
            spineOf(['a.html', 'a1.html', 'b.html', 'b1.html', 'b2.html']),
            readFile
        );
        expect(out.map((item) => item.title)).toEqual(['B', 'One', 'Two', 'A']);
    });

    it('goes one level further when a linked page is itself a list', async () => {
        const { readFile } = reader({
            'notes.html': '<a href="gen.html">Genesis Notes</a><a href="exod.html">Exodus Notes</a>',
            'gen.html': '<a href="gen1.html">1</a><a href="gen2.html">2</a>',
        });
        const out = await addLinkedSections(
            [entry('Study Notes', 0)],
            spineOf(['notes.html', 'gen.html', 'gen1.html', 'gen2.html', 'exod.html']),
            readFile
        );
        expect(out.map((item) => [item.title, item.depth])).toEqual([
            ['Study Notes', 0],
            ['Genesis Notes', 1],
            ['Genesis Notes 1', 2],
            ['Genesis Notes 2', 2],
            ['Exodus Notes', 1],
        ]);
    });
});

describe('tocGroups', () => {
    it('finds each entry\'s parent and which entries hold others', () => {
        const flat = [entry('A', 0, 0), entry('A1', 1, 1), entry('A1a', 2, 2), entry('A2', 3, 1), entry('B', 4, 0)];
        const { parentOf, hasChildren } = tocGroups(flat);
        expect(parentOf).toEqual([-1, 0, 1, 0, -1]);
        expect(hasChildren).toEqual([true, true, false, false, false]);
        expect(tocAncestors(parentOf, 2)).toEqual([1, 0]);
        expect(tocAncestors(parentOf, -1)).toEqual([]);
    });
});
