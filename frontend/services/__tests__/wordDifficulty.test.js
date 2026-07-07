/**
 * Tests for Phase 2.2 `getWordDifficulties` — resolving the knowledge-based
 * difficulty of a list of words from the KB prior already cached on-device.
 * See "personalization model implementation plan.md" §2.2.
 *
 * Same in-memory-SQLite setup as the other Database tests: the REAL
 * `dictionary_cache` schema and REAL SQL run against a real (in-memory) engine.
 * `hanjaDatabase` is mocked because Database.js loads a binary asset from it that
 * Jest can't bundle.
 *
 * The point of these tests: difficulty comes back for EVERY requested word (no
 * silent gaps), it's derived from the cached `level_rank`, ungraded words are
 * flagged as fallbacks, and the lookup is scoped to the requested language.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import { createDictionaryCacheTable, getWordDifficulties } from '../Database';
import { OOV_DIFFICULTY, difficultyFromLevelRank } from '../abilityModel';

const { __resetMockDatabases } = SQLite;

// Insert a cached stem the way the preprocess/lookup pipeline would, so the test
// exercises the real read path rather than a stand-in.
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

beforeEach(async () => {
  __resetMockDatabases();
  await createDictionaryCacheTable();
});

describe('getWordDifficulties', () => {
  it('derives difficulty from cached level_rank for ko / zh / en', async () => {
    await cacheStem({ stem: '가격', language: 'ko', levelRank: 1 }); // 초급
    await cacheStem({ stem: '一', language: 'zh', levelRank: 1 }); // HSK 1
    await cacheStem({ stem: 'abandon', language: 'en', levelRank: 3 }); // B1

    const ko = await getWordDifficulties('ko', ['가격']);
    const zh = await getWordDifficulties('zh', ['一']);
    const en = await getWordDifficulties('en', ['abandon']);

    expect(ko['가격']).toEqual({
      levelRank: 1,
      difficulty: difficultyFromLevelRank('ko', 1),
      isFallback: false,
    });
    expect(zh['一'].difficulty).toBe(difficultyFromLevelRank('zh', 1));
    expect(en['abandon'].difficulty).toBe(difficultyFromLevelRank('en', 3));
  });

  it('orders a harder band above an easier one (stable, sane ordering)', async () => {
    await cacheStem({ stem: 'easy', language: 'en', levelRank: 1 }); // A1
    await cacheStem({ stem: 'hard', language: 'en', levelRank: 6 }); // C2

    const result = await getWordDifficulties('en', ['easy', 'hard']);
    expect(result.easy.difficulty).toBeLessThan(result.hard.difficulty);
  });

  it('flags an ungraded word as a fallback instead of dropping it', async () => {
    await cacheStem({ stem: 'known', language: 'en', levelRank: 2 });
    // "coined" is deliberately never cached — it has no KB entry.

    const result = await getWordDifficulties('en', ['known', 'coined']);

    // Every requested word is present, so callers never guess about gaps.
    expect(Object.keys(result).sort()).toEqual(['coined', 'known']);
    expect(result.coined).toEqual({
      levelRank: null,
      difficulty: OOV_DIFFICULTY,
      isFallback: true,
    });
    expect(result.known.isFallback).toBe(false);
  });

  it('is stable: the same input yields the same difficulty every call', async () => {
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });

    const first = await getWordDifficulties('ko', ['학교']);
    const second = await getWordDifficulties('ko', ['학교']);
    expect(first).toEqual(second);
  });

  it('dedupes a stem cached under multiple interface languages', async () => {
    await cacheStem({ stem: '책', language: 'ko', levelRank: 1, interfaceLanguage: 'en' });
    await cacheStem({ stem: '책', language: 'ko', levelRank: 1, interfaceLanguage: 'ko' });

    const result = await getWordDifficulties('ko', ['책']);
    expect(Object.keys(result)).toEqual(['책']);
    expect(result['책'].levelRank).toBe(1);
  });

  it('only matches rows in the requested language', async () => {
    // Same surface string graded in two languages; the request must pick its own.
    await cacheStem({ stem: 'MB', language: 'en', levelRank: 1 });
    await cacheStem({ stem: 'MB', language: 'zh', levelRank: 6 });

    const en = await getWordDifficulties('en', ['MB']);
    expect(en['MB'].levelRank).toBe(1);
  });

  it('returns an empty map for empty or blank input', async () => {
    expect(await getWordDifficulties('ko', [])).toEqual({});
    expect(await getWordDifficulties('ko', ['   ', ''])).toEqual({});
  });
});
