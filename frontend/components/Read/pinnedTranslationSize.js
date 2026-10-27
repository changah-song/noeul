// Size of the pinned sentence translation (Settings → Words → Text size) and
// the height the bar reserves for it. Kept free of imports so the settings
// sheet can use it without loading the translation services.

export const PINNED_TRANSLATION_FONT_MIN = 14;
export const PINNED_TRANSLATION_FONT_MAX = 24;
export const PINNED_TRANSLATION_FONT_DEFAULT = 17;
// Lines of translation the bar shows; a longer one scrolls inside it.
export const PINNED_TRANSLATION_VISIBLE_LINES = 2;
export const PINNED_TRANSLATION_PILL_PADDING_V = 8;
export const PINNED_TRANSLATION_STRIP_PADDING_V = 4;

export const clampPinnedTranslationFontSize = (value) => {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return PINNED_TRANSLATION_FONT_DEFAULT;
    return Math.min(PINNED_TRANSLATION_FONT_MAX, Math.max(PINNED_TRANSLATION_FONT_MIN, numeric));
};

export const pinnedTranslationLineHeight = (fontSize) => Math.round(fontSize * 1.4);

// Height the bar reserves under the header. It is part of the reader's layout,
// so it only changes with the text size (which re-paginates, like the book's
// own font size): two lines of translation plus padding.
export const pinnedTranslationBarHeight = (fontSize) => {
    const size = clampPinnedTranslationFontSize(fontSize);
    return PINNED_TRANSLATION_VISIBLE_LINES * pinnedTranslationLineHeight(size)
        + 2 * PINNED_TRANSLATION_PILL_PADDING_V
        + 2 * PINNED_TRANSLATION_STRIP_PADDING_V;
};
