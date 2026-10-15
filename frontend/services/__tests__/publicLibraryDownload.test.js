// Public-library downloads: a timed-out or truncated download must never leave
// a file at the final path that later counts as "downloaded".

const mockFiles = new Map();
const mockDownloads = [];

jest.mock('expo-file-system/legacy', () => {
  const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
  return {
    documentDirectory: 'file:///docs/',
    EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: jest.fn(async () => {}),
    getInfoAsync: jest.fn(async (uri) => {
      const bytes = mockFiles.get(uri);
      return bytes ? { exists: true, size: bytes.length } : { exists: false };
    }),
    readAsStringAsync: jest.fn(async (uri, { position = 0, length } = {}) => {
      const bytes = mockFiles.get(uri);
      if (!bytes) throw new Error(`missing ${uri}`);
      return toBase64(bytes.slice(position, length == null ? undefined : position + length));
    }),
    deleteAsync: jest.fn(async (uri) => {
      mockFiles.delete(uri);
    }),
    moveAsync: jest.fn(async ({ from, to }) => {
      mockFiles.set(to, mockFiles.get(from));
      mockFiles.delete(from);
    }),
    createDownloadResumable: jest.fn((url, path) => {
      const task = {
        url,
        path,
        cancelAsync: jest.fn(async () => {}),
        downloadAsync: jest.fn(() => new Promise((resolve) => {
          task.finish = (bytes, status = 200) => {
            mockFiles.set(path, bytes);
            resolve({ uri: path, status });
          };
        })),
      };
      mockDownloads.push(task);
      return task;
    }),
  };
});

jest.mock('../supabase', () => ({ supabase: {} }));

const {
  downloadPublicBook,
  getLocalPath,
  hasCompleteBookTrailer,
  isBookDownloaded,
} = require('../publicLibraryService');

const bytes = (...parts) => Uint8Array.from(parts.flatMap((part) => (
  typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part
)));
const completeEpub = () => bytes('PK\x03\x04', 'x'.repeat(200), 'PK\x05\x06', new Array(18).fill(0));
const truncatedEpub = () => bytes('PK\x03\x04', 'x'.repeat(200));

const STORAGE_PATH = 'https://cdn.test/books/sample.epub';
const book = { storagePath: STORAGE_PATH, format: 'epub' };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const waitForDownload = async () => {
  for (let i = 0; i < 20 && mockDownloads.length === 0; i += 1) {
    await flush();
  }
  return mockDownloads[mockDownloads.length - 1];
};

beforeEach(() => {
  mockFiles.clear();
  mockDownloads.length = 0;
  jest.useRealTimers();
});

describe('hasCompleteBookTrailer', () => {
  test('requires the ZIP end-of-central-directory record for EPUB', () => {
    expect(hasCompleteBookTrailer(completeEpub(), 'epub')).toBe(true);
    expect(hasCompleteBookTrailer(truncatedEpub(), 'epub')).toBe(false);
  });

  test('requires %%EOF for PDF', () => {
    expect(hasCompleteBookTrailer(bytes('%PDF-1.7 ... %%EOF\n'), 'pdf')).toBe(true);
    expect(hasCompleteBookTrailer(bytes('%PDF-1.7 ... trunc'), 'pdf')).toBe(false);
  });
});

describe('downloadPublicBook', () => {
  test('downloads to a .part file and renames it into place when complete', async () => {
    const promise = downloadPublicBook(book);
    const task = await waitForDownload();
    const localPath = getLocalPath(STORAGE_PATH);
    expect(task.path).toBe(`${localPath}.part`);

    task.finish(completeEpub());
    await expect(promise).resolves.toBe(localPath);
    expect(mockFiles.has(localPath)).toBe(true);
    expect(mockFiles.has(`${localPath}.part`)).toBe(false);
    await expect(isBookDownloaded(STORAGE_PATH, 'epub')).resolves.toBe(true);
  });

  test('a truncated download is rejected and leaves nothing behind', async () => {
    const promise = downloadPublicBook(book);
    const task = await waitForDownload();
    task.finish(truncatedEpub());

    await expect(promise).rejects.toThrow(/incomplete/);
    const localPath = getLocalPath(STORAGE_PATH);
    expect(mockFiles.has(localPath)).toBe(false);
    expect(mockFiles.has(`${localPath}.part`)).toBe(false);
  });

  test('on timeout the download is cancelled and the partial file removed', async () => {
    jest.useFakeTimers();
    const promise = downloadPublicBook(book);
    const rejection = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(0);
    const task = mockDownloads[mockDownloads.length - 1];
    expect(task).toBeDefined();
    const localPath = getLocalPath(STORAGE_PATH);
    // Native side has written part of the file when we give up.
    mockFiles.set(task.path, truncatedEpub());

    await jest.advanceTimersByTimeAsync(90000);
    await rejection;
    expect(task.cancelAsync).toHaveBeenCalled();
    expect(mockFiles.has(task.path)).toBe(false);
    expect(mockFiles.has(localPath)).toBe(false);
    jest.useRealTimers();
    await expect(isBookDownloaded(STORAGE_PATH, 'epub')).resolves.toBe(false);
  });
});

describe('isBookDownloaded', () => {
  test('treats a truncated file at the final path as not downloaded and removes it', async () => {
    const localPath = getLocalPath(STORAGE_PATH);
    mockFiles.set(localPath, truncatedEpub());
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(isBookDownloaded(STORAGE_PATH, 'epub')).resolves.toBe(false);
    expect(mockFiles.has(localPath)).toBe(false);
    warn.mockRestore();
  });
});
