import { blankNoteMarkers } from './readerLinks';
import { blankGluedVerseNumbers } from './listenVerseNumbers';

// Listen mode follows the voice word by word: the engine reports offsets in
// the text it was handed, and the reader view lights words by block-local
// offsets. These helpers translate between the two, and pick up a sentence
// again where a pause left it.


// What the voice says for a focus payload's `rawText`: `text` is the sentence
// trimmed, `leading` the spaces trimmed off its front, and `voiced` the same
// stretch with what is not read aloud turned to spaces. Note markers (the "1"
// or "*" of a footnote link) are not read, and in an English book neither are
// verse numbers glued to a word ("26Then"). `voiced` is as long as `text`, so
// the engine's offsets still match the page.
//
// The sentence being read and the next one fetched ahead for an online voice
// both come through here: asked for with different words, the audio fetched
// ahead would never be the audio played.
export const voicedSentence = (rawText, { segments, blocks, language } = {}) => {
    const raw = typeof rawText === 'string' ? rawText : '';
    const text = raw.trim();
    const leading = raw.length - raw.trimStart().length;
    const unmarked = blankNoteMarkers(raw, segments, blocks);
    const english = String(language || '').toLowerCase().startsWith('en');
    const voiced = (english ? blankGluedVerseNumbers(unmarked) : unmarked).slice(leading, leading + text.length);
    return { text, leading, voiced };
};

// The view range for the stretch [from, to) of the read text. `segments` come
// with the focus payload, one per sentence: { blockId, start, end, at } with
// start/end block-local and `at` where that sentence begins in the text
// (sentences are joined with one space). Null when the offset falls between
// sentences or the payload has no segments.
export const spokenRangeAt = (segments, from, to) => {
    if (!Array.isArray(segments) || !Number.isFinite(from)) return null;
    for (const segment of segments) {
        const { blockId, start, end, at } = segment || {};
        if (typeof blockId !== 'string' || ![start, end, at].every(Number.isFinite)) continue;
        if (from < at || from >= at + (end - start)) continue;
        const localStart = start + (from - at);
        const localEnd = Math.min(end, start + (Math.max(to, from + 1) - at));
        return { blockId, start: localStart, end: localEnd };
    }
    return null;
};

// The part of `text` still to read after a pause at `from`, and where that
// part begins in `text` (leading spaces skipped, since the engine trims them
// and its offsets would shift).
export const remainingFrom = (text, from) => {
    const full = typeof text === 'string' ? text : '';
    const clamped = Math.min(Math.max(0, Math.floor(Number(from)) || 0), full.length);
    const rest = full.slice(clamped);
    const trimmed = rest.trimStart();
    return { text: trimmed, base: clamped + (rest.length - trimmed.length) };
};
