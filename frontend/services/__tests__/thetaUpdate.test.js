/**
 * Tests for `updateThetaFromOutcome` — the persistence half of a level change
 * through the level engine (services/levelEngine.js).
 *
 * Same in-memory-SQLite setup as the other Database tests (jest.config.js
 * moduleNameMapper swaps expo-sqlite for a real in-memory engine), so the REAL
 * `profile_ability` / `dictionary_cache` schema and the REAL upsert SQL run.
 * `hanjaDatabase` is mocked because Database.js loads a binary asset Jest can't
 * bundle.
 *
 * What we lock down here (the math itself is covered in levelEngine.test):
 *  - a correct review raises the stored theta and increments event_count;
 *  - a lapse lowers it;
 *  - a word we know nothing about is skipped (no write, no re-sync churn);
 *  - an unseeded profile gets a behavior-only row created;
 *  - every write clears synced_at so the row re-pushes to the cloud;
 *  - a lookup lowers the level, and every change leaves an ability_log row.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createAbilityLogTable,
  createDictionaryCacheTable,
  createProfileAbilityTable,
  ensureProfileAbilitySeed,
  getAbilityLog,
  getProfileAbility,
  updateThetaFromOutcome,
} from '../Database';
import { seedThetaFromRank } from '../abilityModel';

const { __resetMockDatabases } = SQLite;

const OWNER = 'user-theta';
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

beforeEach(async () => {
  __resetMockDatabases();
  await createProfileAbilityTable();
  await createDictionaryCacheTable();
  await createAbilityLogTable();
});

describe('updateThetaFromOutcome', () => {
  it('raises theta and increments event_count on a correct review', async () => {
    // Seed a mid-level ko profile and grade an easy word correctly.
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });
    const before = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    const next = await updateThetaFromOutcome({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stem: '학교',
      outcome: 1,
    });

    const after = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(next).toBeGreaterThan(before.theta);
    expect(after.theta).toBeCloseTo(next, 10);
    expect(after.event_count).toBe(1);
    // A write clears synced_at so the mutable row re-pushes to the cloud.
    expect(after.synced_at).toBeNull();
  });

  it('lowers theta on a lapse', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 3 });
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });
    const before = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    await updateThetaFromOutcome({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stem: '학교',
      outcome: 0,
    });

    const after = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(after.theta).toBeLessThan(before.theta);
    expect(after.event_count).toBe(1);
  });

  it('takes an explicit difficulty and moves further on a word check than a review', async () => {
    await ensureProfileAbilitySeed({ ownerId: 'check', profileId: PROFILE, language: 'ko', rank: 3 });
    await ensureProfileAbilitySeed({ ownerId: 'review', profileId: PROFILE, language: 'ko', rank: 3 });
    const start = seedThetaFromRank('ko', 3);

    const checked = await updateThetaFromOutcome({
      ownerId: 'check', profileId: PROFILE, language: 'ko', stem: '결막염', difficulty: 2, outcome: 1, signal: 'check',
    });
    const reviewed = await updateThetaFromOutcome({
      ownerId: 'review', profileId: PROFILE, language: 'ko', stem: '결막염', difficulty: 2, outcome: 1, signal: 'review',
    });

    expect(checked).toBeGreaterThan(reviewed);
    expect(reviewed).toBeGreaterThan(start);
  });

  it('skips a word with no graded KB rank (no write, no event_count bump)', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    const before = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    // "미등록" is never cached → OOV fallback → the update self-skips.
    const result = await updateThetaFromOutcome({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stem: '미등록',
      outcome: 1,
    });

    const after = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(result).toBeNull();
    expect(after.theta).toBe(before.theta);
    expect(after.event_count).toBe(0);
  });

  it('creates a behavior-only row for a profile that was never seeded', async () => {
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });

    const next = await updateThetaFromOutcome({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stem: '학교',
      outcome: 1,
    });

    const row = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(row).not.toBeNull();
    expect(row.self_report_rank).toBeNull(); // no self-report anchor
    expect(row.event_count).toBe(1);
    expect(row.theta).toBeCloseTo(next, 10);
  });

  it('accumulates event_count across repeated updates', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });

    await updateThetaFromOutcome({ ownerId: OWNER, profileId: PROFILE, language: 'ko', stem: '학교', outcome: 1 });
    await updateThetaFromOutcome({ ownerId: OWNER, profileId: PROFILE, language: 'ko', stem: '학교', outcome: 1 });
    await updateThetaFromOutcome({ ownerId: OWNER, profileId: PROFILE, language: 'ko', stem: '학교', outcome: 0 });

    const row = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(row.event_count).toBe(3);
  });

  it('lowers the level on a lookup and logs why', async () => {
    await cacheStem({ stem: '소문', levelRank: 3 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 3 });
    const start = seedThetaFromRank('ko', 3);

    const next = await updateThetaFromOutcome({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stem: '소문', word: '소문을', signal: 'lookup',
      sourceBookUri: 'book://gamja',
    });

    expect(next).toBeLessThan(start);
    const [log] = await getAbilityLog({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(log).toMatchObject({
      signal: 'lookup',
      word: '소문을',
      stem: '소문',
      outcome: 1,
      source_book_uri: 'book://gamja',
    });
    expect(log.theta_before).toBeCloseTo(start, 10);
    expect(log.theta_after).toBeCloseTo(next, 10);
    expect(log.var_after).toBeLessThan(log.var_before);
    expect(JSON.parse(log.details)).toMatchObject({ levelRank: 3 });
  });

  it('ignores a non-binary outcome', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });

    const result = await updateThetaFromOutcome({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stem: '학교', outcome: null,
    });

    const row = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(result).toBeNull();
    expect(row.event_count).toBe(0);
  });
});
