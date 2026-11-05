const DOCS = 'file:///var/mobile/Containers/Data/Application/436D83D6-04F5-45A3-8910-9B20C5FF6AC1/Documents/';
const CACHE = 'file:///var/mobile/Containers/Data/Application/436D83D6-04F5-45A3-8910-9B20C5FF6AC1/Library/Caches/DocumentPicker/';
const ANDROID_CACHE = 'file:///data/user/0/com.noeulapp.Noeul/cache/DocumentPicker/';

const files = new Set();
const mockFs = {
  documentDirectory: DOCS,
  getInfoAsync: jest.fn(async (uri) => ({ exists: files.has(uri) })),
  makeDirectoryAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async (uri) => { files.delete(uri); }),
  copyAsync: jest.fn(async ({ from, to }) => {
    if (!files.has(from)) throw new Error('missing');
    files.add(to);
  }),
};
jest.mock('expo-file-system/legacy', () => mockFs);

const {
  isPickerCacheUri,
  persistedUriFor,
  persistPickedBookFile,
  resolveBookSourceUri,
  migratePickedBookFiles,
  discardPersistedCopy,
} = require('../bookFiles');

beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
});

describe('picker paths', () => {
  it('recognizes the document picker cache on iOS and Android', () => {
    expect(isPickerCacheUri(`${CACHE}A.pdf`)).toBe(true);
    expect(isPickerCacheUri(`${ANDROID_CACHE}B.epub`)).toBe(true);
    expect(isPickerCacheUri(`${DOCS}books/A.pdf`)).toBe(false);
    expect(isPickerCacheUri('public-domain://ko/x')).toBe(false);
    expect(isPickerCacheUri(null)).toBe(false);
  });

  it('maps a picked file to a stable Documents path', () => {
    expect(persistedUriFor(`${CACHE}D0E2.pdf`)).toBe(`${DOCS}books/D0E2.pdf`);
    expect(persistedUriFor(`${DOCS}books/x.pdf`)).toBe(null);
  });
});

describe('persistPickedBookFile', () => {
  it('copies a picked file into Documents once', async () => {
    files.add(`${CACHE}A.epub`);
    await expect(persistPickedBookFile(`${CACHE}A.epub`)).resolves.toBe(`${DOCS}books/A.epub`);
    await expect(persistPickedBookFile(`${CACHE}A.epub`)).resolves.toBe(`${DOCS}books/A.epub`);
    expect(mockFs.copyAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the original uri when the picked file is already gone', async () => {
    await expect(persistPickedBookFile(`${CACHE}gone.epub`)).resolves.toBe(`${CACHE}gone.epub`);
    expect(mockFs.copyAsync).not.toHaveBeenCalled();
  });

  it('leaves other uris alone', async () => {
    await expect(persistPickedBookFile(`${DOCS}books/A.epub`)).resolves.toBe(`${DOCS}books/A.epub`);
  });
});

describe('resolveBookSourceUri', () => {
  it('reads an old book from its Documents copy, making it if needed', async () => {
    files.add(`${CACHE}A.pdf`);
    await expect(resolveBookSourceUri(`${CACHE}A.pdf`)).resolves.toBe(`${DOCS}books/A.pdf`);
  });

  it('follows the app container when the old path is from a previous install', async () => {
    const oldCache = CACHE.replace('436D83D6-04F5-45A3-8910-9B20C5FF6AC1', '249E296F-98B4-49C0-9D7F-8A0583E5576C');
    files.add(`${DOCS}books/A.pdf`);
    await expect(resolveBookSourceUri(`${oldCache}A.pdf`)).resolves.toBe(`${DOCS}books/A.pdf`);
  });

  it('falls back to the (rebased) picker path when nothing can be copied', async () => {
    await expect(resolveBookSourceUri(`${CACHE}gone.pdf`)).resolves.toBe(`${CACHE}gone.pdf`);
  });
});

describe('migratePickedBookFiles', () => {
  it('copies sources but keeps book uris, and moves covers for good', async () => {
    files.add(`${CACHE}A.epub`);
    files.add(`${CACHE}cover.png`);
    const books = [
      { uri: `${CACHE}A.epub`, cover: `${CACHE}cover.png`, title: 'A' },
      { uri: 'public-domain://ko/x', cover: 'data:image/png;base64,AA' },
    ];
    const next = await migratePickedBookFiles(books);
    expect(files.has(`${DOCS}books/A.epub`)).toBe(true);
    expect(next[0].uri).toBe(`${CACHE}A.epub`);
    expect(next[0].cover).toBe(`${DOCS}covers/cover.png`);
    expect(next[1]).toBe(books[1]);
  });
});

describe('discardPersistedCopy', () => {
  it('removes our own copy of a picked file', async () => {
    files.add(`${CACHE}A.pdf`);
    const copy = await persistPickedBookFile(`${CACHE}A.pdf`);
    await discardPersistedCopy(copy, `${CACHE}A.pdf`);
    expect(files.has(copy)).toBe(false);
  });

  it('never deletes anything that is not that copy', async () => {
    files.add(`${DOCS}books/other.pdf`);
    await discardPersistedCopy(`${DOCS}books/other.pdf`, `${CACHE}A.pdf`);
    await discardPersistedCopy(`${CACHE}A.pdf`, `${CACHE}A.pdf`);
    expect(mockFs.deleteAsync).not.toHaveBeenCalled();
  });
});
