import KO_VOCAB_TIERS from '../assets/data/vocab-size/ko.generated.json';
import ZH_VOCAB_TIERS from '../assets/data/vocab-size/zh.generated.json';
import EN_VOCAB_TIERS from '../assets/data/vocab-size/en.generated.json';
import { normalizeBookLanguage } from '../constants/languages';
import { coveredBand, legacyVocabularySize, thetaForBandCoverage, thetaForVocabulary, vocabularySize } from './levelScale';
import { LEVEL_THETA_MIN } from './abilityModel';

// ─── Vocabulary-size level grid (Profile cold-start) ───────────────────────────
//
// Replaces the manual 초급/중급/고급 chips and the word-by-word calibration quiz
// for Korean. The reader sees frequency-ordered tiers ("know the ~100 most common
// words", "~300", ...) and taps the last row where they know ALL the words. That
// pick seeds their ability `theta`.
//
// The tiers ship bundled (assets/data/vocab-size/ko.generated.json, produced by
// backend/scripts/generate_vocab_size_tiers.py). Each tier already carries the
// `theta` it seeds — computed at build time against the NIKL band boundaries so
// the seed lands on the same axis as book/word difficulty (see
// abilityModel.js / the generator's docstring). Runtime stays dumb: read `theta`.
//
// Korean has a frequency grid, Chinese an HSK grid and English a CEFR grid.

const VOCAB_TIERS_BY_LANGUAGE = {
  ko: KO_VOCAB_TIERS.ko,
  // Chinese: one tier per HSK 3.0 level (chinese_hsk), sample words the
  // most frequent of that level.
  zh: ZH_VOCAB_TIERS.zh,
  // English: one tier per CEFR level (A1-C2, english_cefr), sample words
  // common words of that level.
  en: EN_VOCAB_TIERS.en,
};

/**
 * hasVocabSizeGrid — whether the language ships a frequency-tier grid (vs. the
 * legacy chips + quiz).
 */
export const hasVocabSizeGrid = (language) => (
  Boolean(VOCAB_TIERS_BY_LANGUAGE[normalizeBookLanguage(language)]?.tiers?.length)
);

/**
 * getVocabTiers — the ordered tiers to render, easiest (most common words) first.
 *
 * @param {string} language
 * @returns {Array<{threshold:number, theta:number, words:string[], advanced?:boolean}>}
 */
export const getVocabTiers = (language) => {
  const entry = VOCAB_TIERS_BY_LANGUAGE[normalizeBookLanguage(language)];
  return Array.isArray(entry?.tiers) ? entry.tiers : [];
};

const isLabelled = (tiers) => tiers.some((tier) => tier.label);

/**
 * thetaForTier — the level for "I know all the words up to this tier", in
 * the same meaning the profile shows (services/levelScale.js): for HSK / CEFR
 * tiers, where the tier's band is known to PICK_COVERAGE; for Korean's
 * frequency tiers, where the words counted reach the tier's word count.
 * Falls back to the tier's baked band position, then 0.
 *
 * @param {string} language
 * @param {number} threshold  a tier's `threshold` value
 * @returns {number} theta
 */
export const thetaForTier = (language, threshold) => {
  const tiers = getVocabTiers(language);
  const index = tiers.findIndex((item) => item.threshold === threshold);
  if (index < 0) return 0;
  const theta = isLabelled(tiers)
    ? thetaForBandCoverage(language, index + 1)
    : thetaForVocabulary(language, threshold);
  if (Number.isFinite(theta)) return theta;
  return Number.isFinite(Number(tiers[index].theta)) ? Number(tiers[index].theta) : 0;
};

/**
 * tierIndexForTheta — the tier a level reaches (0 = the first, also when not
 * even that): the highest HSK / CEFR band known to COVERAGE, or the largest
 * Korean frequency tier within the words counted.
 */
