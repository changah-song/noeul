import { Platform } from 'react-native';

// Sizes that follow the reader (and the phone) rather than being fixed.

const DEFAULT_READER_FONT_SIZE = 18;
// The sentence translation at the top: a little smaller than the book's
// text, following the reader's font size (17 at the default 18).
const TRANSLATION_SCALE = 17 / 18;

export const translationTextSize = (readerFontSize) => {
    const base = Number.isFinite(readerFontSize) && readerFontSize > 0 ? readerFontSize : DEFAULT_READER_FONT_SIZE;
    const fontSize = Math.min(26, Math.max(14, Math.round(base * TRANSLATION_SCALE)));
    return { fontSize, lineHeight: Math.round(fontSize * 1.45) };
};

// Space under the lookup panel's last line. On iOS the home indicator's inset
// (34pt) is itself mostly empty, so the full padding on top of it left a tall
// gap; a small margin above the indicator is enough there.
export const DICTIONARY_BOTTOM_PADDING = 26;
const IOS_HOME_INDICATOR_MARGIN = 10;

export const dictionaryBottomPadding = (bottomInset, platform = Platform.OS) => (
    platform === 'ios' && bottomInset > 0
        ? bottomInset + IOS_HOME_INDICATOR_MARGIN
        : DICTIONARY_BOTTOM_PADDING + bottomInset
);
