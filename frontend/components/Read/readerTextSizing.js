import { Platform } from 'react-native';

// Sizes that follow the reader (and the phone) rather than being fixed.

const DEFAULT_READER_FONT_SIZE = 18;
// The sentence translation at the top follows the reader's font size, a
// little smaller than the book's text. How much smaller depends on the two
// scripts, because the same font size is not the same size on screen: a
// Hangul or Chinese character fills about 0.9 of the font size, a lowercase
// Latin letter about 0.55 (measured from Noto Serif KR, Inter and the system
// Hangul font). Sizes below are for the default reader size, 18.
const TRANSLATION_SIZE_AT_DEFAULT = {
    // Korean or Chinese book, Korean / Chinese / Japanese translation: like
    // against like, one step smaller.
    fullOverFull: 17,
    // Korean or Chinese book, English (or other alphabet) translation: at 17
    // the dense sans lines read as larger than the airy page under them.
    compactOverFull: 15,
    // English book, Korean / Chinese / Japanese translation: at 17 a
    // character stands taller than the book's capitals; at 15 it matches them.
    fullOverCompact: 15,
    // English book, alphabet translation: Inter's letters are as tall at 17
    // as the book's serif ones at 18 and wider, so it takes 16 to read smaller.
    compactOverCompact: 16,
};

// Scripts whose characters fill the whole square: Hangul, Chinese, Japanese.
const FULL_SQUARE_LANGUAGES = ['ko', 'zh', 'ja'];
const isFullSquare = (language) => (
    FULL_SQUARE_LANGUAGES.includes(String(language || '').trim().toLowerCase().split(/[-_]/)[0])
);

// With no languages given, the size is the like-against-like one.
export const translationTextSize = (readerFontSize, { bookLanguage, translationLanguage } = {}) => {
    const base = Number.isFinite(readerFontSize) && readerFontSize > 0 ? readerFontSize : DEFAULT_READER_FONT_SIZE;
    let pair = 'fullOverFull';
    if (bookLanguage && translationLanguage) {
        const book = isFullSquare(bookLanguage) ? 'Full' : 'Compact';
        pair = `${isFullSquare(translationLanguage) ? 'full' : 'compact'}Over${book}`;
    }
    const scale = TRANSLATION_SIZE_AT_DEFAULT[pair] / DEFAULT_READER_FONT_SIZE;
    const fontSize = Math.min(26, Math.max(13, Math.round(base * scale)));
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
