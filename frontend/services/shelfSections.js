// Splits the reader's shelf ("My books") in two: the books they added
// themselves, and the public-domain books they took from the free library.
// Sections keep the order the books arrive in (the shelf passes them most
// recently opened first), and an empty section is left out.

export const SHELF_SECTION_ORDER = ['uploaded', 'library'];

// A book that came from the free library rather than the reader's own files.
export const isLibraryBook = (book) => !!(
    book?.publicDomain
    || book?.publicDomainId
    || book?.publicLibraryId
    || book?.publicLibraryStoragePath
    || book?.storagePath
);

export const getShelfSectionKey = (book) => (isLibraryBook(book) ? 'library' : 'uploaded');

export const groupShelfBooks = (books = []) => {
    const grouped = new Map(SHELF_SECTION_ORDER.map((key) => [key, []]));
    books.forEach((book) => {
        if (book) grouped.get(getShelfSectionKey(book)).push(book);
    });
    return SHELF_SECTION_ORDER
        .map((key) => ({ key, books: grouped.get(key) }))
        .filter((section) => section.books.length > 0);
};
