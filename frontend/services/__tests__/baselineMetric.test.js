/**
 * Tests for the Phase 3.2 IRT baseline metric (see "personalization model
 * implementation plan.md" §3.2). These are PURE-function tests — no SQLite, no
 * network — because the metric core takes normalized event records and returns
 * numbers. The scoring reuses the real abilityModel functions, so these also pin
 * down that the metric stays faithful to the deployed baseline.
 *
 * What we lock down:
 *  - the replay is prequential: each event is PREDICTED before its outcome is
 *    folded into theta (no leakage);
 *  - only graded review events become labeled samples; lookups only move theta;
 *  - cold (first encounter) vs. warm (seen before) segmentation is correct;
 *  - Brier and the calibration table are computed correctly;
 *  - the self-report seed drives the initial predictions;
 *  - ungraded-difficulty (OOV) events are flagged and don't move theta.
 */

import {
  brierScore,
  calibrationTable,
  collectSamples,
  evaluateBaseline,
  replayProfile,
} from '../baselineMetric';
import {
  difficultyFromLevelRank,
  pKnown,
  seedThetaFromRank,
} from '../abilityModel';

const ev = (overrides = {}) => ({
  ownerId: 'u1',
  profileId: 'ko_default',
  language: 'ko',
  word: 'w',
  stem: 'w',
  eventType: 'review',
  outcome: 1,
  createdAt: '2026-01-01T00:00:00Z',
  clientEventId: 'c1',
  levelRank: 2, // ko mid band → difficulty 0
  selfReportRank: 2, // ko mid band → theta_0 = 0
  ...overrides,
});

describe('brierScore', () => {
  it('is the mean squared error of prediction vs. outcome', () => {
    const samples = [
      { prediction: 0.8, outcome: 1 },
      { prediction: 0.3, outcome: 0 },
    ];
    // ((0.8-1)^2 + (0.3-0)^2) / 2 = (0.04 + 0.09) / 2 = 0.065
    expect(brierScore(samples)).toBeCloseTo(0.065, 10);
  });

  it('returns null for an empty sample set (no data, not a fake 0)', () => {
    expect(brierScore([])).toBeNull();
  });
});

describe('calibrationTable', () => {
  it('buckets predictions into equal-width bins with per-bin empirical rate', () => {
    const samples = [
      { prediction: 0.05, outcome: 0 },
      { prediction: 0.05, outcome: 1 }, // bin 0: 2 samples, actual 0.5
      { prediction: 0.95, outcome: 1 }, // bin 9: 1 sample, actual 1.0
    ];
    const table = calibrationTable(samples, 10);
    expect(table[0].count).toBe(2);
    expect(table[0].empiricalRate).toBeCloseTo(0.5, 10);
    expect(table[9].count).toBe(1);
    expect(table[9].empiricalRate).toBe(1);
    // Empty bins report null, never a misleading 0.
    expect(table[5].count).toBe(0);
    expect(table[5].empiricalRate).toBeNull();
  });

  it('places a prediction of exactly 1.0 in the last bin, not out of range', () => {
    const table = calibrationTable([{ prediction: 1, outcome: 1 }], 10);
    expect(table[9].count).toBe(1);
  });
});

