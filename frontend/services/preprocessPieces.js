// Word help for a chapter is prepared in pieces, so a very long chapter (or a
// book with no chapter breaks, which reads as one long chapter) is never sent
// to the server whole. Only the pieces near the reader are prepared:
//
//   the open chapter   the piece being read and the one after it, and the
//                      next ones as the reader gets to them
//   a chapter ahead    its first piece (where the reader comes in)
//   the chapter before its last piece (where a step back lands)
//
// Which pieces are done is stored with the chapter (piece_progress), so
// nothing is sent twice.
import { countReadableTextWords } from './epubMetadata';

// A piece is whole paragraphs, at most this many words (a single longer
// paragraph is its own piece), so no one request can time out.
export const PREPROCESS_PIECE_WORDS = 2500;
// Pieces of the open chapter prepared past the one being read.
export const OPEN_CHAPTER_PIECES_AHEAD = 1;

const blockText = (block) => (
    !block?.excludeFromText && typeof block?.text === 'string' ? block.text : ''
);

// The chapter's text in pieces, and for each block id the first and last
// piece its text went into (a block with no text, like an image, belongs to
// the piece around it).
export const splitChapterForPreprocess = (blocks = []) => {
    const pieces = [];
    const blockPieces = new Map();
    let current = [];
    let currentWords = 0;

    (Array.isArray(blocks) ? blocks : []).forEach((block) => {
        const paragraphs = blockText(block).split(/\n+/).filter((paragraph) => paragraph.trim());
        let firstPiece = null;
        paragraphs.forEach((paragraph) => {
            const words = countReadableTextWords(paragraph);
            if (current.length > 0 && currentWords + words > PREPROCESS_PIECE_WORDS) {
                pieces.push(current.join('\n'));
                current = [];
                currentWords = 0;
            }
            if (firstPiece === null) firstPiece = pieces.length;
            current.push(paragraph);
            currentWords += words;
        });
        if (block?.id) {
            const first = firstPiece ?? pieces.length;
            blockPieces.set(block.id, [first, pieces.length]);
        }
    });
    if (current.length > 0) pieces.push(current.join('\n'));

    return { pieces, blockPieces };
};

// The piece the reader is in. The page's first block says it exactly, unless
// that block runs over several pieces (a book that's one long block); then,
// and when there's no block, how far through the chapter's pages they are.
export const pieceForPosition = (layout, position) => {
    const count = layout?.pieces?.length ?? 0;
    if (count <= 1) return 0;
    const clamp = (piece) => Math.min(Math.max(piece, 0), count - 1);

    const { firstBlockId, pageIndex, pagesInChapter } = position || {};
    const byPage = (
        Number.isInteger(pageIndex) && Number.isInteger(pagesInChapter) && pagesInChapter > 0
            ? Math.floor((pageIndex / pagesInChapter) * count)
            : null
    );
    const range = firstBlockId ? layout.blockPieces?.get(firstBlockId) : null;
    if (range) {
        const [first, last] = range;
        return clamp(byPage == null ? first : Math.min(Math.max(byPage, first), last));
    }
    return clamp(byPage ?? 0);
};

// The pieces of a chapter to have ready, by where it sits from the open one.
export const piecesToPrepare = ({ spineIndex, centerSpineIndex, pieceCount, readingPiece = 0 }) => {
    if (!(pieceCount > 0)) return [];
    if (spineIndex === centerSpineIndex) {
        const start = Math.min(Math.max(readingPiece, 0), pieceCount - 1);
        const end = Math.min(start + OPEN_CHAPTER_PIECES_AHEAD, pieceCount - 1);
        const pieces = [];
        for (let piece = start; piece <= end; piece += 1) pieces.push(piece);
        return pieces;
    }
    return spineIndex < centerSpineIndex ? [pieceCount - 1] : [0];
};

// A chapter's stored piece_progress, or null when there's none (or it can't
// be read, which means starting the chapter over).
export const parsePieceProgress = (stored) => {
    if (!stored) return null;
    try {
        const progress = typeof stored === 'string' ? JSON.parse(stored) : stored;
        if (Number.isInteger(progress?.count) && Array.isArray(progress?.done)) {
            return {
                count: progress.count,
                done: progress.done.filter((piece) => Number.isInteger(piece)),
            };
        }
    } catch {
        // Unreadable: treated as nothing done.
    }
    return null;
};
