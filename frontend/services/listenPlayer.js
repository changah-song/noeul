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

const LANGUAGE_SETTLE_MS = 1500;

export const createListenPlayer = ({ tts = Tts } = {}) => {
  let session = 0;
  let currentId = null;
  let resolveCurrent = null;
  let currentLocale = null;
  let currentRate = null;
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
  tts.addEventListener('tts-finish', onFinish);
  tts.addEventListener('tts-cancel', onCancel);
  tts.addEventListener('tts-error', onError);

  const withTimeout = (promise, ms) => Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);

  const prepare = async (locale, rate) => {
    if (locale && locale !== currentLocale) {
      // Set the voice before speaking; otherwise the first utterance after a
      // language change is read with the previous voice.
      await withTimeout(tts.setDefaultLanguage(locale), LANGUAGE_SETTLE_MS);
      currentLocale = locale;
    }
    if (Number.isFinite(rate) && rate !== currentRate) {
      // skipTransform: pass the engine's own scale, where 1 is normal speed.
      await withTimeout(tts.setDefaultRate(rate, true), LANGUAGE_SETTLE_MS);
      currentRate = rate;
    }
  };

  // Speak one utterance; resolves 'finish', 'cancel' or 'error'.
  const speakOne = async ({ text, locale, rate }, mySession) => {
    const utterance = String(text || '').trim();
    if (!utterance) return 'finish';
    await prepare(locale, rate);
    if (mySession !== session) return 'cancel';
    lastEndedId = null;
    lastEndedWith = null;
    const waiter = new Promise((resolve) => {
      resolveCurrent = resolve;
    });
    let id;
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
    if (lastEndedId != null && String(lastEndedId) === String(id)) {
      resolveCurrent = null;
      return lastEndedWith;
    }
    currentId = id;
    return waiter;
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
      tts.removeEventListener('tts-finish', onFinish);
      tts.removeEventListener('tts-cancel', onCancel);
      tts.removeEventListener('tts-error', onError);
    },
  };
};
