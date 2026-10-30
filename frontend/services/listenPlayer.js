import Tts from 'react-native-tts';

// Listen mode's voice: a small queue over the phone's own text-to-speech
// engine. The reader screen hands it sequences of utterances (the sentence,
// then for study mode each underlined word and its meaning) and waits for the
// sequence to finish before stepping the focus beam to the next sentence.
//
// The engine is free and works offline; the voice is whatever the phone has
// installed for the language (Samsung or Google TTS on a Galaxy). Nothing here
// touches the network.

// BCP-47 locale the engine understands for each language code the app uses.
const VOICE_LOCALES = {
  en: 'en-US',
  ko: 'ko-KR',
  zh: 'zh-CN',
  'zh-hant': 'zh-TW',
  ja: 'ja-JP',
  fr: 'fr-FR',
  es: 'es-ES',
  ru: 'ru-RU',
  vi: 'vi-VN',
  id: 'id-ID',
  th: 'th-TH',
  ar: 'ar-SA',
  mn: 'mn-MN',
  pt: 'pt-BR',
};

export const voiceLocaleFor = (code) => {
  const raw = String(code || '').trim().replace('_', '-');
  if (!raw) return 'en-US';
  const lower = raw.toLowerCase();
  if (VOICE_LOCALES[lower]) return VOICE_LOCALES[lower];
  if (['zh-tw', 'zh-hk', 'zh-mo'].includes(lower)) return 'zh-TW';
  // Already a full locale such as ko-KR: keep its casing convention.
  if (/^[a-z]{2,3}-[a-z]{2,4}$/i.test(raw)) {
    const [language, region] = raw.split('-');
    return `${language.toLowerCase()}-${region.toUpperCase()}`;
  }
  return VOICE_LOCALES[lower.split('-')[0]] || 'en-US';
};

// Playback rates offered in the listen bar; 1 is the engine's normal speed.
export const LISTEN_RATES = [0.8, 1, 1.2, 1.5];
// Voice pitch: lower / normal / higher. 1 is the voice's own pitch.
export const LISTEN_PITCHES = [0.85, 1, 1.15];

// A short line each voice reads in the picker so the reader can compare them.
const VOICE_SAMPLES = {
  ko: '안녕하세요. 오늘도 같이 책을 읽어 볼까요?',
  zh: '你好，我们今天一起来读这本书吧。',
  ja: 'こんにちは。今日も一緒に本を読みましょう。',
  en: 'Hello. Shall we read a few pages together today?',
  pt: 'Olá! Vamos ler algumas páginas juntos hoje?',
};
export const voiceSampleFor = (locale) => {
  const language = String(locale || '').split('-')[0].toLowerCase();
  return VOICE_SAMPLES[language] || VOICE_SAMPLES.en;
};

// Engines report Mandarin and Cantonese under their ISO 639-3 codes.
const LANGUAGE_ALIASES = { cmn: 'zh', zho: 'zh', chi: 'zh', kor: 'ko', jpn: 'ja', eng: 'en' };
const splitLocale = (locale) => {
  const [language = '', region = ''] = String(locale || '').replace(/_/g, '-').toLowerCase().split('-');
  return { language: LANGUAGE_ALIASES[language] || language, region };
};

// Samsung's engine names its voices like ko-KR-SMTf00 / ko-KR-SMTm00.
const voiceGender = (name) => {
  const match = /-smt([fm])\d/i.exec(String(name || ''));
  if (!match) return null;
  return match[1].toLowerCase() === 'f' ? 'female' : 'male';
};

