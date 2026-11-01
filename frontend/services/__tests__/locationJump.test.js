import { isLocationJump, isNearPosition, pageInLayout } from '../locationJump';

// When the reader is asked "is this your new spot?": a jump, not reading on,
// and not the same spot laid out again.

const at = (spineIndex, pageIndex, pagesInChapter = 40) => ({ spineIndex, pageIndex, pagesInChapter });

describe('pageInLayout', () => {
    it('keeps the page when the layout is the same', () => {
        expect(pageInLayout(at(3, 25), 40)).toBe(25);
    });

    it('places a page where it falls after a relayout', () => {
        // Full screen fits more on a page: 25 of 40 is about 21 of 34.
        expect(pageInLayout(at(3, 25), 34)).toBe(21);
        expect(pageInLayout(at(3, 21, 34), 40)).toBe(25);
    });

    it('keeps the page when the old count is unknown', () => {
        expect(pageInLayout(at(3, 25, null), 34)).toBe(25);
    });
});

describe('isLocationJump', () => {
    it('does not count turning a page or two', () => {
        expect(isLocationJump(at(3, 10), at(3, 11))).toBe(false);
        expect(isLocationJump(at(3, 10), at(3, 13))).toBe(false);
    });

    it('counts more than a few pages at once', () => {
        expect(isLocationJump(at(3, 10), at(3, 20))).toBe(true);
    });

    it('does not count the same spot renumbered by a relayout', () => {
        // Going full screen: page 25 of 40 becomes page 21 of 34.
        expect(isLocationJump(at(3, 25), at(3, 21, 34))).toBe(false);
        // And back out of it.
        expect(isLocationJump(at(3, 21, 34), at(3, 25))).toBe(false);
    });

    it('still counts a real jump across a relayout', () => {
        expect(isLocationJump(at(3, 25), at(3, 5, 34))).toBe(true);
    });

    it('only counts chapter changes in scroll mode', () => {
        expect(isLocationJump(at(3, 1), at(3, 30), { pagedWithinChapter: false })).toBe(false);
        expect(isLocationJump(at(3, 1), at(7, 0), { pagedWithinChapter: false })).toBe(true);
    });

    it('does not count reading into the next chapter or back into the last', () => {
        expect(isLocationJump(at(3, 39), at(4, 0))).toBe(false);
        expect(isLocationJump(at(4, 0), at(3, 39))).toBe(false);
    });

    it('counts entering another chapter from its middle', () => {
        expect(isLocationJump(at(3, 10), at(4, 0))).toBe(true);
    });
});

describe('isNearPosition', () => {
    it('is near on the same or the next page', () => {
        expect(isNearPosition(at(3, 10), at(3, 11))).toBe(true);
        expect(isNearPosition(at(3, 10), at(3, 12))).toBe(false);
    });

    it('is near on the same spot after a relayout', () => {
        expect(isNearPosition(at(3, 25), at(3, 21, 34))).toBe(true);
    });

    it('is not near in another chapter', () => {
        expect(isNearPosition(at(3, 10), at(4, 10))).toBe(false);
    });
});
