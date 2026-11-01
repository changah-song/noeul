const { spokenRangeAt, remainingFrom } = require('../listenSpokenWord');

// Two sentences read as one text: "Hello there." (block a, 10..22) then
// "Bye now." (block b, 0..8), joined with a space, so "Bye" sits at 13.
const segments = [
    { blockId: 'a', start: 10, end: 22, at: 0 },
    { blockId: 'b', start: 0, end: 8, at: 13 },
];

describe('spokenRangeAt', () => {
    it('maps a word in the first sentence to its block offsets', () => {
        // "there" is 6..11 in the text.
        expect(spokenRangeAt(segments, 6, 11)).toEqual({ blockId: 'a', start: 16, end: 21 });
    });

    it('maps a word in a later sentence past the joining space', () => {
        expect(spokenRangeAt(segments, 13, 16)).toEqual({ blockId: 'b', start: 0, end: 3 });
    });

    it('keeps the range inside its sentence', () => {
        expect(spokenRangeAt(segments, 17, 40)).toEqual({ blockId: 'b', start: 4, end: 8 });
    });

    it('lights at least one character when the engine reports an empty range', () => {
        expect(spokenRangeAt(segments, 2, 2)).toEqual({ blockId: 'a', start: 12, end: 13 });
    });

    it('returns null for the joining space and for missing segments', () => {
        expect(spokenRangeAt(segments, 12, 13)).toBeNull();
        expect(spokenRangeAt(undefined, 0, 3)).toBeNull();
        expect(spokenRangeAt([{ blockId: 'a' }], 0, 3)).toBeNull();
    });
});

describe('remainingFrom', () => {
    it('starts at the word the voice reached', () => {
        expect(remainingFrom('Hello there friend.', 6)).toEqual({ text: 'there friend.', base: 6 });
    });

    it('skips spaces so the engine offsets line up', () => {
        expect(remainingFrom('Hello there.', 5)).toEqual({ text: 'there.', base: 6 });
    });

    it('reads the whole sentence from 0 and nothing past the end', () => {
        expect(remainingFrom('Hi.', 0)).toEqual({ text: 'Hi.', base: 0 });
        expect(remainingFrom('Hi.', 99)).toEqual({ text: '', base: 3 });
        expect(remainingFrom('Hi.', undefined)).toEqual({ text: 'Hi.', base: 0 });
    });
});
