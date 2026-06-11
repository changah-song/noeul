import * as FileSystem from 'expo-file-system';

import { normalizeBookLanguage } from '../constants/languages';
import { supabase } from './supabase';

export const PUBLIC_LIBRARY_BUCKET = 'public-library';
export const PUBLIC_LIBRARY_DIR = `${FileSystem.documentDirectory}public-library/`;

const PUBLIC_LIBRARY_SELECT = '*';
const PUBLIC_LIBRARY_QUERY_TIMEOUT_MS = 15000;
const BOOK_DOWNLOAD_TIMEOUT_MS = 90000;
const EPUB_SIGNATURES = ['UEsD', 'UEsF', 'UEsH'];
const PDF_SIGNATURE = 'JVBER';

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error(message));
  }, timeoutMs);

  promise
    .then(resolve)
    .catch(reject)
    .finally(() => clearTimeout(timeout));
});

const cleanString = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const cleanNullableString = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const cleanNumber = (...values) => {
  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }

    const number = typeof value === 'string'
      ? Number(value.replace(/[^\d.]/g, ''))
      : Number(value);
    if (Number.isFinite(number) && number > 0) {
      return Math.round(number);
    }
  }

  return null;
};

const cleanByteSize = (...values) => {
  for (const value of values) {
    if (value == null || value === '') {
      continue;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    }

    const text = String(value).trim();
    const match = text.match(/([\d.]+)\s*(b|kb|mb|gb)?/i);
    if (!match) {
      continue;
    }

    const number = Number(match[1]);
    if (!Number.isFinite(number) || number <= 0) {
      continue;
    }

    const unit = String(match[2] || 'b').toLowerCase();
    const multiplier = unit === 'gb'
      ? 1024 ** 3
      : unit === 'mb'
        ? 1024 ** 2
        : unit === 'kb'
          ? 1024
          : 1;
    return Math.round(number * multiplier);
  }

  return null;
};

const cleanDifficulty = (value) => {
  const text = cleanNullableString(value);
  return text ? text.replace(/_/g, ' ') : null;
};

const safeStorageFilename = (storagePath) => (
  String(storagePath || '')
    .replace(/^\/+/, '')
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .join('_')
);

const normalizeStoragePath = (storagePath) => {
  const rawPath = cleanString(storagePath).replace(/^\/+/, '');
  const bucketPrefix = `${PUBLIC_LIBRARY_BUCKET}/`;

  return rawPath.startsWith(bucketPrefix)
    ? rawPath.slice(bucketPrefix.length)
    : rawPath;
};

const getStoragePath = (book) => cleanString(
  book?.storagePath
    ?? book?.storage_path
    ?? book?.publicLibraryStoragePath
    ?? book?.file_path
    ?? book?.file_url
);

const inferFormat = (...values) => {
  const joined = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (joined.includes('pdf') || /\.pdf(?:\?|$|\s)/.test(joined)) {
    return 'pdf';
  }

  return 'epub';
};

const publicUrlForStoragePath = (storagePath) => {
  if (/^https?:\/\//i.test(storagePath)) {
    return storagePath;
  }

  const normalizedPath = normalizeStoragePath(storagePath);
  const { data } = supabase.storage
    .from(PUBLIC_LIBRARY_BUCKET)
    .getPublicUrl(normalizedPath);

  return data?.publicUrl ?? '';
};

export const ensurePublicLibraryDir = async () => {
  await FileSystem.makeDirectoryAsync(PUBLIC_LIBRARY_DIR, { intermediates: true })
    .catch((error) => {
      if (!String(error?.message || '').toLowerCase().includes('already exists')) {
        throw error;
      }
    });
};

export const getLocalPath = (storagePath) => {
  const filename = safeStorageFilename(normalizeStoragePath(storagePath));
  return `${PUBLIC_LIBRARY_DIR}${filename || 'book.epub'}`;
};

export const isBookDownloaded = async (storagePath, format = 'epub') => {
  if (!cleanString(storagePath)) {
    return false;
  }

  const localPath = getLocalPath(storagePath);
  try {
    await validateDownloadedBookFile(localPath, format, { storagePath });
    return true;
  } catch (error) {
    const info = await FileSystem.getInfoAsync(localPath).catch(() => null);
    if (info?.exists) {
      console.warn('[publicLibraryService] Removing invalid cached public book:', error?.message ?? error);
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    }
    return false;
  }
};

export const getDownloadedBookUri = async (storagePath, format = 'epub') => (
  await isBookDownloaded(storagePath, format) ? getLocalPath(storagePath) : null
);

