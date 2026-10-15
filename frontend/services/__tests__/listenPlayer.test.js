jest.mock('react-native-tts', () => ({}), { virtual: true });

const { createListenPlayer, voiceLocaleFor, LISTEN_RATES } = require('../listenPlayer');

// A stand-in engine: speak() hands back an id, and the test fires the finish
// or cancel events the real engine would.
const fakeTts = () => {
  const handlers = {};
  let nextId = 1;
  return {
    spoken: [],
    languages: [],
    rates: [],
    addEventListener: jest.fn((name, handler) => { handlers[name] = handler; }),
    removeEventListener: jest.fn((name) => { delete handlers[name]; }),
    setDefaultLanguage: jest.fn(async (locale) => { this.languages?.push(locale); return 'success'; }),
    setDefaultRate: jest.fn(async () => 'success'),
    speak: jest.fn(async function speak(text) {
      const id = `u${nextId++}`;
      this.spoken.push({ id, text });
      return id;
    }),
    stop: jest.fn(),
    finish(id) { handlers['tts-finish']?.({ utteranceId: id }); },
    cancel(id) { handlers['tts-cancel']?.({ utteranceId: id }); },
    error(id) { handlers['tts-error']?.({ utteranceId: id }); },
    handlers,
  };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('listenPlayer', () => {
  it('speaks items in order and resolves done after the last finish', async () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    const result = player.speakSequence([
      { text: '안녕하세요', locale: 'ko-KR', rate: 1 },
      { text: 'hello', locale: 'en-US', rate: 1 },
    ]);
    await flush();
    expect(tts.spoken.map((s) => s.text)).toEqual(['안녕하세요']);
    tts.finish('u1');
    await flush();
    await flush();
    expect(tts.spoken.map((s) => s.text)).toEqual(['안녕하세요', 'hello']);
    tts.finish('u2');
    await expect(result).resolves.toBe('done');
    // The voice switched once per language, not per utterance.
    expect(tts.setDefaultLanguage.mock.calls.map((c) => c[0])).toEqual(['ko-KR', 'en-US']);
    expect(tts.setDefaultRate).toHaveBeenCalledWith(1, true);
  });

  it('stop() cancels the running sequence and later items never play', async () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    const result = player.speakSequence([
      { text: 'one', locale: 'en-US', rate: 1 },
      { text: 'two', locale: 'en-US', rate: 1 },
    ]);
    await flush();
    player.stop();
    await expect(result).resolves.toBe('stopped');
    expect(tts.stop).toHaveBeenCalled();
    await flush();
    expect(tts.spoken.map((s) => s.text)).toEqual(['one']);
  });

  it('a new sequence supersedes the old one', async () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    const first = player.speakSequence([{ text: 'first', locale: 'en-US', rate: 1 }, { text: 'never', locale: 'en-US', rate: 1 }]);
    await flush();
    const second = player.speakSequence([{ text: 'second', locale: 'en-US', rate: 1 }]);
    await flush();
    tts.finish('u1');
    await expect(first).resolves.toBe('stopped');
    tts.finish('u2');
    await expect(second).resolves.toBe('done');
    expect(tts.spoken.map((s) => s.text)).toEqual(['first', 'second']);
  });

  it('reports an engine error instead of racing on', async () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    const result = player.speakSequence([{ text: 'x', locale: 'mn-MN', rate: 1 }, { text: 'y', locale: 'mn-MN', rate: 1 }]);
    await flush();
    tts.error('u1');
    await expect(result).resolves.toBe('error');
    expect(tts.spoken).toHaveLength(1);
  });

  it('does not hang when the finish event beats the speak() promise', async () => {
    const tts = fakeTts();
    // Fire the finish event synchronously inside speak, before its promise resolves.
    tts.speak = jest.fn(async function speak(text) {
      const id = 'early';
      this.spoken.push({ id, text });
      tts.handlers['tts-finish']?.({ utteranceId: id });
      return id;
    });
    const player = createListenPlayer({ tts });
    await expect(player.speakSequence([{ text: 'a', locale: 'en-US', rate: 1 }])).resolves.toBe('done');
  });

  it('runs before() hooks as each item starts', async () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    const order = [];
    const result = player.speakSequence([
      { text: 'a', locale: 'en-US', rate: 1, before: () => order.push('a') },
      { text: 'b', locale: 'en-US', rate: 1, before: () => order.push('b') },
    ]);
    await flush();
    expect(order).toEqual(['a']);
    tts.finish('u1');
    await flush();
    await flush();
    expect(order).toEqual(['a', 'b']);
    tts.finish('u2');
    await result;
  });
});

describe('voiceLocaleFor', () => {
  it('maps app language codes to engine locales', () => {
    expect(voiceLocaleFor('ko')).toBe('ko-KR');
    expect(voiceLocaleFor('zh')).toBe('zh-CN');
    expect(voiceLocaleFor('zh-Hant')).toBe('zh-TW');
    expect(voiceLocaleFor('ko-KR')).toBe('ko-KR');
    expect(voiceLocaleFor('ko_kr')).toBe('ko-KR');
    expect(voiceLocaleFor('')).toBe('en-US');
    expect(voiceLocaleFor('xx')).toBe('en-US');
  });

  it('offers normal speed among the rates', () => {
    expect(LISTEN_RATES).toContain(1);
  });
});
