// Size of the pinned sentence translation and the height the bar reserves
// for it. Kept free of imports so it can be used anywhere.

export const PINNED_TRANSLATION_FONT_MIN = 12;
export const PINNED_TRANSLATION_FONT_MAX = 28;
export const PINNED_TRANSLATION_FONT_DEFAULT = 17;
// The translation is set smaller than the book's text, so it reads as a
// companion to the page rather than part of it.
const READER_FONT_RATIO = 0.82;
// Lines of translation the bar shows; a longer one scrolls inside it.
export const PINNED_TRANSLATION_VISIBLE_LINES = 2;
export const PINNED_TRANSLATION_PADDING_V = 10;

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

export const pinnedTranslationLineHeight = (fontSize) => Math.round(fontSize * 1.4);

// Height the bar reserves under the header: always two lines of translation.
// It is part of the reader's layout, so it only changes with the font size or
// when the bar is turned off (both re-paginate).
export const pinnedTranslationBarHeight = (fontSize, shown = true) => {
    if (!shown) return 0;
    const size = clampPinnedTranslationFontSize(fontSize);
    return Math.round(PINNED_TRANSLATION_VISIBLE_LINES * pinnedTranslationLineHeight(size))
        + 2 * PINNED_TRANSLATION_PADDING_V;
};