export const publicLibraryRowToBook = (row = {}, overrides = {}) => {
  const storagePath = normalizeStoragePath(getStoragePath(row));
  const targetLanguage = normalizeBookLanguage(
    row.target_language
      ?? row.targetLanguage
      ?? row.language
      ?? row.lang
      ?? overrides.language
      ?? 'en'
  );
  const id = cleanString(row.id ?? row.public_library_id ?? storagePath, storagePath);
  const format = inferFormat(row.format, row.mime_type, row.content_type, storagePath);
  const title = cleanString(row.title ?? row.name, 'Untitled');
  const author = cleanString(row.author ?? row.creator, 'Unknown author');
  const coverStoragePath = cleanNullableString(row.cover_path ?? row.cover_storage_path);
  const cover = row.cover_url
    ?? row.cover
    ?? row.cover_uri
    ?? (coverStoragePath ? publicUrlForStoragePath(coverStoragePath) : null);

  return {
    id: overrides.id ?? `public-library-${id}`,
    publicDomainId: id,
    publicLibraryId: id,
    publicLibraryStoragePath: storagePath,
    storagePath,
    publicDomain: true,
    publicLibrary: true,
    isFeatured: Boolean(row.is_featured ?? row.isFeatured),
    downloaded: overrides.downloaded ?? false,
    uri: overrides.uri ?? null,
    format,
    title,
    author,
    originalTitle: title,
    originalAuthor: author,
    originalCover: cover,
    originalFilename: cleanString(row.original_filename ?? row.filename ?? storagePath.split('/').pop(), `${title}.${format}`),
    cover,
    coverColor: row.cover_color ?? null,
    coverAccentColor: row.cover_accent_color ?? null,
    coverBackgroundColor: row.cover_background_color ?? null,
    language: targetLanguage,
    targetLanguage,
    genre: cleanNullableString(row.genre ?? row.category),
    difficulty: cleanDifficulty(row.difficulty ?? row.level),
    snippet: cleanNullableString(row.description ?? row.summary ?? row.snippet),
    source: cleanNullableString(row.source ?? row.publisher ?? 'Public library'),
    previewSource: cleanNullableString(row.preview_source ?? row.source),
    attributionCategory: cleanNullableString(row.attribution_category),
    attribution: cleanNullableString(row.attribution),
    wordCount: cleanNumber(row.word_count, row.wordCount, row.words),
    size: cleanByteSize(row.size_bytes, row.file_size_bytes, row.file_size, row.size),
    progress: overrides.progress ?? 0,
    location: overrides.location ?? null,
    nativePosition: overrides.nativePosition ?? null,
    preprocessed: overrides.preprocessed ?? false,
    preprocessing: false,
    publicLibraryRaw: row,
  };
};

export const fetchPublicLibrary = async (targetLanguage) => {
  const normalizedLanguage = normalizeBookLanguage(targetLanguage, 'en');
  const { data, error } = await withTimeout(
    supabase
      .from('public_library')
      .select(PUBLIC_LIBRARY_SELECT)
      .eq('target_language', normalizedLanguage)
      .order('is_featured', { ascending: false })
      .order('title', { ascending: true }),
    PUBLIC_LIBRARY_QUERY_TIMEOUT_MS,
    `Timed out loading public_library rows for target_language=${normalizedLanguage}`
  );

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => publicLibraryRowToBook(row, {
    language: normalizedLanguage,
  }));
};

const assertDownloadedFileReady = async (uri) => {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) {
    throw new Error('Downloaded public library book was not saved on this device');
  }
  if (typeof info.size === 'number' && info.size <= 0) {
    throw new Error('Downloaded public library book is empty');
  }
};

const base64ToBytes = (base64) => {
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

  return bytes;
};

const asciiPreviewForBytes = (bytes) => Array.from(bytes)
  .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
  .join('');

const readFileSignature = async (uri) => {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
    position: 0,
    length: 96,
  });

  return {
    base64,
    preview: asciiPreviewForBytes(base64ToBytes(base64)).trim(),
  };
};

const describeSignature = (signature) => {
  const base64 = String(signature?.base64 || '');
  if (base64.startsWith('PGh0') || base64.startsWith('PCFET0') || base64.startsWith('PD94')) {
    return 'an HTML/XML response';
  }
  if (base64.startsWith('ey') || base64.startsWith('W3')) {
    return 'a JSON response';
  }
  return signature?.preview || base64.slice(0, 24) || 'unknown bytes';
};

const parseStorageErrorMessage = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed.message || parsed.error_description || parsed.error || trimmed.slice(0, 180);
  } catch {
    return trimmed.slice(0, 180);
  }
};

