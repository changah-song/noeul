import CALIBRATION_WORDLISTS from '../assets/data/calibration/words.generated.json';
import { normalizeBookLanguage } from '../constants/languages';
import { getProficiencyLevelOptions } from '../constants/proficiencyLevels';
import {
  difficultyFromLevelRank,
  seedThetaFromRank,
  updateThetaOnline,
} from './abilityModel';

// ─── Cold-start calibration quiz ───────────────────────────────────────────────
//
// The self-reported level seeds theta at one of only a few values (ko has just
// 3 bands → −3 / 0 / +3), and a profile that never reports at all sits at the
// beginner floor. This quiz replaces that guess with a measurement: show a
// stratified sample of graded words, ask "do you know this?", and fold each tap
// through the SAME online IRT update the rest of Phase 3 uses
// (`updateThetaOnline` / `updateThetaFromOutcome`). ~24 taps land theta at a
// continuous value BETWEEN bands, which is what lets the reading-ease estimate
// (bookEase.js) differentiate books instead of quantizing.
//
// The word pool ships with the app (assets/data/calibration/words.generated.json,
// produced by backend/scripts/generate_calibration_wordlists.py) because the
// on-device dictionary_cache only knows ranks for words already looked up.
//
// This module is pure (no SQLite, no React) — persistence goes through
// Database.js `updateThetaFromOutcome`, exactly like a flashcard review.

// A quiz tap is a deliberate, unconfounded self-assessment — stronger evidence
// than a graded review (0.3) and far stronger than a lookup (0.1).
export const CALIBRATION_LEARNING_RATE = 0.5;

// Total prompts to aim for per quiz run, split evenly across the language's
// graded bands (ko: 3×8, en: 6×4, zh: 7×4 → 24–28 taps, under a minute).
export const CALIBRATION_TARGET_PROMPTS = 24;

// Small deterministic PRNG (mulberry32) so a given seed always builds the same
// quiz — reproducible in tests, varied between runs via a time-based seed.
const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleInPlace = (items, random) => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

/**
 * selectCalibrationWords — build one quiz run: an equal sample from every graded
 * band, ordered easiest band → hardest band (comfortable ramp), shuffled within
 * each band.
 *
 * @param {string} language          target language code (ko | zh | en)
 * @param {object} [options]
 * @param {number} [options.seed]    PRNG seed; defaults to the clock so each run varies
 * @param {number} [options.targetPrompts]  total prompts to aim for
 * @returns {Array<{word:string, rank:number, difficulty:number}>} empty when the
 *          language has no bundled wordlist.
 */
export const selectCalibrationWords = (language, {
  seed = Date.now(),
  targetPrompts = CALIBRATION_TARGET_PROMPTS,
} = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const bands = CALIBRATION_WORDLISTS[normalizedLanguage]?.bands;
  if (!bands || typeof bands !== 'object') {
    return [];
  }

  const ranks = Object.keys(bands)
    .map((rank) => Number(rank))
    .filter((rank) => Number.isFinite(rank) && Array.isArray(bands[String(rank)]))
    .sort((a, b) => a - b);
  if (ranks.length === 0) {
    return [];
  }

  const random = mulberry32(Number.isFinite(Number(seed)) ? Number(seed) : 0);
  const perBand = Math.max(3, Math.round(targetPrompts / ranks.length));

  return ranks.flatMap((rank) => {
    const pool = bands[String(rank)].filter((word) => typeof word === 'string' && word.trim());
    const picks = shuffleInPlace([...pool], random).slice(0, perBand);
    return picks.map((word) => ({
      word,
      rank,
      difficulty: difficultyFromLevelRank(normalizedLanguage, rank),
    }));
  });
};

/**
 * estimateThetaFromResponses — pure preview of where a set of quiz responses
 * lands theta, folding each one through the standard online IRT step. The live
 * quiz persists per tap via Database.js `updateThetaFromOutcome` instead; this
 * exists for tests and for showing a result before committing.
 *
 * No self-report anchor (`theta0: null`): the quiz IS the measurement the anchor
 * exists to approximate, so pulling it back toward the old guess would only slow
 * convergence.
 *
 * @param {object} args
 * @param {string} args.language
 * @param {Array<{difficulty?:number, rank?:number, outcome:number|boolean}>} args.responses
 * @param {number|null} [args.initialTheta]   starting theta (e.g. the current seed);
 *                                            defaults to the scale midpoint
 * @param {number} [args.initialEventCount]
 * @param {number} [args.learningRate]
 * @returns {{theta:number, eventCount:number}}
 */
export const estimateThetaFromResponses = ({
  language,
  responses,
  initialTheta = null,
  initialEventCount = 0,
  learningRate = CALIBRATION_LEARNING_RATE,
} = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  let theta = Number.isFinite(Number(initialTheta)) ? Number(initialTheta) : 0;
  let eventCount = Number.isFinite(Number(initialEventCount))
    ? Math.max(0, Number(initialEventCount))
    : 0;

  (Array.isArray(responses) ? responses : []).forEach((response) => {
    const outcome = response?.outcome === 1 || response?.outcome === true
      ? 1
      : (response?.outcome === 0 || response?.outcome === false ? 0 : null);
    if (outcome == null) {
      return;
    }
    const difficulty = Number.isFinite(Number(response?.difficulty))
      ? Number(response.difficulty)
      : difficultyFromLevelRank(normalizedLanguage, response?.rank);

    theta = updateThetaOnline({
      theta,
      difficulty,
      outcome,
      eventCount,
      theta0: null,
      learningRate,
    });
    eventCount += 1;
  });

  return { theta, eventCount };
};

/**
 * nearestRankForTheta — map a measured theta back to the closest self-report
 * band, so the profile's displayed level can follow the measurement after a
 * quiz. (Safe to re-seed from: ensureProfileAbilitySeed never clobbers a theta
 * once event_count > 0.)
 *
 * @param {string} language
 * @param {number} theta
 * @returns {number} the 1-based rank whose seed value is closest to theta
 */
export const nearestRankForTheta = (language, theta) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const options = getProficiencyLevelOptions(normalizedLanguage);
  const t = Number.isFinite(Number(theta)) ? Number(theta) : 0;

  let best = options[0]?.rank ?? 1;
  let bestDistance = Infinity;
  options.forEach((option) => {
    const distance = Math.abs(seedThetaFromRank(normalizedLanguage, option.rank) - t);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option.rank;
    }
  });
  return best;
};
