// Size of the pinned sentence translation (Settings → Words → Sentence
// translation) and the height the bar reserves for it. Kept free of imports so
// the settings sheet can use it without loading the translation services.

export const PINNED_TRANSLATION_FONT_MIN = 14;
export const PINNED_TRANSLATION_FONT_MAX = 24;
export const PINNED_TRANSLATION_FONT_DEFAULT = 17;
// Lines of translation the open bar shows: two full lines and half of a third,
// faded, which says there is more to scroll to.
export const PINNED_TRANSLATION_VISIBLE_LINES = 2.5;
export const PINNED_TRANSLATION_PADDING_V = 10;
// The folded bar: just the chevron that opens it again.
export const PINNED_TRANSLATION_COLLAPSED_HEIGHT = 20;

export const clampPinnedTranslationFontSize = (value) => {
    const numeric = Math.round(Number(value));
    if (!Number.isFinite(numeric)) return PINNED_TRANSLATION_FONT_DEFAULT;
    return Math.min(PINNED_TRANSLATION_FONT_MAX, Math.max(PINNED_TRANSLATION_FONT_MIN, numeric));
};

export const pinnedTranslationLineHeight = (fontSize) => Math.round(fontSize * 1.4);

// Height the bar reserves under the header. It is part of the reader's layout,
// so it only changes with the text size or when the bar is folded (both
// re-paginate, like the book's own font size).
export const pinnedTranslationBarHeight = (fontSize, open = true) => {
    if (!open) return PINNED_TRANSLATION_COLLAPSED_HEIGHT;
    const size = clampPinnedTranslationFontSize(fontSize);
    return Math.round(PINNED_TRANSLATION_VISIBLE_LINES * pinnedTranslationLineHeight(size))
        + 2 * PINNED_TRANSLATION_PADDING_V;
};
