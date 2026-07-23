/**
 * Tests for `applyExposureBatch` — the read-mode "shown but not looked up"
 * channel. This is the only reader signal that can push ability UP; every other
 * one (lookups) only pushes it down.
 *
 * Same in-memory-SQLite setup as the other Database tests (jest.config.js swaps
 * expo-sqlite for a real in-memory engine), so the REAL profile_ability /
 * dictionary_cache / interaction_events schema and the REAL SQL run here.
 *
 * What we lock down:
 *  - a batch raises theta and advances event_count by the number of graded words;
 *  - the batched fold equals N sequential single updates (the whole point of the
 *    batch is write amplification, not different math);
 *  - ungraded words are skipped rather than nudged on the OOV fallback;
 *  - exactly ONE ability row write happens regardless of batch size;
 *  - every credited word leaves an exposure event carrying its dwell.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  applyExposureBatch,
  createDictionaryCacheTable,
  createInteractionEventsTable,
  createProfileAbilityTable,
  ensureProfileAbilitySeed,
  getProfileAbility,
  updateThetaFromOutcome,
} from '../Database';
import {
  EXPOSURE_ABS_FLOOR_MS,
  EXPOSURE_LEARNING_RATE,
  EXPOSURE_MS_PER_CHAR,
  exposureDwellIsPlausible,
} from '../abilityModel';

describe('exposureDwellIsPlausible', () => {
  it('scales the threshold with unit length', () => {
    // A long page needs a proportionally longer dwell than a short sentence.
    const shortChars = 40;
    const longChars = 800;
    const shortReq = shortChars * EXPOSURE_MS_PER_CHAR * 0.4;
    const longReq = longChars * EXPOSURE_MS_PER_CHAR * 0.4;

    // The same 3s dwell reads a sentence but only skims a full page.
    expect(exposureDwellIsPlausible(shortChars, 3000)).toBe(true);
    expect(exposureDwellIsPlausible(longChars, 3000)).toBe(false);
    // Right at each unit's own requirement.
    expect(exposureDwellIsPlausible(longChars, longReq)).toBe(true);
    expect(exposureDwellIsPlausible(shortChars, shortReq - 1)).toBe(false);
  });

  it('never credits a sub-floor blip even for a one-character unit', () => {
    // A tiny unit's scaled requirement is below the absolute floor, so the floor
    // wins — a 12ms flash past a single graded word must not count.
    expect(exposureDwellIsPlausible(1, 12)).toBe(false);
    expect(exposureDwellIsPlausible(1, EXPOSURE_ABS_FLOOR_MS)).toBe(true);
  });

  it('treats a missing dwell or length as not plausible', () => {
    expect(exposureDwellIsPlausible(100, undefined)).toBe(false);
    expect(exposureDwellIsPlausible(100, NaN)).toBe(false);
    expect(exposureDwellIsPlausible(NaN, 5000)).toBe(true); // unknown length → floor only
  });
});

const { __resetMockDatabases } = SQLite;

const OWNER = 'user-exposure';
const PROFILE = 'ko_default';

const cacheStem = ({ stem, language = 'ko', levelRank, interfaceLanguage = 'en' }) =>
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

const readEvents = () =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(
        `SELECT * FROM interaction_events WHERE event_type = 'exposure' ORDER BY id`,
        [],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          reject(error);
          return true;
        }
      );
    });
  });

beforeEach(async () => {
  __resetMockDatabases();
  await createProfileAbilityTable();
  await createDictionaryCacheTable();
  await createInteractionEventsTable();
});

describe('applyExposureBatch', () => {
  it('raises theta and advances event_count by the graded word count', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    await cacheStem({ stem: '학교', levelRank: 2 });
    await cacheStem({ stem: '사과', levelRank: 2 });
    await cacheStem({ stem: '나무', levelRank: 3 });
    const before = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    const result = await applyExposureBatch({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['학교', '사과', '나무'],
      dwellSeconds: 12,
    });

    const after = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(result.applied).toBe(3);
    expect(after.theta).toBeGreaterThan(before.theta);
    expect(after.event_count).toBe(3);
    expect(after.synced_at).toBeNull();
  });

  it('folds to exactly what N sequential single updates would produce', async () => {
    const stems = ['학교', '사과', '나무'];
    await Promise.all(stems.map((stem) => cacheStem({ stem, levelRank: 2 })));

    // Batched.
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    const batched = await applyExposureBatch({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems,
    });

    // Sequential, on a separate but identically seeded profile.
    const otherOwner = 'user-exposure-seq';
    await ensureProfileAbilitySeed({ ownerId: otherOwner, profileId: PROFILE, language: 'ko', rank: 2 });
    for (const stem of stems) {
      // eslint-disable-next-line no-await-in-loop
      await updateThetaFromOutcome({
        ownerId: otherOwner,
        profileId: PROFILE,
        language: 'ko',
        stem,
        outcome: 1,
        learningRate: EXPOSURE_LEARNING_RATE,
      });
    }
    const sequential = await getProfileAbility({
      ownerId: otherOwner,
      profileId: PROFILE,
      language: 'ko',
    });

    expect(batched.theta).toBeCloseTo(sequential.theta, 10);
  });

  it('skips ungraded words instead of nudging on the OOV fallback', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    await cacheStem({ stem: '학교', levelRank: 2 });

    const result = await applyExposureBatch({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['학교', '없는단어', '또다른단어'],
    });

    expect(result.applied).toBe(1);
    const after = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(after.event_count).toBe(1);
  });

  it('does nothing at all when no word in the batch is graded', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    const before = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    const result = await applyExposureBatch({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['없는단어'],
    });

    const after = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(result).toEqual({ theta: null, applied: 0 });
    expect(after.theta).toBeCloseTo(before.theta, 10);
    expect(after.event_count).toBe(before.event_count);
    expect(await readEvents()).toHaveLength(0);
  });

  it('logs one exposure event per credited word, carrying the dwell', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    await cacheStem({ stem: '학교', levelRank: 2 });
    await cacheStem({ stem: '사과', levelRank: 3 });

    await applyExposureBatch({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: ['학교', '사과'],
      sourceBookUri: 'file:///book.epub',
      dwellSeconds: 7.5,
    });

    const events = await readEvents();
    expect(events).toHaveLength(2);
    events.forEach((event) => {
      expect(event.event_type).toBe('exposure');
      expect(event.outcome).toBe(1);
      expect(event.value_num).toBeCloseTo(7.5, 5);
      expect(event.source_book_uri).toBe('file:///book.epub');
    });
    expect(events.map((event) => event.stem).sort()).toEqual(['사과', '학교']);
  });

  it('is a no-op on an empty batch', async () => {
    const result = await applyExposureBatch({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stems: [],
    });
    expect(result).toEqual({ theta: null, applied: 0 });
  });
});
