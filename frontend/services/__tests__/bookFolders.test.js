import AsyncStorage from '@react-native-async-storage/async-storage';

import {
    arrangeShelf,
    createFolder,
    deleteFolder,
    findFolderOfBook,
    loadFolders,
    moveBookToFolder,
    removeBookFromFolders,
    renameFolder,
    saveFolders,
} from '../bookFolders';

jest.mock('@react-native-async-storage/async-storage', () => (
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
));

const scope = { ownerId: 'owner', profileId: 'profile', language: 'ko' };

describe('createFolder', () => {
    it('makes a folder holding the book it was made for', () => {
        const { folders, folder } = createFolder([], '  Series  ', 'a');
        expect(folder.name).toBe('Series');
        expect(folders).toHaveLength(1);
        expect(folders[0].bookKeys).toEqual(['a']);
    });

    it('takes the book out of the folder it was in', () => {
        const first = createFolder([], 'One', 'a').folders;
        const { folders } = createFolder(first, 'Two', 'a');
        expect(folders[0].bookKeys).toEqual([]);
        expect(folders[1].bookKeys).toEqual(['a']);
    });

    it('does nothing for a blank name', () => {
        const before = [];
        const { folders, folder } = createFolder(before, '   ');
        expect(folder).toBeNull();
        expect(folders).toBe(before);
    });
});

describe('moving books', () => {
    const setUp = () => {
        const one = createFolder([], 'One', 'a');
        const two = createFolder(one.folders, 'Two', 'b');
        return { folders: two.folders, oneId: one.folder.id, twoId: two.folder.id };
    };

    it('keeps a book in only one folder, newest first', () => {
        const { folders, twoId } = setUp();
        const moved = moveBookToFolder(folders, 'a', twoId);
        expect(moved[0].bookKeys).toEqual([]);
        expect(moved[1].bookKeys).toEqual(['a', 'b']);
        expect(findFolderOfBook(moved, 'a').id).toBe(twoId);
    });

    it('ignores a folder that does not exist', () => {
        const { folders } = setUp();
        expect(moveBookToFolder(folders, 'a', 'missing')).toBe(folders);
    });

    it('removes a book from its folder', () => {
        const { folders } = setUp();
        const removed = removeBookFromFolders(folders, 'a');
        expect(findFolderOfBook(removed, 'a')).toBeNull();
        expect(findFolderOfBook(removed, 'b')).not.toBeNull();
    });

    it('does not change the list it was given', () => {
        const { folders, twoId } = setUp();
        const snapshot = JSON.stringify(folders);
        moveBookToFolder(folders, 'a', twoId);
        removeBookFromFolders(folders, 'b');
        expect(JSON.stringify(folders)).toBe(snapshot);
    });
});

describe('renameFolder and deleteFolder', () => {
    it('renames, but not to a blank name', () => {
        const { folders, folder } = createFolder([], 'Old');
        expect(renameFolder(folders, folder.id, 'New')[0].name).toBe('New');
        expect(renameFolder(folders, folder.id, '  ')[0].name).toBe('Old');
    });

    it('deleting a folder leaves its books loose on the shelf', () => {
        const { folders, folder } = createFolder([], 'Gone', 'a');
        const after = deleteFolder(folders, folder.id);
        expect(arrangeShelf([{ uri: 'a' }], after)).toEqual({ folders: [], looseBooks: [{ uri: 'a' }] });
    });
});

describe('arrangeShelf', () => {
    it('splits books into folders and loose books', () => {
        const { folders } = createFolder([], 'Series', 'b');
        const shelf = arrangeShelf([{ uri: 'a' }, { uri: 'b' }], folders);
        expect(shelf.folders[0].books).toEqual([{ uri: 'b' }]);
        expect(shelf.looseBooks).toEqual([{ uri: 'a' }]);
    });

    it('skips a filed book that is not on the shelf, and keeps empty folders', () => {
        const { folders } = createFolder([], 'Series', 'missing');
        const shelf = arrangeShelf([{ uri: 'a' }], folders);
        expect(shelf.folders).toHaveLength(1);
        expect(shelf.folders[0].books).toEqual([]);
        expect(shelf.looseBooks).toEqual([{ uri: 'a' }]);
    });
});

describe('storage', () => {
    beforeEach(() => AsyncStorage.clear());

    it('saves and loads folders for a scope', async () => {
        const { folders } = createFolder([], 'Series', 'a');
        await saveFolders(scope, folders);
        expect(await loadFolders(scope)).toEqual(folders);
        expect(await loadFolders({ ...scope, language: 'zh' })).toEqual([]);
    });

    it('returns no folders when what is stored cannot be read', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await AsyncStorage.setItem('bookFolders:owner:profile:ko', '[{"id":');
        expect(await loadFolders(scope)).toEqual([]);
        warn.mockRestore();
    });
});
