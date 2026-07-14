/**
 * Tests for the book reading-ease estimate (`bookEase.js`). Like the ability-model
 * tests, these are pure functions — no database, no React — so we just call them and
 * assert on the numbers.
 *
 * What we're pinning down:
 *  - ease is `P(known)` = sigmoid(theta − book difficulty), so a stronger reader
 *    always finds a given book easier, and an easier (lower-band) book always reads
 *    easier for a fixed reader (monotonic both ways);
 *  - an unleveled book returns null (we never fabricate a "hard" estimate);
 *  - the percentage formatter and band labels behave at the edges.
 */

import {
  BOOK_LEVEL_COMPREHENSION_ANCHOR,
  bookEaseFromDistribution,
  bookEaseFromLevel,
  bookEaseFromWordScores,
  formatEasePercent,
  getEaseBandKey,
} from '../bookEase';
import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  difficultyFromLevelRank,
  sigmoid,
} from '../abilityModel';

describe('bookEaseFromLevel', () => {
  it('reports the leveling percentile (~80%) for a reader AT the book level, not a bare 50%', () => {
    // ko band 3 (고급): difficulty at the ceiling; an "advanced" reader (rank 3)
    // seeds to that same ceiling, so theta === difficulty — the exact case the naive
    // sigmoid(theta − difficulty) collapsed to 0.5.
    const theta = ABILITY_THETA_MAX;
    const difficulty = difficultyFromLevelRank('ko', 3);
    expect(theta).toBeCloseTo(difficulty, 12);
    expect(bookEaseFromLevel({ theta, language: 'ko', levelRank: 3 }))
      .toBeCloseTo(BOOK_LEVEL_COMPREHENSION_ANCHOR, 12);
  });

  it('rises above the anchor when the reader out-levels the book', () => {
    // Advanced ko reader on an intermediate (band 2) book.
    const ease = bookEaseFromLevel({ theta: ABILITY_THETA_MAX, language: 'ko', levelRank: 2 });
    expect(ease).toBeGreaterThan(BOOK_LEVEL_COMPREHENSION_ANCHOR);
  });

  it('is monotonic in the reader: a stronger reader finds the same book easier', () => {
    const weak = bookEaseFromLevel({ theta: ABILITY_THETA_MIN, language: 'zh', levelRank: 4 });
    const strong = bookEaseFromLevel({ theta: ABILITY_THETA_MAX, language: 'zh', levelRank: 4 });
    expect(strong).toBeGreaterThan(weak);
  });

  it('is monotonic in the book: an easier (lower-band) book reads easier for a fixed reader', () => {
    const easyBook = bookEaseFromLevel({ theta: 0, language: 'en', levelRank: 1 });
    const hardBook = bookEaseFromLevel({ theta: 0, language: 'en', levelRank: 6 });
    expect(easyBook).toBeGreaterThan(hardBook);
  });

  it('returns a value strictly in (0, 1)', () => {
    const ease = bookEaseFromLevel({ theta: 3, language: 'ko', levelRank: 1 });
    expect(ease).toBeGreaterThan(0);
    expect(ease).toBeLessThan(1);
  });

  it('returns null when the book has no graded level (no fabricated "hard" score)', () => {
    expect(bookEaseFromLevel({ theta: 0, language: 'ko', levelRank: null })).toBeNull();
    expect(bookEaseFromLevel({ theta: 0, language: 'ko', levelRank: undefined })).toBeNull();
    expect(bookEaseFromLevel({ theta: 0, language: 'ko', levelRank: 'nope' })).toBeNull();
  });

  it('treats a missing/non-finite theta as the neutral midpoint (0) rather than NaN', () => {
    const neutral = bookEaseFromLevel({ theta: 0, language: 'ko', levelRank: 2 });
    expect(bookEaseFromLevel({ theta: null, language: 'ko', levelRank: 2 })).toBeCloseTo(neutral, 12);
    expect(bookEaseFromLevel({ theta: undefined, language: 'ko', levelRank: 2 })).toBeCloseTo(neutral, 12);
  });
});

