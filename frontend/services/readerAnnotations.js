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
// not components, and a stem equal to the whole surface wins outright. An
// English phrase ("gave up") is never split into its words' glosses: it takes
// its own (포기하다), not "주다 · 위로".
export const isPhraseSurface = (surface) => /\S\s+\S/.test(String(surface || '').trim());

// A Chinese word (two or more Han characters). Its gloss is never assembled
// from its characters' glosses: 如果 is "if", not 如 "as" · 果 "fruit".
const HAN_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/;
export const isCjkCompoundSurface = (surface) => {
  const text = String(surface || '').trim();
  return Array.from(text).filter((char) => HAN_CHAR.test(char)).length >= 2;
};

const compoundComponents = (surface, stems) => {
  if (isPhraseSurface(surface) || HAN_CHAR.test(surface)) return null;
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

// One { pinyin, gloss } per surface. Glosses come in the interface language,
// or English when that is all there is, never a third language: rows saved
// under a previous app language (a word looked up before switching) would
// otherwise show under words in that old language. Pinyin comes from any row
// that has it. A compound surface gets its components' glosses joined in
// reading order, so the label under 공동묘지 reads "joint · graveyard" rather
// than just "joint".
export const annotationsBySurface = (rows, interfaceLanguage = 'en') => {
  const rank = (language) => {
    if (language === interfaceLanguage) return 0;
    if (language === 'en') return 1;
    return null;
  };
  const bySurface = new Map();
  (rows || []).forEach((row) => {
    const surface = cleanText(row?.surface);
    if (!surface) return;
    const entry = bySurface.get(surface) || { pinyin: '', gloss: '', glossRank: 3, byStem: new Map() };
    const pinyin = cleanText(row?.ipa);
    if (pinyin && !entry.pinyin) entry.pinyin = pinyin;
    // Korean preprocessing fills `definition` (the short dictionary sense) but
    // usually not `gloss`; either works as the label under the word. English
    // definitions are full English senses, so an English word shows only its
    // gloss (the equivalents in the learner's language, e.g. 달리다).
    const glossRank = rank(cleanText(row?.interface_language) || 'en');
    const isEnglishWord = cleanText(row?.language) === 'en';
    // A row in another language still contributes its pinyin, never its gloss.
    // A Chinese definition is a list of CC-CEDICT senses: only its first one
    // fits under a word (the backend sends a short gloss; this covers rows
    // without one).
    const isChineseWord = cleanText(row?.language) === 'zh';
    const fallback = isEnglishWord ? '' : cleanText(row?.definition);
    const gloss = glossRank == null
      ? ''
      : (cleanText(row?.gloss) || (isChineseWord ? cleanText(fallback.split(/;\s/)[0]) : fallback));
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
 * withPhraseTapTerms — the level terms plus every phrase surface of the book
 * ("gave up", "of course") and, in a Chinese book, every word of two or more
 * characters (如果, 知道) not already among them, as annotation-only terms:
 * drawn as nothing, but the reader knows the word is there. A tap on any of
 * its letters or characters opens the whole word, and a word or character
 * inside it is not underlined, glossed or counted on its own. The reader
 * matches words anywhere in the text, so without these an easy word that is
 * not underlined let its characters be: 有 "to have" inside 只有 "only".
 *
 * `ranks` (surface -> how common the word is, Zipf) is attached to every term
 * as `rank`. The reader tries longer words first and, between two of the same
 * length that overlap, the more common one: 不知道 is 不 + 知道 "to know",
 * not 不知 + 道 "road".
 */
export const withPhraseTapTerms = (levelTerms = [], phraseSurfaces = [], ranks = null) => {
  const ranked = (terms) => {
    if (!ranks || typeof ranks.get !== 'function' || ranks.size === 0) return terms;
    return terms.map((term) => {
      const rank = Number(ranks.get(term?.text));
      return Number.isFinite(rank) && term?.rank !== rank ? { ...term, rank } : term;
    });
  };
  if (!phraseSurfaces || phraseSurfaces.length === 0) return ranked(levelTerms || []);
  const present = new Set((levelTerms || []).map((term) => term?.text));
  const extra = [];
  phraseSurfaces.forEach((surface) => {
    const text = cleanText(surface);
    if (!text || present.has(text) || !(isPhraseSurface(text) || isCjkCompoundSurface(text))) return;
    present.add(text);
    extra.push({ text, weight: 0, annotationOnly: true });
  });
  return ranked(extra.length > 0 ? [...(levelTerms || []), ...extra] : levelTerms || []);
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
 * - `hiddenSurfaces`: surfaces that get no pinyin or gloss (the learner's saved
 *   words, so they can try to recall them). Their underline is unaffected.
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
  hiddenSurfaces = null,
} = {}) => {
  if (!pinyin && !gloss) {
    return marksEnabled ? levelTerms : [];
  }

  const annotations = annotationsBySurface(annotationRows, interfaceLanguage);
  const isHidden = (surface) => Boolean(hiddenSurfaces && hiddenSurfaces.has(surface));
  const annotate = (term) => {
    const next = { ...term };
    if (isHidden(term.text)) {
      delete next.pinyin;
      delete next.gloss;
      return next;
    }
    const found = annotations.get(term.text);
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
      if (seen.has(surface) || isHidden(surface)) return;
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