export const tierIndexForTheta = (language, theta) => {
  const tiers = getVocabTiers(language);
  if (tiers.length === 0) return 0;
  if (isLabelled(tiers)) {
    const band = coveredBand(language, theta);
    return Math.max(0, Math.min(tiers.length - 1, (band ?? 1) - 1));
  }
  // Half a word of slack: a tier's seed solves to its count to within
  // floating-point error, and must read back as that tier.
  const words = (vocabularySize(language, theta) ?? 0) + 0.5;
  let index = 0;
  tiers.forEach((tier, i) => {
    if (tier.threshold <= words) index = i;
  });
  return index;
};

/**
 * legacySeedTheta — a level picked under an older engine, in today's meaning.
 * Before engine 2.4 a tier seeded the tier's band position (the level at
 * which the reader knows HALF of it): the same tier, seeded by thetaForTier.
 * Under 2.4 a Korean frequency tier seeded where the old words count
 * (levelScale legacyVocabularySize) was the tier's size: the level with that
 * many words today (the bottom of the scale stays there). HSK / CEFR picks
 * from 2.4 already mean today's level. `engine`: the row's engine version
 * (missing: before 2.4).
 */
export const legacySeedTheta = (language, theta, engine = null) => {
  const tiers = getVocabTiers(language);
  const value = Number(theta);
  if (tiers.length === 0 || !Number.isFinite(value)) return value;
  const version = Number.parseFloat(engine);
  if (Number.isFinite(version) && version >= 2.4) {
    if (version >= 2.5 || isLabelled(tiers) || value <= LEVEL_THETA_MIN + 1e-6) return value;
    const words = legacyVocabularySize(language, value);
    const today = Number.isFinite(words) ? thetaForVocabulary(language, words) : null;
    return Number.isFinite(today) ? today : value;
  }
  let nearest = tiers[0];
  tiers.forEach((tier) => {
    if (Math.abs(Number(tier.theta) - value) < Math.abs(Number(nearest.theta) - value)) nearest = tier;
  });
  return thetaForTier(language, nearest.threshold);
};

/**
 * isLegacySeed — whether a level picked under `engine` (missing: before 2.4)
 * means a different level today (legacySeedTheta).
 */
export const isLegacySeed = (language, engine) => {
  const version = Number.parseFloat(engine);
  if (!Number.isFinite(version) || version < 2.4) return true;
  if (version >= 2.5) return false;
  const tiers = getVocabTiers(language);
  return tiers.length > 0 && !isLabelled(tiers);
};

// ─── Below the first tier ("just starting") ──────────────────────────────────
//
// A reader who knows none of the first row's words (the word check answered
// "don't know" throughout, "I'm just starting", or "none of these" in the
// picker) is below every tier. Labelling them with the first tier ("about
// 100 words", "HSK 1") told a beginner they already knew a level's words.

// "Just starting" and "none of these" seed the bottom of the scale, where a
// word check with no word known lands too, held loosely so reading moves it.
export const BEGINNER_THETA = LEVEL_THETA_MIN;
// sd ≈ 1.2; a picked tier is held at 0.6.
export const BEGINNER_SEED_VARIANCE = 1.5;

// The first tier a reader below it hasn't reached: HSK 1 / A1, or Korean's
// first frequency tier (100 words). The vocabulary is 0 at the bottom of the
// scale and rises from there (levelScale countedShare), so every Korean tier
// seeds its own level and "knows none" stays below the first.
const firstTier = (language) => getVocabTiers(language).find((tier) => !tier.advanced) ?? null;

/**
 * isBeginnerTheta — whether a level is below the language's first tier: for
 * HSK / CEFR, not even the first band known to COVERAGE; for Korean, below the
 * pick level of the first frequency tier (fewer than its 100 words).
 */
export const isBeginnerTheta = (language, theta) => {
  const value = Number(theta);
  if (!Number.isFinite(value)) return false;
  const tiers = getVocabTiers(language);
  const first = firstTier(language);
  if (!first) return false;
  if (isLabelled(tiers)) {
    const band = coveredBand(language, value);
    if (Number.isFinite(band)) return band === 0;
  }
  return value < thetaForTier(language, first.threshold) - 1e-6;
};

/**
 * beginnerWords — the words a beginner is learning first: the first tier's
 * size (HSK 1's or A1's words, or Korean's first frequency tier).
 */
export const beginnerWords = (language) => firstTier(language)?.threshold ?? null;
