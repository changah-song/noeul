/**
 * Tests for the Phase 4.1 `assembleWordFeatures` orchestrator (see "personalization
 * model implementation plan.md" §4.1). Real in-memory SQLite (jest.config.js
 * moduleNameMapper), so the REAL gathering queries against the REAL schemas run.
 * `hanjaDatabase` is mocked (Database.js loads a binary asset Jest can't bundle).
 *
 * The orchestrator's job is to pull the raw rows each feature family needs from
 * their own tables and hand them to the pure assembler. We lock down that each
 * source is wired to the right feature, and that an absent source becomes an
 * explicit absent feature — the batch never fabricates data.
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
  assembleWordFeatures,
  createDictionaryCacheTable,
  createInteractionEventsTable,
  createProfileAbilityTable,
  createTable,
  ensureProfileAbilitySeed,
  logInteractionEvent,
  migrateVocabTable,
} from '../Database';

const { __resetMockDatabases } = SQLite;

const OWNER = 'user-feat';
const PROFILE = 'ko_default';

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, r) => resolve(r), (_, e) => { reject(e); return true; });
    });
  });

const cacheStem = ({ stem, hanja = null, pos = null, levelRank = null, definition = null }) =>
  run(
    `INSERT OR IGNORE INTO dictionary_cache (stem, language, interface_language, hanja, pos, level_rank, definition)
     VALUES (?, 'ko', 'en', ?, ?, ?, ?)`,
    [stem, hanja, pos, levelRank, definition]
  );

const saveVocab = ({ word, hanja = null }) =>
  run(
    `INSERT INTO vocab (owner_id, profile_id, language, word, hanja, stability, difficulty,
       correct_count, wrong_count, last_reviewed_at, next_review_at, updated_at)
     VALUES (?, ?, 'ko', ?, ?, 10, 5, 2, 0, '2026-07-01T00:00:00Z', '2026-07-20T00:00:00Z', '2026-07-01T00:00:00Z')`,
    [OWNER, PROFILE, word, hanja]
  );

beforeEach(async () => {
  __resetMockDatabases();
  await createTable();
  await migrateVocabTable();
  await createDictionaryCacheTable();
  await createProfileAbilityTable();
  await createInteractionEventsTable();
});

describe('assembleWordFeatures', () => {
  it('returns a feature record for every requested stem', async () => {
    await cacheStem({ stem: '학교', hanja: '學校', pos: 'noun', levelRank: 1 });
    const out = await assembleWordFeatures({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교', '미등록'],
    });
    expect(Object.keys(out).sort()).toEqual(['미등록', '학교']);
    // The graded word gets a real KB rank; the uncached one falls back explicitly.
    expect(out['학교'].kb_level_rank).toMatchObject({ present: true, value: 1 });
    expect(out['미등록'].kb_level_rank.present).toBe(false);
    expect(out['미등록'].kb_difficulty).toMatchObject({ present: true, note: 'fallback:oov' });
  });

  it('wires the profile ability row into the user features', async () => {
    await cacheStem({ stem: '학교', levelRank: 1 });
    await ensureProfileAbilitySeed({ ownerId: OWNER, profileId: PROFILE, language: 'ko', rank: 2 });

    const out = await assembleWordFeatures({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교'],
    });
    expect(out['학교'].user_theta.present).toBe(true);
    expect(out['학교'].user_self_report_rank.value).toBe(2);
    expect(out['학교'].user_self_report_weight.value).toBe(1); // event_count 0 → full weight
  });

  it('turns on SRS + explicit-saved features for a saved word only', async () => {
    await cacheStem({ stem: '학교', hanja: '學校', levelRank: 1 });
    await cacheStem({ stem: '커피' });
    await saveVocab({ word: '학교', hanja: '學校' });

    const out = await assembleWordFeatures({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교', '커피'],
    });
    expect(out['학교'].srs_saved.value).toBe(1);
    expect(out['학교'].srs_stability.value).toBe(10);
    expect(out['커피'].srs_saved.value).toBe(0);
    expect(out['커피'].srs_stability).toMatchObject({ present: false, note: 'unsaved' });
  });

  it('aggregates interaction events into lookup / review counts', async () => {
    await cacheStem({ stem: '학교', levelRank: 1 });
    await logInteractionEvent({ ownerId: OWNER, profileId: PROFILE, language: 'ko', word: '학교', stem: '학교', eventType: 'lookup' });
    await logInteractionEvent({ ownerId: OWNER, profileId: PROFILE, language: 'ko', word: '학교', stem: '학교', eventType: 'lookup' });
    await logInteractionEvent({ ownerId: OWNER, profileId: PROFILE, language: 'ko', word: '학교', stem: '학교', eventType: 'review', grade: 3, outcome: 1 });

    const out = await assembleWordFeatures({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학교'],
    });
    expect(out['학교'].explicit_lookup_count.value).toBe(2);
    expect(out['학교'].explicit_review_count.value).toBe(1);
    expect(out['학교'].explicit_last_lookup_decay.present).toBe(true);
  });

  it('computes cross-word hanja overlap from other saved words', async () => {
    // The user knows 學 (from 學校) — a query for 學生 should overlap 0.5.
    await cacheStem({ stem: '학교', hanja: '學校', levelRank: 1 });
    await cacheStem({ stem: '학생', hanja: '學生', levelRank: 1 });
    await saveVocab({ word: '학교', hanja: '學校' });

    const out = await assembleWordFeatures({
      ownerId: OWNER, profileId: PROFILE, language: 'ko', stems: ['학생'],
    });
    // 學 is in the known set (from 學校), 生 is not → 0.5, flagged capped.
    expect(out['학생'].item_cross_hanja_overlap).toMatchObject({ present: true, value: 0.5, note: 'capped:tier4' });
  });

  it('returns an empty map for empty input', async () => {
    expect(await assembleWordFeatures({ ownerId: OWNER, language: 'ko', stems: [] })).toEqual({});
  });
});
