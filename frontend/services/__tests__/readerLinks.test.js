import {
    blankNoteMarkers,
    linkAtOffset,
    linkRangesForBlock,
    resolveLinkTarget,
    silentRangesForBlock,
} from '../readerLinks';

// A block the way epubMetadata builds it: spans with offsets, text joined.
const blockOf = (id, parts) => {
    let offset = 0;
    const spans = parts.map(([text, href = null, marks = []]) => {
        const span = { text, href, marks, startOffset: offset, endOffset: offset + text.length };
        offset += text.length;
        return span;
    });
    return { id, text: parts.map(([text]) => text).join(''), spans };
};

describe('linkRangesForBlock', () => {
    it('joins the spans of one link', () => {
        const block = blockOf('b', [['See '], ['the ', 'n.xhtml#a'], ['note', 'n.xhtml#a', ['a', 'em']], ['.']]);
        expect(linkRangesForBlock(block)).toEqual([
            { href: 'n.xhtml#a', start: 4, end: 12, text: 'the note', raised: false },
        ]);
    });

    it('finds the link under an offset', () => {
        const block = blockOf('b', [['word'], ['1', '#fn1', ['a', 'sup']], [' next']]);
        expect(linkAtOffset(block, 4)?.href).toBe('#fn1');
        expect(linkAtOffset(block, 3)).toBeNull();
        expect(linkAtOffset(block, 5)).toBeNull();
        expect(linkAtOffset(block, undefined)).toBeNull();
    });
});

describe('silentRangesForBlock', () => {
    it('silences number and symbol markers', () => {
        const block = blockOf('b', [['He left.'], ['1', '#fn1'], [' She stayed'], ['*', '#fn2'], ['.']]);
        expect(silentRangesForBlock(block)).toEqual([{ start: 8, end: 9 }, { start: 20, end: 21 }]);
    });

    it('takes the brackets written around a marker', () => {
        const block = blockOf('b', [['He left.['], ['12', '#fn12'], ['] Then']]);
        expect(silentRangesForBlock(block)).toEqual([{ start: 8, end: 12 }]);
    });

    it('silences a short raised label but keeps a linked word', () => {
        const block = blockOf('b', [['Go'], ['a', '#fna', ['sup', 'a']], [' to '], ['Chapter 2', 'c2.xhtml'], ['.']]);
        expect(silentRangesForBlock(block)).toEqual([{ start: 2, end: 3 }]);
    });

    it('leaves a block that is only links alone', () => {
        const block = blockOf('b', [['1', 'c1.xhtml'], [' · '], ['2', 'c2.xhtml']]);
        expect(silentRangesForBlock(block)).toEqual([]);
    });
});

describe('blankNoteMarkers', () => {
    const block = blockOf('b1', [['One.'], ['1', '#fn1'], [' Two'], ['[2]', '#fn2'], [' more.']]);

    it('blanks the markers and keeps the length', () => {
        const text = block.text;
        const segments = [{ blockId: 'b1', start: 0, end: text.length, at: 0 }];
        const voiced = blankNoteMarkers(text, segments, [block]);
        expect(voiced).toBe('One.  Two    more.');
        expect(voiced).toHaveLength(text.length);
    });

    it('maps a sentence that starts partway into the block', () => {
        // "Two[2] more." starts at 6 in the block, and sits after a space.
        const text = ` ${block.text.slice(6)}`;
        const segments = [{ blockId: 'b1', start: 6, end: block.text.length, at: 1 }];
        expect(blankNoteMarkers(text, segments, [block])).toBe(' Two    more.');
    });

    it('returns the text untouched without segments or a matching block', () => {
        expect(blankNoteMarkers('One.1', null, [block])).toBe('One.1');
        expect(blankNoteMarkers('One.1', [{ blockId: 'x', start: 0, end: 5, at: 0 }], [block])).toBe('One.1');
    });
});

describe('resolveLinkTarget', () => {
    const spine = [
        { index: 0, path: 'OEBPS/Text/ch1.xhtml' },
        { index: 1, path: 'OEBPS/Text/ch 2.xhtml' },
        { index: 2, path: 'OEBPS/notes.xhtml' },
    ];

    it('keeps a bare fragment in the chapter', () => {
        expect(resolveLinkTarget('#fn1', { spine, spineIndex: 0 })).toEqual({
            kind: 'internal', spineIndex: 0, anchor: 'fn1', path: 'OEBPS/Text/ch1.xhtml',
        });
    });

    it('resolves a relative file against the chapter', () => {
        expect(resolveLinkTarget('../notes.xhtml#n%201', { spine, spineIndex: 0 })).toEqual({
            kind: 'internal', spineIndex: 2, anchor: 'n 1', path: 'OEBPS/notes.xhtml',
        });
        expect(resolveLinkTarget('ch%202.xhtml', { spine, spineIndex: 0 })).toMatchObject({
            spineIndex: 1, anchor: null,
        });
    });

    it('passes web addresses through and drops the rest', () => {
        expect(resolveLinkTarget('https://example.com/a', { spine, spineIndex: 0 })).toEqual({
            kind: 'external', url: 'https://example.com/a',
        });
        expect(resolveLinkTarget('mailto:a@example.com', { spine, spineIndex: 0 })).toBeNull();
        expect(resolveLinkTarget('missing.xhtml#x', { spine, spineIndex: 0 })).toBeNull();
        expect(resolveLinkTarget('', { spine, spineIndex: 0 })).toBeNull();
    });
});
