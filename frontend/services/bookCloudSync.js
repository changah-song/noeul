import * as FileSystem from 'expo-file-system';
import { USER_BOOKS_BUCKET, supabase } from './supabase';

const FILE_TAG = '[bookCloudSync]';
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
  language,
  progress,
  location,
  native_position,
  uploaded_at,
  updated_at,
  deleted_at
`;

const BOOKS_DIRECTORY = `${FileSystem.documentDirectory}cloud-books/`;

const createUuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
  const random = Math.floor(Math.random() * 16);
  const value = char === 'x' ? random : ((random & 0x3) | 0x8);
  return value.toString(16);
});

const sanitizeText = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const ensureBooksDirectory = async () => {
  await FileSystem.makeDirectoryAsync(BOOKS_DIRECTORY, { intermediates: true }).catch((error) => {
    if (!String(error?.message || '').toLowerCase().includes('already exists')) {
      throw error;
    }
  });
};

const getContentTypeForUri = (uri, fallback = 'application/octet-stream') => {
  const value = String(uri || '').toLowerCase();
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+)/);
    return match?.[1] || fallback;
  }
  if (value.endsWith('.epub')) return 'application/epub+zip';
  if (value.endsWith('.png')) return 'image/png';
  if (value.endsWith('.webp')) return 'image/webp';
  if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'image/jpeg';
  return fallback;
};

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

const uploadStorageObject = async (path, uri, contentType) => {
  const body = await readUriAsArrayBuffer(uri);
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

const uploadCoverIfAvailable = async (userId, cloudBookId, coverUri) => {
  const cover = sanitizeText(coverUri);
  if (!cover || cover.startsWith('http:') || cover.startsWith('https:')) {
    return null;
  }

  const coverPath = `${userId}/${cloudBookId}/cover.jpg`;

  try {
    await uploadStorageObject(
      coverPath,
      cover,
      getContentTypeForUri(cover, 'image/jpeg')
    );
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
  preprocessed: overrides.preprocessed ?? false,
  preprocessing: false,
  downloaded: overrides.downloaded ?? false,
});

export const uploadUserBook = async (userId, localBook, pickedAsset) => {
  if (!userId) {
    throw new Error('Cannot upload book without a user id');
  }

  const localUri = sanitizeText(pickedAsset?.uri || localBook?.uri);
  if (!localUri) {
    throw new Error('Cannot upload book without a local EPUB URI');
  }

  const cloudBookId = localBook?.cloudId || createUuid();
  const filePath = localBook?.cloudFilePath || `${userId}/${cloudBookId}/book.epub`;

  await uploadStorageObject(filePath, localUri, getContentTypeForUri(localUri, 'application/epub+zip'));
  const coverPath = await uploadCoverIfAvailable(userId, cloudBookId, localBook?.cover);

  const row = toUserBookRow({
    userId,
    cloudBookId,
    localBook,
    pickedAsset,
    filePath,
    coverPath: coverPath || localBook?.cloudCoverPath || null,
  });

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

export const fetchUserBooks = async (userId) => {
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('user_books')
    .select(USER_BOOK_SELECT)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn(`${FILE_TAG} fetchUserBooks failed`, error);
    throw error;
  }

  return data ?? [];
};

const downloadStoragePath = async (storagePath, destinationUri) => {
  if (/^https?:\/\//i.test(String(storagePath || ''))) {
    const result = await FileSystem.downloadAsync(storagePath, destinationUri);
    return result.uri;
  }

  const { data, error } = await supabase.storage
    .from(USER_BOOKS_BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error) {
    throw error;
  }

  const result = await FileSystem.downloadAsync(data.signedUrl, destinationUri);
  return result.uri;
};

export const downloadUserBook = async (userId, cloudBook) => {
  if (!userId || !cloudBook?.cloudId) {
    throw new Error('Cannot download book without a user id and cloud book id');
  }

  const filePath = cloudBook.cloudFilePath || cloudBook.file_path || cloudBook.file_url;
  if (!filePath) {
    throw new Error('Cloud book does not have a file path');
  }

  await ensureBooksDirectory();

  const localUri = `${BOOKS_DIRECTORY}${cloudBook.cloudId}.epub`;
  const downloadedUri = await downloadStoragePath(filePath, localUri);
  let coverUri = cloudBook.cover ?? null;
  const coverPath = cloudBook.cloudCoverPath || cloudBook.cover_path;

  if (coverPath) {
    try {
      coverUri = await downloadStoragePath(coverPath, `${BOOKS_DIRECTORY}${cloudBook.cloudId}-cover.jpg`);
    } catch (error) {
      console.warn(`${FILE_TAG} cover download failed`, error);
    }
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
      preprocessed: false,
    }
  );
};

export const updateUserBookProgress = async (userId, book) => {
  if (!userId || !book?.cloudId) {
    return;
  }

  const { error } = await supabase
    .from('user_books')
    .update({
      progress: getBookProgress(book),
      location: normalizeLocation(book.location),
      native_position: book.nativePosition ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', book.cloudId);

  if (error) {
    console.warn(`${FILE_TAG} updateUserBookProgress failed`, error);
    throw error;
  }
};

export const softDeleteUserBook = async (userId, cloudBookId) => {
  if (!userId || !cloudBookId) {
    return;
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
