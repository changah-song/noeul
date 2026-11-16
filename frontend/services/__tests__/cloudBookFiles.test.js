jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn() }));
jest.mock('../bookCloudSync', () => ({
  MAX_CLOUD_BOOK_BYTES: 50 * 1024 * 1024,
  isCloudBookUser: (user) => Boolean(user?.id) && user?.is_anonymous !== true,
  markUserBookOpened: jest.fn(),
  syncUserBookFiles: jest.fn(),
  uploadUserBook: jest.fn(),
}));
jest.mock('../localOwnerCoordinator', () => ({ isCurrentSyncGeneration: () => true }));

const { reconcileCloudBookFiles, cloudBookFilesSignature } = require('../cloudBookFiles');

const USER = { id: 'u1', is_anonymous: false };
const MB = 1024 * 1024;

const book = (name, openedAt, extra = {}) => ({
  id: name,
  uri: `file:///books/${name}.epub`,
  title: name,
  downloaded: true,
  lastOpenedAt: openedAt,
  ...extra,
});

// A fake server: rows by cloud id, with the newest `limit` keeping their files.
const makeServer = (limit = 3) => {
  const rows = new Map();
  let next = 1;
  const upload = jest.fn(async ({ localBook, includeFile }) => {
    const id = localBook.cloudId ?? `c${next++}`;
    const existing = rows.get(id);
    const row = {
      id,
      user_id: USER.id,
      file_path: `u1/${id}/book.epub`,
      last_opened_at: localBook.lastOpenedAt,
      file_stored: includeFile || existing?.file_stored === true,
    };
    rows.set(id, row);
    return row;
  });
  const markOpened = jest.fn(async ({ cloudBookId, openedAt }) => {
    rows.get(cloudBookId).last_opened_at = openedAt;
  });
  const syncFiles = jest.fn(async () => {
    const ordered = [...rows.values()].sort((a, b) => (
      new Date(b.last_opened_at) - new Date(a.last_opened_at)
    ));
    ordered.slice(limit).forEach((row) => { row.file_stored = false; });
    return {
      limit,
      keep: new Set(ordered.slice(0, limit).map((row) => row.id)),
      stored: new Set(ordered.filter((row) => row.file_stored).map((row) => row.id)),
    };
  });
  return { rows, deps: { upload, markOpened, syncFiles, fileSize: async () => 2 * MB } };
};

// Applies updateBook patches like the app's book list.
const run = async (books, server, extra = {}) => {
  let list = books.map((entry) => ({ ...entry }));
  const updateBook = (target, patch) => {
    list = list.map((candidate) => (candidate.uri === target.uri ? { ...candidate, ...patch } : candidate));
  };
  const result = await reconcileCloudBookFiles({
    user: USER,
    ownerId: USER.id,
    generation: 1,
    books: list,
    updateBook,
    deps: { ...server.deps, ...extra },
  });
  return { result, list };
};

describe('reconcileCloudBookFiles', () => {
  it('gives every book a row and uploads only the 3 most recently opened files', async () => {
    const server = makeServer(3);
    const books = [
      book('a', '2026-11-01T00:00:00Z'),
      book('b', '2026-11-05T00:00:00Z'),
      book('c', '2026-11-03T00:00:00Z'),
      book('d', '2026-11-04T00:00:00Z'),
      book('e', '2026-11-02T00:00:00Z'),
    ];
    const { result, list } = await run(books, server);

    expect(server.rows.size).toBe(5);
    expect(result.uploaded).toBe(3);
    const stored = list.filter((entry) => entry.cloudFileStored).map((entry) => entry.title).sort();
    expect(stored).toEqual(['b', 'c', 'd']);
    const fileUploads = server.deps.upload.mock.calls.filter(([args]) => args.includeFile);
    expect(fileUploads.map(([args]) => args.localBook.title).sort()).toEqual(['b', 'c', 'd']);
  });

  it('opening an older book uploads it and drops the oldest stored one', async () => {
    const server = makeServer(3);
    const first = await run([
      book('a', '2026-11-01T00:00:00Z'),
      book('b', '2026-11-02T00:00:00Z'),
      book('c', '2026-11-03T00:00:00Z'),
      book('d', '2026-11-04T00:00:00Z'),
    ], server);
    expect(first.list.find((entry) => entry.title === 'a').cloudFileStored).toBe(false);

    const reopened = first.list.map((entry) => (
      entry.title === 'a' ? { ...entry, lastOpenedAt: '2026-11-10T00:00:00Z' } : entry
    ));
    server.deps.upload.mockClear();
    const { list } = await run(reopened, server);

    expect(server.deps.markOpened).toHaveBeenCalledWith(expect.objectContaining({
      cloudBookId: first.list.find((entry) => entry.title === 'a').cloudId,
    }));
    const stored = list.filter((entry) => entry.cloudFileStored).map((entry) => entry.title).sort();
    expect(stored).toEqual(['a', 'c', 'd']);
    expect(server.deps.upload.mock.calls.map(([args]) => [args.localBook.title, args.includeFile]))
      .toEqual([['a', true]]);
  });

  it('keeps a book over 50 MB on the device', async () => {
    const server = makeServer(3);
    const { list } = await run([book('big', '2026-11-05T00:00:00Z')], server, {
      fileSize: async () => 80 * MB,
    });
    expect(server.rows.size).toBe(1);
    expect(list[0].cloudFileStored).toBe(false);
    expect(server.deps.upload.mock.calls.every(([args]) => !args.includeFile)).toBe(true);
  });

  it('does nothing for guests or library books', async () => {
    const server = makeServer(3);
    const guest = await reconcileCloudBookFiles({
      user: { id: 'g1', is_anonymous: true },
      ownerId: 'g1',
      books: [book('a', '2026-11-01T00:00:00Z')],
      updateBook: jest.fn(),
      deps: server.deps,
    });
    expect(guest).toBeNull();
    expect(server.deps.upload).not.toHaveBeenCalled();

    await run([book('lib', '2026-11-01T00:00:00Z', { publicLibrary: true })], server);
    expect(server.deps.upload).not.toHaveBeenCalled();
  });
});

describe('cloudBookFilesSignature', () => {
  it('changes when a book is opened or imported, not when progress moves', () => {
    const books = [book('a', '2026-11-01T00:00:00Z', { cloudId: 'c1', progress: 0.1 })];
    const base = cloudBookFilesSignature(books);
    expect(cloudBookFilesSignature([{ ...books[0], progress: 0.5 }])).toBe(base);
    expect(cloudBookFilesSignature([{ ...books[0], lastOpenedAt: '2026-11-02T00:00:00Z' }])).not.toBe(base);
    expect(cloudBookFilesSignature([...books, book('b', '2026-10-01T00:00:00Z')])).not.toBe(base);
  });
});