const getDownloadFailureDetail = async (url) => {
  try {
    const response = await fetch(url);
    const text = await response.text();
    return parseStorageErrorMessage(text);
  } catch {
    return null;
  }
};

const makeDownloadHttpError = async ({ status, storagePath, url }) => {
  const detail = await getDownloadFailureDetail(url);
  const parts = [
    `Public library download failed with HTTP ${status}`,
    detail,
    storagePath ? `storage_path=${storagePath}` : null,
  ].filter(Boolean);
  return new Error(parts.join(': '));
};

async function validateDownloadedBookFile(uri, format = 'epub', context = {}) {
  await assertDownloadedFileReady(uri);

  const signature = await readFileSignature(uri);
  const normalizedFormat = inferFormat(format, uri);
  const valid = normalizedFormat === 'pdf'
    ? signature.base64.startsWith(PDF_SIGNATURE)
    : EPUB_SIGNATURES.some((prefix) => signature.base64.startsWith(prefix));

  if (!valid) {
    const sourceHint = [
      context.storagePath ? `storage_path=${context.storagePath}` : null,
      context.url ? `url=${context.url}` : null,
    ].filter(Boolean).join(', ');
    throw new Error(
      `Downloaded public library ${normalizedFormat.toUpperCase()} is not a valid ${normalizedFormat.toUpperCase()} file. ` +
      `First bytes look like ${describeSignature(signature)}${sourceHint ? `. ${sourceHint}` : ''}`
    );
  }
}

const downloadUrlToFile = async ({ url, localPath, format, storagePath, onProgress }) => {
  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    localPath,
    {},
    onProgress
  );

  const result = await withTimeout(
    downloadResumable.downloadAsync(),
    BOOK_DOWNLOAD_TIMEOUT_MS,
    'Timed out while downloading public library book'
  );
  if (typeof result?.status === 'number' && (result.status < 200 || result.status >= 300)) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw await makeDownloadHttpError({ status: result.status, storagePath, url });
  }

  try {
    await validateDownloadedBookFile(result.uri, format, { storagePath, url });
  } catch (error) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    throw error;
  }

  return result.uri;
};

export const downloadPublicBook = async (book, onProgress) => {
  const storagePath = getStoragePath(book);
  if (!storagePath) {
    throw new Error('Public library book is missing its storage path');
  }

  await ensurePublicLibraryDir();
  const format = inferFormat(book?.format, storagePath, book?.mime_type, book?.content_type);
  const localPath = getLocalPath(storagePath);
  if (await isBookDownloaded(storagePath, format)) {
    return localPath;
  }

  const url = publicUrlForStoragePath(storagePath);
  if (!url) {
    throw new Error('Public library book is missing its download URL');
  }

  return downloadUrlToFile({ url, localPath, format, storagePath, onProgress });
};

export const downloadFeaturedBooks = async (targetLanguage, onBookDownloaded) => {
  const normalizedLanguage = normalizeBookLanguage(targetLanguage, 'en');
  const { data, error } = await withTimeout(
    supabase
      .from('public_library')
      .select(PUBLIC_LIBRARY_SELECT)
      .eq('target_language', normalizedLanguage)
      .eq('is_featured', true)
      .order('title', { ascending: true }),
    PUBLIC_LIBRARY_QUERY_TIMEOUT_MS,
    `Timed out loading featured public_library rows for target_language=${normalizedLanguage}`
  );

  if (error) {
    throw error;
  }

  const downloadedBooks = [];
  const failures = [];
  for (const row of data ?? []) {
    const book = publicLibraryRowToBook(row, { language: normalizedLanguage });
    try {
      const alreadyDownloaded = await isBookDownloaded(book.storagePath, book.format);
      const uri = alreadyDownloaded
        ? getLocalPath(book.storagePath)
        : await downloadPublicBook(book);
      const localBook = publicLibraryRowToBook(row, {
        language: normalizedLanguage,
        downloaded: true,
        uri,
      });
      downloadedBooks.push(localBook);
      onBookDownloaded?.(localBook);
    } catch (error) {
      failures.push({ book, error });
      console.warn(
        `[publicLibraryService] Failed to pre-download featured public book "${book.title}" ` +
        `from storage_path="${book.storagePath}": ${error?.message || error}`
      );
    }
  }

  if (failures.length > 0 && downloadedBooks.length === 0) {
    const firstFailure = failures[0];
    throw new Error(
      `Could not pre-download ${failures.length} featured public books. ` +
      `First failure: "${firstFailure.book.title}" (${firstFailure.book.storagePath}): ` +
      `${firstFailure.error?.message || firstFailure.error}`
    );
  }

  return downloadedBooks;
};
