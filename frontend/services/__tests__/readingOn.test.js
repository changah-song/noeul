import { isReadingOn } from '../readingOn';

// What sends the reader full screen by itself: reading on, and nothing else.

const at = (spineIndex, page, total = 10) => ({ spineIndex, page, total });

describe('isReadingOn', () => {
    it('counts turning to the next page', () => {
        expect(isReadingOn(at(3, 4), at(3, 5))).toBe(true);
    });

    it('counts the next chapter opening at its start', () => {
        expect(isReadingOn(at(3, 9), at(4, 0, 6))).toBe(true);
        expect(isReadingOn(at(3, 9), at(4, 2, 6))).toBe(false);
    });

    it('does not count going back', () => {
        expect(isReadingOn(at(3, 5), at(3, 4))).toBe(false);
        expect(isReadingOn(at(4, 0), at(3, 9))).toBe(false);
    });

    it('does not count staying put or jumping ahead', () => {
        expect(isReadingOn(at(3, 5), at(3, 5))).toBe(false);
        expect(isReadingOn(at(3, 1), at(3, 6))).toBe(false);
        expect(isReadingOn(at(3, 1), at(7, 0))).toBe(false);
    });

    it('does not count a relayout, where the page count changes', () => {
        expect(isReadingOn(at(3, 4, 10), at(3, 5, 11))).toBe(false);
    });

    it('lets one scroll-mode fling cover a few screens', () => {
        expect(isReadingOn(at(3, 1), at(3, 3), { scroll: true })).toBe(true);
        expect(isReadingOn(at(3, 1), at(3, 4), { scroll: true })).toBe(true);
        expect(isReadingOn(at(3, 1), at(3, 5), { scroll: true })).toBe(false);
        expect(isReadingOn(at(3, 1), at(3, 3))).toBe(false);
    });

    it('needs two positions it can read', () => {
        expect(isReadingOn(null, at(3, 1))).toBe(false);
        expect(isReadingOn(at(3, 1), { spineIndex: 3, page: null, total: 10 })).toBe(false);
    });
});
