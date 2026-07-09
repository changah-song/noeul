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
  bookEaseFromLevel,
  bookEaseFromWordScores,
  formatEasePercent,
  getEaseBandKey,
} from '../bookEase';
import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  difficultyFromLevelRank,
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