// The voices the reader can pick for a locale: on this phone, for the same
// language and region, already downloaded and working offline. Engines list
// a "<locale>-language" alias for their default voice; that is the "Phone
// default" row, so it is left out here. Ordered by name so "Voice 2" stays
// the same voice between visits.
export const onDeviceVoicesFor = (voices, locale) => {
  const target = splitLocale(locale);
  const seen = new Set();
  return (Array.isArray(voices) ? voices : [])
    .filter((voice) => {
      const id = String(voice?.id || '');
      if (!id || seen.has(id)) return false;
      if (voice.networkConnectionRequired || voice.notInstalled) return false;
      if (/-language$/i.test(id)) return false;
      const own = splitLocale(voice.language);
      if (own.language !== target.language) return false;
      if (target.region && own.region && own.region !== target.region) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((voice, index) => ({
      id: String(voice.id),
      number: index + 1,
      gender: voiceGender(voice.id),
      quality: Number(voice.quality) || 0,
    }));
};

export const loadOnDeviceVoices = async (locale, tts = Tts) => {
  try {
    await tts.getInitStatus();
    return onDeviceVoicesFor(await tts.voices(), locale);
  } catch {
    return [];
  }
};

const LANGUAGE_SETTLE_MS = 1500;

// Even very fast speech takes over ~25 ms a character; a sentence of 12+
// characters "finished" in under a sixth of that never played.
export const isImplausiblyFast = (utterance, elapsedMs) => {
  const length = String(utterance || '').trim().length;
  return length >= 12 && elapsedMs < Math.min(400, length * 4);
};

export const createListenPlayer = ({ tts = Tts, now = Date.now } = {}) => {
  let session = 0;
  let currentId = null;
  let resolveCurrent = null;
  let currentLocale = null;
  let currentRate = null;
  let currentVoice = null;
  let currentPitch = null;
  // A finish event can arrive before speak()'s promise hands back the id for
  // a very short utterance; remember it so the wait does not hang.
  let lastEndedId = null;
  let lastEndedWith = null;

  const settle = (id, outcome) => {
    if (resolveCurrent && currentId != null && String(id) === String(currentId)) {
      const resolve = resolveCurrent;
      resolveCurrent = null;
      currentId = null;
      resolve(outcome);
      return;
    }
    lastEndedId = id;
    lastEndedWith = outcome;
  };
  const onFinish = (event) => settle(event?.utteranceId, 'finish');
  const onCancel = (event) => settle(event?.utteranceId, 'cancel');
  const onError = (event) => settle(event?.utteranceId, 'error');
  // Keep the subscriptions: react-native-tts's removeEventListener calls
  // NativeEventEmitter.removeListener, which React Native 0.81 removed, so
  // unhooking must go through each subscription's remove() instead.
  const subscriptions = [
    tts.addEventListener('tts-finish', onFinish),
    tts.addEventListener('tts-cancel', onCancel),
    tts.addEventListener('tts-error', onError),
  ];

  const withTimeout = (promise, ms) => Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);

  const prepare = async (locale, rate, voice, pitch) => {
    const wantVoice = voice || null;
    if ((locale && locale !== currentLocale) || wantVoice !== currentVoice) {
      // Set the voice before speaking; otherwise the first utterance after a
      // language change is read with the previous voice. setLanguage resets
      // the engine to that language's default voice, so a chosen voice goes
      // on after it; a voice the phone no longer has keeps the default.
      if (locale) await withTimeout(tts.setDefaultLanguage(locale), LANGUAGE_SETTLE_MS);
      if (wantVoice) await withTimeout(tts.setDefaultVoice(wantVoice), LANGUAGE_SETTLE_MS);
      currentLocale = locale || currentLocale;
      currentVoice = wantVoice;
    }
    if (Number.isFinite(rate) && rate !== currentRate) {
      // skipTransform: pass the engine's own scale, where 1 is normal speed.
      await withTimeout(tts.setDefaultRate(rate, true), LANGUAGE_SETTLE_MS);
      currentRate = rate;
    }
    const wantPitch = Number.isFinite(pitch) ? pitch : 1;
    if (wantPitch !== currentPitch) {
      await withTimeout(tts.setDefaultPitch(wantPitch), LANGUAGE_SETTLE_MS);
      currentPitch = wantPitch;
    }
  };

  // Speak one utterance; resolves 'finish', 'cancel' or 'error'.
  const speakOne = async ({ text, locale, rate, voice, pitch }, mySession) => {
    const utterance = String(text || '').trim();
    if (!utterance) return 'finish';
    await prepare(locale, rate, voice, pitch);
    if (mySession !== session) return 'cancel';
    lastEndedId = null;
    lastEndedWith = null;
    const waiter = new Promise((resolve) => {
      resolveCurrent = resolve;
    });
    let id;
    const startedAt = now();
    try {
      id = await tts.speak(utterance);
    } catch {
      resolveCurrent = null;
      return 'error';
    }
    if (mySession !== session) {
      resolveCurrent = null;
      return 'cancel';
    }
    let outcome;
    if (lastEndedId != null && String(lastEndedId) === String(id)) {
      resolveCurrent = null;
      outcome = lastEndedWith;
    } else {
      currentId = id;
      outcome = await waiter;
    }
    // Some engines without a voice for the language report every utterance
    // as finished at once, without a sound: the reader then raced through the
    // chapter. A sentence can't be read that fast, so count it as an error.
    if (outcome === 'finish' && isImplausiblyFast(utterance, now() - startedAt)) {
      return 'error';
    }
    return outcome;
  };

  // End whatever is playing: the engine flushes its queue and the waiting
  // sequence resolves 'cancel'.
  const interrupt = () => {
    session += 1;
    const resolve = resolveCurrent;
    resolveCurrent = null;
    currentId = null;
    try {
      tts.stop();
    } catch {
      // The engine may not be bound yet; nothing to stop then.
    }
    if (resolve) resolve('cancel');
  };

  return {
    // Speak the items in order. Resolves 'done' when every item finished,
    // 'stopped' when stop() or a newer sequence interrupted it, 'error' when
    // the engine failed (usually no voice installed for the language).
    async speakSequence(items = []) {
      interrupt();
      const mySession = session;
      for (const item of items) {
        if (typeof item?.before === 'function') item.before();
        // A silent gap (no text), e.g. between one word and the next.
        if (!item?.text && Number(item?.pauseMs) > 0) {
          await new Promise((resolve) => setTimeout(resolve, Number(item.pauseMs)));
          if (mySession !== session) return 'stopped';
          continue;
        }
        const outcome = await speakOne(item, mySession);
        if (mySession !== session || outcome === 'cancel') return 'stopped';
        if (outcome === 'error') return 'error';
      }
      return mySession === session ? 'done' : 'stopped';
    },

    stop() {
      interrupt();
    },

    destroy() {
      this.stop();
      subscriptions.forEach((subscription) => {
        try {
          subscription?.remove?.();
        } catch {
          // Already gone with the engine; nothing to unhook.
        }
      });
    },
  };
};
