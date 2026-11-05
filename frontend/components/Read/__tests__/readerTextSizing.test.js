const { translationTextSize, dictionaryBottomPadding } = require('../readerTextSizing');

describe('translationTextSize', () => {
    it('is 17 at the default reader size, a bit bigger than before', () => {
        expect(translationTextSize(18)).toEqual({ fontSize: 17, lineHeight: 25 });
        expect(translationTextSize(undefined).fontSize).toBe(17);
    });

    it('follows the reader font size within bounds', () => {
        expect(translationTextSize(24).fontSize).toBe(23);
        expect(translationTextSize(12).fontSize).toBe(14);
        expect(translationTextSize(40).fontSize).toBe(26);
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
