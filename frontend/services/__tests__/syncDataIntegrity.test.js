/**
 * Data-integrity fixes for saved words and their sync:
 * empty-vs-null hanja duplicates, cloud pulls wiping related known words, sync
 * cursors, profile-id backfill scoping, guest import of learning-signal tables,
 * related-known-word un-mark tombstones, single-context tombstones, and
 * removeData atomicity. Real in-memory SQLite (see test/mocks/expoSqliteMock.js).
 */

jest.mock('../hanjaDatabase', () => ({
  initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

// The real supabase module builds a client at import time (needs env vars).
// Sync only needs its identity-key helpers and network calls, so stub it.
jest.mock('../supabase', () => {
  const norm = (value) => (value == null ? '' : String(value).normalize('NFKC').replace(/\s+/g, ' ').trim());
  return {
    makeUserVocabKey: (entry) => [
      entry.language ?? 'ko', norm(entry.word), norm(entry.hanja), norm(entry.definition ?? entry.def).toLowerCase(),
    ].join('::'),
    makeUserVocabContextKey: (context) => [
      context.language ?? 'ko', norm(context.word), norm(context.hanja),
      norm(context.definition ?? context.def).toLowerCase(),
      norm(context.source_book_uri ?? context.sourceBookUri), norm(context.sentence),
    ].join('::'),
    makeUserRelatedKnownWordKey: (relation) => [
      relation.language ?? 'ko', norm(relation.main_word ?? relation.mainWord),
      norm(relation.main_hanja ?? relation.mainHanja),
      norm(relation.main_definition ?? relation.mainDefinition).toLowerCase(),
      norm(relation.related_word ?? relation.relatedWord ?? relation.korean),
      norm(relation.related_hanja ?? relation.relatedHanja ?? relation.hanja),
    ].join('::'),
    pullUserLearningSync: jest.fn(),
    fetchUserVocab: jest.fn(),
    fetchUserVocabContexts: jest.fn(),
    fetchUserRelatedKnownWords: jest.fn(),
    softDeleteRelatedKnownWordsForMainWord: jest.fn().mockResolvedValue(undefined),
    softDeleteUserRelatedKnownWord: jest.fn().mockResolvedValue(undefined),
    softDeleteUserVocabContextsForWord: jest.fn().mockResolvedValue(undefined),
    softDeleteUserVocabEntry: jest.fn().mockResolvedValue(undefined),
    upsertUserVocabContext: jest.fn().mockResolvedValue(undefined),
    upsertUserRelatedKnownWord: jest.fn().mockResolvedValue(undefined),
    upsertUserVocabEntry: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../interactionEventsCloudSync', () => ({
  pushInteractionEvents: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../profileAbilityCloudSync', () => ({
  pushProfileAbilities: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../localOwnerCoordinator', () => ({
  ...jest.requireActual('../localOwnerCoordinator'),
  assertCanUploadForOwner: jest.fn(),
  isCloudSyncPaused: () => false,
  isCurrentSyncGeneration: () => true,
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {
  addRelatedKnownWord,
  createBookBookmarksTable,
  createBookIndexTable,
  createBookNotesTable,
  createBookPreprocessTables,
  createDictionaryCacheTable,
  createAbilityLogTable,
  createInteractionEventsTable,
  createProfileAbilityTable,
  createTable,
  createVocabContextTable,
  createWordScoresTable,
  dedupeVocabDefinitionKeyRows,
  getAllRelatedKnownWords,
  getRelatedKnownWords,
  getVocabContexts,
  insertData,
  migrateVocabContextTable,
  migrateVocabEmptyHanja,
  migrateVocabTable,
  reassignSqliteUserData,
  recordVocabContext,
  removeData,
  removeRelatedKnownWord,
  replaceDefaultProfileId,
  softDeleteVocabContext,
  upsertVocabEntryFromCloud,
} from '../Database';
import { buildNextTableCursors, syncUserDataFromCloud } from '../userDataSync';
import * as supabaseApi from '../supabase';
import { setRuntimeActiveProfileId } from '../profileScope';
import { setRuntimeTargetLanguage } from '../interfaceLanguage';

const { __resetMockDatabases } = SQLite;
const OWNER = 'user-sync';
const PROFILE = 'ko_default';

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

const liveVocab = (word) => queryAll(
  'SELECT * FROM vocab WHERE owner_id = ? AND word = ? AND deleted_at IS NULL',
  [OWNER, word]
);

beforeEach(async () => {
  __resetMockDatabases();
  await AsyncStorage.clear();
  await createTable();
  await migrateVocabTable();
  await createVocabContextTable();
  await migrateVocabContextTable();
  await createInteractionEventsTable();
  await createProfileAbilityTable();
  await createAbilityLogTable();
  await createWordScoresTable();
  await createDictionaryCacheTable();
  await createBookIndexTable();
  await createBookNotesTable();
  await createBookBookmarksTable();
  await createBookPreprocessTables();
});

describe('empty hanja is stored as NULL and matches the cloud copy (bug 1)', () => {
  it('stores "" hanja as NULL on insert', async () => {
    await insertData('사과', '', 'apple', { ownerId: OWNER, profileId: PROFILE });
    const rows = await liveVocab('사과');
    expect(rows).toHaveLength(1);
    expect(rows[0].hanja).toBeNull();
  });

  it('a cloud pull with hanja null updates the existing row instead of inserting a duplicate', async () => {
    // Legacy row written before the fix, with hanja ''.
    await run(
      `INSERT INTO vocab (owner_id, profile_id, word, hanja, def, def_key, level, updated_at, language)
       VALUES (?, ?, '사과', '', 'apple', 'apple', 'unorganized', '2024-01-01T00:00:00.000Z', 'ko')`,
      [OWNER, PROFILE]
    );

    await upsertVocabEntryFromCloud(
      { word: '사과', hanja: null, definition: 'apple', status: 'good', language: 'ko', updated_at: '2024-02-01T00:00:00.000Z' },
      { ownerId: OWNER, profileId: PROFILE }
    );

    const rows = await liveVocab('사과');
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe('good');
    expect(rows[0].hanja).toBeNull();
  });

  it('a cloud delete with hanja null removes a legacy "" row', async () => {
    await run(
      `INSERT INTO vocab (owner_id, profile_id, word, hanja, def, def_key, level, language)
       VALUES (?, ?, '사과', '', 'apple', 'apple', 'unorganized', 'ko')`,
      [OWNER, PROFILE]
    );

    await removeData('사과', null, 'apple', 'ko', { ownerId: OWNER, profileId: PROFILE });
    expect(await liveVocab('사과')).toHaveLength(0);
  });

  it('the one-off migration nulls "" hanja and dedupe merges the duplicate pair', async () => {
    await run(
      `INSERT INTO vocab (owner_id, profile_id, word, hanja, def, def_key, level, correct_count,
                          related_known_words, created_at, updated_at, language)
       VALUES (?, ?, '사과', '', 'apple', 'apple', 'unorganized', 2,
               '[{"korean":"과일","hanja":"","markedAt":"2024-01-01T00:00:00.000Z"}]',
               '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 'ko')`,
      [OWNER, PROFILE]
    );
    const [original] = await liveVocab('사과');
    await run(
      `INSERT INTO vocab_contexts (owner_id, profile_id, vocab_id, word, hanja, def, def_key, sentence, language)
       VALUES (?, ?, ?, '사과', '', 'apple', 'apple', '사과를 먹었다.', 'ko')`,
      [OWNER, PROFILE, original.id]
    );
    // The duplicate a sync pull created (hanja NULL, no related words, newer).
    await run(
      `INSERT INTO vocab (owner_id, profile_id, word, hanja, def, def_key, level, correct_count,
                          related_known_words, created_at, updated_at, language)
       VALUES (?, ?, '사과', NULL, 'apple', 'apple', 'unorganized', 3, '[]',
               '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z', 'ko')`,
      [OWNER, PROFILE]
    );

    await migrateVocabEmptyHanja();
    await dedupeVocabDefinitionKeyRows();

    const rows = await liveVocab('사과');
    expect(rows).toHaveLength(1);
    expect(rows[0].hanja).toBeNull();
    expect(rows[0].correct_count).toBe(5);
    expect(JSON.parse(rows[0].related_known_words).map((entry) => entry.korean)).toEqual(['과일']);
    expect(await AsyncStorage.getItem('vocab_empty_hanja_migration_v1')).toBe('done');

    // The example sentence follows the surviving row.
    const contexts = await getVocabContexts('사과', null, 'apple', 12, 'ko', { ownerId: OWNER, profileId: PROFILE });
    expect(contexts.map((context) => context.sentence)).toEqual(['사과를 먹었다.']);
    const [context] = await queryAll('SELECT hanja FROM vocab_contexts');
    expect(context.hanja).toBeNull();
  });
});

describe('cloud pull keeps local related known words (bug 2)', () => {
  it('does not wipe related_known_words when the cloud row lacks the field', async () => {
    await insertData('학교', '學校', 'school', {
      ownerId: OWNER,
      profileId: PROFILE,
      relatedKnownWords: [{ korean: '학생', hanja: '學生' }],
    });

    await upsertVocabEntryFromCloud(
      { word: '학교', hanja: '學校', definition: 'school', status: 'good', language: 'ko' },
      { ownerId: OWNER, profileId: PROFILE }
    );

    const [row] = await liveVocab('학교');
    expect(row.level).toBe('good');
    expect(JSON.parse(row.related_known_words)).toEqual([{ korean: '학생', hanja: '學生' }]);
  });

  it('still writes related_known_words when the cloud row carries them', async () => {
    await insertData('학교', '學校', 'school', { ownerId: OWNER, profileId: PROFILE });
    await upsertVocabEntryFromCloud(
      { word: '학교', hanja: '學校', definition: 'school', language: 'ko', related_known_words: [{ korean: '교사' }] },
      { ownerId: OWNER, profileId: PROFILE }
    );
    const [row] = await liveVocab('학교');
    expect(JSON.parse(row.related_known_words)).toEqual([{ korean: '교사' }]);
  });
});

describe('sync cursors (bug 4)', () => {
  it('builds the cloud cursor only from server_updated_at and the local cursor only from local rows', () => {
    const next = buildNextTableCursors(
      { cloud: null, local: null },
      [
        // Client updated_at far in the future must not move the cloud cursor.
        { updated_at: '2030-01-01T00:00:00.000Z', server_updated_at: '2024-03-01T00:00:00.000Z' },
        { updated_at: '2030-01-01T00:00:00.000Z' },
      ],
      [{ updated_at: '2024-02-01T00:00:00.000Z' }]
    );

    expect(next.cloud).toBe('2024-03-01T00:00:00.000Z');
    expect(next.local).toBe('2024-02-01T00:00:00.000Z');
  });

  it('keeps the previous cursors when nothing newer was seen', () => {
    const next = buildNextTableCursors(
      { cloud: '2024-05-01T00:00:00.000Z', local: '2024-05-02T00:00:00.000Z' },
      [{ updated_at: '2024-09-01T00:00:00.000Z' }],
      []
    );
    expect(next).toEqual({ cloud: '2024-05-01T00:00:00.000Z', local: '2024-05-02T00:00:00.000Z' });
  });
});

describe('replaceDefaultProfileId is scoped by owner and language (bug 5)', () => {
  it('only relabels the given owner\'s rows in the given language', async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: 'ko_default', language: 'ko' });
    await insertData('苹果', null, 'apple', { ownerId: OWNER, profileId: 'ko_default', language: 'zh' });
    await insertData('바나나', null, 'banana', { ownerId: 'other-user', profileId: 'ko_default', language: 'ko' });

    await replaceDefaultProfileId('uuid-ko', 'ko', { ownerId: OWNER });

    const rows = await queryAll('SELECT owner_id, word, profile_id FROM vocab ORDER BY id');
    expect(rows).toEqual([
      { owner_id: OWNER, word: '사과', profile_id: 'uuid-ko' },
      { owner_id: OWNER, word: '苹果', profile_id: 'ko_default' },
      { owner_id: 'other-user', word: '바나나', profile_id: 'ko_default' },
    ]);
  });

  it('does not fail when the real profile already has a profile_ability row', async () => {
    await run(
      `INSERT INTO profile_ability (owner_id, profile_id, language, theta, event_count)
       VALUES (?, 'ko_default', 'ko', 0.1, 1), (?, 'uuid-ko', 'ko', 0.5, 9)`,
      [OWNER, OWNER]
    );

    await expect(replaceDefaultProfileId('uuid-ko', 'ko', { ownerId: OWNER })).resolves.toBeUndefined();
    const rows = await queryAll('SELECT profile_id, theta FROM profile_ability WHERE profile_id = ?', ['uuid-ko']);
    expect(rows).toEqual([{ profile_id: 'uuid-ko', theta: 0.5 }]);
  });
});

describe('guest import moves learning-signal tables (bug 6)', () => {
  it('reassigns interaction_events, word_scores and merges profile_ability on its unique key', async () => {
    const guest = 'guest';
    await run(
      `INSERT INTO interaction_events (client_event_id, owner_id, profile_id, language, word, event_type)
       VALUES ('evt-1', ?, 'ko_default', 'ko', '사과', 'lookup')`,
      [guest]
    );
    await run(
      `INSERT INTO word_scores (owner_id, profile_id, language, stem, p_known)
       VALUES (?, 'ko_default', 'ko', '사과', 0.4), (?, 'ko_default', 'ko', '학교', 0.6),
              (?, 'ko_default', 'ko', '학교', 0.9)`,
      [guest, guest, OWNER]
    );
    // Target already has a seeded ability row; the guest's has more evidence.
    await run(
      `INSERT INTO profile_ability (owner_id, profile_id, language, theta, event_count, updated_at)
       VALUES (?, 'ko_default', 'ko', 0.0, 0, '2024-01-01T00:00:00.000Z'),
              (?, 'ko_default', 'ko', 1.5, 40, '2024-02-01T00:00:00.000Z'),
              (?, 'zh_default', 'zh', 0.7, 3, '2024-02-01T00:00:00.000Z')`,
      [OWNER, guest, guest]
    );

    await reassignSqliteUserData(guest, OWNER);

    expect(await queryAll('SELECT owner_id FROM interaction_events')).toEqual([{ owner_id: OWNER }]);
    expect(await queryAll('SELECT COUNT(*) AS n FROM word_scores WHERE owner_id = ?', [guest])).toEqual([{ n: 0 }]);
    expect(await queryAll('SELECT stem, p_known FROM word_scores ORDER BY stem')).toEqual([
      { stem: '사과', p_known: 0.4 },
      { stem: '학교', p_known: 0.9 },
    ]);
    expect(await queryAll('SELECT COUNT(*) AS n FROM profile_ability WHERE owner_id = ?', [guest])).toEqual([{ n: 0 }]);
    expect(await queryAll(
      'SELECT profile_id, theta, event_count FROM profile_ability WHERE owner_id = ? ORDER BY profile_id',
      [OWNER]
    )).toEqual([
      { profile_id: 'ko_default', theta: 1.5, event_count: 40 },
      { profile_id: 'zh_default', theta: 0.7, event_count: 3 },
    ]);
  });
  it('keeps the winning level whole (not just theta) and moves its history', async () => {
    const guest = 'guest';
    await run(
      `INSERT INTO profile_ability (owner_id, profile_id, language, theta, theta_var, lookup_model, guess_yes, guess_total, event_count, updated_at)
       VALUES (?, 'ko_default', 'ko', 0.0, 2.0, 'account-model', 0, 0, 1, '2024-01-01T00:00:00.000Z'),
              (?, 'ko_default', 'ko', 1.5, 0.3, 'guest-model', 4, 10, 40, '2024-02-01T00:00:00.000Z')`,
      [OWNER, guest]
    );
    await run(
      `INSERT INTO ability_log (client_log_id, owner_id, profile_id, language, signal, created_at)
       VALUES ('log-1', ?, 'ko_default', 'ko', 'lookup', '2024-02-01T00:00:00.000Z')`,
      [guest]
    );

    await reassignSqliteUserData(guest, OWNER);

    expect(await queryAll(
      'SELECT theta, theta_var, lookup_model, guess_yes, guess_total FROM profile_ability WHERE owner_id = ?',
      [OWNER]
    )).toEqual([{ theta: 1.5, theta_var: 0.3, lookup_model: 'guest-model', guess_yes: 4, guess_total: 10 }]);
    expect(await queryAll('SELECT owner_id, synced_at FROM ability_log')).toEqual([{ owner_id: OWNER, synced_at: null }]);
  });
});

describe('guest import into an account that already has words', () => {
  it('merges the same word into one row and moves the rest', async () => {
    const guest = 'guest';
    await insertData('사과', '', 'apple', { ownerId: OWNER, profileId: PROFILE });
    await insertData('사과', '', 'apple', { ownerId: guest, profileId: 'ko_default' });
    await insertData('학교', '學校', 'school', { ownerId: guest, profileId: 'ko_default' });
    await run(`UPDATE vocab SET level = 'learned', correct_count = 4 WHERE owner_id = ? AND word = '사과'`, [guest]);

    await reassignSqliteUserData(guest, OWNER);

    expect(await queryAll('SELECT COUNT(*) AS n FROM vocab WHERE owner_id = ?', [guest])).toEqual([{ n: 0 }]);
    const rows = await queryAll('SELECT word, level, correct_count FROM vocab WHERE owner_id = ? ORDER BY word', [OWNER]);
    expect(rows.map((row) => row.word)).toEqual(['사과', '학교']);
    expect(rows[0]).toMatchObject({ level: 'learned', correct_count: 4 });
  });
});

describe('un-marking a related known word leaves a tombstone (bug 7)', () => {
  it('records the un-mark for sync and clears it on re-mark', async () => {
    await insertData('학교', '學校', 'school', { ownerId: OWNER, profileId: PROFILE });
    const scope = { ownerId: OWNER, profileId: PROFILE, mainHanja: '學校', mainDefinition: 'school' };
    await addRelatedKnownWord('학교', { korean: '학생', hanja: '學生' }, scope);
    await removeRelatedKnownWord('학교', { korean: '학생', hanja: '學生' }, 'ko', scope);

    // Screens still see only live entries.
    expect(await getRelatedKnownWords('학교', 'ko', { ownerId: OWNER, profileId: PROFILE })).toEqual([]);
    expect(await getAllRelatedKnownWords({ ownerId: OWNER, profileId: PROFILE })).toEqual([]);

    const withTombstones = await getAllRelatedKnownWords({ ownerId: OWNER, profileId: PROFILE, includeDeleted: true });
    expect(withTombstones).toHaveLength(1);
    expect(withTombstones[0]).toMatchObject({ mainWord: '학교', relatedWord: '학생', relatedHanja: '學生' });
    expect(withTombstones[0].deletedAt).toBeTruthy();

    await addRelatedKnownWord('학교', { korean: '학생', hanja: '學生' }, scope);
    const afterRemark = await getAllRelatedKnownWords({ ownerId: OWNER, profileId: PROFILE, includeDeleted: true });
    expect(afterRemark).toHaveLength(1);
    expect(afterRemark[0].deletedAt).toBeUndefined();
  });
});

describe('a cloud context tombstone deletes only its own sentence (bug 8)', () => {
  const recordSentence = (sentence, sourceBookUri = 'book://a') => recordVocabContext({
    word: '사과',
    hanja: null,
    definition: 'apple',
    sentence,
    sourceBookUri,
    ownerId: OWNER,
    profileId: PROFILE,
    language: 'ko',
  });

  beforeEach(async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: PROFILE });
    await recordSentence('사과를 먹었다.');
    await recordSentence('사과가 빨갛다.');
  });

  const liveSentences = async () => (
    await queryAll('SELECT sentence FROM vocab_contexts WHERE deleted_at IS NULL ORDER BY id')
  ).map((row) => row.sentence);

  it('soft-deletes the matching sentence and leaves the others', async () => {
    const deleted = await softDeleteVocabContext(
      { word: '사과', hanja: null, definition: 'apple', sentence: '사과를  먹었다.', source_book_uri: 'book://a', language: 'ko' },
      { ownerId: OWNER, profileId: PROFILE }
    );
    expect(deleted).toBe(1);
    expect(await liveSentences()).toEqual(['사과가 빨갛다.']);
  });

  it('does nothing when no sentence matches (different source book)', async () => {
    const deleted = await softDeleteVocabContext(
      { word: '사과', hanja: null, definition: 'apple', sentence: '사과를 먹었다.', source_book_uri: 'book://b', language: 'ko' },
      { ownerId: OWNER, profileId: PROFILE }
    );
    expect(deleted).toBe(0);
    expect(await liveSentences()).toEqual(['사과를 먹었다.', '사과가 빨갛다.']);
  });
});

