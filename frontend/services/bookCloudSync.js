import * as FileSystem from 'expo-file-system';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { normalizeBookLanguage } from '../constants/languages';
import { makeOwnerDataDirectory } from './localDataScope';
import { USER_BOOKS_BUCKET, supabase } from './supabase';

const FILE_TAG = '[bookCloudSync]';
const BOOK_DOWNLOAD_TIMEOUT_MS = 45000;
const COVER_DOWNLOAD_TIMEOUT_MS = 10000;
const USER_BOOK_SELECT = `
  id,
  user_id,
  title,
  author,
  original_filename,
  file_path,
  file_url,
  cover_path,
  size_bytes,
  word_count,
  language,
  progress,
  location,
  native_position,
  uploaded_at,
  updated_at,
  deleted_at
`;

const getBooksDirectory = (ownerId) =>
  `${FileSystem.documentDirectory}${makeOwnerDataDirectory(ownerId)}cloud-books/`;

const createUuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
  const random = Math.floor(Math.random() * 16);
  const value = char === 'x' ? random : ((random & 0x3) | 0x8);
  return value.toString(16);
});

const sanitizeText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const assertCloudWriteAllowed = ({ user, ownerId, generation }) => {
  assertCanUploadForOwner({ ownerId, user });
  if (generation != null && !isCurrentSyncGeneration(generation)) {
    throw new Error('Refusing cloud upload for stale sync generation');
  }

  return user.id;
};

const isMissingRpcError = (error, functionName) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes(functionName.toLowerCase());
};

const sortBookRows = (rows) => [...(rows ?? [])].sort((a, b) => (
  new Date(b.updated_at ?? b.uploaded_at ?? 0) - new Date(a.updated_at ?? a.uploaded_at ?? 0)
));

const ensureBooksDirectory = async (ownerId) => {
  const booksDirectory = getBooksDirectory(ownerId);

  await FileSystem.makeDirectoryAsync(booksDirectory, { intermediates: true }).catch((error) => {
    if (!String(error?.message || '').toLowerCase().includes('already exists')) {
      throw error;
    }
  });

  return booksDirectory;
};

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error(message));
  }, timeoutMs);

  promise
    .then(resolve)
    .catch(reject)
    .finally(() => clearTimeout(timeout));
});

const getContentTypeForUri = (uri, fallback = 'application/octet-stream') => {
  const value = String(uri || '').toLowerCase();
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+)/);
    return match?.[1] || fallback;
  }
  if (value.endsWith('.epub')) return 'application/epub+zip';
  if (value.endsWith('.pdf')) return 'application/pdf';
  if (value.endsWith('.png')) return 'image/png';
  if (value.endsWith('.webp')) return 'image/webp';
  if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'image/jpeg';
  return fallback;
};

const inferBookFormat = (...values) => {
  const joined = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (joined.includes('application/pdf') || /\.pdf(?:\?|$|\s)/.test(joined)) {
    return 'pdf';
  }

  return 'epub';
};

const extensionForFormat = (format) => (format === 'pdf' ? 'pdf' : 'epub');

const contentTypeForBookFormat = (format) => (
  format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
);

const base64ToArrayBuffer = (base64) => {
  const clean = String(base64 || '').replace(/\s/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let index = 0; index < alphabet.length; index += 1) {
    lookup[alphabet.charCodeAt(index)] = index;
  }

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  const bytes = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let byteIndex = 0;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '=') {
      break;
    }

    buffer = (buffer << 6) | lookup[clean.charCodeAt(index)];
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      if (byteIndex < byteLength) {
        bytes[byteIndex] = (buffer >> bits) & 0xff;
        byteIndex += 1;
      }
    }
  }

  return bytes.buffer;
};

