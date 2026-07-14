/**
 * Tests for Phase 3.1 `updateThetaFromOutcome` — the persistence half of the
 * online ability update. See "personalization model implementation plan.md" §3.1.
 *
 * Same in-memory-SQLite setup as the other Database tests (jest.config.js
 * moduleNameMapper swaps expo-sqlite for a real in-memory engine), so the REAL
 * `profile_ability` / `dictionary_cache` schema and the REAL upsert SQL run.
 * `hanjaDatabase` is mocked because Database.js loads a binary asset Jest can't
 * bundle.
 *
 * What we lock down here (the math itself is covered purely in abilityModel.test):
 *  - a correct review raises the stored theta and increments event_count;
 *  - a lapse lowers it;
 *  - a word with no graded KB rank is skipped (no write, no re-sync churn);
 *  - an unseeded profile gets a behavior-only row created;
 *  - every write clears synced_at so the row re-pushes to the cloud;
 *  - the lookup channel nudges with its (weaker) learning rate.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createDictionaryCacheTable,
  createProfileAbilityTable,
  ensureProfileAbilitySeed,
  getProfileAbility,
  updateThetaFromOutcome,
} from '../Database';
import { LOOKUP_LEARNING_RATE, seedThetaFromRank } from '../abilityModel';

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

  it('ignores the self-report anchor when anchor: false (calibration-quiz path)', async () => {
    // Seed at beginner (theta0 = -3). A correct answer on a HARD word with the
    // anchor on gets dragged back toward the seed; with anchor: false (and an
    // explicit difficulty, as the quiz passes) it takes the full evidence step.
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 1 });
    const before = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });

    const next = await updateThetaFromOutcome({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      stem: '결막염',
      difficulty: 3, // ko band 3 — no dictionary_cache row needed
      outcome: 1,
      learningRate: 0.5,
      anchor: false,
    });

    // Pure evidence step: theta + lr·(1 − sigmoid(theta − d)), no anchor term.
    const expected = before.theta + 0.5 * (1 - 1 / (1 + Math.exp(-(before.theta - 3))));
    expect(next).toBeCloseTo(expected, 10);
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

  it('nudges less on a lookup (weak channel) than on a review', async () => {
    // Two identical cold profiles, same word/outcome; only the learning rate differs.
    await cacheStem({ stem: '학교', language: 'ko', levelRank: 1 });
    await ensureProfileAbilitySeed({ ownerId: 'rev', profileId: PROFILE, language: 'ko', rank: 3 });
    await ensureProfileAbilitySeed({ ownerId: 'look', profileId: PROFILE, language: 'ko', rank: 3 });
    const start = seedThetaFromRank('ko', 3);

    const reviewTheta = await updateThetaFromOutcome({
      ownerId: 'rev', profileId: PROFILE, language: 'ko', stem: '학교', outcome: 0,
    });
    const lookupTheta = await updateThetaFromOutcome({
      ownerId: 'look', profileId: PROFILE, language: 'ko', stem: '학교', outcome: 0,
      learningRate: LOOKUP_LEARNING_RATE,
    });

    // Both drop theta (outcome 0), but the lookup moves it far less from the seed.
    expect(start - lookupTheta).toBeLessThan(start - reviewTheta);
    expect(start - lookupTheta).toBeGreaterThan(0);
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