describe('replayProfile — prequential replay', () => {
  it('predicts the first event from the self-report seed, before any update', () => {
    const samples = replayProfile({
      events: [ev()],
      language: 'ko',
      selfReportRank: 2,
    });
    // theta_0 = seed(ko, 2) = 0; difficulty(ko, 2) = 0; so first prediction = 0.5.
    const expected = pKnown(seedThetaFromRank('ko', 2), difficultyFromLevelRank('ko', 2));
    expect(samples).toHaveLength(1);
    expect(samples[0].prediction).toBeCloseTo(expected, 10);
    expect(samples[0].prediction).toBeCloseTo(0.5, 10);
  });

  it('folds a correct review so the next prediction on that word is higher', () => {
    const samples = replayProfile({
      events: [
        ev({ clientEventId: 'a', createdAt: '2026-01-01T00:00:00Z', outcome: 1 }),
        ev({ clientEventId: 'b', createdAt: '2026-01-01T01:00:00Z', outcome: 1 }),
      ],
      language: 'ko',
      selfReportRank: 2,
    });
    // First predicted at theta_0 (0.5); the correct outcome raises theta, so the
    // second prediction (same word) must be strictly higher.
    expect(samples[1].prediction).toBeGreaterThan(samples[0].prediction);
  });

  it('tags the first encounter cold and a later same-word event warm', () => {
    const samples = replayProfile({
      events: [
        ev({ clientEventId: 'a', stem: 'x', createdAt: '2026-01-01T00:00:00Z' }),
        ev({ clientEventId: 'b', stem: 'x', createdAt: '2026-01-01T01:00:00Z' }),
      ],
      language: 'ko',
      selfReportRank: 2,
    });
    expect(samples[0].cold).toBe(true);
    expect(samples[1].cold).toBe(false);
  });

  it('sorts by time regardless of input order', () => {
    const later = ev({ clientEventId: 'late', createdAt: '2026-01-02T00:00:00Z', outcome: 0 });
    const earlier = ev({ clientEventId: 'early', createdAt: '2026-01-01T00:00:00Z', outcome: 1 });
    // Pass out of order; the earlier (cold) event must still be scored first.
    const samples = replayProfile({ events: [later, earlier], language: 'ko', selfReportRank: 2 });
    expect(samples[0].cold).toBe(true); // the earlier event
    expect(samples.map((s) => s.outcome)).toEqual([1, 0]);
  });

  it('does not create samples for lookups, but they still move theta', () => {
    const withLookup = replayProfile({
      events: [
        ev({ clientEventId: 'l', eventType: 'lookup', outcome: null, createdAt: '2026-01-01T00:00:00Z' }),
        ev({ clientEventId: 'r', eventType: 'review', outcome: 1, createdAt: '2026-01-01T01:00:00Z' }),
      ],
      language: 'ko',
      selfReportRank: 2,
    });
    const withoutLookup = replayProfile({
      events: [ev({ clientEventId: 'r', eventType: 'review', outcome: 1 })],
      language: 'ko',
      selfReportRank: 2,
    });
    // Only the review produced a sample.
    expect(withLookup).toHaveLength(1);
    // The lookup (outcome 0, weak) pushed theta down, so the review prediction is
    // lower than it would have been with no preceding lookup.
    expect(withLookup[0].prediction).toBeLessThan(withoutLookup[0].prediction);
  });

  it('flags ungraded-difficulty events and does not move theta on them', () => {
    const samples = replayProfile({
      events: [
        ev({ clientEventId: 'a', levelRank: null, outcome: 1, createdAt: '2026-01-01T00:00:00Z' }),
        ev({ clientEventId: 'b', levelRank: null, outcome: 1, createdAt: '2026-01-01T01:00:00Z' }),
      ],
      language: 'ko',
      selfReportRank: 2,
    });
    expect(samples[0].isFallback).toBe(true);
    // OOV skips the theta update, so both predictions are identical (theta unmoved).
    expect(samples[1].prediction).toBeCloseTo(samples[0].prediction, 10);
  });

  it('starts from the neutral midpoint when there is no self-report', () => {
    const samples = replayProfile({ events: [ev({ selfReportRank: null })], language: 'ko', selfReportRank: null });
    // Neutral theta 0, mid difficulty 0 → 0.5.
    expect(samples[0].prediction).toBeCloseTo(0.5, 10);
  });
});

describe('self-report seed drives initial predictions', () => {
  it('gives a higher initial prediction to a higher self-report', () => {
    const low = replayProfile({ events: [ev({ selfReportRank: 1 })], language: 'ko', selfReportRank: 1 });
    const high = replayProfile({ events: [ev({ selfReportRank: 3 })], language: 'ko', selfReportRank: 3 });
    expect(high[0].prediction).toBeGreaterThan(low[0].prediction);
  });
});

describe('collectSamples + evaluateBaseline', () => {
  it('replays multiple profiles independently and segments cold vs. warm', () => {
    const events = [
      // profile A: two encounters of the same word (1 cold, 1 warm)
      ev({ ownerId: 'A', stem: 'x', clientEventId: 'a1', createdAt: '2026-01-01T00:00:00Z' }),
      ev({ ownerId: 'A', stem: 'x', clientEventId: 'a2', createdAt: '2026-01-01T01:00:00Z' }),
      // profile B: one cold encounter
      ev({ ownerId: 'B', stem: 'y', clientEventId: 'b1', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    const { samples, groupCount } = collectSamples(events);
    expect(groupCount).toBe(2);
    expect(samples).toHaveLength(3);

    const result = evaluateBaseline(events);
    expect(result.meta.profiles).toBe(2);
    expect(result.meta.reviewSamples).toBe(3);
    expect(result.cold.count).toBe(2); // A's first + B's first
    expect(result.warm.count).toBe(1); // A's second
    expect(result.overall.count).toBe(3);
  });

  it('a stream drawn from the baseline model scores far better than always-0.5', () => {
    // Outcomes generated to AGREE with the baseline: easy word for a strong user
    // is recalled, hard word for a weak user is lapsed. Brier should beat 0.25
    // (the Brier of always predicting 0.5).
    const events = [];
    for (let i = 0; i < 40; i += 1) {
      const strong = i % 2 === 0;
      events.push(
        ev({
          ownerId: `u${i}`,
          stem: `s${i}`,
          clientEventId: `e${i}`,
          selfReportRank: strong ? 3 : 1,
          levelRank: strong ? 1 : 3, // strong user + easy word, or weak user + hard word
          outcome: strong ? 1 : 0,
        })
      );
    }
    const result = evaluateBaseline(events);
    expect(result.overall.brier).toBeLessThan(0.25);
  });
});
