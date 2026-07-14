/**
 * Tests for the Korean vocabulary-size grid (`vocabSizeLevels.js`) plus the
 * theta→band inversion it relies on. The bundled tiers are generated at build
 * time (backend/scripts/generate_vocab_size_tiers.py); here we pin the contract
 * the runtime + UI depend on:
 *  - tiers are ordered easiest → hardest, so tapping "the last row I know" makes
 *    sense (theta must be non-decreasing);
 *  - every baked theta stays on the shared ability axis [-3, 3];
 *  - thetaForTier reads a tier's baked value, and the frontier tier seeds a
 *    higher band than the first tier.
 */

import {
  getVocabTiers,
  hasVocabSizeGrid,
  thetaForTier,
} from '../vocabSizeLevels';
import { nearestRankForTheta } from '../calibrationQuiz';
import { ABILITY_THETA_MAX, ABILITY_THETA_MIN } from '../abilityModel';

describe('vocab-size grid data', () => {
  it('exposes a grid for Korean but not for English/Chinese', () => {
    expect(hasVocabSizeGrid('ko')).toBe(true);
    expect(hasVocabSizeGrid('en')).toBe(false);
    expect(hasVocabSizeGrid('zh')).toBe(false);
  });

  it('ships a non-trivial, easiest-first ladder of tiers', () => {
    const tiers = getVocabTiers('ko');
    expect(tiers.length).toBeGreaterThanOrEqual(6);

    // thresholds strictly increase (more common words first)
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i].threshold).toBeGreaterThan(tiers[i - 1].threshold);
    }

    // each tier shows a few sample words
    tiers.forEach((tier) => {
      expect(Array.isArray(tier.words)).toBe(true);
      expect(tier.words.length).toBeGreaterThan(0);
    });
  });

  it('bakes monotonically non-decreasing theta within [-3, 3]', () => {
    const tiers = getVocabTiers('ko');
    let prev = -Infinity;
    tiers.forEach((tier) => {
      expect(tier.theta).toBeGreaterThanOrEqual(ABILITY_THETA_MIN);
      expect(tier.theta).toBeLessThanOrEqual(ABILITY_THETA_MAX);
      expect(tier.theta).toBeGreaterThanOrEqual(prev);
      prev = tier.theta;
    });
  });
});

describe('thetaForTier', () => {
  it('returns the tier\'s baked theta', () => {
    const tiers = getVocabTiers('ko');
    const sample = tiers[Math.floor(tiers.length / 2)];
    expect(thetaForTier('ko', sample.threshold)).toBe(sample.theta);
  });

  it('falls back to the scale midpoint for an unknown threshold', () => {
    expect(thetaForTier('ko', -1)).toBe(0);
  });
});

describe('grid pick → band', () => {
  it('maps the easiest tier to a lower band than the hardest tier', () => {
    const tiers = getVocabTiers('ko');
    const first = nearestRankForTheta('ko', tiers[0].theta);
    const last = nearestRankForTheta('ko', tiers[tiers.length - 1].theta);
    expect(last).toBeGreaterThan(first);
  });
});
