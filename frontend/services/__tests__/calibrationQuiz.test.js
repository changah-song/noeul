/**
 * Tests for the cold-start calibration quiz (`calibrationQuiz.js`). Pure
 * functions — the word selection, the theta fold, and the theta→band mapping.
 *
 * What we're pinning down:
 *  - a quiz run samples EVERY band equally and orders easy → hard, so the reader
 *    "checks where their confidence drops";
 *  - the fold moves theta in the right direction and lands BETWEEN band seeds
 *    (the whole point: continuous ability, not 3 quantized values);
 *  - a given seed reproduces the same quiz (deterministic for tests/support);
 *  - nearestRankForTheta inverts the seeding sanely at the edges.
 */

import {
  CALIBRATION_LEARNING_RATE,
  estimateThetaFromResponses,
  nearestRankForTheta,
  selectCalibrationWords,
} from '../calibrationQuiz';
import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  seedThetaFromRank,
} from '../abilityModel';

describe('selectCalibrationWords', () => {
  it('samples every graded band equally, ordered easiest band first', () => {
    const words = selectCalibrationWords('ko', { seed: 42 });
    expect(words.length).toBeGreaterThanOrEqual(24);

    const ranks = words.map((entry) => entry.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks); // non-decreasing
    expect(new Set(ranks)).toEqual(new Set([1, 2, 3])); // all ko bands present

    const perBand = ranks.filter((rank) => rank === 1).length;
    expect(ranks.filter((rank) => rank === 3).length).toBe(perBand);
  });

  it('is deterministic for a fixed seed and varies across seeds', () => {
    const a = selectCalibrationWords('ko', { seed: 7 });
    const b = selectCalibrationWords('ko', { seed: 7 });
    const c = selectCalibrationWords('ko', { seed: 8 });
    expect(a).toEqual(b);
    expect(a.map((w) => w.word)).not.toEqual(c.map((w) => w.word));
  });

  it('covers all 7 HSK bands for zh and returns [] for an unbundled language', () => {
    const zh = selectCalibrationWords('zh', { seed: 1 });
    expect(new Set(zh.map((w) => w.rank))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    expect(selectCalibrationWords('xx-not-a-language', { seed: 1 })).toEqual(
      selectCalibrationWords('ko', { seed: 1 }) // normalizes to the ko default
    );
  });
});

describe('estimateThetaFromResponses', () => {
  const knowsEverything = (words) => words.map((w) => ({ ...w, outcome: 1 }));
  const knowsNothing = (words) => words.map((w) => ({ ...w, outcome: 0 }));

  it('drives theta up for a reader who knows everything, down for one who knows nothing', () => {
    const words = selectCalibrationWords('ko', { seed: 3 });
    const up = estimateThetaFromResponses({ language: 'ko', responses: knowsEverything(words), initialTheta: 0 });
    const down = estimateThetaFromResponses({ language: 'ko', responses: knowsNothing(words), initialTheta: 0 });
    expect(up.theta).toBeGreaterThan(1.5);
    expect(down.theta).toBeLessThan(-1.5);
    expect(up.theta).toBeLessThanOrEqual(ABILITY_THETA_MAX);
    expect(down.theta).toBeGreaterThanOrEqual(ABILITY_THETA_MIN);
    expect(up.eventCount).toBe(words.length);
  });

  it('lands BETWEEN band seeds for a mixed profile (the anti-quantization point)', () => {
    // Knows all band-1, most band-2, no band-3: a solid intermediate-plus.
    const words = selectCalibrationWords('ko', { seed: 5 });
    let band2Seen = 0;
    const responses = words.map((w) => {
      if (w.rank === 1) return { ...w, outcome: 1 };
      if (w.rank === 3) return { ...w, outcome: 0 };
      band2Seen += 1;
      return { ...w, outcome: band2Seen % 4 === 0 ? 0 : 1 }; // knows ~75% of band 2
    });
    const { theta } = estimateThetaFromResponses({ language: 'ko', responses, initialTheta: 0 });

    const band2Seed = seedThetaFromRank('ko', 2); // 0
    const band3Seed = seedThetaFromRank('ko', 3); // 3
    expect(theta).toBeGreaterThan(band2Seed);
    expect(theta).toBeLessThan(band3Seed);
  });

  it('starts a truly cold profile at the midpoint and skips malformed outcomes', () => {
    const { theta, eventCount } = estimateThetaFromResponses({
      language: 'ko',
      responses: [{ rank: 1, outcome: 'maybe' }, { rank: 1, outcome: null }],
    });
    expect(theta).toBe(0);
    expect(eventCount).toBe(0);
  });

  it('uses the calibration learning rate by default (stronger than a review step)', () => {
    const single = [{ rank: 3, outcome: 1 }];
    const calibrated = estimateThetaFromResponses({ language: 'ko', responses: single, initialTheta: 0 });
    const gentle = estimateThetaFromResponses({
      language: 'ko', responses: single, initialTheta: 0, learningRate: 0.1,
    });
    expect(calibrated.theta).toBeGreaterThan(gentle.theta);
    expect(CALIBRATION_LEARNING_RATE).toBeGreaterThan(0.3);
  });
});

describe('nearestRankForTheta', () => {
  it('inverts the band seeding at the seeds and splits sensibly between them', () => {
    expect(nearestRankForTheta('ko', seedThetaFromRank('ko', 1))).toBe(1);
    expect(nearestRankForTheta('ko', seedThetaFromRank('ko', 2))).toBe(2);
    expect(nearestRankForTheta('ko', seedThetaFromRank('ko', 3))).toBe(3);
    expect(nearestRankForTheta('ko', 1.2)).toBe(2); // closer to 0 than to +3
    expect(nearestRankForTheta('ko', 2.1)).toBe(3);
    expect(nearestRankForTheta('zh', 0)).toBe(4); // HSK midpoint band
  });
});
