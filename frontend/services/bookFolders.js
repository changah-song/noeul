// Folders on the reader's shelf: a name and the books filed under it, so a
// series or a genre can sit together. A book is in at most one folder.
//
// Folders are kept on this device, one list per account, profile and language
// (the shelf itself is per language). They are not synced to the account yet.
//
// Every function that changes folders takes the current list and returns a new
// one, leaving the old list untouched, so the screen can show the change at
// once and save it afterwards.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const FOLDER_NAME_MAX_LENGTH = 40;

// How a folder remembers a book. The file's location is used first because it
// does not change once the book is on the device.
export const getFolderBookKey = (book) => (
    book?.uri || book?.cloudId || book?.id || null
);

const cleanName = (name) => String(name ?? '').trim().slice(0, FOLDER_NAME_MAX_LENGTH);

const makeFolderId = () => `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeFolder = (folder) => {
    const name = cleanName(folder?.name);
    if (!folder?.id || !name) return null;
    return {
        id: String(folder.id),
        name,
        bookKeys: Array.isArray(folder.bookKeys)
            ? [...new Set(folder.bookKeys.filter((key) => typeof key === 'string' && key))]
            : [],
        createdAt: folder.createdAt ?? null,
    };
};

export const normalizeFolders = (folders) => (
    Array.isArray(folders) ? folders.map(normalizeFolder).filter(Boolean) : []
);

const withoutBook = (folders, bookKey) => folders.map((folder) => (
    folder.bookKeys.includes(bookKey)
        ? { ...folder, bookKeys: folder.bookKeys.filter((key) => key !== bookKey) }
        : folder
));

// Returns { folders, folder }: the new list and the folder that was made.
// `folder` is null (and the list unchanged) when the name is blank.
export const createFolder = (folders, name, bookKey = null) => {
    const trimmed = cleanName(name);
    if (!trimmed) return { folders, folder: null };
    const folder = {
        id: makeFolderId(),
        name: trimmed,
        bookKeys: bookKey ? [bookKey] : [],
        createdAt: new Date().toISOString(),
    };
    const rest = bookKey ? withoutBook(folders, bookKey) : folders;
    return { folders: [...rest, folder], folder };
};

export const renameFolder = (folders, folderId, name) => {
    const trimmed = cleanName(name);
    if (!trimmed) return folders;
    return folders.map((folder) => (folder.id === folderId ? { ...folder, name: trimmed } : folder));
};

// The folder goes; its books simply return to the shelf.
export const deleteFolder = (folders, folderId) => folders.filter((folder) => folder.id !== folderId);

// Files the book under the folder, taking it out of any other folder. The
// newest arrival goes to the front, so it shows on top of the folder's stack.
export const moveBookToFolder = (folders, bookKey, folderId) => {
    if (!bookKey || !folders.some((folder) => folder.id === folderId)) return folders;
    return withoutBook(folders, bookKey).map((folder) => (
        folder.id === folderId ? { ...folder, bookKeys: [bookKey, ...folder.bookKeys] } : folder
    ));
};

export const removeBookFromFolders = (folders, bookKey) => (bookKey ? withoutBook(folders, bookKey) : folders);

export const findFolderOfBook = (folders, bookKey) => (
    bookKey ? folders.find((folder) => folder.bookKeys.includes(bookKey)) ?? null : null
);

// Lays the shelf out: each folder with the books it holds (in the folder's own
// order), and the books that are in no folder. A key whose book is no longer
// on the shelf (deleted, or another language) is skipped, not removed, so a
// book that comes back is still filed.
export const arrangeShelf = (books = [], folders = []) => {
    const byKey = new Map();
    books.forEach((book) => {
        const key = getFolderBookKey(book);
        if (key && !byKey.has(key)) byKey.set(key, book);
    });
    const filed = new Set();
    const arranged = folders.map((folder) => {
        const folderBooks = [];
        folder.bookKeys.forEach((key) => {
            const book = byKey.get(key);
            if (book && !filed.has(key)) {
                filed.add(key);
                folderBooks.push(book);
            }
        });
        return { folder, books: folderBooks };
    });
    const looseBooks = books.filter((book) => !filed.has(getFolderBookKey(book)));
    return { folders: arranged, looseBooks };
};

export const getFoldersStorageKey = ({ ownerId, profileId, language }) => (
    `bookFolders:${ownerId ?? 'local'}:${profileId ?? 'default'}:${language ?? 'ko'}`
);

export const loadFolders = async (scope) => {
    try {
        const stored = await AsyncStorage.getItem(getFoldersStorageKey(scope));
        return stored ? normalizeFolders(JSON.parse(stored)) : [];
    } catch (error) {
        console.warn('[bookFolders] Failed to load folders:', error?.message ?? error);
        return [];
    }
};

export const saveFolders = async (scope, folders) => {
    try {
        await AsyncStorage.setItem(getFoldersStorageKey(scope), JSON.stringify(normalizeFolders(folders)));
    } catch (error) {
        console.warn('[bookFolders] Failed to save folders:', error?.message ?? error);
    }
};
