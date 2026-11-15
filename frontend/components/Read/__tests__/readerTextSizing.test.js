const { translationTextSize, dictionaryBottomPadding } = require('../readerTextSizing');

describe('translationTextSize', () => {
    it('is 17 at the default reader size, a bit bigger than before', () => {
        expect(translationTextSize(18)).toEqual({ fontSize: 17, lineHeight: 25 });
        expect(translationTextSize(undefined).fontSize).toBe(17);
    });

    it('follows the reader font size within bounds', () => {
        expect(translationTextSize(24).fontSize).toBe(23);
        expect(translationTextSize(12).fontSize).toBe(13);
        expect(translationTextSize(40).fontSize).toBe(26);
    });

    it('is smaller for an English translation of a Korean or Chinese book', () => {
        const english = { translationLanguage: 'en' };
        expect(translationTextSize(18, { ...english, bookLanguage: 'ko' }).fontSize).toBe(15);
        expect(translationTextSize(18, { ...english, bookLanguage: 'zh' }).fontSize).toBe(15);
        expect(translationTextSize(24, { ...english, bookLanguage: 'ko' }).fontSize).toBe(20);
    });

    it('is smaller for a Korean or Chinese translation of an English book', () => {
        expect(translationTextSize(18, { bookLanguage: 'en', translationLanguage: 'ko' }).fontSize).toBe(15);
        expect(translationTextSize(18, { bookLanguage: 'en', translationLanguage: 'zh-Hant' }).fontSize).toBe(15);
    });

    it('stays one step under the book when both scripts are alike', () => {
        expect(translationTextSize(18, { bookLanguage: 'zh', translationLanguage: 'ko' }).fontSize).toBe(17);
        expect(translationTextSize(18, { bookLanguage: 'ko', translationLanguage: 'ja' }).fontSize).toBe(17);
        expect(translationTextSize(18, { bookLanguage: 'en', translationLanguage: 'fr' }).fontSize).toBe(16);
    });
});

describe('dictionaryBottomPadding', () => {
    it('keeps the Android padding', () => {
        expect(dictionaryBottomPadding(24, 'android')).toBe(50);
        expect(dictionaryBottomPadding(0, 'android')).toBe(26);
    });

    it('leaves a small margin above the iOS home indicator', () => {
        expect(dictionaryBottomPadding(34, 'ios')).toBe(44);
        expect(dictionaryBottomPadding(0, 'ios')).toBe(26);
    });
});