describe('removeData is all-or-nothing (bug 9)', () => {
  it('rolls back the contexts delete when the vocab delete fails', async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: PROFILE });
    await recordVocabContext({
      word: '사과', definition: 'apple', sentence: '사과를 먹었다.', ownerId: OWNER, profileId: PROFILE,
    });
    await run(
      `CREATE TRIGGER fail_vocab_delete BEFORE UPDATE OF deleted_at ON vocab
       BEGIN SELECT RAISE(ABORT, 'boom'); END`
    );

    await expect(removeData('사과', null, 'apple', 'ko', { ownerId: OWNER, profileId: PROFILE }))
      .rejects.toThrow('boom');

    expect(await liveVocab('사과')).toHaveLength(1);
    expect(await queryAll('SELECT deleted_at FROM vocab_contexts')).toEqual([{ deleted_at: null }]);
  });
});

describe('syncUserDataFromCloud', () => {
  const user = { id: OWNER };
  const PROFILE_UUID = 'uuid-ko-profile';
  const pull = (rows) => supabaseApi.pullUserLearningSync.mockResolvedValue({
    vocab: rows.vocab ?? [],
    contexts: rows.contexts ?? [],
    relatedKnownWords: rows.relatedKnownWords ?? [],
  });
  const sync = () => syncUserDataFromCloud({ user, ownerId: OWNER, generation: 1 });

  beforeEach(() => {
    jest.clearAllMocks();
    setRuntimeTargetLanguage('ko');
    setRuntimeActiveProfileId(PROFILE_UUID, 'ko');
  });

  afterAll(() => {
    setRuntimeTargetLanguage('ko');
    setRuntimeActiveProfileId(null, 'ko');
  });

  it('applies only the active language\'s rows and keys cursors by profile (bug 3)', async () => {
    pull({
      vocab: [
        { word: '사과', hanja: null, definition: 'apple', language: 'ko', updated_at: '2024-01-01T00:00:00.000Z', server_updated_at: '2024-01-02T00:00:00.000Z' },
        { word: '苹果', hanja: null, definition: 'apple', language: 'zh', updated_at: '2024-01-01T00:00:00.000Z', server_updated_at: '2024-01-03T00:00:00.000Z' },
      ],
    });

    await sync();

    expect(await queryAll('SELECT word, profile_id, language FROM vocab')).toEqual([
      { word: '사과', profile_id: PROFILE_UUID, language: 'ko' },
    ]);
    const keys = await AsyncStorage.getAllKeys();
    const cursorKey = keys.find((key) => key.includes('user-data-cursors-v2') && key.includes(PROFILE_UUID));
    expect(cursorKey).toBeTruthy();
    const cursors = JSON.parse(await AsyncStorage.getItem(cursorKey));
    // The cloud cursor covers every row the pull returned, including skipped
    // languages (those sync under their own profile's cursors).
    expect(cursors.vocab.cloud).toBe('2024-01-03T00:00:00.000Z');
  });

  it('does not duplicate a word saved with "" hanja when the cloud copy has null (bug 1)', async () => {
    await insertData('사과', '', 'apple', { ownerId: OWNER, profileId: PROFILE_UUID, updatedAt: '2024-01-01T00:00:00.000Z' });
    pull({
      vocab: [{ word: '사과', hanja: null, definition: 'apple', status: 'good', language: 'ko', updated_at: '2024-02-01T00:00:00.000Z' }],
    });

    await sync();

    const rows = await liveVocab('사과');
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe('good');
  });

  it('applies a context tombstone to that one sentence only (bug 8)', async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: PROFILE_UUID });
    for (const sentence of ['사과를 먹었다.', '사과가 빨갛다.']) {
      await recordVocabContext({
        word: '사과', definition: 'apple', sentence, sourceBookUri: 'book://a',
        seenAt: '2024-01-01T00:00:00.000Z', ownerId: OWNER, profileId: PROFILE_UUID,
      });
    }
    await run("UPDATE vocab_contexts SET updated_at = '2024-01-01T00:00:00.000Z'");
    pull({
      contexts: [
        // Tombstone for a sentence this device never had: must be a no-op.
        { word: '사과', hanja: null, definition: 'apple', language: 'ko', sentence: '모르는 문장.', source_book_uri: 'book://a', deleted_at: '2024-03-01T00:00:00.000Z' },
        { word: '사과', hanja: null, definition: 'apple', language: 'ko', sentence: '사과를 먹었다.', source_book_uri: 'book://a', deleted_at: '2024-03-01T00:00:00.000Z', updated_at: '2024-03-01T00:00:00.000Z' },
      ],
    });

    await sync();

    expect((await queryAll('SELECT sentence FROM vocab_contexts WHERE deleted_at IS NULL')).map((row) => row.sentence))
      .toEqual(['사과가 빨갛다.']);
  });

  it('pushes a related-word un-mark instead of resurrecting it from the cloud (bug 7)', async () => {
    await insertData('학교', '學校', 'school', { ownerId: OWNER, profileId: PROFILE_UUID });
    const scope = { ownerId: OWNER, profileId: PROFILE_UUID, mainHanja: '學校', mainDefinition: 'school' };
    await addRelatedKnownWord('학교', { korean: '학생', hanja: '學生', markedAt: '2024-01-01T00:00:00.000Z' }, scope);
    await removeRelatedKnownWord('학교', { korean: '학생', hanja: '學生' }, 'ko', scope);
    pull({
      relatedKnownWords: [{
        language: 'ko', main_word: '학교', main_hanja: '學校', main_definition: 'school',
        related_word: '학생', related_hanja: '學生',
        marked_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
      }],
    });

    await sync();

    expect(await getRelatedKnownWords('학교', 'ko', { ownerId: OWNER, profileId: PROFILE_UUID })).toEqual([]);
    expect(supabaseApi.softDeleteUserRelatedKnownWord).toHaveBeenCalledTimes(1);
    expect(supabaseApi.softDeleteUserRelatedKnownWord.mock.calls[0][0].relation)
      .toMatchObject({ mainWord: '학교', relatedWord: '학생' });
  });
});
