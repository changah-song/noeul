import {
    OPEN_CHAPTER_PIECES_AHEAD,
    PREPROCESS_PIECE_WORDS,
    parsePieceProgress,
    pieceForPosition,
    piecesToPrepare,
    splitChapterForPreprocess,
} from '../preprocessPieces';

const words = (count, word = 'word') => Array.from({ length: count }, () => word).join(' ');
const block = (id, text, extra = {}) => ({ id, text, ...extra });

describe('splitChapterForPreprocess', () => {
    it('keeps a short chapter in one piece', () => {
        const { pieces, blockPieces } = splitChapterForPreprocess([
            block('b1', 'one two'),
            block('b2', 'three'),
        ]);
        expect(pieces).toEqual(['one two\nthree']);
        expect(blockPieces.get('b2')).toEqual([0, 0]);
    });

    it('starts a new piece before a paragraph that would go over the limit', () => {
        const half = Math.floor(PREPROCESS_PIECE_WORDS / 2) + 1;
        const { pieces, blockPieces } = splitChapterForPreprocess([
            block('b1', words(half)),
            block('b2', words(half)),
            block('b3', words(half)),
        ]);
        expect(pieces).toHaveLength(3);
        expect(blockPieces.get('b1')).toEqual([0, 0]);
        expect(blockPieces.get('b3')).toEqual([2, 2]);
    });

    it('splits one long block of many paragraphs (a book with no chapter breaks)', () => {
        const paragraphs = Array.from({ length: 10 }, () => words(1000)).join('\n');
        const { pieces, blockPieces } = splitChapterForPreprocess([block('only', paragraphs)]);
        expect(pieces).toHaveLength(5);
        expect(blockPieces.get('only')).toEqual([0, 4]);
    });

    it('leaves out text marked excludeFromText, but still places the block', () => {
        const { pieces, blockPieces } = splitChapterForPreprocess([
            block('b1', 'kept'),
            block('img', 'caption', { excludeFromText: true }),
        ]);
        expect(pieces).toEqual(['kept']);
        expect(blockPieces.get('img')).toEqual([0, 0]);
    });

    it('gives an empty chapter no pieces', () => {
        expect(splitChapterForPreprocess([]).pieces).toEqual([]);
        expect(splitChapterForPreprocess(null).pieces).toEqual([]);
    });
});

describe('pieceForPosition', () => {
    const layout = splitChapterForPreprocess([
        block('a', words(2000)),
        block('b', words(2000)),
        block('c', words(2000)),
        block('d', words(2000)),
    ]);

    it('uses the page\'s first block when it sits in one piece', () => {
        expect(pieceForPosition(layout, { firstBlockId: 'c', pageIndex: 0, pagesInChapter: 40 })).toBe(2);
    });

    it('falls back to how far through the pages the reader is', () => {
        expect(pieceForPosition(layout, { pageIndex: 30, pagesInChapter: 40 })).toBe(3);
        expect(pieceForPosition(layout, { pageIndex: 0, pagesInChapter: 40 })).toBe(0);
    });

    it('uses the page within a block that runs over several pieces', () => {
        const oneBlock = splitChapterForPreprocess([
            block('only', Array.from({ length: 10 }, () => words(1000)).join('\n')),
        ]);
        expect(pieceForPosition(oneBlock, { firstBlockId: 'only', pageIndex: 70, pagesInChapter: 100 })).toBe(3);
    });

    it('starts at the beginning with nothing to go on', () => {
        expect(pieceForPosition(layout, null)).toBe(0);
        expect(pieceForPosition(layout, { firstBlockId: 'missing' })).toBe(0);
    });
});

describe('piecesToPrepare', () => {
    it('takes the piece being read and the one after in the open chapter', () => {
        expect(piecesToPrepare({ spineIndex: 4, centerSpineIndex: 4, pieceCount: 10, readingPiece: 3 }))
            .toEqual([3, 3 + OPEN_CHAPTER_PIECES_AHEAD]);
    });

    it('stops at the open chapter\'s last piece', () => {
        expect(piecesToPrepare({ spineIndex: 4, centerSpineIndex: 4, pieceCount: 10, readingPiece: 9 }))
            .toEqual([9]);
    });

    it('takes the first piece of a chapter ahead and the last of the one before', () => {
        expect(piecesToPrepare({ spineIndex: 5, centerSpineIndex: 4, pieceCount: 6 })).toEqual([0]);
        expect(piecesToPrepare({ spineIndex: 3, centerSpineIndex: 4, pieceCount: 6 })).toEqual([5]);
    });

    it('has nothing for a chapter with no text', () => {
        expect(piecesToPrepare({ spineIndex: 4, centerSpineIndex: 4, pieceCount: 0 })).toEqual([]);
    });
});

describe('parsePieceProgress', () => {
    it('reads what markBookPreprocessChapter stored', () => {
        expect(parsePieceProgress('{"count":4,"done":[0,1]}')).toEqual({ count: 4, done: [0, 1] });
    });

    it('treats missing or unreadable progress as nothing done', () => {
        expect(parsePieceProgress(null)).toBeNull();
        expect(parsePieceProgress('not json')).toBeNull();
        expect(parsePieceProgress('{"done":[0]}')).toBeNull();
    });
});
