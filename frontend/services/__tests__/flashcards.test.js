/**
 * Tests for the Phase 4.4 Database wiring: P(known)-seeded new-card FSRS state
 * (insertData), getCachedPKnown, and the nominateFlashcards orchestrator. Real
 * in-memory SQLite so the real schemas + queries run.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createBookIndexTable,
  createDictionaryCacheTable,
  createTable,
  createWordScoresTable,
  getCachedPKnown,
  insertData,
  migrateVocabTable,
  nominateFlashcards,
  saveWordScores,
} from '../Database';
import { initialFsrsFromPKnown } from '../flashcardNomination';

const { __resetMockDatabases } = SQLite;
const OWNER = 'user-fc';
const PROFILE = 'ko_default';
const BOOK = 'book://demo';

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, r) => resolve(r), (_, e) => { reject(e); return true; });
    });
  });

const queryAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, r) => resolve(r.rows._array), (_, e) => { reject(e); return true; });
    });
  });

// Insert a dictionary_cache row and return its id (book_index.stem_id → this id).
const cacheStem = async (stem) => {
  await run(
    `INSERT INTO dictionary_cache (stem, language, interface_language, level_rank)
     VALUES (?, 'ko', 'en', 1)`,
    [stem]
  );
  const rows = await queryAll(`SELECT id FROM dictionary_cache WHERE stem = ? AND language = 'ko'`, [stem]);
  return rows[0].id;
};

// Give a stem `count` occurrences in the book (distinct surfaces → book_index rows).
const indexInBook = async (stemId, count) => {
  for (let i = 0; i < count; i += 1) {
    await run(
      `INSERT OR IGNORE INTO book_index (owner_id, profile_id, book_uri, surface, stem_id)
       VALUES (?, ?, ?, ?, ?)`,
      [OWNER, PROFILE, BOOK, `surf-${stemId}-${i}`, stemId]
    );
  }
};

beforeEach(async () => {
  __resetMockDatabases();
  await createTable();
  await migrateVocabTable();
  await createDictionaryCacheTable();
  await createWordScoresTable();
  await createBookIndexTable();
});

describe('insertData — P(known)-seeded FSRS prior', () => {
  it('seeds a likely-known word to a longer interval / lower difficulty', async () => {
    await insertData('학교', null, 'definition', {
      ownerId: OWNER, profileId: PROFILE, language: 'ko', pKnown: 0.95,
    });
    const [row] = await queryAll(`SELECT stability, difficulty FROM vocab WHERE word = '학교'`);
    const seed = initialFsrsFromPKnown(0.95);
    expect(row.stability).toBeCloseTo(seed.stability, 6);
    expect(row.difficulty).toBeCloseTo(seed.difficulty, 6);
    expect(row.stability).toBeGreaterThan(1.0); // longer than the generic default
    expect(row.difficulty).toBeLessThan(5.0);
  });

  it('falls back to the FSRS defaults when no P(known) is supplied', async () => {
    await insertData('커피', null, 'coffee', { ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    const [row] = await queryAll(`SELECT stability, difficulty FROM vocab WHERE word = '커피'`);
    expect(row.stability).toBe(1.0);
    expect(row.difficulty).toBe(5.0);
  });

  it('lets an explicit stability/difficulty override the P(known) seed', async () => {
    await insertData('책', null, 'book', {
      ownerId: OWNER, profileId: PROFILE, language: 'ko', pKnown: 0.95, stability: 2.5, difficulty: 6,
    });
    const [row] = await queryAll(`SELECT stability, difficulty FROM vocab WHERE word = '책'`);
    expect(row.stability).toBe(2.5);
    expect(row.difficulty).toBe(6);
  });
});

describe('getCachedPKnown', () => {
  it('reads the cached score for a word, or null when unscored', async () => {
    await saveWordScores(
      [{ stem: '학교', difficulty: -3, theta: 0, pKnown: 0.8, isFallback: false }],
      { ownerId: OWNER, profileId: PROFILE, language: 'ko', theta: 0, sourceBookUri: BOOK }
    );
    expect(await getCachedPKnown({ ownerId: OWNER, profileId: PROFILE, language: 'ko', word: '학교' })).toBeCloseTo(0.8, 6);
    expect(await getCachedPKnown({ ownerId: OWNER, profileId: PROFILE, language: 'ko', word: 'uncached' })).toBeNull();
  });
});

describe('nominateFlashcards', () => {
  it('ranks uncertain + rare-in-book words first and excludes saved words', async () => {
    // Three scored, unsaved words in the book:
    //   good-find : uncertain (0.5) + rare  (1 occurrence)  → best candidate
    //   frequent  : uncertain (0.5) + common (12 occurrences) → book teaches it
    //   confident : near-known (0.97) + rare (1)             → low uncertainty
    const goodId = await cacheStem('gf');
    const freqId = await cacheStem('fr');
    const confId = await cacheStem('cf');
    await indexInBook(goodId, 1);
    await indexInBook(freqId, 12);
    await indexInBook(confId, 1);

    await saveWordScores([
      { stem: 'gf', difficulty: 0, theta: 0, pKnown: 0.5, isFallback: false },
      { stem: 'fr', difficulty: 0, theta: 0, pKnown: 0.5, isFallback: false },
      { stem: 'cf', difficulty: 0, theta: 0, pKnown: 0.97, isFallback: false },
    ], { ownerId: OWNER, profileId: PROFILE, language: 'ko', theta: 0, sourceBookUri: BOOK });

    const ranked = await nominateFlashcards({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', sourceBookUri: BOOK,
    });

    expect(ranked[0].stem).toBe('gf');
    // 'gf' (uncertain+rare) beats both the frequent and the confident word.
    const byStem = Object.fromEntries(ranked.map((r) => [r.stem, r.nominationScore]));
    expect(byStem.gf).toBeGreaterThan(byStem.fr);
    expect(byStem.gf).toBeGreaterThan(byStem.cf);
  });

  it('excludes a word that has since been saved', async () => {
    const id = await cacheStem('saved');
    await indexInBook(id, 1);
    await saveWordScores(
      [{ stem: 'saved', difficulty: 0, theta: 0, pKnown: 0.5, isFallback: false }],
      { ownerId: OWNER, profileId: PROFILE, language: 'ko', theta: 0, sourceBookUri: BOOK }
    );
    // The user saved it after it was scored.
    await insertData('saved', null, 'def', { ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    const ranked = await nominateFlashcards({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', sourceBookUri: BOOK,
    });
    expect(ranked.find((r) => r.stem === 'saved')).toBeUndefined();
  });

  it('returns an empty list when the book has no scored words', async () => {
    expect(await nominateFlashcards({ ownerId: OWNER, profileId: PROFILE, language: 'ko', sourceBookUri: BOOK })).toEqual([]);
  });
});
