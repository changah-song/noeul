import KO_VOCAB_TIERS from '../assets/data/vocab-size/ko.generated.json';
import { normalizeBookLanguage } from '../constants/languages';

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
// Only Korean has a frequency grid today; other languages fall back to the chips.

const VOCAB_TIERS_BY_LANGUAGE = {
  ko: KO_VOCAB_TIERS.ko,
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

/**
 * thetaForTier — the seeded ability for "I know all the words up to this tier".
 * Falls back to the scale midpoint for an unknown threshold.
 *
 * @param {string} language
 * @param {number} threshold  a tier's `threshold` value
 * @returns {number} theta in [-3, 3]
 */
export const thetaForTier = (language, threshold) => {
  const tier = getVocabTiers(language).find((item) => item.threshold === threshold);
  return Number.isFinite(Number(tier?.theta)) ? Number(tier.theta) : 0;
};
