const DOCS = 'file:///var/mobile/Containers/Data/Application/APP/Documents/';

const files = new Map(); // uri -> first bytes (base64)
const mockFs = {
  documentDirectory: DOCS,
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async ({ from, to }) => {
    if (!files.has(from)) throw new Error('missing');
    files.set(to, files.get(from));
  }),
  moveAsync: jest.fn(async ({ from, to }) => {
    files.set(to, files.get(from));
    files.delete(from);
  }),
  deleteAsync: jest.fn(async (uri) => { files.delete(uri); }),
  readAsStringAsync: jest.fn(async (uri) => files.get(uri)),
  getInfoAsync: jest.fn(async (uri) => ({ exists: files.has(uri), size: 1234 })),
};
jest.mock('expo-file-system/legacy', () => mockFs);

const mockLinking = {
  initialUrl: null,
  handler: null,
  getInitialURL: jest.fn(async () => mockLinking.initialUrl),
  addEventListener: jest.fn((event, handler) => {
    mockLinking.handler = handler;
    return { remove: jest.fn() };
  }),
};
jest.mock('react-native', () => ({ Linking: mockLinking }));

const mockDisplayName = jest.fn(async () => null);
jest.mock('../../modules/native-epub-reader/src/NativeEpubReaderView', () => ({
  contentDisplayName: (...args) => mockDisplayName(...args),
}));

const {
  isOpenedFileUrl,
  stageOpenedBookFile,
  discardOpenedCopy,
  listenForOpenedBookFiles,
  formatFromHeader,
  __resetOpenedBookFiles,
} = require('../openedBookFiles');

const PDF = 'JVBERg==';
const ZIP = 'UEsDBA==';

beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
  mockLinking.initialUrl = null;
  mockLinking.handler = null;
  __resetOpenedBookFiles();
});

describe('opened file urls', () => {
  it('accepts files and content uris, not app or sign-in links', () => {
    expect(isOpenedFileUrl(`${DOCS}Inbox/a.epub`)).toBe(true);
    expect(isOpenedFileUrl('content://com.android.providers.downloads.documents/document/1')).toBe(true);
    expect(isOpenedFileUrl('noeul://open')).toBe(false);
    expect(isOpenedFileUrl('com.googleusercontent.apps.123:/oauth2redirect')).toBe(false);
    expect(isOpenedFileUrl(null)).toBe(false);
  });

  it('tells books apart by their first bytes', () => {
    expect(formatFromHeader(PDF)).toBe('pdf');
    expect(formatFromHeader(ZIP)).toBe('epub');
    expect(formatFromHeader('AAAAAA==')).toBe(null);
  });
});

describe('stageOpenedBookFile', () => {
  it('copies an iOS inbox file into Documents/books and clears the inbox', async () => {
    const inbox = `${DOCS}Inbox/My%20Book.epub`;
    files.set(inbox, ZIP);
    const staged = await stageOpenedBookFile(inbox);
    expect(staged.format).toBe('epub');
    expect(staged.name).toBe('My Book.epub');
    expect(staged.uri).toMatch(new RegExp(`^${DOCS}books/opened-.+\\.epub$`));
    expect(files.has(staged.uri)).toBe(true);
    expect(files.has(inbox)).toBe(false);
  });

  it('names a content uri from the provider and reads its format from the bytes', async () => {
    const uri = 'content://com.android.providers.downloads.documents/document/msf%3A42';
    files.set(uri, PDF);
    mockDisplayName.mockResolvedValueOnce('Lecture notes');
    const staged = await stageOpenedBookFile(uri);
    expect(staged).toMatchObject({ format: 'pdf', name: 'Lecture notes.pdf', mimeType: 'application/pdf' });
    expect(files.has(uri)).toBe(true); // another app's file stays put
  });

  it('turns away files that are not books and keeps no copy', async () => {
    const uri = `${DOCS}Inbox/photo.jpg`;
    files.set(uri, '/9j/4A==');
    await expect(stageOpenedBookFile(uri)).resolves.toEqual({ unsupported: true, name: 'photo.jpg' });
    expect([...files.keys()].some((key) => key.includes('/books/'))).toBe(false);
  });
});

describe('discardOpenedCopy', () => {
  it('only removes our own opened copies', async () => {
    await discardOpenedCopy(`${DOCS}books/opened-x.epub`);
    await discardOpenedCopy(`${DOCS}books/A.epub`);
    await discardOpenedCopy('content://x/1');
    expect(mockFs.deleteAsync).toHaveBeenCalledTimes(1);
    expect(mockFs.deleteAsync).toHaveBeenCalledWith(`${DOCS}books/opened-x.epub`, { idempotent: true });
  });
});

describe('listenForOpenedBookFiles', () => {
  it('reports the launch file and later ones, once each, and ignores other links', async () => {
    mockLinking.initialUrl = `${DOCS}Inbox/a.epub`;
    const onOpened = jest.fn();
    const stop = listenForOpenedBookFiles(onOpened);
    await Promise.resolve();
    await Promise.resolve();
    mockLinking.handler({ url: 'noeul://home' });
    mockLinking.handler({ url: `${DOCS}Inbox/b.pdf` });
    mockLinking.handler({ url: `${DOCS}Inbox/b.pdf` });
    expect(onOpened.mock.calls.map(([url]) => url)).toEqual([`${DOCS}Inbox/a.epub`, `${DOCS}Inbox/b.pdf`]);
    stop();
  });
});
