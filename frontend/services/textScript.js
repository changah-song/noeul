// Which language a book's text is actually written in, from its characters.
// EPUB language tags are often wrong (many Korean and Chinese ebooks are
// tagged "en"), so import trusts the text over the tag.

const HANGUL_RE = /[가-힣ᄀ-ᇿ㄰-㆏]/g;
const KANA_RE = /[぀-ヿ]/g;
const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/g;
const LATIN_RE = /[A-Za-zÀ-ɏ]/g;

// Below this many letters there isn't enough text to tell.
const MIN_LETTERS = 200;

const countOf = (text, re) => (text.match(re) || []).length;

export const emptyScriptCounts = () => ({ hangul: 0, kana: 0, han: 0, latin: 0 });

/** Adds `text`'s letters by script to `counts` (mutated and returned). */
export const addScriptCounts = (counts, text) => {
  const value = String(text || '');
  counts.hangul += countOf(value, HANGUL_RE);
  counts.kana += countOf(value, KANA_RE);
  counts.han += countOf(value, HAN_RE);
  counts.latin += countOf(value, LATIN_RE);
  return counts;
};

/**
 * 'ko' | 'zh' | 'ja' | 'en' for the script the text is mostly written in, or
 * null when there is too little text or no clear majority. Korean text with
 * hanja and Japanese text with kanji are told apart by Hangul and kana.
 */
export const dominantScriptLanguage = (counts) => {
  const { hangul = 0, kana = 0, han = 0, latin = 0 } = counts || {};
  const total = hangul + kana + han + latin;
  if (total < MIN_LETTERS) return null;
  if (hangul / total >= 0.2) return 'ko';
  if (kana / total >= 0.1) return 'ja';
  if (han / total >= 0.3) return 'zh';
  if (latin / total >= 0.8) return 'en';
  return null;
};
