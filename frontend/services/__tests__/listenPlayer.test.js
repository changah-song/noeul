jest.mock('react-native-tts', () => ({}), { virtual: true });

const {
  createListenPlayer, voiceLocaleFor, voiceSampleFor, onDeviceVoicesFor, LISTEN_RATES,
} = require('../listenPlayer');

// A stand-in engine: speak() hands back an id, and the test fires the finish
// or cancel events the real engine would.
const fakeTts = () => {
  const handlers = {};
  let nextId = 1;
  return {
    spoken: [],
    languages: [],
    rates: [],
    addEventListener: jest.fn((name, handler) => {
      handlers[name] = handler;
      return { remove: () => { delete handlers[name]; } };
    }),
    // RN 0.81: the library's removeEventListener throws; it must not be used.
    removeEventListener: jest.fn(() => { throw new TypeError('this.removeListener is not a function'); }),
    setDefaultLanguage: jest.fn(async (locale) => { this.languages?.push(locale); return 'success'; }),
    setDefaultRate: jest.fn(async () => 'success'),
    setDefaultVoice: jest.fn(async () => 'success'),
    setDefaultPitch: jest.fn(async () => 'success'),
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
    expect(voiceLocaleFor('ja')).toBe('ja-JP');
    expect(voiceLocaleFor('pt')).toBe('pt-BR');
    expect(voiceLocaleFor('ko-KR')).toBe('ko-KR');
    expect(voiceLocaleFor('ko_kr')).toBe('ko-KR');
    expect(voiceLocaleFor('')).toBe('en-US');
    expect(voiceLocaleFor('xx')).toBe('en-US');
  });

  it('has a sample line for Japanese and Portuguese voices', () => {
    expect(voiceSampleFor('ja-JP')).toMatch(/本を読み/);
    expect(voiceSampleFor('pt-BR')).toMatch(/Vamos ler/);
    expect(voiceSampleFor('de-DE')).toBe(voiceSampleFor('en-US'));
  });

  it('offers normal speed among the rates', () => {
    expect(LISTEN_RATES).toContain(1);
  });
});


describe('listenPlayer teardown', () => {
  it('unhooks through the subscriptions, not removeEventListener', () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    expect(() => player.destroy()).not.toThrow();
    expect(tts.removeEventListener).not.toHaveBeenCalled();
    expect(Object.keys(tts.handlers)).toEqual([]);
  });

  it('puts a chosen voice on after the language, and again after switching languages', async () => {
    const tts = fakeTts();
    const calls = [];
    tts.setDefaultLanguage.mockImplementation(async (locale) => { calls.push(`lang:${locale}`); });
    tts.setDefaultVoice.mockImplementation(async (id) => { calls.push(`voice:${id}`); });
    const player = createListenPlayer({ tts });
    const done = player.speakSequence([
      { text: '하나', locale: 'ko-KR', voice: 'ko-kr-x-kod-local' },
      { text: 'one', locale: 'en-US' },
      { text: '둘', locale: 'ko-KR', voice: 'ko-kr-x-kod-local' },
    ]);
    for (let i = 0; i < 3; i += 1) {
      await flush();
      tts.finish(tts.spoken[i].id);
    }
    await expect(done).resolves.toBe('done');
    expect(calls).toEqual([
      'lang:ko-KR', 'voice:ko-kr-x-kod-local',
      'lang:en-US',
      'lang:ko-KR', 'voice:ko-kr-x-kod-local',
    ]);
  });

  it('sets the pitch once and only when it changes', async () => {
    const tts = fakeTts();
    const player = createListenPlayer({ tts });
    const done = player.speakSequence([
      { text: 'a', locale: 'en-US', pitch: 1.15 },
      { text: 'b', locale: 'en-US', pitch: 1.15 },
    ]);
    for (let i = 0; i < 2; i += 1) {
      await flush();
      tts.finish(tts.spoken[i].id);
    }
    await done;
    expect(tts.setDefaultPitch.mock.calls).toEqual([[1.15]]);
  });
});

describe('onDeviceVoicesFor', () => {
  const voices = [
    { id: 'ko-kr-x-kod-local', language: 'ko-KR', networkConnectionRequired: false, notInstalled: false },
    { id: 'ko-kr-x-ism-local', language: 'ko-KR', networkConnectionRequired: false, notInstalled: false },
    { id: 'ko-kr-x-ism-network', language: 'ko-KR', networkConnectionRequired: true, notInstalled: false },
    { id: 'ko-kr-x-kob-local', language: 'ko-KR', networkConnectionRequired: false, notInstalled: true },
    { id: 'ko-KR-language', language: 'ko-KR', networkConnectionRequired: false, notInstalled: false },
    { id: 'ko-KR-SMTf00', language: 'ko-KR', networkConnectionRequired: false, notInstalled: false },
    { id: 'cmn-cn-x-ccc-local', language: 'cmn-CN', networkConnectionRequired: false, notInstalled: false },
    { id: 'cmn-tw-x-ctc-local', language: 'cmn-TW', networkConnectionRequired: false, notInstalled: false },
    { id: 'en-us-x-iob-local', language: 'en-US', networkConnectionRequired: false, notInstalled: false },
  ];

  it('keeps only offline, installed voices of the language, numbered by name', () => {
    expect(onDeviceVoicesFor(voices, 'ko-KR')).toEqual([
      { id: 'ko-KR-SMTf00', number: 1, gender: 'female', quality: 0 },
      { id: 'ko-kr-x-ism-local', number: 2, gender: null, quality: 0 },
      { id: 'ko-kr-x-kod-local', number: 3, gender: null, quality: 0 },
    ]);
  });

  it('matches Mandarin voices reported as cmn, by region', () => {
    expect(onDeviceVoicesFor(voices, 'zh-CN').map((v) => v.id)).toEqual(['cmn-cn-x-ccc-local']);
    expect(onDeviceVoicesFor(voices, 'zh-TW').map((v) => v.id)).toEqual(['cmn-tw-x-ctc-local']);
  });

  it('copes with no voices at all', () => {
    expect(onDeviceVoicesFor(null, 'ko-KR')).toEqual([]);
  });

  it('treats a sentence "finished" instantly as an error (an engine with no voice)', async () => {
    const tts = fakeTts();
    let clock = 0;
    const player = createListenPlayer({ tts, now: () => clock });
    const sentence = 'Once upon a time there were four little rabbits.';

    const silent = player.speakSequence([{ text: sentence, locale: 'en-US', rate: 1 }]);
    await flush();
    clock += 5;
    tts.finish('u1');
    await expect(silent).resolves.toBe('error');

    const spoken = player.speakSequence([{ text: sentence, locale: 'en-US', rate: 1 }]);
    await flush();
    clock += 2500;
    tts.finish('u2');
    await expect(spoken).resolves.toBe('done');
  });
});

