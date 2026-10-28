// Audio review (Learn tab): what the voice reads for each saved word. By
// default, the word, its short meaning in the learner's language, a sentence
// the word was met in, and that sentence's translation, with short pauses in
// between, so a list can be played hands-free (on a commute).
//
// Pure helpers; the player (components/Learn/AudioReview.js) fetches the
// sentences and translations and drives the voice.

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const MEANING_MAX = 60;
// A gloss lists equivalents ("이름, 성함, 명칭, 평판"); a few are enough to hear.
const GLOSS_MAX_ITEMS = 3;
// Gaps between the parts, and after a word before the next one starts.
export const AUDIO_REVIEW_PAUSES = {
  afterWord: 450,
  afterMeaning: 800,
  afterSentence: 450,
  betweenWords: 1300,
};

// The meaning to read aloud: the first sense of a saved definition, without
// its numbering or asides, and short ("뜻 1; 뜻 2" -> "뜻 1").
export const shortMeaning = (definition) => {
  const lines = String(definition ?? '').split('\n').map(clean).filter(Boolean);
  const first = (lines[0] || '').replace(/^\d+[.)]\s*/, '');
  const sense = clean(first.split(/[;；]/)[0].replace(/\([^)]*\)|（[^）]*）/g, ' '));
  if (sense.length <= MEANING_MAX) return sense;
  const cut = sense.slice(0, MEANING_MAX);
  const lastBreak = Math.max(cut.lastIndexOf(','), cut.lastIndexOf('，'), cut.lastIndexOf(' '));
  return (lastBreak > 20 ? cut.slice(0, lastBreak) : cut).trim();
};

// The meaning to read when the dictionary has a short gloss for the word
// (the equivalents shown in the lookup panel), else the saved definition's
// first sense. Saved English definitions are long senses, so the gloss reads
// far better aloud.
export const spokenMeaning = ({ gloss, definition } = {}) => {
  const items = clean(gloss).split(/[;；]/)[0].split(/[,，、]/).map(clean).filter(Boolean);
  if (items.length > 0) return items.slice(0, GLOSS_MAX_ITEMS).join(', ');
  return shortMeaning(definition);
};

// The sentence to read: of the sentences the word was met in, the shortest
// reasonable one (shorter sentences carry fewer other hard words). Very
// short fragments and very long passages are skipped when anything else is
// there.
const SENTENCE_MIN = 12;
const SENTENCE_MAX = 160;
export const pickSentence = (contexts = [], word = '') => {
  const target = clean(word).toLowerCase();
  const sentences = [...new Set((Array.isArray(contexts) ? contexts : [])
    .map((context) => clean(typeof context === 'string' ? context : context?.sentence))
    .filter(Boolean))];
  if (sentences.length === 0) return null;
  const withWord = target
    ? sentences.filter((sentence) => sentence.toLowerCase().includes(target))
    : [];
  const pool = withWord.length > 0 ? withWord : sentences;
  const fitting = pool.filter((sentence) => sentence.length >= SENTENCE_MIN && sentence.length <= SENTENCE_MAX);
  const candidates = fitting.length > 0 ? fitting : pool;
  return [...candidates].sort((a, b) => a.length - b.length)[0];
};

// The utterances for one word, for listenPlayer.speakSequence. Parts that are
// missing (no sentence, no translation yet) are skipped.
export const buildAudioReviewScript = ({
  word,
  meaning,
  sentence,
  translation,
  targetLocale,
  interfaceLocale,
  rate,
  pitch = 1,
  // The voices chosen in listen mode, by locale (en-US, ko-KR, ...).
  voices = {},
}) => {
  const items = [];
  const say = (text, locale, pauseMs) => {
    const spoken = clean(text);
    if (!spoken) return;
    items.push({ text: spoken, locale, rate, pitch, voice: voices?.[locale] || null });
    if (pauseMs) items.push({ pauseMs });
  };
  say(word, targetLocale, AUDIO_REVIEW_PAUSES.afterWord);
  say(meaning, interfaceLocale, AUDIO_REVIEW_PAUSES.afterMeaning);
  say(sentence, targetLocale, AUDIO_REVIEW_PAUSES.afterSentence);
  say(translation, interfaceLocale, 0);
  items.push({ pauseMs: AUDIO_REVIEW_PAUSES.betweenWords });
  return items;
};
