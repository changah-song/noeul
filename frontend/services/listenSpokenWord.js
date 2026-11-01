// Listen mode follows the voice word by word: the engine reports offsets in
// the text it was handed, and the reader view lights words by block-local
// offsets. These helpers translate between the two, and pick up a sentence
// again where a pause left it.

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
