// Matching a reader position against saved bookmarks.
//
// Kept out of the Read screen so the rule is testable on its own: it decides
// whether the header bookmark icon shows filled, and therefore whether tapping
// it saves a new bookmark or deletes an existing one. Getting it wrong deletes
// bookmarks the reader never meant to touch.

const pageOf = (value) => (Number.isInteger(value?.pageIndex) ? value.pageIndex : 0);

/**
 * The bookmark the given reader position is sitting on, or null.
 *
 * Page position within the chapter is the identity. An earlier version keyed on
 * firstBlockId instead, on the theory that naming the text would survive
 * repagination — but firstBlockId is only as fine-grained as the book's blocks,
 * and in a book whose chapter is one large block every page reports the same id.
 * That lit the icon on every page of the chapter and, because this same match
 * decides what the toggle deletes, let any page remove a bookmark set on
 * another. So the block id is now only a guard: when both sides have one and
 * they disagree, the pages hold different text and it is not a match.
 *
 * @param {Array} bookmarks saved bookmarks for the current book
 * @param {object|null} position current reader position ({ spineIndex, pageIndex, firstBlockId })
 */
export const findActiveBookmark = (bookmarks, position) => {
    const spineIndex = position?.spineIndex;
    if (!Number.isInteger(spineIndex) || !Array.isArray(bookmarks)) {
        return null;
    }

    const pageIndex = pageOf(position);
    const blockId = position.firstBlockId || null;

    return bookmarks.find((bookmark) => {
        if (bookmark?.spineIndex !== spineIndex || pageOf(bookmark) !== pageIndex) {
            return false;
        }
        // Both sides know which text they start on and it differs: the book has
        // reflowed under this bookmark, so this is a different page now.
        if (blockId && bookmark.firstBlockId && bookmark.firstBlockId !== blockId) {
            return false;
        }
        return true;
    }) ?? null;
};

export default findActiveBookmark;
