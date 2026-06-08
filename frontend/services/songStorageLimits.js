export const MAX_SONGS_STORAGE_BYTES = 4 * 1024 * 1024;

export const formatStorageSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const createSongStorageLimitError = (byteLength) => {
  const error = new Error(
    `Saved songs would use ${formatStorageSize(byteLength)} locally; limit is ${formatStorageSize(MAX_SONGS_STORAGE_BYTES)}.`
  );
  error.code = 'SONG_STORAGE_LIMIT';
  error.byteLength = byteLength;
  return error;
};

export const isSongStorageLimitError = (error) => error?.code === 'SONG_STORAGE_LIMIT';

export const getUtf8ByteLength = (value) => {
  const text = String(value ?? '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }

  try {
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, 'x').length;
  } catch {
    return text.length * 2;
  }
};

export const serializeSongsForStorage = (songs) => {
  const serialized = JSON.stringify(Array.isArray(songs) ? songs : []);
  const byteLength = getUtf8ByteLength(serialized);
  if (byteLength > MAX_SONGS_STORAGE_BYTES) {
    throw createSongStorageLimitError(byteLength);
  }

  return serialized;
};
