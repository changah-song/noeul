import { findActiveBookmark } from '../bookmarks';

// A bookmark as getBookBookmarks returns it.
const bookmark = (overrides = {}) => ({
    id: 'bb_1',
    spineIndex: 3,
    pageIndex: 4,
    pagesInChapter: 12,
    href: 'ch3.xhtml',
    firstBlockId: 'block_88',
    ...overrides,
});

// A reader position as the native page event produces it.
const position = (overrides = {}) => ({
    spineIndex: 3,
    pageIndex: 4,
    firstBlockId: 'block_88',
    ...overrides,
});

describe('findActiveBookmark', () => {
    it('matches the bookmark the reader is sitting on', () => {
        const saved = bookmark();
        expect(findActiveBookmark([saved], position())).toBe(saved);
    });

    it('returns null when nothing is bookmarked in this chapter', () => {
        expect(findActiveBookmark([bookmark({ spineIndex: 7 })], position())).toBeNull();
    });

    it('ignores a bookmark on another page of the same chapter', () => {
        const saved = bookmark({ pageIndex: 9, firstBlockId: 'block_200' });
        expect(findActiveBookmark([saved], position())).toBeNull();
    });

    // The bug this rule exists for: in a book whose chapter is one large block,
    // every page reports the same firstBlockId. Keying on the block id lit the
    // icon on every page of the chapter and let any of them delete the bookmark.
    it('does not match other pages that share a chapter-wide block id', () => {
        const saved = bookmark({ pageIndex: 4, firstBlockId: 'chapter_block' });
        const elsewhere = position({ pageIndex: 9, firstBlockId: 'chapter_block' });
        expect(findActiveBookmark([saved], elsewhere)).toBeNull();
    });

    it('does not match a page whose text changed under it after reflow', () => {
        const saved = bookmark({ pageIndex: 4, firstBlockId: 'block_88' });
        const differentText = position({ pageIndex: 4, firstBlockId: 'block_301' });
        expect(findActiveBookmark([saved], differentText)).toBeNull();
    });

    // Bookmarks saved before block ids were stored have only a page number.
    it('matches on page alone for a bookmark with no block id', () => {
        const legacy = bookmark({ firstBlockId: null });
        expect(findActiveBookmark([legacy], position())).toBe(legacy);
    });

    it('matches on page alone when the reader position has no block id', () => {
        const saved = bookmark();
        expect(findActiveBookmark([saved], position({ firstBlockId: null }))).toBe(saved);
    });

    it('picks the bookmark on this page, not another page in the chapter', () => {
        const otherPage = bookmark({ id: 'bb_other', pageIndex: 6 });
        const thisPage = bookmark({ id: 'bb_this', pageIndex: 4 });
        expect(findActiveBookmark([otherPage, thisPage], position())).toBe(thisPage);
    });

    it('treats a missing pageIndex as the first page', () => {
        const saved = bookmark({ pageIndex: null, firstBlockId: null });
        const atChapterStart = position({ pageIndex: null, firstBlockId: null });
        expect(findActiveBookmark([saved], atChapterStart)).toBe(saved);
    });

    it('returns null for an unusable position or list', () => {
        expect(findActiveBookmark([bookmark()], null)).toBeNull();
        expect(findActiveBookmark([bookmark()], position({ spineIndex: null }))).toBeNull();
        expect(findActiveBookmark(null, position())).toBeNull();
        expect(findActiveBookmark([], position())).toBeNull();
    });
});
