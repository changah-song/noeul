/**
 * Tests for the Phase 4.3 serving wiring: scoreWordsForProfile uses the active
 * full model to REPLACE the baseline score, caches it, and leaves the read path
 * unchanged. Real in-memory SQLite so the actual cache writes/reads run.
 *
 * The model here is a fake object with a `score()` method — that's the whole
 * point of the model-agnostic interface (plan §4.3): serving depends only on
 * `.score(featureRecord)`, not on any particular model implementation.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createDictionaryCacheTable,
  createInteractionEventsTable,
  createProfileAbilityTable,
  createTable,
  createWordScoresTable,
  ensureProfileAbilitySeed,
  getWordScores,
  migrateVocabTable,
  scoreWordsForProfile,
} from '../Database';
import {
  clearActivePknownModel,
  setActivePknownModel,
} from '../pknownModel';

const { __resetMockDatabases } = SQLite;
const OWNER = 'user-serve';
const PROFILE = 'ko_default';

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, r) => resolve(r), (_, e) => { reject(e); return true; });
    });
  });

const cacheStem = ({ stem, levelRank = 1 }) =>
  run(
    `INSERT OR IGNORE INTO dictionary_cache (stem, language, interface_language, level_rank)
     VALUES (?, 'ko', 'en', ?)`,
    [stem, levelRank]
  );

beforeEach(async () => {
  __resetMockDatabases();
  await createTable();
  await migrateVocabTable();
  await createDictionaryCacheTable();
  await createProfileAbilityTable();
  await createInteractionEventsTable();
  await createWordScoresTable();
  await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
});

afterEach(() => clearActivePknownModel());

describe('scoreWordsForProfile — full-model serving', () => {
  it('falls back to the IRT baseline when no model is registered', async () => {
    await cacheStem({ stem: '학교', levelRank: 1 });
    const scores = await scoreWordsForProfile({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교'],
    });
    expect(scores['학교'].source).toBe('baseline');
    // baseline P = sigmoid(theta - difficulty); theta seed rank2 = 0, diff(rank1)=-3
    expect(scores['학교'].pKnown).toBeGreaterThan(0.9);
  });

  it('replaces the baseline score with the model score and caches it', async () => {
    await cacheStem({ stem: '학교', levelRank: 1 });
    // A fake model that always returns 0.42 — exercises the model-agnostic path.
    setActivePknownModel({ version: 9, score: () => 0.42 });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교'],
    });
    expect(scores['학교'].pKnown).toBeCloseTo(0.42, 10);
    expect(scores['학교'].source).toBe('model:v9');

    // The cache (read path unchanged) now holds the model score.
    const cached = await getWordScores('ko', ['학교'], { ownerId: OWNER, profileId: PROFILE });
    expect(cached['학교'].p_known).toBeCloseTo(0.42, 6);
  });

  it('keeps the baseline score if model scoring throws', async () => {
    await cacheStem({ stem: '학교', levelRank: 1 });
    setActivePknownModel({ version: 9, score: () => { throw new Error('boom'); } });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교'],
    });
    // Non-fatal: baseline stands, preprocessing isn't broken.
    expect(scores['학교'].source).toBe('baseline');
    expect(Number.isFinite(scores['학교'].pKnown)).toBe(true);
  });
});
