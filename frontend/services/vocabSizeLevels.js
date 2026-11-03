import KO_VOCAB_TIERS from '../assets/data/vocab-size/ko.generated.json';
import ZH_VOCAB_TIERS from '../assets/data/vocab-size/zh.generated.json';
import EN_VOCAB_TIERS from '../assets/data/vocab-size/en.generated.json';
import { normalizeBookLanguage } from '../constants/languages';
import { coveredBand, thetaForBandCoverage, thetaForVocabulary, vocabularySize } from './levelScale';

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
 * frequency tiers, where the expected vocabulary is the tier's word count.
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
 * Korean frequency tier within the expected vocabulary.
 */
export const tierIndexForTheta = (language, theta) => {
  const tiers = getVocabTiers(language);
  if (tiers.length === 0) return 0;
  if (isLabelled(tiers)) {
    const band = coveredBand(language, theta);
    return Math.max(0, Math.min(tiers.length - 1, (band ?? 1) - 1));
  }
  const words = vocabularySize(language, theta) ?? 0;
  let index = 0;
  tiers.forEach((tier, i) => {
    if (tier.threshold <= words) index = i;
  });
  return index;
};

/**
 * legacySeedTheta — a level picked before engine 2.4, when a tier seeded the
 * tier's band position (the level at which the reader knows HALF of it), in
 * today's meaning: the same tier, seeded by thetaForTier.
 */
export const legacySeedTheta = (language, theta) => {
  const tiers = getVocabTiers(language);
  if (tiers.length === 0 || !Number.isFinite(Number(theta))) return Number(theta);
  let nearest = tiers[0];
  tiers.forEach((tier) => {
    if (Math.abs(Number(tier.theta) - Number(theta)) < Math.abs(Number(nearest.theta) - Number(theta))) nearest = tier;
  });
  return thetaForTier(language, nearest.threshold);
};
