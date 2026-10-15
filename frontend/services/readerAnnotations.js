// Word annotations for the native reader: pinyin above words (Chinese) and a
// short translation under them. They ride on the reader's levelTerms list, which
// already reaches every render mode: underlined words get `pinyin` / `gloss`
// attached, and with the "all words" scope the book's other words are added as
// `annotationOnly` terms (annotated, never underlined, never counted as graded
// exposures).

export const ANNOTATION_SCOPES = ['underlined', 'all'];

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

// Separator between the component glosses of a compound word.
export const COMPOUND_GLOSS_JOINER = ' · ';

// A surface's stems that are its components (공동묘지 → 공동 + 묘지): each one
// appears literally in the surface, they do not overlap, and together they
// make up most of it. Alternatives for one and the same span (길 / 길다) are
// not components, and a stem equal to the whole surface wins outright.
const compoundComponents = (surface, stems) => {
  if (stems.length < 2 || stems.includes(surface)) return null;
  const placed = stems
    .map((stem) => ({ stem, at: surface.indexOf(stem) }))
    .filter(({ stem, at }) => stem && at >= 0)
    .sort((a, b) => a.at - b.at || b.stem.length - a.stem.length);
  const picked = [];
  let cursor = 0;
  placed.forEach((item) => {
    if (item.at >= cursor) {
      picked.push(item);
      cursor = item.at + item.stem.length;
    }
  });
  if (picked.length < 2) return null;
  const covered = picked.reduce((sum, { stem }) => sum + stem.length, 0);
  return covered * 2 >= surface.length ? picked.map(({ stem }) => stem) : null;
};

// One { pinyin, gloss } per surface. Glosses prefer the interface language,
// then English, then anything; pinyin comes from any row that has it. A
// compound surface gets its components' glosses joined in reading order, so
// the label under 공동묘지 reads "joint · graveyard" rather than just "joint".
export const annotationsBySurface = (rows, interfaceLanguage = 'en') => {
  const rank = (language) => {
    if (language === interfaceLanguage) return 0;
    if (language === 'en') return 1;
    return 2;
  };
  const bySurface = new Map();
  (rows || []).forEach((row) => {
    const surface = cleanText(row?.surface);
    if (!surface) return;
    const entry = bySurface.get(surface) || { pinyin: '', gloss: '', glossRank: 3, byStem: new Map() };
    const pinyin = cleanText(row?.ipa);
    if (pinyin && !entry.pinyin) entry.pinyin = pinyin;
    // Korean preprocessing fills `definition` (the short dictionary sense) but
    // usually not `gloss`; either works as the label under the word.
    const gloss = cleanText(row?.gloss) || cleanText(row?.definition);
    const glossRank = rank(cleanText(row?.interface_language) || 'en');
    if (gloss && glossRank < entry.glossRank) {
      entry.gloss = gloss;
      entry.glossRank = glossRank;
    }
    const stem = cleanText(row?.stem);
    if (stem && gloss) {
      const known = entry.byStem.get(stem);
      if (!known || glossRank < known.rank) entry.byStem.set(stem, { gloss, rank: glossRank });
    }
    bySurface.set(surface, entry);
  });
  bySurface.forEach((entry, surface) => {
    const components = compoundComponents(surface, [...entry.byStem.keys()]);
    if (components) {
      entry.gloss = components.map((stem) => entry.byStem.get(stem).gloss).join(COMPOUND_GLOSS_JOINER);
    }
    delete entry.byStem;
  });
  return bySurface;
};

/**
 * Merge annotations into the level-term list sent to the native reader.
 *
 * - `levelTerms`: the graded (underlined) words, [{ text, weight, ... }].
 * - `marksEnabled`: false when the user turned underlines off. The graded words
 *   are then still annotated (with the "underlined" scope) but sent as
 *   annotation-only, so no underline is drawn.
 * - `pinyin` / `gloss`: which annotations are on. With both off the level terms
 *   are returned as they are (or empty when marks are off).
 * - `pinyinScope` / `glossScope`: 'underlined' (graded words only) or 'all'
 *   (every word in the book), chosen separately for each annotation.
 */
export const buildAnnotatedLevelTerms = ({
  levelTerms = [],
  annotationRows = [],
  marksEnabled = true,
  pinyin = false,
  gloss = false,
  pinyinScope = 'underlined',
  glossScope = 'underlined',
  interfaceLanguage = 'en',
} = {}) => {
  if (!pinyin && !gloss) {
    return marksEnabled ? levelTerms : [];
  }

  const annotations = annotationsBySurface(annotationRows, interfaceLanguage);
  const annotate = (term) => {
    const found = annotations.get(term.text);
    const next = { ...term };
    if (pinyin) {
      const reading = cleanText(term.pinyin) || found?.pinyin || '';
      if (reading) next.pinyin = reading;
    } else {
      delete next.pinyin;
    }
    if (gloss && found?.gloss) {
      next.gloss = found.gloss;
    }
    return next;
  };

  const result = (levelTerms || []).map((term) => {
    const next = annotate(term);
    if (!marksEnabled) next.annotationOnly = true;
    return next;
  });

  const pinyinForAll = pinyin && pinyinScope === 'all';
  const glossForAll = gloss && glossScope === 'all';
  if (pinyinForAll || glossForAll) {
    const seen = new Set(result.map((term) => term.text));
    annotations.forEach((entry, surface) => {
      if (seen.has(surface)) return;
      const hasPinyin = pinyinForAll && entry.pinyin;
      const hasGloss = glossForAll && entry.gloss;
      if (!hasPinyin && !hasGloss) return;
      const term = { text: surface, weight: 0, annotationOnly: true };
      if (hasPinyin) term.pinyin = entry.pinyin;
      if (hasGloss) term.gloss = entry.gloss;
      result.push(term);
    });
  }

  return result;
};
