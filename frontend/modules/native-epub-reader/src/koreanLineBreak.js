// Keep Korean words whole across line breaks.
//
// Android's line breaker (ICU) treats Hangul syllables like CJK ideographs and
// allows a break between any two of them, so a word like 소녀는 could wrap as
// 소 / 녀는. Korean learners read by word, so the reader joins the syllables of
// each word with WORD JOINER (U+2060): zero width, invisible, and a hard
// "no break here" for the line breaker. The joiners live only inside the
// native view: every string sent in (chapter text, highlight and level terms)
// gets them, and every string coming back out (tapped words, sentences,
// exposure terms) has them stripped, so the rest of the app never sees them.

export const WORD_JOINER = '⁠';

const HANGUL = /[가-힣]/;
const JOINER_PATTERN = /⁠/g;

// Insert a joiner between every two adjacent Hangul syllables. Punctuation,
// digits and Latin letters are left to the normal rules, and spaces still break.
export const joinKoreanSyllables = (text) => {
  if (typeof text !== 'string' || text.length < 2) {
    return text;
  }
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (i > 0 && HANGUL.test(char) && HANGUL.test(text[i - 1])) {
      out += WORD_JOINER;
    }
    out += char;
  }
  return out;
};

export const stripJoiners = (text) => (
  typeof text === 'string' && text.includes(WORD_JOINER) ? text.replace(JOINER_PATTERN, '') : text
);

// Strip joiners from every string anywhere inside an event payload.
export const stripJoinersDeep = (value) => {
  if (typeof value === 'string') {
    return stripJoiners(value);
  }
  if (Array.isArray(value)) {
    return value.map(stripJoinersDeep);
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = stripJoinersDeep(value[key]);
    });
    return out;
  }
  return value;
};

// Chapter blocks carry their text in `spans[].text` (styled runs) and/or `text`.
export const joinKoreanInBlocks = (blocks) => (blocks || []).map((block) => {
  if (!block || typeof block !== 'object') {
    return block;
  }
  const next = { ...block };
  if (typeof block.text === 'string') {
    next.text = joinKoreanSyllables(block.text);
  }
  if (Array.isArray(block.spans)) {
    next.spans = block.spans.map((span) => (
      span && typeof span.text === 'string' ? { ...span, text: joinKoreanSyllables(span.text) } : span
    ));
  }
  return next;
});

export const joinKoreanInTerms = (terms) => (terms || []).map((term) => {
  if (typeof term === 'string') {
    return joinKoreanSyllables(term);
  }
  if (term && typeof term.text === 'string') {
    return { ...term, text: joinKoreanSyllables(term.text) };
  }
  return term;
});
