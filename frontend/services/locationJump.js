// The reader's spot is held when they jump away (contents, scrubber, a
// bookmark) so they can go back; reading on moves it. This tells the two
// apart from two positions in a row (screens/Read.js, processNativePageChange).
// Positions: { spineIndex, pageIndex, pagesInChapter }.

// Whether going from `previous` to `next` (spine + page) was a jump rather
// than reading on: another chapter that isn't the next one entered at its
// start (or the one before, paging back from its start), or more than a few
// pages at once in paged mode. A vertical fling or focus steps can move far
// within a chapter, so only chapter changes count there.
const LOCATION_JUMP_PAGES = 3;
// A relayout (full screen, a font change) renumbers a chapter's pages: page 25
// of 40 can become page 21 of 34. A page from before it is compared where it
// would fall now, by how far into the chapter it was.
export const pageInLayout = (position, pagesInChapter) => {
    const before = position.pagesInChapter;
    if (!Number.isInteger(before) || before <= 0 || !Number.isInteger(pagesInChapter) || before === pagesInChapter) {
        return position.pageIndex;
    }
    return Math.round((position.pageIndex / before) * pagesInChapter);
};
const pageDistance = (previous, next) => (
    Math.abs(next.pageIndex - pageInLayout(previous, next.pagesInChapter))
);
export const isLocationJump = (previous, next, { pagedWithinChapter = true } = {}) => {
    if (!previous || !next) return false;
    if (!Number.isInteger(previous.spineIndex) || !Number.isInteger(next.spineIndex)) return false;
    if (previous.spineIndex === next.spineIndex) {
        return pagedWithinChapter
            && Number.isInteger(previous.pageIndex)
            && Number.isInteger(next.pageIndex)
            && pageDistance(previous, next) > LOCATION_JUMP_PAGES;
    }
    const lastPage = Number.isInteger(previous.pagesInChapter) ? previous.pagesInChapter - 1 : null;
    const forwardOn = next.spineIndex === previous.spineIndex + 1
        && next.pageIndex === 0
        && (lastPage === null || previous.pageIndex >= lastPage - 1);
    const backOn = next.spineIndex === previous.spineIndex - 1 && previous.pageIndex === 0;
    return !forwardOn && !backOn;
};
export const isNearPosition = (a, b) => (
    Boolean(a && b)
    && a.spineIndex === b.spineIndex
    && Number.isInteger(a.pageIndex)
    && Number.isInteger(b.pageIndex)
    && pageDistance(a, b) <= 1
);
