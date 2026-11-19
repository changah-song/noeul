import * as FileSystem from 'expo-file-system/legacy';
import {
  MAX_CLOUD_BOOK_BYTES,
  isCloudBookUser,
  markUserBookOpened,
  syncUserBookFiles,
  uploadUserBook,
} from './bookCloudSync';
import { isCurrentSyncGeneration } from './localOwnerCoordinator';

// Which books keep their file in the cloud.
//
// Every book the reader imported has a row in the cloud (title, cover,
// progress), so the shelf and reading position follow them to every device.
// The server also says which books keep their file: the most recently opened
// ones, up to a limit it sets (1000 for an account, so in practice all of
// them; it was 3 for a while). Past the limit, opening an older book makes it
// recent again: its file goes up and the oldest one's comes down. This
// uploads what the server asks for.

const getTime = (value) => {
  const time = new Date(value ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

// A book imported on this device (not a library book, which the library
// already hosts) whose file is here.
export const isOwnLocalBook = (book) => Boolean(
  book?.uri
  && book.downloaded !== false
  && !book.publicDomain
  && !book.publicLibrary
);

const byRecentlyOpened = (a, b) => (
  getTime(b.lastOpenedAt ?? b.createdAt) - getTime(a.lastOpenedAt ?? a.createdAt)
);

const defaultFileSize = async (uri) => {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info?.exists && typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
};

const cloudFields = (cloudBook, extra = {}) => ({
  cloudId: cloudBook.id,
  cloudOwnerId: cloudBook.user_id,
  cloudFilePath: cloudBook.file_path,
  cloudCoverPath: cloudBook.cover_path ?? null,
  cloudSyncedAt: cloudBook.updated_at ?? cloudBook.uploaded_at ?? new Date().toISOString(),
  cloudFileStored: cloudBook.file_stored !== false,
  cloudLastOpenedAt: cloudBook.last_opened_at ?? null,
  ...extra,
});

/**
 * Bring the cloud in line with this device's books:
 * 1. give every book imported here a row in the cloud (without its file),
 * 2. tell the cloud when books were opened here,
 * 3. ask which books keep their file, and upload the ones this device has.
 *
 * updateBook(book, patch) applies a patch to that book in the app's list.
 * Returns { limit, uploaded } or null when there is nothing to do.
 */
export const reconcileCloudBookFiles = async ({
  user,
  ownerId,
  generation,
  books,
  updateBook,
  deps = {},
} = {}) => {
  if (!isCloudBookUser(user) || ownerId !== user.id) {
    return null;
  }

  const {
    upload = uploadUserBook,
    markOpened = markUserBookOpened,
    syncFiles = syncUserBookFiles,
    fileSize = defaultFileSize,
    isCurrent = isCurrentSyncGeneration,
  } = deps;
  const stale = () => generation != null && !isCurrent(generation);
  const context = { user, ownerId, generation };

  const ownBooks = (books ?? []).filter(isOwnLocalBook).sort(byRecentlyOpened);
  // cloud id -> the local book, including rows made below.
  const localByCloudId = new Map();

  for (const book of ownBooks) {
    if (stale()) return null;
    if (book.cloudId) {
      localByCloudId.set(book.cloudId, book);
      continue;
    }
    try {
      const cloudBook = await upload({ ...context, localBook: book, includeFile: false });
      if (!cloudBook?.id) continue;
      const patch = cloudFields(cloudBook, {
        cloudFileStored: false,
        cloudLastOpenedAt: book.lastOpenedAt ?? null,
      });
      updateBook(book, patch);
      localByCloudId.set(cloudBook.id, { ...book, ...patch });
    } catch (error) {
      console.warn('[cloudBookFiles] Could not add a book to the cloud:', book.title, error?.message ?? error);
    }
  }

  for (const book of localByCloudId.values()) {
    if (stale()) return null;
    if (!book.lastOpenedAt || getTime(book.lastOpenedAt) <= getTime(book.cloudLastOpenedAt)) continue;
    try {
      await markOpened({ ...context, cloudBookId: book.cloudId, openedAt: book.lastOpenedAt });
      updateBook(book, { cloudLastOpenedAt: book.lastOpenedAt });
    } catch (error) {
      console.warn('[cloudBookFiles] Could not record when a book was opened:', error?.message ?? error);
    }
  }

  if (stale()) return null;
  const files = await syncFiles(context);
  if (!files) return null;

  (books ?? []).forEach((book) => {
    const cloudId = book?.cloudId ?? [...localByCloudId.entries()].find(([, local]) => local.uri === book?.uri)?.[0];
    if (!cloudId) return;
    const stored = files.stored.has(cloudId);
    if (book.cloudFileStored !== stored) {
      updateBook(book, { cloudFileStored: stored });
    }
  });

  let uploaded = 0;
  for (const cloudId of files.keep) {
    if (stale()) return null;
    if (files.stored.has(cloudId)) continue;
    const book = localByCloudId.get(cloudId);
    if (!book) continue; // its file is on another device
    const size = await fileSize(book.uri);
    if (size == null || size > MAX_CLOUD_BOOK_BYTES) continue;
    try {
      const cloudBook = await upload({ ...context, localBook: book, includeFile: true });
      if (cloudBook?.id) {
        updateBook(book, cloudFields(cloudBook, { cloudFileStored: true }));
        uploaded += 1;
      }
    } catch (error) {
      console.warn('[cloudBookFiles] Book upload skipped:', book.title, error?.message ?? error);
    }
  }

  return { limit: files.limit, uploaded };
};

// What decides the reconcile: which own books there are, their cloud ids,
// and the newest few by when they were opened. A change here is worth a
// reconcile; a progress update isn't.
export const cloudBookFilesSignature = (books, recentCount = 6) => {
  const own = (books ?? []).filter(isOwnLocalBook);
  const missing = own.filter((book) => !book.cloudId).map((book) => book.uri).sort();
  const recent = [...own].sort(byRecentlyOpened).slice(0, recentCount)
    .map((book) => `${book.cloudId ?? book.uri}@${book.lastOpenedAt ?? ''}`);
  return JSON.stringify([missing, recent]);
};
