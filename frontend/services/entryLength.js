// Length rules for AI writing assessment.
//
// Whitespace-separated word counting is meaningless for Chinese and Japanese,
// which are written without spaces: a whole Chinese essay counts as "1 word".
// For those languages we count characters instead (each CJK ideograph / kana
// counts as one, plus any space-separated non-CJK tokens such as English
// words a learner mixed in).
//
// Word limits mirror backend/main.py (ENTRY_MIN_WORDS / ENTRY_MAX_WORDS).

export const ENTRY_MIN_WORDS = 30;
export const ENTRY_MAX_WORDS = 500;
export const ENTRY_MIN_CHARS = 60;
export const ENTRY_MAX_CHARS = 1000;

// Han ideographs (incl. Ext A + compatibility), Hiragana, Katakana.
const CJK_CHAR = /[㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ]/;
const CJK_CHAR_GLOBAL = /[㐀-䶿一-鿿豈-﫿぀-ゟ゠-ヿ]/g;
const HAS_WORD_CHAR = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ؀-ۿ฀-๿가-힯]/;

export const usesCharacterCount = (language) => {
  const code = String(language ?? '').toLowerCase();
  return code === 'ja' || code === 'zh' || code.startsWith('zh-');
};

export const countEntryWords = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;

export const countEntryCharacters = (text) => {
  const source = String(text ?? '');
  const cjk = (source.match(CJK_CHAR_GLOBAL) ?? []).length;
  // Non-CJK runs (e.g. an English word) still count once per token;
  // punctuation-only tokens are ignored.
  const others = source
    .replace(CJK_CHAR_GLOBAL, ' ')
    .split(/\s+/)
    .filter((token) => token && HAS_WORD_CHAR.test(token) && !CJK_CHAR.test(token)).length;
  return cjk + others;
};

// Returns { unit: 'words' | 'characters', count, min, max, tooShort, tooLong }.
export const measureEntry = (text, language) => {
  if (usesCharacterCount(language)) {
    const count = countEntryCharacters(text);
    return {
      unit: 'characters',
      count,
      min: ENTRY_MIN_CHARS,
      max: ENTRY_MAX_CHARS,
      tooShort: count < ENTRY_MIN_CHARS,
      tooLong: count > ENTRY_MAX_CHARS,
    };
  }
  const count = countEntryWords(text);
  return {
    unit: 'words',
    count,
    min: ENTRY_MIN_WORDS,
    max: ENTRY_MAX_WORDS,
    tooShort: count < ENTRY_MIN_WORDS,
    tooLong: count > ENTRY_MAX_WORDS,
  };
};
