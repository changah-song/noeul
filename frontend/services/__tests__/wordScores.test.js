/**
 * Tests for Phase 2.3 — the baseline scorer's caching layer: `scoreWordsForProfile`
 * (the orchestrator), `word_scores` (the unsaved-word cache), and `vocab.p_known`
 * (the saved-word cache). See "personalization model implementation plan.md" §2.3.
 *
 * Same in-memory-SQLite setup as the other Database tests (jest.config.js
 * moduleNameMapper swaps expo-sqlite for a real engine), so the REAL schema and
 * REAL SQL — the ON CONFLICT upsert, the saved/unsaved partition — actually run.
 * `hanjaDatabase` is mocked because Database.js loads a binary asset from it.
 *
 * What we lock down (the §2.3 acceptance check):
 *  - every requested word gets a p_known strictly in (0, 1);
 *  - ordering is sane: a harder/higher-rank word scores lower than an easier one;
 *  - saved words cache onto vocab.p_known, unsaved words into word_scores, with no
 *    overlap;
 *  - scoring still works (neutral midpoint) before any theta is seeded;
 *  - re-scoring overwrites in place (idempotent per stem).
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createDictionaryCacheTable,
  createProfileAbilityTable,
  createTable,
  createWordScoresTable,
  ensureProfileAbilitySeed,
  getWordScores,
  insertData,
  migrateVocabTable,
  scoreWordsForProfile,
} from '../Database';
import { OOV_DIFFICULTY, pKnown, seedThetaFromRank } from '../abilityModel';

const { __resetMockDatabases } = SQLite;

const queryAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          reject(error);
          return true;
        }
      );
    });
  });

// Cache a stem the way the preprocess/lookup pipeline would, so scoring reads the
// real difficulty path.
const cacheStem = ({ stem, language, levelRank, interfaceLanguage = 'en' }) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(
        `INSERT OR IGNORE INTO dictionary_cache
           (stem, language, interface_language, level_rank)
         VALUES (?, ?, ?, ?)`,
        [stem, language, interfaceLanguage, levelRank],
        () => resolve(),
        (_, error) => {
          reject(error);
          return true;
        }
      );
    });
  });

const OWNER = 'user-scores';
const PROFILE = 'ko_default';

beforeEach(async () => {
  __resetMockDatabases();
  await createTable(); // vocab (includes p_known)
  await migrateVocabTable(); // adds source_book_uri etc. used by insertData
  await createDictionaryCacheTable();
  await createProfileAbilityTable();
  await createWordScoresTable();
});

describe('scoreWordsForProfile', () => {
  it('scores every requested word with a p_known strictly in (0, 1)', async () => {
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });
    await cacheStem({ stem: '가격', language: 'ko', levelRank: 2 });
    // '신조어' deliberately never cached → OOV fallback, still scored.
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['학교', '가격', '신조어'],
    });

    expect(Object.keys(scores).sort()).toEqual(['가격', '신조어', '학교']);
    for (const stem of Object.keys(scores)) {
      expect(scores[stem].pKnown).toBeGreaterThan(0);
      expect(scores[stem].pKnown).toBeLessThan(1);
    }
  });

  it('matches the pure scorer: P = 0.5 when the user band equals the word band', async () => {
    // ko rank 2 → theta 0; a rank-2 word → difficulty 0 → sigmoid(0) = 0.5.
    await cacheStem({ stem: '가격', language: 'ko', levelRank: 2 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['가격'],
    });

    expect(scores['가격'].pKnown).toBe(pKnown(seedThetaFromRank('ko', 2), 0));
    expect(scores['가격'].pKnown).toBe(0.5);
  });

  it('orders a harder word below an easier one, and OOV lowest of all', async () => {
    await cacheStem({ stem: 'easy', language: 'en', levelRank: 1 }); // A1
    await cacheStem({ stem: 'hard', language: 'en', levelRank: 6 }); // C2
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: 'en_default', language: 'en', rank: 3 });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER,
      profileId: 'en_default',
      language: 'en',
      stems: ['easy', 'hard', 'coined'],
    });

    expect(scores.easy.pKnown).toBeGreaterThan(scores.hard.pKnown);
    expect(scores.hard.pKnown).toBeGreaterThanOrEqual(scores.coined.pKnown);
    // The ungraded word is flagged so calibration can segment on it later.
    expect(scores.coined.isFallback).toBe(true);
    expect(scores.coined.difficulty).toBe(OOV_DIFFICULTY);
    expect(scores.easy.isFallback).toBe(false);
  });

  it('caches saved words onto vocab.p_known and unsaved words into word_scores, with no overlap', async () => {
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });
    await cacheStem({ stem: '책', language: 'ko', levelRank: 1 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    // '학교' is a saved vocab word; '책' is not.
    await insertData('학교', null, 'school', { ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['학교', '책'],
    });

    // Saved word: p_known lands on the vocab row, and NOT in word_scores.
    const vocabRows = await queryAll('SELECT word, p_known FROM vocab WHERE word = ?', ['학교']);
    expect(vocabRows).toHaveLength(1);
    expect(vocabRows[0].p_known).toBeCloseTo(scores['학교'].pKnown, 10);

    const cached = await getWordScores('ko', ['학교', '책'], { ownerId: OWNER, profileId: PROFILE });
    expect(Object.keys(cached)).toEqual(['책']); // only the unsaved word
    expect(cached['책'].p_known).toBeCloseTo(scores['책'].pKnown, 10);
    expect(cached['책'].is_fallback).toBe(0);
  });

  it('still scores (neutral midpoint) when the profile has no seeded theta', async () => {
    await cacheStem({ stem: '가격', language: 'ko', levelRank: 2 });

    const scores = await scoreWordsForProfile({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['가격'],
    });

    // Midpoint theta (0) vs. a rank-2 (difficulty 0) word → 0.5, and it's recorded.
    expect(scores['가격'].theta).toBe(0);
    expect(scores['가격'].pKnown).toBe(0.5);
  });

  it('re-scoring overwrites the cached row in place (idempotent per stem)', async () => {
    await cacheStem({ stem: '책', language: 'ko', levelRank: 1 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 1 });
    await scoreWordsForProfile({ ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['책'] });
    await scoreWordsForProfile({ ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['책'] });

    const rows = await queryAll('SELECT * FROM word_scores WHERE stem = ?', ['책']);
    expect(rows).toHaveLength(1);
  });

  it('returns an empty map for empty input', async () => {
    expect(await scoreWordsForProfile({ ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: [] })).toEqual({});
  });
});
