import { getShelfSectionKey, groupShelfBooks } from '../shelfSections';

describe('getShelfSectionKey', () => {
    it('treats a book with no library markers as the reader\'s own', () => {
        expect(getShelfSectionKey({ uri: 'a', progress: 0.3 })).toBe('uploaded');
    });

    it('recognises library books by any of their markers', () => {
        expect(getShelfSectionKey({ uri: 'a', publicDomain: true })).toBe('library');
        expect(getShelfSectionKey({ uri: 'b', publicLibraryId: 'x' })).toBe('library');
        expect(getShelfSectionKey({ uri: 'c', storagePath: 'ko/book.epub' })).toBe('library');
    });
});

describe('groupShelfBooks', () => {
    it('puts the reader\'s own books first and drops an empty section', () => {
        const mixed = groupShelfBooks([
            { uri: 'lib', publicDomain: true },
            { uri: 'mine' },
        ]);
        expect(mixed.map((section) => section.key)).toEqual(['uploaded', 'library']);

        const onlyLibrary = groupShelfBooks([{ uri: 'lib', publicDomain: true }]);
        expect(onlyLibrary.map((section) => section.key)).toEqual(['library']);
    });

    it('keeps the incoming order inside a section', () => {
        const sections = groupShelfBooks([{ uri: 'first' }, { uri: 'second' }]);
        expect(sections[0].books.map((book) => book.uri)).toEqual(['first', 'second']);
    });

    it('returns nothing for an empty shelf', () => {
        expect(groupShelfBooks([])).toEqual([]);
        expect(groupShelfBooks()).toEqual([]);
    });
});
