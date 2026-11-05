import * as FileSystem from 'expo-file-system/legacy';
import { rebaseAppContainerUri } from './appContainerPaths';

// Imported books and picked covers start out in the document picker's copy
// under the app's cache directory (<cache>/DocumentPicker/<uuid>.<ext>, on
// iOS and Android). The system may clear caches (low storage, "Clear cache"),
// and the book would then lose its source: fine while the extraction cache
// holds, unreadable once it has to be rebuilt. These helpers keep a copy in
// Documents instead.
//
// New imports use the Documents copy as the book's uri from the start. Older
// books keep their uri (it keys progress, caches and sync), and their source
// is read through resolveBookSourceUri, which maps a picker path onto its
// copy, making the copy on first use if the picked file is still there.

const BOOK_FILES_DIR = 'books';
const COVER_FILES_DIR = 'covers';
const PICKER_CACHE_PATTERN = /\/(?:Caches|cache)\/DocumentPicker\/([^/]+)$/;

export const isPickerCacheUri = (uri) => typeof uri === 'string' && PICKER_CACHE_PATTERN.test(uri);

// Where the Documents copy of a picked file lives: its picker name (a UUID
// plus extension) is unique, so the same file always maps to the same copy.
export const persistedUriFor = (uri, dir = BOOK_FILES_DIR, documentDirectory = FileSystem.documentDirectory) => {
  const match = typeof uri === 'string' ? uri.match(PICKER_CACHE_PATTERN) : null;
  if (!match || !documentDirectory) return null;
  return `${documentDirectory}${dir}/${match[1]}`;
};

const exists = async (uri) => {
  try {
    return !!(await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
};

// Copy a picked file into Documents (once); returns the copy, or the
// original uri when it isn't a picker file or the copy can't be made.
const persistInto = async (uri, dir) => {
  const source = rebaseAppContainerUri(uri);
  const target = persistedUriFor(source, dir);
  if (!target) return uri;
  try {
    if (await exists(target)) return target;
    if (!(await exists(source))) return uri;
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}${dir}`, { intermediates: true });
    await FileSystem.copyAsync({ from: source, to: target });
    return target;
  } catch (error) {
    console.warn('[bookFiles] Could not keep a copy of the picked file:', error?.message ?? error);
    return uri;
  }
};

export const persistPickedBookFile = (uri) => persistInto(uri, BOOK_FILES_DIR);

// Drop a copy made by persistPickedBookFile that no book ended up using (a
// duplicate import, a failed one). Only ever deletes our own Documents copy.
export const discardPersistedCopy = async (copyUri, pickedUri) => {
  if (!copyUri || copyUri === pickedUri || copyUri !== persistedUriFor(rebaseAppContainerUri(pickedUri))) return;
  try {
    await FileSystem.deleteAsync(copyUri, { idempotent: true });
  } catch (error) {
    console.warn('[bookFiles] Could not remove an unused copy:', error?.message ?? error);
  }
};
export const persistPickedCoverFile = (uri) => persistInto(uri, COVER_FILES_DIR);

// The file to read a book's source from.
export const resolveBookSourceUri = async (uri) => {
  const rebased = rebaseAppContainerUri(uri);
  if (!isPickerCacheUri(rebased)) return rebased;
  const persisted = await persistPickedBookFile(rebased);
  return persisted === uri ? rebased : persisted;
};

// Keep copies of every still-present picked file of the stored books, so a
// later cache clear doesn't take them. Covers move for good (they are not
// keys); returns the books with their covers updated.
export const migratePickedBookFiles = async (books) => {
  if (!Array.isArray(books)) return books;
  return Promise.all(books.map(async (book) => {
    if (!book || typeof book !== 'object') return book;
    if (isPickerCacheUri(book.uri)) await persistPickedBookFile(book.uri);
    let next = book;
    for (const field of ['cover', 'originalCover']) {
      if (isPickerCacheUri(book[field])) {
        const persisted = await persistPickedCoverFile(book[field]);
        if (persisted !== book[field]) {
          if (next === book) next = { ...book };
          next[field] = persisted;
        }
      }
    }
    return next;
  }));
};
