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
jest.mock('../listenDelay', () => ({
  listenDelay: jest.fn(async () => {}),
  withListenTimeout: (promise) => promise,
}));

const {
  CLAUSE_MAX, createCloudSpeaker, fetchSpeech, speechFileName, speechPieces, speechUrl,
} = require('../cloudVoice');

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

  it('asks for the same file however the spaces run', async () => {
    const first = await fetchSpeech('and it was so.   Then God said', 'juno');
    const same = await fetchSpeech(' and it was so. Then God said ', 'juno');
    expect(same).toBe(first);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload.mock.calls[0][0]).toContain('text=and%20it%20was%20so.%20Then%20God%20said');
  });

  it('fetches ahead only after the sentence being read has its audio', async () => {
    const order = [];
    let release;
    mockDownload.mockImplementationOnce(async (url, fileUri) => {
      order.push('current asked');
      await new Promise((resolve) => { release = resolve; });
      mockFiles.set(fileUri, 1200);
      order.push('current ready');
      return { status: 200 };
    });
    mockDownload.mockImplementationOnce(async (url, fileUri) => {
      order.push('next asked');
      mockFiles.set(fileUri, 1200);
      return { status: 200 };
    });
    const speaker = createCloudSpeaker();
    const current = fetchSpeech('First sentence.', 'juno');
    speaker.prefetch('Second sentence.', 'juno');
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['current asked']);
    release();
    await current;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['current asked', 'current ready', 'next asked']);
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

describe('speechPieces', () => {
  const LONG = 'They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree, '
    + 'and every morning they went out together to look for blackberries along the lane, while Peter, '
    + 'who was very naughty, ran straight away to the garden.';

  it('keeps a sentence of up to CLAUSE_MAX characters whole', () => {
    expect(speechPieces('  Mr. McGregor  said, "Stop!"  ')).toEqual(['Mr. McGregor said, "Stop!"']);
    expect(speechPieces('')).toEqual([]);
  });

  it('cuts a long sentence at clause punctuation, never past CLAUSE_MAX', () => {
    const pieces = speechPieces(LONG);
    expect(pieces.length).toBeGreaterThan(1);
    pieces.forEach((piece) => expect(piece.length).toBeLessThanOrEqual(CLAUSE_MAX));
    expect(pieces.join(' ')).toBe(LONG);
    pieces.slice(0, -1).forEach((piece) => expect(piece).toMatch(/[,;:]$/));
  });

  it('does not cut at a full stop such as Mr.', () => {
    const text = `${'Mr. McGregor walked slowly '.repeat(5).trim()}, and then he stopped.`;
    speechPieces(text).forEach((piece) => expect(piece.startsWith('McGregor')).toBe(false));
  });

  it('cuts a long run without punctuation once before a conjunction near the middle', () => {
    const text = 'The little rabbit hopped across the wide green meadow very quickly '
      + 'and then he sat down under the tall old oak tree to rest his tired paws';
    const pieces = speechPieces(text);
    expect(pieces).toHaveLength(2);
    expect(pieces[1].startsWith('and then')).toBe(true);
  });
});

describe('cloud speaker playing pieces', () => {
  const { Audio } = require('expo-av');
  let players;
  beforeEach(() => {
    mockFiles.clear();
    mockDownload.mockClear();
    players = [];
    Audio.setAudioModeAsync = jest.fn(async () => {});
    Audio.Sound = {
      createAsync: jest.fn(async (source, options, onStatus) => {
        const sound = { uri: source.uri, unloadAsync: jest.fn(async () => {}), end: () => onStatus({ didJustFinish: true }) };
        players.push(sound);
        return { sound };
      }),
    };
  });
  const flushAll = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  const LONG = 'They lived with their Mother in a sand-bank, underneath the root of a very big fir-tree, '
    + 'and every morning they went out together to look for blackberries along the lane.';

  it('plays each piece in turn, fetching the next one while one plays', async () => {
    const pieces = speechPieces(LONG);
    expect(pieces.length).toBe(2);
    const speaker = createCloudSpeaker();
    const done = speaker.speak({ text: LONG, voiceName: 'juno', rate: 1 });
    await flushAll();
    // The first piece plays, and the second has already been asked for.
    expect(players).toHaveLength(1);
    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(mockDownload.mock.calls[0][0]).toContain(encodeURIComponent(pieces[0]));
    expect(mockDownload.mock.calls[1][0]).toContain(encodeURIComponent(pieces[1]));
    players[0].end();
    await flushAll();
    expect(players).toHaveLength(2);
    players[1].end();
    await expect(done).resolves.toBe('finish');
  });

  it('answers cancel at once when stopped mid-sentence, and plays nothing more', async () => {
    const speaker = createCloudSpeaker();
    const done = speaker.speak({ text: LONG, voiceName: 'juno', rate: 1 });
    await flushAll();
    speaker.stop();
    await expect(done).resolves.toBe('cancel');
    await flushAll();
    expect(players).toHaveLength(1);
    expect(players[0].unloadAsync).toHaveBeenCalled();
  });

  it('fails when a piece cannot be fetched', async () => {
    mockDownload.mockImplementationOnce(async (url, fileUri) => {
      mockFiles.set(fileUri, 10);
      return { status: 503 };
    });
    const speaker = createCloudSpeaker();
    await expect(speaker.speak({ text: 'Short line.', voiceName: 'juno', rate: 1 })).resolves.toBe('error');
  });
});
