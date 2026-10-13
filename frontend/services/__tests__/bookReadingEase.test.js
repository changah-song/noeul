/**
 * Tests for estimateBookReadingEase — the orchestrator behind the book-preview
 * "reading ease" percentage. Real in-memory SQLite so the ability read and the
 * preprocess-meta fallback both run for real.
 *
 * What we're pinning down:
 *  - a band DISTRIBUTION refines the estimate (continuous, mix-sensitive) and is
 *    preferred over the coarse single-band formula — the fix for every ko book
 *    collapsing to one of three values;
 *  - stats arrive as an object OR the stored JSON string;
 *  - when the caller's bookLevel has no distribution but the preprocess meta
 *    table does (accumulated while reading), the stored one is used;
 *  - `easeSource` and `coverage` surface so the UI can hedge a thin estimate.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createBookPreprocessTables,
  createProfileAbilityTable,
  ensureProfileAbilitySeed,
  estimateBookReadingEase,
  markBookPreprocessMeta,
} from '../Database';
import { bookEaseFromDistribution, bookEaseFromLevel } from '../bookEase';
import { seedThetaFromRank } from '../abilityModel';

const { __resetMockDatabases } = SQLite;
const OWNER = 'user-ease';
const PROFILE = 'ko_default';

// ko reader who self-reported reading level 3 of 6 (seeds theta at -0.6).
const SEED_RANK = 3;
const THETA = seedThetaFromRank('ko', SEED_RANK);

const DISTRIBUTION = [
  { rank: 1, count: 40 },
  { rank: 3, count: 25 },
  { rank: 6, count: 35 },
];

beforeEach(async () => {
  __resetMockDatabases();
  await createProfileAbilityTable();
  await createBookPreprocessTables();
  await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: SEED_RANK });
});

describe('estimateBookReadingEase', () => {
  it('prefers the band distribution over the coarse single-band estimate', async () => {
    const result = await estimateBookReadingEase({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      levelRank: 3,
      bookLevelStats: { distribution: DISTRIBUTION, coverage: 0.27 },
    });

    const expected = bookEaseFromDistribution({ theta: THETA, language: 'ko', distribution: DISTRIBUTION });
    expect(result.ease).toBeCloseTo(expected, 12);
    expect(result.easeSource).toBe('distribution');
    expect(result.coverage).toBeCloseTo(0.27, 12);
    // And it must NOT be the collapsed single-band number (~17% for ko rank 3).
    const collapsed = bookEaseFromLevel({ theta: THETA, language: 'ko', levelRank: 3 });
    expect(Math.abs(result.ease - collapsed)).toBeGreaterThan(0.1);
  });

  it('accepts the stored JSON string form of book_level_stats', async () => {
    const result = await estimateBookReadingEase({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      levelRank: 3,
      bookLevelStats: JSON.stringify({ distribution: DISTRIBUTION }),
    });
    const expected = bookEaseFromDistribution({ theta: THETA, language: 'ko', distribution: DISTRIBUTION });
    expect(result.ease).toBeCloseTo(expected, 12);
    expect(result.easeSource).toBe('distribution');
  });

  it('falls back to the single-band estimate when there is no distribution', async () => {
    const result = await estimateBookReadingEase({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      levelRank: 3,
    });
    expect(result.ease).toBeCloseTo(
      bookEaseFromLevel({ theta: THETA, language: 'ko', levelRank: 3 }),
      12
    );
    expect(result.easeSource).toBe('level');
    expect(result.coverage).toBeNull();
  });

  it('reads the locally-accumulated preprocess stats when the passed bookLevel has no distribution', async () => {
    const bookUri = 'file:///books/test.epub';
    await markBookPreprocessMeta({
      ownerId: OWNER,
      bookUri,
      status: 'complete',
      bookLevel: {
        level: '고급',
        level_rank: 3,
        coverage: 0.31,
        distribution: DISTRIBUTION,
      },
    });

    const result = await estimateBookReadingEase({
      ownerId: OWNER,
      language: 'ko',
      levelRank: 3,
      // e.g. the bundled-catalog bookLevel: a band but no distribution.
      bookLevelStats: { level_rank: 3 },
      bookUri,
    });

    const expected = bookEaseFromDistribution({ theta: THETA, language: 'ko', distribution: DISTRIBUTION });
    expect(result.ease).toBeCloseTo(expected, 12);
    expect(result.easeSource).toBe('distribution');
    expect(result.coverage).toBeCloseTo(0.31, 12);
  });

  it('still returns null ease for an unleveled book with no stats', async () => {
    const result = await estimateBookReadingEase({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      levelRank: null,
    });
    expect(result.ease).toBeNull();
    expect(result.easeSource).toBeNull();
  });
});

describe('estimateBookReadingEase with pre-rescale (NIKL) stats', () => {
  it('scores an old-format book the same as the same book on reading levels', async () => {
    const legacyStats = {
      language: 'ko',
      proficiency_system: 'NIKL',
      level_rank: 3,
      distribution: [
        { rank: 1, level: '초급', count: 40 },
        { rank: 2, level: '중급', count: 25 },
        { rank: 3, level: '고급', count: 35 },
      ],
    };
    const legacy = await estimateBookReadingEase({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', levelRank: 3, bookLevelStats: legacyStats,
    });
    const expected = bookEaseFromDistribution({
      theta: THETA,
      language: 'ko',
      distribution: [{ rank: 1, count: 40 }, { rank: 3, count: 25 }, { rank: 5, count: 35 }],
    });
    expect(legacy.ease).toBeCloseTo(expected, 12);
    expect(legacy.easeSource).toBe('distribution');
  });

  it('remaps the level-only fallback too', async () => {
    const legacy = await estimateBookReadingEase({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', levelRank: 3,
      bookLevelStats: { language: 'ko', proficiency_system: 'NIKL', level_rank: 3 },
    });
    expect(legacy.ease).toBeCloseTo(bookEaseFromLevel({ theta: THETA, language: 'ko', levelRank: 5 }), 12);
    expect(legacy.easeSource).toBe('level');
  });
});
