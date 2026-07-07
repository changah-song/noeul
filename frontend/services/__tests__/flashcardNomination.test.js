/**
 * Tests for the Phase 4.4 flashcard nomination + scheduling priors
 * (services/flashcardNomination.js). Pure functions — no SQLite.
 *
 * Two behaviors the plan §4.4 acceptance rests on:
 *  - nomination skews toward UNCERTAIN and RARE-in-book words;
 *  - a brand-new card's initial FSRS state is informed by P(known) (a likely-known
 *    word starts longer/easier), anchored so P = 0.5 reproduces today's defaults.
 */

import {
  EXPOSURE_SATURATION,
  INITIAL_STABILITY_MAX,
  INITIAL_STABILITY_MIN,
  initialFsrsFromPKnown,
  nominationScore,
  rankNominations,
  remainingExposureFactor,
  wordUncertainty,
} from '../flashcardNomination';

describe('wordUncertainty', () => {
  it('peaks at P = 0.5 and is 0 at the confident extremes', () => {
    expect(wordUncertainty(0.5)).toBe(1);
    expect(wordUncertainty(0)).toBe(0);
    expect(wordUncertainty(1)).toBe(0);
  });

  it('is symmetric around 0.5', () => {
    expect(wordUncertainty(0.25)).toBeCloseTo(wordUncertainty(0.75), 10);
    expect(wordUncertainty(0.25)).toBeCloseTo(0.75, 10); // 4*.25*.75
  });

  it('is 0 for non-finite input, not NaN', () => {
    expect(wordUncertainty(NaN)).toBe(0);
    expect(wordUncertainty(undefined)).toBe(0);
  });
});

describe('remainingExposureFactor', () => {
  it('rises from 0 to 1 as remaining occurrences approach saturation', () => {
    expect(remainingExposureFactor(0)).toBe(0);
    expect(remainingExposureFactor(EXPOSURE_SATURATION / 2)).toBeCloseTo(0.5, 10);
    expect(remainingExposureFactor(EXPOSURE_SATURATION)).toBe(1);
    expect(remainingExposureFactor(EXPOSURE_SATURATION * 3)).toBe(1); // clamped
  });

  it('treats unknown / absent counts as 0 (do not suppress)', () => {
    expect(remainingExposureFactor(null)).toBe(0);
    expect(remainingExposureFactor(undefined)).toBe(0);
  });
});

describe('nominationScore', () => {
  it('is maximal for an uncertain word the book will not repeat', () => {
    expect(nominationScore(0.5, 0)).toBe(1); // uncertain + rare
  });

  it('collapses to 0 when the book will teach the word incidentally', () => {
    expect(nominationScore(0.5, EXPOSURE_SATURATION)).toBe(0); // frequent → book teaches it
  });

  it('collapses to 0 when we are already confident about the word', () => {
    expect(nominationScore(0.98, 0)).toBeCloseTo(4 * 0.98 * 0.02, 10);
    expect(nominationScore(0.98, 0)).toBeLessThan(0.1);
  });

  it('prefers the more uncertain of two equally-rare words', () => {
    expect(nominationScore(0.5, 1)).toBeGreaterThan(nominationScore(0.9, 1));
  });
});

describe('initialFsrsFromPKnown', () => {
  it('reproduces the FSRS defaults at P = 0.5 (no information → no nudge)', () => {
    expect(initialFsrsFromPKnown(0.5)).toEqual({ stability: 1.0, difficulty: 5.0 });
  });

  it('gives a likely-known word a longer interval and lower difficulty', () => {
    const known = initialFsrsFromPKnown(0.95);
    const unknown = initialFsrsFromPKnown(0.05);
    expect(known.stability).toBeGreaterThan(unknown.stability);
    expect(known.difficulty).toBeLessThan(unknown.difficulty);
  });

  it('clamps to the configured FSRS ranges at the extremes', () => {
    expect(initialFsrsFromPKnown(1)).toEqual({ stability: INITIAL_STABILITY_MAX, difficulty: 1 });
    const zero = initialFsrsFromPKnown(0);
    expect(zero.stability).toBe(INITIAL_STABILITY_MIN);
    expect(zero.difficulty).toBe(9);
  });

  it('falls back to the defaults on non-finite input', () => {
    expect(initialFsrsFromPKnown(undefined)).toEqual({ stability: 1.0, difficulty: 5.0 });
  });
});

describe('rankNominations', () => {
  it('ranks the uncertain + rare word above a confident or frequent one', () => {
    const ranked = rankNominations([
      { stem: 'confident', pKnown: 0.97, remainingCount: 1 },
      { stem: 'good-find', pKnown: 0.5, remainingCount: 1 },   // uncertain + rare
      { stem: 'book-teaches', pKnown: 0.5, remainingCount: 20 }, // uncertain but frequent
    ]);
    expect(ranked[0].stem).toBe('good-find');
    expect(ranked[ranked.length - 1].stem).not.toBe('good-find');
    // Each candidate is annotated with its score.
    expect(ranked[0].nominationScore).toBeGreaterThan(ranked[1].nominationScore);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ stem: `w${i}`, pKnown: 0.5, remainingCount: 0 }));
    expect(rankNominations(many, { limit: 5 })).toHaveLength(5);
  });
});
