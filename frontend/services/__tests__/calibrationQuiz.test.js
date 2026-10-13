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
    expect(new Set(ranks)).toEqual(new Set([1, 2, 3, 4, 5, 6])); // all 6 ko reading levels

    const perBand = ranks.filter((rank) => rank === 1).length;
    expect(ranks.filter((rank) => rank === 6).length).toBe(perBand);
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
    // Knows all of levels 1-2, ~75% of level 3, nothing above: around level 3.
    const words = selectCalibrationWords('ko', { seed: 5 });
    let level3Seen = 0;
    const responses = words.map((w) => {
      if (w.rank <= 2) return { ...w, outcome: 1 };
      if (w.rank >= 4) return { ...w, outcome: 0 };
      level3Seen += 1;
      return { ...w, outcome: level3Seen % 4 === 0 ? 0 : 1 };
    });
    const { theta } = estimateThetaFromResponses({ language: 'ko', responses, initialTheta: 0 });

    // Lands in the level-3 neighborhood, but on a continuous value rather than
    // snapping onto any level's seed.
    expect(theta).toBeGreaterThan(seedThetaFromRank('ko', 2)); // -1.8
    expect(theta).toBeLessThan(seedThetaFromRank('ko', 4)); // +0.6
    [1, 2, 3, 4, 5, 6].forEach((rank) => {
      expect(Math.abs(theta - seedThetaFromRank('ko', rank))).toBeGreaterThan(0.01);
    });
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
    // ko reading levels 1-6 seed at -3, -1.8, -0.6, +0.6, +1.8, +3.
    [1, 2, 3, 4, 5, 6].forEach((rank) => {
      expect(nearestRankForTheta('ko', seedThetaFromRank('ko', rank))).toBe(rank);
    });
    expect(nearestRankForTheta('ko', -0.1)).toBe(3); // closer to -0.6 than to +0.6
    expect(nearestRankForTheta('ko', 0.1)).toBe(4);
    expect(nearestRankForTheta('ko', 2.5)).toBe(6); // closer to +3 than to +1.8
    expect(nearestRankForTheta('ko', -10)).toBe(1); // clamps at the floor
    expect(nearestRankForTheta('zh', 0)).toBe(4); // HSK midpoint band
  });
});
