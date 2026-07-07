/**
 * Tests for the Phase 2.1 `profile_ability` table (per-profile ability estimate
 * `theta`). See "personalization model implementation plan.md" §2.1.
 *
 * Setup mirrors interactionEvents.test.js: `expo-sqlite` is swapped for a real
 * in-memory SQLite engine (jest.config.js moduleNameMapper), so the REAL schema
 * and REAL SQL — including the `ON CONFLICT ... DO UPDATE ... WHERE` guard that
 * makes seeding cold-only — actually run. `hanjaDatabase` is mocked because
 * Database.js imports it and it loads a binary asset Jest can't bundle.
 *
 * The behaviors worth locking down:
 *  - a fresh profile gets a non-null theta_0 seeded from its self-report rank;
 *  - re-seeding a cold profile with a new rank updates the seed;
 *  - once behavior has moved theta (event_count > 0), seeding never clobbers it;
 *  - the sync bookkeeping (unsynced query + mark-synced) round-trips correctly.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  createProfileAbilityTable,
  ensureProfileAbilitySeed,
  getProfileAbility,
  getUnsyncedProfileAbilities,
  markProfileAbilitiesSynced,
} from '../Database';
import { seedThetaFromRank } from '../abilityModel';

const { __resetMockDatabases } = SQLite;

// Talks to the same in-memory DB Database.js uses (same filename → same engine).
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

// A direct write helper to simulate "behavior has moved theta" without needing
// the (not-yet-built) Phase 3 update path.
const setEventCount = (ownerId, profileId, language, count, theta) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(
        `UPDATE profile_ability SET event_count = ?, theta = ?
         WHERE owner_id = ? AND profile_id = ? AND language = ?`,
        [count, theta, ownerId, profileId, language],
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
});

describe('ensureProfileAbilitySeed', () => {
  const OWNER = 'user-abc';
  const PROFILE = 'ko_default';

  it('seeds a fresh profile with a non-null theta_0 derived from its rank', async () => {
    const returned = await ensureProfileAbilitySeed({
      ownerId: OWNER,
      profileId: PROFILE,
      language: 'ko',
      rank: 2,
    });

    // The helper hands back the seeded theta, and it matches the pure mapping.
    expect(returned).toBe(seedThetaFromRank('ko', 2));

    const row = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(row).not.toBeNull();
    expect(row.theta).toBe(seedThetaFromRank('ko', 2));
    expect(row.self_report_rank).toBe(2);
    expect(row.event_count).toBe(0);
    // A fresh seed is unsynced so the push sync will pick it up.
    expect(row.synced_at).toBeNull();
  });

  it('keeps a single row per (owner, profile, language) across repeated seeds', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 1 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 1 });

    const rows = await queryAll('SELECT * FROM profile_ability');
    expect(rows).toHaveLength(1);
  });

  it('updates the seed when the reported level changes while still cold', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 1 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 3 });

    const row = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(row.self_report_rank).toBe(3);
    expect(row.theta).toBe(seedThetaFromRank('ko', 3));
  });

  it('never clobbers a theta that behavior has already moved (event_count > 0)', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 1 });
    // Simulate Phase 3 having nudged theta from real reviews.
    const warmTheta = 1.75;
    await setEventCount(OWNER, PROFILE, 'ko', 5, warmTheta);

    // A later self-report re-seed must NOT overwrite the behavioral theta.
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 3 });

    const row = await getProfileAbility({ ownerId: OWNER, profileId: PROFILE, language: 'ko' });
    expect(row.theta).toBe(warmTheta);
    expect(row.event_count).toBe(5);
    // The self-report rank stays whatever it was when the row was still cold.
    expect(row.self_report_rank).toBe(1);
  });

  it('scopes rows separately per language for the same owner', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: 'ko_default', language: 'ko', rank: 2 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: 'en_default', language: 'en', rank: 4 });

    const rows = await queryAll('SELECT * FROM profile_ability ORDER BY language');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.language)).toEqual(['en', 'ko']);
  });
});

describe('profile ability sync bookkeeping', () => {
  const OWNER = 'user-sync';

  it('returns unsynced rows for the owner and stops after they are marked synced', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: 'ko_default', language: 'ko', rank: 2 });
    // A different owner's row must not leak into this owner's push.
    await ensureProfileAbilitySeed({ ownerId: 'other', profileId: 'ko_default', language: 'ko', rank: 1 });

    const unsynced = await getUnsyncedProfileAbilities(OWNER);
    expect(unsynced).toHaveLength(1);
    expect(unsynced[0].owner_id).toBe(OWNER);

    const marked = await markProfileAbilitiesSynced(unsynced);
    expect(marked).toBe(1);

    const remaining = await getUnsyncedProfileAbilities(OWNER);
    expect(remaining).toHaveLength(0);
  });

  it('re-marks a row unsynced when it is seeded again (a new local write)', async () => {
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: 'ko_default', language: 'ko', rank: 1 });
    const first = await getUnsyncedProfileAbilities(OWNER);
    await markProfileAbilitiesSynced(first);

    // A cold re-seed with a changed rank is a new write → synced_at cleared again.
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: 'ko_default', language: 'ko', rank: 3 });

    const afterReseed = await getUnsyncedProfileAbilities(OWNER);
    expect(afterReseed).toHaveLength(1);
  });
});