describe('bookEaseFromDistribution', () => {
  it('is the count-weighted mean of the per-band word-level sigmoid (no anchor)', () => {
    // ko bands 1/2/3 map to difficulties -3/0/+3. For a neutral reader (theta 0)
    // a 40/25/35 split should give 0.4·σ(3) + 0.25·σ(0) + 0.35·σ(-3) exactly.
    const distribution = [
      { rank: 1, count: 40 },
      { rank: 2, count: 25 },
      { rank: 3, count: 35 },
    ];
    const expected = (40 * sigmoid(3) + 25 * sigmoid(0) + 35 * sigmoid(-3)) / 100;
    expect(bookEaseFromDistribution({ theta: 0, language: 'ko', distribution }))
      .toBeCloseTo(expected, 12);
  });

  it('differentiates two same-band books with different vocabulary mixes', () => {
    // Both books level to ko band 3 under the 80th-percentile rule, but one is
    // mostly easy words with a hard tail while the other is hard throughout.
    // The single-band estimate collapses them to the same number; the
    // distribution must not.
    const easierMix = [
      { rank: 1, count: 70 },
      { rank: 2, count: 8 },
      { rank: 3, count: 22 },
    ];
    const harderMix = [
      { rank: 1, count: 20 },
      { rank: 2, count: 20 },
      { rank: 3, count: 60 },
    ];
    const easier = bookEaseFromDistribution({ theta: 0, language: 'ko', distribution: easierMix });
    const harder = bookEaseFromDistribution({ theta: 0, language: 'ko', distribution: harderMix });
    expect(easier).toBeGreaterThan(harder);
  });

  it('is monotonic in the reader: a stronger reader gets a higher ease on the same book', () => {
    const distribution = [
      { rank: 2, count: 50 },
      { rank: 5, count: 50 },
    ];
    const weak = bookEaseFromDistribution({ theta: ABILITY_THETA_MIN, language: 'zh', distribution });
    const strong = bookEaseFromDistribution({ theta: ABILITY_THETA_MAX, language: 'zh', distribution });
    expect(strong).toBeGreaterThan(weak);
  });

  it('treats a missing theta as the neutral midpoint rather than flattening to 0.5', () => {
    const distribution = [{ rank: 1, count: 10 }];
    const neutral = bookEaseFromDistribution({ theta: 0, language: 'ko', distribution });
    expect(bookEaseFromDistribution({ theta: null, language: 'ko', distribution }))
      .toBeCloseTo(neutral, 12);
    // Band 1 for a neutral reader is very likely known — NOT the 0.5 that a
    // NaN-poisoned sigmoid would produce.
    expect(neutral).toBeGreaterThan(0.9);
  });

  it('skips malformed bands and returns null when nothing usable remains', () => {
    expect(bookEaseFromDistribution({ theta: 0, language: 'ko', distribution: [] })).toBeNull();
    expect(bookEaseFromDistribution({ theta: 0, language: 'ko' })).toBeNull();
    expect(bookEaseFromDistribution({
      theta: 0,
      language: 'ko',
      distribution: [{ rank: 'x', count: 5 }, { rank: 2, count: 0 }, { rank: 3, count: -1 }],
    })).toBeNull();
    // One good band among junk still produces an estimate.
    const ease = bookEaseFromDistribution({
      theta: 0,
      language: 'ko',
      distribution: [{ rank: 'x', count: 5 }, { rank: 2, count: 10 }],
    });
    expect(ease).toBeCloseTo(sigmoid(0), 12);
  });
});

describe('bookEaseFromWordScores', () => {
  it('computes a frequency-weighted mean of per-word P(known)', () => {
    // 0.9 seen 3×, 0.1 seen 1× → (0.9*3 + 0.1*1) / 4 = 0.7
    const ease = bookEaseFromWordScores([
      { pKnown: 0.9, weight: 3 },
      { pKnown: 0.1, weight: 1 },
    ]);
    expect(ease).toBeCloseTo(0.7, 12);
  });

  it('defaults a missing/invalid weight to 1 and skips non-finite scores', () => {
    const ease = bookEaseFromWordScores([
      { pKnown: 0.4 },
      { pKnown: 0.6 },
      { pKnown: NaN, weight: 100 },
    ]);
    expect(ease).toBeCloseTo(0.5, 12);
  });

  it('returns null when there are no scored tokens', () => {
    expect(bookEaseFromWordScores([])).toBeNull();
    expect(bookEaseFromWordScores([{ pKnown: 'x' }])).toBeNull();
  });
});

describe('formatEasePercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatEasePercent(0.732)).toBe(73);
  });

  it('clamps to [1, 99] so we never claim "0%" or "100%"', () => {
    expect(formatEasePercent(0.0001)).toBe(1);
    expect(formatEasePercent(0.9999)).toBe(99);
  });

  it('returns null when ease is unavailable', () => {
    expect(formatEasePercent(null)).toBeNull();
    expect(formatEasePercent(undefined)).toBeNull();
    expect(formatEasePercent(NaN)).toBeNull();
  });
});

describe('getEaseBandKey', () => {
  it('labels bands by ease, from comfortable down to difficult', () => {
    expect(getEaseBandKey(0.95)).toBe('comfortable');
    expect(getEaseBandKey(0.8)).toBe('approachable');
    expect(getEaseBandKey(0.6)).toBe('challenging');
    expect(getEaseBandKey(0.2)).toBe('difficult');
  });

  it('returns null when ease is unavailable', () => {
    expect(getEaseBandKey(null)).toBeNull();
    expect(getEaseBandKey(NaN)).toBeNull();
  });
});
