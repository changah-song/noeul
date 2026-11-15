const mockFiles = new Map();
const mockDownload = jest.fn(async (url, fileUri) => {
  mockFiles.set(fileUri, 1200);
  return { status: 200 };
});
jest.mock('expo-av', () => ({ Audio: {} }), { virtual: true });
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async (uri) => ({ exists: mockFiles.has(uri), size: mockFiles.get(uri) || 0 })),
  downloadAsync: (...args) => mockDownload(...args),
  deleteAsync: jest.fn(async (uri) => { mockFiles.delete(uri); }),
}), { virtual: true });
jest.mock('../../config', () => ({ BASE_URL: 'https://api.test' }));
jest.mock('../api/client', () => ({ getAccessToken: jest.fn(async () => 'token-1') }));
jest.mock('../listenDelay', () => ({ withListenTimeout: (promise) => promise }));

const { fetchSpeech, speechFileName, speechUrl } = require('../cloudVoice');

describe('cloudVoice', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockDownload.mockClear();
  });

  it('names a sentence\'s file by voice and text', () => {
    expect(speechFileName('Hello.', 'juno')).toBe(speechFileName('Hello.', 'juno'));
    expect(speechFileName('Hello.', 'juno')).not.toBe(speechFileName('Hello!', 'juno'));
    expect(speechFileName('Hello.', 'juno')).toMatch(/^juno-[0-9a-f]+\.mp3$/);
  });

  it('builds the request with the text encoded', () => {
    expect(speechUrl('Is he "married" & single?', 'juno', 'https://api.test'))
      .toBe('https://api.test/speak/?voice=juno&text=Is%20he%20%22married%22%20%26%20single%3F');
  });

  it('downloads a sentence once and reuses the file', async () => {
    const [first, same] = await Promise.all([fetchSpeech('Hello.', 'juno'), fetchSpeech('Hello.', 'juno')]);
    expect(first).toBe(same);
    expect(first).toBe(`file:///cache/listen-voice/${speechFileName('Hello.', 'juno')}`);
    await fetchSpeech('Hello.', 'juno');
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload.mock.calls[0][2]).toEqual({ headers: { Authorization: 'Bearer token-1' } });
  });

  it('removes the file and fails when the server refuses', async () => {
    mockDownload.mockImplementationOnce(async (url, fileUri) => {
      mockFiles.set(fileUri, 80);
      return { status: 503 };
    });
    await expect(fetchSpeech('Later.', 'juno')).rejects.toThrow('503');
    expect(mockFiles.size).toBe(0);
  });
});