const readUriAsArrayBuffer = async (uri) => {
  const value = String(uri || '');

  if (value.startsWith('data:')) {
    const match = value.match(/^data:[^;,]+;base64,([\s\S]+)$/);
    if (!match) {
      throw new Error('Unsupported data URI format for upload');
    }

    return base64ToArrayBuffer(match[1]);
  }

  const base64 = await FileSystem.readAsStringAsync(value, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return base64ToArrayBuffer(base64);
};

const uploadStorageObject = async ({ user, ownerId, generation, path, uri, contentType }) => {
  const body = await readUriAsArrayBuffer(uri);
  assertCloudWriteAllowed({ user, ownerId, generation });
  const { error } = await supabase.storage
    .from(USER_BOOKS_BUCKET)
    .upload(path, body, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw error;
  }
};

const uploadCoverIfAvailable = async ({ user, ownerId, generation, cloudBookId, coverUri }) => {
  const cover = sanitizeText(coverUri);
  if (!cover || cover.startsWith('http:') || cover.startsWith('https:')) {
    return null;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const coverPath = `${userId}/${cloudBookId}/cover.jpg`;

  try {
    await uploadStorageObject({
      user,
      ownerId,
      generation,
      path: coverPath,
      uri: cover,
      contentType: getContentTypeForUri(cover, 'image/jpeg'),
    });
    return coverPath;
  } catch (error) {
    console.warn(`${FILE_TAG} cover upload failed`, error);
    return null;
  }
};

const normalizeLocation = (location) => {
  if (location == null) {
    return null;
  }
  return typeof location === 'string' ? location : JSON.stringify(location);
};

const getBookProgress = (book) => {
  const progress = Number(book?.progress);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(Math.max(progress, 0), 1);
};

const getBookWordCount = (book) => {
  const wordCount = Number(
    book?.wordCount
    ?? book?.word_count
    ?? book?.totalWords
    ?? book?.total_words
    ?? book?.estimatedWordCount
    ?? book?.estimated_word_count
  );

  return Number.isFinite(wordCount) && wordCount > 0 ? Math.round(wordCount) : null;
};

const toUserBookRow = ({
  userId,
  cloudBookId,
  localBook,
  pickedAsset,
  filePath,
  coverPath,
}) => ({
  id: cloudBookId,
  user_id: userId,
  title: sanitizeText(localBook?.title, 'Untitled'),
  author: sanitizeText(localBook?.author, 'Unknown author'),
  original_filename: sanitizeText(
    pickedAsset?.name || localBook?.originalFilename || localBook?.title,
    null
  ),
  file_path: filePath,
  file_url: filePath,
  cover_path: coverPath,
  size_bytes: pickedAsset?.size ?? localBook?.size ?? null,
  word_count: getBookWordCount(localBook),
  language: localBook?.language ?? null,
  progress: getBookProgress(localBook),
  location: normalizeLocation(localBook?.location),
  native_position: localBook?.nativePosition ?? null,
  deleted_at: null,
});

export const cloudBookToLocalBook = (cloudBook = {}, overrides = {}) => ({
  id: overrides.id || `cloud-${cloudBook.id ?? 'book'}`,
  cloudId: cloudBook.id ?? null,
  cloudOwnerId: cloudBook.user_id ?? null,
  cloudFilePath: cloudBook.file_path ?? cloudBook.file_url ?? null,
  cloudCoverPath: cloudBook.cover_path ?? null,
  cloudSyncedAt: cloudBook.updated_at ?? cloudBook.uploaded_at ?? null,
  uri: overrides.uri ?? null,
  size: cloudBook.size_bytes ?? null,
  wordCount: getBookWordCount(cloudBook),
  title: sanitizeText(cloudBook.title, 'Untitled'),
  author: sanitizeText(cloudBook.author, 'Unknown author'),
  originalTitle: sanitizeText(cloudBook.title, 'Untitled'),
  originalAuthor: sanitizeText(cloudBook.author, 'Unknown author'),
  originalCover: overrides.cover ?? null,
  originalFilename: cloudBook.original_filename ?? null,
  cover: overrides.cover ?? null,
  location: cloudBook.location ?? null,
  nativePosition: cloudBook.native_position ?? null,
  progress: getBookProgress(cloudBook),
  language: cloudBook.language ?? null,
  format: overrides.format || inferBookFormat(
    cloudBook.format,
    cloudBook.original_filename,
    cloudBook.file_path,
    cloudBook.file_url
  ),
  preprocessed: overrides.preprocessed ?? false,
  preprocessing: false,
  downloaded: overrides.downloaded ?? false,
});

export const uploadUserBook = async ({ user, ownerId, generation, localBook, pickedAsset } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });

  const localUri = sanitizeText(pickedAsset?.uri || localBook?.uri);
  if (!localUri) {
    throw new Error('Cannot upload book without a local file URI');
  }

  const cloudBookId = localBook?.cloudId || createUuid();
  const format = inferBookFormat(localBook?.format, pickedAsset?.name, localUri, pickedAsset?.mimeType);
  const fileExtension = extensionForFormat(format);
  const filePath = localBook?.cloudFilePath || `${userId}/${cloudBookId}/book.${fileExtension}`;

  await uploadStorageObject({
    user,
    ownerId,
    generation,
    path: filePath,
    uri: localUri,
    contentType: getContentTypeForUri(localUri, contentTypeForBookFormat(format)),
  });
  const coverPath = await uploadCoverIfAvailable({
    user,
    ownerId,
    generation,
    cloudBookId,
    coverUri: localBook?.cover,
  });

  const row = toUserBookRow({
    userId,
    cloudBookId,
    localBook,
    pickedAsset,
    filePath,
    coverPath: coverPath || localBook?.cloudCoverPath || null,
  });

  assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    const { data, error } = await supabase.rpc('upsert_user_book_metadata', {
      book: row,
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_book_metadata')) {
      console.warn(`${FILE_TAG} uploadUserBook metadata upsert failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from('user_books')
    .upsert(row, { onConflict: 'user_id,file_path' })
    .select(USER_BOOK_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} uploadUserBook metadata upsert failed`, error);
    throw error;
  }

  return data;
};

export const updateUserBookMetadata = async ({ user, ownerId, generation, book } = {}) => {
  if (!book?.cloudId) {
    return null;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const coverPath = await uploadCoverIfAvailable({
    user,
    ownerId,
    generation,
    cloudBookId: book.cloudId,
    coverUri: book.cover,
  });
  const updatedAt = book.updatedAt || new Date().toISOString();
  const patch = {
    title: sanitizeText(book.title, 'Untitled'),
    author: sanitizeText(book.author, 'Unknown author'),
    updated_at: updatedAt,
  };

  if (coverPath || Object.prototype.hasOwnProperty.call(book, 'cloudCoverPath')) {
    patch.cover_path = coverPath || book.cloudCoverPath || null;
  }

  const wordCount = getBookWordCount(book);
  if (wordCount != null) {
    patch.word_count = wordCount;
  }

  if (book.language != null) {
    patch.language = book.language;
  }

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { data, error } = await supabase.rpc('upsert_user_book_metadata', {
      book: {
        id: book.cloudId,
        ...patch,
      },
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_book_metadata')) {
      console.warn(`${FILE_TAG} updateUserBookMetadata failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from('user_books')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', book.cloudId)
    .select(USER_BOOK_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} updateUserBookMetadata failed`, error);
    throw error;
  }

  return data;
};

export const fetchUserBooks = async (userId, options = {}) => {
  if (!userId) {
    return [];
  }

  const targetLanguage = options?.targetLanguage ?? options?.language ?? null;
  const normalizedLanguage = targetLanguage != null ? normalizeBookLanguage(targetLanguage) : null;

  try {
    const { data, error } = await supabase.rpc('sync_user_books_pull', {
      target_language: normalizedLanguage,
      include_deleted: Boolean(options?.includeDeleted),
      updated_after: options?.updatedAfter ?? null,
    });

    if (error) {
      throw error;
    }

    return sortBookRows(Array.isArray(data?.books) ? data.books : []);
  } catch (error) {
    if (!isMissingRpcError(error, 'sync_user_books_pull')) {
      console.warn(`${FILE_TAG} fetchUserBooks failed`, error);
      throw error;
    }
  }

  let query = supabase
    .from('user_books')
    .select(USER_BOOK_SELECT)
    .eq('user_id', userId);

  if (!options?.includeDeleted) {
    query = query.is('deleted_at', null);
  }

  if (normalizedLanguage != null) {
    query = query.eq('language', normalizedLanguage);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  if (error) {
    console.warn(`${FILE_TAG} fetchUserBooks failed`, error);
    throw error;
  }

  return data ?? [];
};

const downloadStoragePath = async (storagePath, destinationUri, { timeoutMs = BOOK_DOWNLOAD_TIMEOUT_MS } = {}) => {
  if (/^https?:\/\//i.test(String(storagePath || ''))) {
    const result = await withTimeout(
      FileSystem.downloadAsync(storagePath, destinationUri),
      timeoutMs,
      'Timed out while downloading book file'
    );
    return result.uri;
  }

  const { data, error } = await withTimeout(
    supabase.storage
      .from(USER_BOOKS_BUCKET)
      .createSignedUrl(storagePath, 60),
    timeoutMs,
    'Timed out while preparing book download'
  );

  if (error) {
    throw error;
  }

  const result = await withTimeout(
    FileSystem.downloadAsync(data.signedUrl, destinationUri),
    timeoutMs,
    'Timed out while downloading book file'
  );
  return result.uri;
};

const assertDownloadedFileReady = async (uri) => {
  const info = await FileSystem.getInfoAsync(uri, { size: true });

  if (!info.exists) {
    throw new Error('Downloaded book file was not saved on this device');
  }

  if (typeof info.size === 'number' && info.size <= 0) {
    throw new Error('Downloaded book file is empty');
  }
};

export const downloadUserBook = async ({ user, ownerId, generation, cloudBook } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });

  if (!cloudBook?.cloudId) {
    throw new Error('Cannot download book without a user id and cloud book id');
  }

  const filePath = cloudBook.cloudFilePath || cloudBook.file_path || cloudBook.file_url;
  if (!filePath) {
    throw new Error('Cloud book does not have a file path');
  }
  const format = inferBookFormat(cloudBook.format, cloudBook.originalFilename, filePath);
  const fileExtension = extensionForFormat(format);

  const booksDirectory = await ensureBooksDirectory(ownerId);
  assertCloudWriteAllowed({ user, ownerId, generation });

  const localUri = `${booksDirectory}${cloudBook.cloudId}.${fileExtension}`;
  const downloadedUri = await downloadStoragePath(filePath, localUri);
  await assertDownloadedFileReady(downloadedUri);
  assertCloudWriteAllowed({ user, ownerId, generation });
  let coverUri = cloudBook.cover ?? null;
  const coverPath = cloudBook.cloudCoverPath || cloudBook.cover_path;

  if (coverPath) {
    coverUri = await downloadStoragePath(
      coverPath,
      `${booksDirectory}${cloudBook.cloudId}-cover.jpg`,
      { timeoutMs: COVER_DOWNLOAD_TIMEOUT_MS }
    ).catch((error) => {
      console.warn(`${FILE_TAG} cover download failed`, error);
      return coverUri;
    });
  }

  return cloudBookToLocalBook(
    {
      id: cloudBook.cloudId,
      user_id: cloudBook.cloudOwnerId || userId,
      title: cloudBook.title,
      author: cloudBook.author,
      original_filename: cloudBook.originalFilename,
      file_path: filePath,
      cover_path: coverPath,
      size_bytes: cloudBook.size,
      word_count: cloudBook.wordCount ?? cloudBook.word_count ?? null,
      language: cloudBook.language,
      progress: cloudBook.progress,
      location: cloudBook.location,
      native_position: cloudBook.nativePosition,
      uploaded_at: null,
      updated_at: cloudBook.cloudSyncedAt,
    },
    {
      id: cloudBook.id || `cloud-${cloudBook.cloudId}`,
      uri: downloadedUri,
      cover: coverUri,
      downloaded: true,
      format,
      preprocessed: false,
    }
  );
};

export const updateUserBookProgress = async ({ user, ownerId, generation, book } = {}) => {
  if (!book?.cloudId) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const wordCount = getBookWordCount(book);
  const patch = {
    progress: getBookProgress(book),
    location: normalizeLocation(book.location),
    native_position: book.nativePosition ?? null,
    updated_at: new Date().toISOString(),
  };

  if (wordCount != null) {
    patch.word_count = wordCount;
  }

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('update_user_book_progress', {
      book_id: book.cloudId,
      progress_value: patch.progress,
      location_value: patch.location,
      native_position_value: patch.native_position,
      word_count_value: wordCount,
    });

    if (error) {
      throw error;
    }

    return;
  } catch (error) {
    if (!isMissingRpcError(error, 'update_user_book_progress')) {
      console.warn(`${FILE_TAG} updateUserBookProgress failed`, error);
      throw error;
    }
  }

  const { error } = await supabase
    .from('user_books')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', book.cloudId);

  if (error) {
    console.warn(`${FILE_TAG} updateUserBookProgress failed`, error);
    throw error;
  }
};

export const softDeleteUserBook = async ({ user, ownerId, generation, cloudBookId } = {}) => {
  if (!cloudBookId) {
    return;
  }

  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { error } = await supabase.rpc('soft_delete_user_book', {
      book_id: cloudBookId,
    });

    if (error) {
      throw error;
    }

    return;
  } catch (error) {
    if (!isMissingRpcError(error, 'soft_delete_user_book')) {
      console.warn(`${FILE_TAG} softDeleteUserBook failed`, error);
      throw error;
    }
  }

  const { error } = await supabase
    .from('user_books')
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', cloudBookId);

  if (error) {
    console.warn(`${FILE_TAG} softDeleteUserBook failed`, error);
    throw error;
  }
};
