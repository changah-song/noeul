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

// A piece is whole paragraphs, at most this many words, so no one request can
// time out. A paragraph longer than that on its own (a book that is one block
// of text) is cut at sentence ends.
export const PREPROCESS_PIECE_WORDS = 2500;
// Chinese has no spaces, so its words are counted from its characters.
const HAN_CHARS_PER_WORD = 1.5;
const HAN_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF]+/g;
// Pieces of the open chapter prepared past the one being read.
export const OPEN_CHAPTER_PIECES_AHEAD = 1;

const blockText = (block) => (
    !block?.excludeFromText && typeof block?.text === 'string' ? block.text : ''
);

// How much of a piece a text takes, in words. A run of Chinese characters
// counts by its length (countReadableTextWords takes a whole run as one word,
// which let a Chinese piece grow many times past the limit).
const pieceWords = (text) => {
    let hanChars = 0;
    const rest = text.replace(HAN_RUN, (run) => {
        hanChars += run.length;
        return ' ';
    });
    return countReadableTextWords(rest) + Math.ceil(hanChars / HAN_CHARS_PER_WORD);
};

// A paragraph over the limit, cut into parts under it: at sentence ends, or
// between words when one sentence is itself too long.
const splitLongParagraph = (paragraph) => {
    if (pieceWords(paragraph) <= PREPROCESS_PIECE_WORDS) return [paragraph];

    const cut = (text, pattern) => text.match(pattern) || [text];
    const units = cut(paragraph, /[^.!?。！？…]+[.!?。！？…]*["'”’」』）)]*\s*/g).flatMap((sentence) => (
        pieceWords(sentence) <= PREPROCESS_PIECE_WORDS
            ? [sentence]
            // No sentence ends to cut at: by words, and unspaced text by length.
            : cut(sentence, /\S+\s*/g).flatMap((word) => (
                pieceWords(word) <= PREPROCESS_PIECE_WORDS
                    ? [word]
                    : cut(word, new RegExp(`[\\s\\S]{1,${PREPROCESS_PIECE_WORDS}}`, 'g'))
            ))
    ));

    const parts = [];
    let current = '';
    let currentWords = 0;
    units.forEach((unit) => {
        const words = pieceWords(unit);
        if (current && currentWords + words > PREPROCESS_PIECE_WORDS) {
            parts.push(current.trim());
            current = '';
            currentWords = 0;
        }
        current += unit;
        currentWords += words;
    });
    if (current.trim()) parts.push(current.trim());
    return parts;
};

// The chapter's text in pieces, and for each block id the first and last
// piece its text went into (a block with no text, like an image, belongs to
// the piece around it).
export const splitChapterForPreprocess = (blocks = []) => {
    const pieces = [];
    const blockPieces = new Map();
    let current = [];
    let currentWords = 0;

    (Array.isArray(blocks) ? blocks : []).forEach((block) => {
        const paragraphs = blockText(block)
            .split(/\n+/)
            .filter((paragraph) => paragraph.trim())
            .flatMap(splitLongParagraph);
        let firstPiece = null;
        paragraphs.forEach((paragraph) => {
            const words = pieceWords(paragraph);
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

// What's done of a chapter, from its stored row. A 'partial' chapter from
// before pieces were tracked had just its first piece done (it was prepared
// as a chapter ahead, split the same way); how many pieces it has is unknown
// (count null) until the chapter is opened.
export const storedChapterProgress = (chapter) => {
    const progress = parsePieceProgress(chapter?.piece_progress);
    if (progress) return progress;
    if (chapter?.status === 'partial') return { count: null, done: [0] };
    return null;
};

// Whether the stored progress already covers the one piece a chapter ahead
// (its first) or behind (its last) needs, without opening the chapter.
export const storedProgressCoversNeighbor = ({ spineIndex, centerSpineIndex, progress }) => {
    if (!progress || spineIndex === centerSpineIndex) return false;
    const needed = spineIndex > centerSpineIndex
        ? 0
        : (Number.isInteger(progress.count) && progress.count > 0 ? progress.count - 1 : null);
    return needed !== null && progress.done.includes(needed);
};

// The pieces of the chapter as split now that the stored progress has done:
// none when it was split into a different number of pieces.
export const donePiecesForLayout = (progress, pieceCount) => (
    progress && (progress.count === null || progress.count === pieceCount)
        ? progress.done.filter((piece) => piece < pieceCount)
        : []
);
