/**
 * Pulled cloud vocab rows carry no profile id, so the local profile they land
 * in comes from the runtime active profile. That id is the placeholder
 * ('ko_default') until AppContext loads the saved settings, and a sync that ran
 * in that window filed every saved word a second time under the placeholder
 * (invisible in the real profile). Real in-memory SQLite.
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
import { resetRuntimeActiveProfileId, setRuntimeActiveProfileId } from '../profileScope';
import { setRuntimeTargetLanguage } from '../interfaceLanguage';

const { __resetMockDatabases } = SQLite;
const OWNER = 'user-sync';
const PROFILE_UUID = '718648b8-973c-45dc-8a45-1812728f50e0';
const PLACEHOLDER = 'ko_default';
const SAVED_AT = '2024-01-01T00:00:00.000Z';

const queryAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    const db = SQLite.openDatabase('fluentfable.db');
    db.transaction((tx) => {
      tx.executeSql(sql, params, (_, r) => resolve(r.rows._array), (_, e) => { reject(e); return true; });
    });
  });

const vocabRows = () => queryAll(
  'SELECT word, profile_id, level, updated_at FROM vocab WHERE owner_id = ? AND deleted_at IS NULL ORDER BY word, profile_id',
  [OWNER]
);

const cloudRow = (overrides = {}) => ({
  word: '사과', hanja: null, definition: 'apple', status: 'unorganized', language: 'ko',
  updated_at: SAVED_AT, server_updated_at: SAVED_AT, ...overrides,
});

beforeEach(async () => {
  __resetMockDatabases();
  await AsyncStorage.clear();
  await createTable();
  await migrateVocabTable();
  await createVocabContextTable();
  await migrateVocabContextTable();
  await createInteractionEventsTable();
  await createProfileAbilityTable();
  await createWordScoresTable();
  await createDictionaryCacheTable();
  await createBookIndexTable();
  await createBookNotesTable();
  await createBookBookmarksTable();
  await createBookPreprocessTables();
  jest.clearAllMocks();
  setRuntimeTargetLanguage('ko');
  setRuntimeActiveProfileId(PROFILE_UUID, 'ko');
});

afterAll(() => {
  setRuntimeActiveProfileId(null, 'ko');
});

describe('upsertVocabEntryFromCloud across profiles', () => {
  it('updates the word saved under the real profile instead of copying it into the placeholder', async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: PROFILE_UUID, updatedAt: SAVED_AT });

    await upsertVocabEntryFromCloud(cloudRow({ status: 'good', updated_at: '2024-02-01T00:00:00.000Z' }), {
      ownerId: OWNER, profileId: PLACEHOLDER,
    });

    expect(await vocabRows()).toEqual([
      { word: '사과', profile_id: PROFILE_UUID, level: 'good', updated_at: '2024-02-01T00:00:00.000Z' },
    ]);
  });

  it('moves a word stranded under the placeholder into the real profile', async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: PLACEHOLDER, updatedAt: SAVED_AT });

    await upsertVocabEntryFromCloud(cloudRow(), { ownerId: OWNER, profileId: PROFILE_UUID });

    expect(await vocabRows()).toEqual([
      { word: '사과', profile_id: PROFILE_UUID, level: 'unorganized', updated_at: SAVED_AT },
    ]);
  });

  it('keeps two real profiles apart', async () => {
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: 'other-real-profile', updatedAt: SAVED_AT });

    await upsertVocabEntryFromCloud(cloudRow(), { ownerId: OWNER, profileId: PROFILE_UUID });

    expect((await vocabRows()).map((row) => row.profile_id).sort())
      .toEqual(['other-real-profile', PROFILE_UUID].sort());
  });

  it('does not match another owner or language', async () => {
    await insertData('사과', null, 'apple', { ownerId: 'someone-else', profileId: PROFILE_UUID, updatedAt: SAVED_AT });

    await upsertVocabEntryFromCloud(cloudRow(), { ownerId: OWNER, profileId: PLACEHOLDER });

    expect(await vocabRows()).toEqual([
      { word: '사과', profile_id: PLACEHOLDER, level: 'unorganized', updated_at: SAVED_AT },
    ]);
    expect(await queryAll('SELECT profile_id FROM vocab WHERE owner_id = ?', ['someone-else']))
      .toEqual([{ profile_id: PROFILE_UUID }]);
  });
});

describe('syncUserDataFromCloud before the active profile is loaded', () => {
  const user = { id: OWNER };
  const sync = () => syncUserDataFromCloud({ user, ownerId: OWNER, generation: 1 });

  it('reproduces the emulator duplicate: a full pull under the placeholder must not copy saved words', async () => {
    // The SQLite file was swapped, so the placeholder profile has no cursors and
    // the pull is a full one returning words already saved under the real profile.
    await insertData('사과', null, 'apple', { ownerId: OWNER, profileId: PROFILE_UUID, updatedAt: SAVED_AT });
    await insertData('학교', '學校', 'school', { ownerId: OWNER, profileId: PROFILE_UUID, updatedAt: SAVED_AT });
    setRuntimeActiveProfileId(null, 'ko');
    supabaseApi.pullUserLearningSync.mockResolvedValue({
      vocab: [cloudRow(), cloudRow({ word: '학교', hanja: '學校', definition: 'school' })],
      contexts: [],
      relatedKnownWords: [],
    });

    await sync();

    expect(await vocabRows()).toEqual([
      { word: '사과', profile_id: PROFILE_UUID, level: 'unorganized', updated_at: SAVED_AT },
      { word: '학교', profile_id: PROFILE_UUID, level: 'unorganized', updated_at: SAVED_AT },
    ]);
  });

  it('pulls nothing until AppContext sets the profile', async () => {
    resetRuntimeActiveProfileId();
    supabaseApi.pullUserLearningSync.mockResolvedValue({ vocab: [cloudRow()], contexts: [], relatedKnownWords: [] });

    await sync();

    expect(supabaseApi.pullUserLearningSync).not.toHaveBeenCalled();
    expect(await vocabRows()).toEqual([]);

    setRuntimeActiveProfileId(PROFILE_UUID, 'ko');
    await sync();

    expect(await vocabRows()).toEqual([
      { word: '사과', profile_id: PROFILE_UUID, level: 'unorganized', updated_at: SAVED_AT },
    ]);
  });
});
