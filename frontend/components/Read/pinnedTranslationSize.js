// Size of the sentence translation in the bar under the reader's header.
// Kept free of imports so it can be used anywhere.

export const PINNED_TRANSLATION_FONT_MIN = 13;
export const PINNED_TRANSLATION_FONT_MAX = 30;
export const PINNED_TRANSLATION_FONT_DEFAULT = 17;
// A touch smaller than the book's text, so it reads as a companion to the
// page rather than part of it.
const READER_FONT_RATIO = 0.95;
export const PINNED_TRANSLATION_PADDING_V = 14;
// The bar shows 0 to this many lines (dragged at its grip; 0 folds it away);
// a longer translation scrolls inside it.
export const PINNED_TRANSLATION_MAX_LINES = 4;
export const PINNED_TRANSLATION_DEFAULT_LINES = 4;
// The grip under the bar (a hairline with a handle) that resizes it.
export const PINNED_TRANSLATION_GRIP_HEIGHT = 22;
// Room for the serif's ascenders on the first line (Android font padding).
const FIRST_LINE_ALLOWANCE = 4;

export const clampPinnedTranslationFontSize = (value) => {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return PINNED_TRANSLATION_FONT_DEFAULT;
    return Math.min(PINNED_TRANSLATION_FONT_MAX, Math.max(PINNED_TRANSLATION_FONT_MIN, numeric));
};

// The translation's size for a reader font size: it follows the book's text,
// so a large reading font never sits under a small translation, or the reverse.
export const pinnedTranslationFontSizeForReader = (readerFontSize) => (
    clampPinnedTranslationFontSize(Number(readerFontSize) * READER_FONT_RATIO)
);

export const pinnedTranslationLineHeight = (fontSize) => Math.round(fontSize * 1.6);

export const clampPinnedTranslationLines = (value) => {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return PINNED_TRANSLATION_DEFAULT_LINES;
    return Math.min(PINNED_TRANSLATION_MAX_LINES, Math.max(0, numeric));
};

// Height of the bar above its grip (without a status-bar inset): exactly
// `lines` lines of translation at the font size, so the next never peeks in;
// 0 lines is no bar at all.
export const pinnedTranslationBarHeight = (fontSize, lines = PINNED_TRANSLATION_DEFAULT_LINES) => {
    const count = clampPinnedTranslationLines(lines);
    if (count === 0) return 0;
    const size = clampPinnedTranslationFontSize(fontSize);
    return count * pinnedTranslationLineHeight(size)
        + 2 * PINNED_TRANSLATION_PADDING_V
        + FIRST_LINE_ALLOWANCE;
};

// The line count whose bar height is nearest to `height` (a drag in progress).
export const nearestPinnedTranslationLines = (height, fontSize) => {
    let best = 0;
    for (let lines = 1; lines <= PINNED_TRANSLATION_MAX_LINES; lines += 1) {
        if (Math.abs(pinnedTranslationBarHeight(fontSize, lines) - height)
            < Math.abs(pinnedTranslationBarHeight(fontSize, best) - height)) {
            best = lines;
        }
    }
    return best;
};
