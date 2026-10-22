// Sentences the way the native reader cuts them, so a chapter translated up
// front lines up with the sentence a reader taps or listen mode reads.
//
// splitSentences is a line-for-line port of the reader's SentenceSplitter.kt
// (modules/native-epub-reader/android/.../SentenceSplitter.kt); keep them in
// step. The reader splits each paragraph on its own, so chapters are split per
// paragraph too. normalizeSentence is the key both sides are matched on: it
// smooths over the small differences in how the reader hands a sentence back
// (collapsed spaces, stripped quotes, invisible word joiners).

const TERMINAL_PUNCTUATION = new Set(['.', '!', '?', '。', '！', '？']);
const CLOSING_DELIMITERS = new Set([
    ')', ']', '"', '“', '”', '\'', '‘', '’',
    // CJK quotes and brackets that close after the full stop: 。』 。」 。）
    '』', '」', '）', '】', '》', '〉',
]);

const isDigit = (char) => char >= '0' && char <= '9';

const skipLeadingSpace = (text, start) => {
    let i = start;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
    return i;
};

/** [start, end) ranges of the sentences in `text`, like SentenceSplitter.kt. */
export const splitSentences = (text) => {
    if (typeof text !== 'string' || !text) return [];
    const result = [];
    let sentenceStart = skipLeadingSpace(text, 0);
    let i = sentenceStart;

    while (i < text.length) {
        const c = text[i];
        if (c === '\n') {
            if (sentenceStart < i) result.push([sentenceStart, i]);
            sentenceStart = skipLeadingSpace(text, i + 1);
            i = sentenceStart;
        } else if (TERMINAL_PUNCTUATION.has(c)) {
            // A period between digits is a decimal point (3.14), not an end.
            if (c === '.' && i > 0 && isDigit(text[i - 1]) && i + 1 < text.length && isDigit(text[i + 1])) {
                i += 1;
                continue;
            }
            let end = i + 1;
            while (end < text.length && (TERMINAL_PUNCTUATION.has(text[end]) || CLOSING_DELIMITERS.has(text[end]))) {
                end += 1;
            }
            if (sentenceStart < end) result.push([sentenceStart, end]);
            sentenceStart = skipLeadingSpace(text, end);
            i = sentenceStart;
        } else {
            i += 1;
        }
    }

    if (sentenceStart < text.length) result.push([sentenceStart, text.length]);
    return result.filter(([start, end]) => start < end);
};

const WORD_JOINER = /⁠/g;
const EDGE_QUOTES = /^["'“”‘’]+|["'“”‘’]+$/g;

/** The form a sentence is cached and looked up under. */
export const normalizeSentence = (text) => (
    typeof text === 'string'
        ? text.replace(WORD_JOINER, '').replace(/\s+/g, ' ').trim().replace(EDGE_QUOTES, '').trim()
        : ''
);

/** Sentences of one paragraph, normalized, empty ones dropped. */
export const sentencesOf = (text) => splitSentences(text)
    .map(([start, end]) => normalizeSentence(text.slice(start, end)))
    .filter(Boolean);

/**
 * A chapter's distinct sentences in reading order, from its paragraphs (the
 * reader's blocks) or from text with one paragraph per line.
 */
export const chapterSentences = (paragraphs) => {
    const list = Array.isArray(paragraphs)
        ? paragraphs
        : String(paragraphs || '').split('\n');
    const seen = new Set();
    const out = [];
    list.forEach((paragraph) => {
        sentencesOf(String(paragraph || '')).forEach((sentence) => {
            if (seen.has(sentence)) return;
            seen.add(sentence);
            out.push(sentence);
        });
    });
    return out;
};
