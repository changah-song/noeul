// The reader goes full screen by itself once the reader reads on, and a tap
// on the page brings its controls back (screens/Read.js). This decides what
// counts as reading on, from two page events in a row.

// A deliberate jump (contents, scrubber, bookmark) or a relayout settles
// within this long; page events until then are that, not reading on.
export const SEEK_SETTLE_MS = 1500;

// In scroll mode a "page" is a screen's height, and one fling can cover a
// few of them.
const SCROLL_MAX_STEP = 3;

/**
 * Reading on, as opposed to looking around: the next page (in scroll mode up
 * to a few screens down), or the next chapter's start. Going back, a jump,
 * or a relayout (the chapter's page count changed, as it does when the
 * controls come or go) is not. Positions are page events:
 * { spineIndex, page, total }.
 */
export const isReadingOn = (previous, next, { scroll = false } = {}) => {
    if (!previous || !next) return false;
    if (![previous.spineIndex, previous.page, next.spineIndex, next.page].every(Number.isInteger)) return false;
    if (next.spineIndex === previous.spineIndex + 1) return next.page === 0;
    if (next.spineIndex !== previous.spineIndex || next.total !== previous.total) return false;
    const step = next.page - previous.page;
    return step >= 1 && step <= (scroll ? SCROLL_MAX_STEP : 1);
};
