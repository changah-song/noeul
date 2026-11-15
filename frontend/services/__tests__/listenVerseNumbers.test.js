import { blankGluedVerseNumbers } from '../listenVerseNumbers';

describe('blankGluedVerseNumbers', () => {
    it('blanks a verse number glued to the next word and keeps the length', () => {
        const text = 'and it was so. 26Then God said, 27So God created';
        const out = blankGluedVerseNumbers(text);
        expect(out).toBe('and it was so.   Then God said,   So God created');
        expect(out).toHaveLength(text.length);
    });

    it('blanks one glued to a small word or at the start', () => {
        expect(blankGluedVerseNumbers('1In the beginning')).toBe(' In the beginning');
        expect(blankGluedVerseNumbers('the earth; 4and God saw')).toBe('the earth;  and God saw');
    });

    it('keeps ordinals, units, decades and short labels', () => {
        const text = 'the 2nd and 4th day, 10am, 5km, the 90s, a 3D film, 100mph, 5in';
        expect(blankGluedVerseNumbers(text)).toBe(text);
    });

    it('keeps numbers with a space after them or inside a word', () => {
        const text = 'Genesis 1 26 and B52bomber or abc123def';
        expect(blankGluedVerseNumbers(text)).toBe(text);
    });
});
