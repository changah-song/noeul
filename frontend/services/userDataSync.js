import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAllVocabContexts,
  getAllRelatedKnownWords,
  insertVocabContextIfMissing,
  addRelatedKnownWordForEntry,
  removeRelatedKnownWordForEntry,
  removeData,
  softDeleteVocabContext,
  upsertVocabEntryFromCloud,
  viewData,
} from './Database';
import {
  fetchUserVocabContexts,
  fetchUserRelatedKnownWords,
  fetchUserVocab,
  makeUserVocabContextKey,
  makeUserRelatedKnownWordKey,
  makeUserVocabKey,
  pullUserLearningSync,
  softDeleteRelatedKnownWordsForMainWord,
  softDeleteUserRelatedKnownWord,
  softDeleteUserVocabContextsForWord,
  softDeleteUserVocabEntry,
  upsertUserVocabContext,
  upsertUserRelatedKnownWord,
  upsertUserVocabEntry,
} from './supabase';
import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { pushInteractionEvents } from './interactionEventsCloudSync';
import { pushProfileAbilities } from './profileAbilityCloudSync';
import { pushAbilityLog } from './abilityLogCloudSync';
import { makeScopedStorageKey } from './localDataScope';
import {
  getDefaultProfileIdForLanguage,
  getRuntimeActiveProfileId,
  isRuntimeActiveProfileLoaded,
} from './profileScope';
import { getRuntimeTargetLanguage } from './interfaceLanguage';
import { normalizeBookLanguage } from '../constants/languages';

// v2: cursors are kept per profile. A profile without v2 cursors (including
// every profile on first run after upgrading from v1) does a full pull, which is
// safe: it re-merges every row by key and timestamp.
const USER_DATA_SYNC_CURSOR_KEY = 'sync/user-data-cursors-v2';
const SYNC_TABLES = {
  vocab: 'vocab',
  vocabContexts: 'vocabContexts',
  relatedKnownWords: 'relatedKnownWords',
};

const getTimestamp = (entry, keys = ['updated_at', 'updatedAt', 'created_at', 'createdAt']) => {
  for (const key of keys) {
    const value = entry?.[key];
    if (!value) {
      continue;
    }

    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return 0;
};

const shouldContinueSync = (generation) => (
  !isCloudSyncPaused() && isCurrentSyncGeneration(generation)
);

const getCursorStorageKey = (ownerId, profileId) => makeScopedStorageKey(
  ownerId,
  `${USER_DATA_SYNC_CURSOR_KEY}/${encodeURIComponent(profileId)}`
);

const rowLanguage = (row) => normalizeBookLanguage(row?.language || 'ko');

// The cloud tables hold every language's words for the user and carry no
// profile id. Local rows live under a profile, and only the active profile's id
// is known here, so a sync applies just the rows in the active profile's
// language. Other languages' rows sync when their profile is active (each
// profile has its own cursors, so nothing is skipped).
const resolveSyncScope = (ownerId) => {
  const language = normalizeBookLanguage(getRuntimeTargetLanguage());
  const profileId = getRuntimeActiveProfileId() || getDefaultProfileIdForLanguage(language);
  return { ownerId, profileId, language };
};

const filterToScopeLanguage = (rows, scope) => (
  (rows ?? []).filter((row) => rowLanguage(row) === scope.language)
);

const normalizeCursorTimestamp = (value) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const readSyncCursors = async (ownerId, profileId) => {
  try {
    const raw = await AsyncStorage.getItem(getCursorStorageKey(ownerId, profileId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[userDataSync] Failed to read sync cursors:', error?.message ?? error);
    return {};
  }
};

const writeSyncCursors = async (ownerId, profileId, cursors) => {
  try {
    await AsyncStorage.setItem(getCursorStorageKey(ownerId, profileId), JSON.stringify(cursors));
  } catch (error) {
    console.warn('[userDataSync] Failed to persist sync cursors:', error?.message ?? error);
  }
};

const getTableCursors = (cursors, table) => ({
  cloud: normalizeCursorTimestamp(cursors?.[table]?.cloud),
  local: normalizeCursorTimestamp(cursors?.[table]?.local),
});

const canUseDeltaSync = (tableCursors) => Boolean(tableCursors.cloud && tableCursors.local);

const maxCursorValue = (...values) => {
  let maxTimestamp = 0;

  values.forEach((value) => {
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp) && timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  });

  return maxTimestamp > 0 ? new Date(maxTimestamp).toISOString() : null;
};

const rowTimestampValues = (rows, keys = ['updated_at', 'updatedAt']) => (
  (rows ?? []).flatMap((row) => keys.map((key) => row?.[key]).filter(Boolean))
);

// The cloud cursor is compared against the server's server_updated_at, so it is
// built only from that column (a client updated_at can be skewed or older than
// the server write and would make the next delta skip rows). The local cursor is
// compared against local updated_at, so it is built only from the local rows
// read for this pass; folding in cloud rows' timestamps could jump it past local
// edits that haven't been uploaded yet.
export const buildNextTableCursors = (tableCursors, cloudRows, localRows) => ({
  cloud: maxCursorValue(
    tableCursors.cloud,
    ...rowTimestampValues(cloudRows, ['server_updated_at', 'serverUpdatedAt'])
  ),
  local: maxCursorValue(
    tableCursors.local,
    ...rowTimestampValues(localRows)
  ),
});

const persistTableCursors = async (scope, cursors, table, tableCursors) => {
  const nextCursors = {
    ...cursors,
    [table]: {
      ...cursors?.[table],
      ...tableCursors,
    },
  };

  await writeSyncCursors(scope.ownerId, scope.profileId, nextCursors);
  return nextCursors;
};

const toVocabEntryIdentity = (entry) => ({
  language: entry.language ?? 'ko',
  word: entry.word ?? entry.main_word ?? entry.mainWord,
  hanja: entry.hanja ?? entry.main_hanja ?? entry.mainHanja ?? null,
  definition: entry.def ?? entry.definition ?? entry.main_definition ?? entry.mainDefinition ?? null,
});

const softDeleteCloudRelatedKnownWordsForEntry = async ({ user, ownerId, generation, entry }) => {
  await softDeleteRelatedKnownWordsForMainWord({
    user,
    ownerId,
    generation,
    entry: toVocabEntryIdentity(entry),
  });
};

const syncVocabFromCloud = async (user, scope, generation, tableCursors, cloudRowsOverride = null) => {
  const { ownerId, profileId, language } = scope;
  const useDelta = canUseDeltaSync(tableCursors);
  const cloudRowsPromise = cloudRowsOverride
    ? Promise.resolve(cloudRowsOverride)
    : fetchUserVocab(user.id, {
        includeDeleted: true,
        updatedAfter: useDelta ? tableCursors.cloud : null,
      });
  const [allCloudRows, localRows] = await Promise.all([
    cloudRowsPromise,
    viewData({
      ownerId,
      profileId,
      language,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
  ]);

  if (!shouldContinueSync(generation)) {
    return;
  }

  const cloudRows = filterToScopeLanguage(allCloudRows, scope);

  const cloudByKey = new Map(
    cloudRows.map((row) => [makeUserVocabKey(row), row])
  );
  const localByKey = new Map();
  localRows.forEach((row) => {
    const key = makeUserVocabKey({
      language: row.language ?? 'ko',
      word: row.word,
      hanja: row.hanja,
      definition: row.def,
    });
    // A word deleted and saved again leaves a deleted and a live row under one
    // key; the live row is the one to sync.
    const existing = localByKey.get(key);
    if (!existing || (existing.deleted_at && !row.deleted_at)) {
      localByKey.set(key, row);
    }
  });
  const allKeys = new Set([...cloudByKey.keys(), ...localByKey.keys()]);
  const dbScope = { ownerId, profileId };

  for (const key of allKeys) {
    if (!shouldContinueSync(generation)) {
      return;
    }

    const cloudRow = cloudByKey.get(key);
    const localRow = localByKey.get(key);

    if (!cloudRow && localRow) {
      if (localRow.deleted_at) {
        if (useDelta) {
          assertCanUploadForOwner({ ownerId, user });
          await softDeleteUserVocabEntry({ user, ownerId, generation, entry: localRow });
          await softDeleteCloudRelatedKnownWordsForEntry({
            user,
            ownerId,
            generation,
            entry: localRow,
          });
        }
        continue;
      }

      assertCanUploadForOwner({ ownerId, user });
      // One word the server refuses must not stop the rest of the pass (and,
      // since the pass then never finishes, every later sync).
      try {
        await upsertUserVocabEntry({ user, ownerId, generation, entry: localRow });
      } catch (error) {
        console.warn('[userDataSync] Skipped a word the cloud refused:', localRow.word, error?.message ?? error);
      }
      continue;
    }

    if (cloudRow && !localRow) {
      if (cloudRow.deleted_at) {
        await removeData(
          cloudRow.word,
          cloudRow.hanja,
          cloudRow.definition,
          cloudRow.language ?? 'ko',
          dbScope
        );
      } else {
        await upsertVocabEntryFromCloud(cloudRow, dbScope);
      }
      continue;
    }

    if (!cloudRow || !localRow) {
      continue;
    }

    const cloudUpdatedAt = getTimestamp(cloudRow);
    const localUpdatedAt = getTimestamp(localRow);
    const cloudDeletedAt = getTimestamp(cloudRow, ['deleted_at']);
    const localDeletedAt = getTimestamp(localRow, ['deleted_at']);

    if (cloudDeletedAt && cloudDeletedAt >= localUpdatedAt) {
      await removeData(localRow.word, localRow.hanja, localRow.def, localRow.language ?? 'ko', dbScope);
      continue;
    }

    if (localDeletedAt && localDeletedAt >= cloudUpdatedAt) {
      assertCanUploadForOwner({ ownerId, user });
      await softDeleteUserVocabEntry({ user, ownerId, generation, entry: localRow });
      if (useDelta) {
        await softDeleteCloudRelatedKnownWordsForEntry({
          user,
          ownerId,
          generation,
          entry: localRow,
        });
      }
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await upsertVocabEntryFromCloud(cloudRow, dbScope);
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    try {
      await upsertUserVocabEntry({ user, ownerId, generation, entry: localRow });
    } catch (error) {
      console.warn('[userDataSync] Skipped a word the cloud refused:', localRow.word, error?.message ?? error);
    }
  }

  return buildNextTableCursors(tableCursors, allCloudRows, localRows);
};

const syncVocabContextsFromCloud = async (
  user,
  scope,
  generation,
  tableCursors,
  cloudContextsOverride = null
) => {
  const { ownerId, profileId, language } = scope;
  const dbScope = { ownerId, profileId };
  const useDelta = canUseDeltaSync(tableCursors);
  const cloudContextsPromise = cloudContextsOverride
    ? Promise.resolve(cloudContextsOverride)
    : fetchUserVocabContexts(user.id, {
        includeDeleted: true,
        updatedAfter: useDelta ? tableCursors.cloud : null,
      });
  const [allCloudContexts, localContexts, localVocabRows] = await Promise.all([
    cloudContextsPromise,
    getAllVocabContexts({
      ownerId,
      profileId,
      language,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
    viewData({ ownerId, profileId, language }),
  ]);

  if (!shouldContinueSync(generation)) {
    return;
  }

  const cloudContexts = filterToScopeLanguage(allCloudContexts, scope);
  const localVocabKeys = new Set(
    localVocabRows.map((row) => makeUserVocabKey({
      language: row.language ?? 'ko',
      word: row.word,
      hanja: row.hanja,
      definition: row.def,
    }))
  );
  const cloudByKey = new Map(
    cloudContexts.map((context) => [makeUserVocabContextKey(context), context])
  );
  const localByKey = new Map();
  localContexts.forEach((context) => {
    const key = makeUserVocabContextKey(context);
    const existing = localByKey.get(key);
    if (!existing || (existing.deleted_at && !context.deleted_at)) {
      localByKey.set(key, context);
    }
  });
  const allKeys = new Set([...cloudByKey.keys(), ...localByKey.keys()]);

  for (const key of allKeys) {
    if (!shouldContinueSync(generation)) {
      return;
    }

    const cloudContext = cloudByKey.get(key);
    const localContext = localByKey.get(key);

    if (cloudContext?.deleted_at || cloudContext?.deletedAt) {
      const cloudDeletedAt = getTimestamp(cloudContext, ['deleted_at', 'deletedAt']);
      const localUpdatedAt = Math.max(
        getTimestamp(localContext, ['updated_at', 'updatedAt']),
        getTimestamp(localContext, ['seen_at', 'seenAt'])
      );
      const localDeletedAt = getTimestamp(localContext, ['deleted_at', 'deletedAt']);

      if (!localContext || cloudDeletedAt >= localUpdatedAt) {
        // The tombstone is for one sentence: delete only the local context with
        // the same sentence and source book (a no-op when there is none), never
        // the word's other sentences. With delta sync the matching local row may
        // simply be older than the local cursor, so look it up in the DB.
        await softDeleteVocabContext(cloudContext, dbScope);
        continue;
      }

      if (localDeletedAt) {
        assertCanUploadForOwner({ ownerId, user });
        await softDeleteUserVocabContextsForWord({
          user,
          ownerId,
          generation,
          entry: {
            language: localContext.language ?? 'ko',
            word: localContext.word,
            hanja: localContext.hanja,
            definition: localContext.def ?? localContext.definition,
          },
        });
        continue;
      }

      assertCanUploadForOwner({ ownerId, user });
      await upsertUserVocabContext({ user, ownerId, generation, context: localContext });
      continue;
    }

    if (!cloudContext && localContext) {
      if (localContext.deleted_at || localContext.deletedAt) {
        if (useDelta) {
          assertCanUploadForOwner({ ownerId, user });
          await softDeleteUserVocabContextsForWord({
            user,
            ownerId,
            generation,
            entry: {
              language: localContext.language ?? 'ko',
              word: localContext.word,
              hanja: localContext.hanja,
              definition: localContext.def ?? localContext.definition,
            },
          });
        }
        continue;
      }

      const vocabKey = makeUserVocabKey({
        language: localContext.language ?? 'ko',
        word: localContext.word,
        hanja: localContext.hanja,
        definition: localContext.def ?? localContext.definition,
      });

      if (localVocabKeys.has(vocabKey)) {
        assertCanUploadForOwner({ ownerId, user });
        await upsertUserVocabContext({ user, ownerId, generation, context: localContext });
      }
      continue;
    }

    if (cloudContext && !localContext) {
      const vocabKey = makeUserVocabKey({
        language: cloudContext.language ?? 'ko',
        word: cloudContext.word,
        hanja: cloudContext.hanja,
        definition: cloudContext.definition,
      });

      if (localVocabKeys.has(vocabKey)) {
        await insertVocabContextIfMissing(cloudContext, dbScope);
      }
      continue;
    }

    if (!cloudContext || !localContext) {
      continue;
    }

    const cloudUpdatedAt = Math.max(
      getTimestamp(cloudContext, ['updated_at', 'updatedAt']),
      getTimestamp(cloudContext, ['seen_at', 'seenAt'])
    );
    const localUpdatedAt = Math.max(
      getTimestamp(localContext, ['updated_at', 'updatedAt']),
      getTimestamp(localContext, ['seen_at', 'seenAt'])
    );
    const localDeletedAt = getTimestamp(localContext, ['deleted_at', 'deletedAt']);

    if (localDeletedAt && localDeletedAt >= cloudUpdatedAt) {
      assertCanUploadForOwner({ ownerId, user });
      await softDeleteUserVocabContextsForWord({
        user,
        ownerId,
        generation,
        entry: {
          language: localContext.language ?? 'ko',
          word: localContext.word,
          hanja: localContext.hanja,
          definition: localContext.def ?? localContext.definition,
        },
      });
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await insertVocabContextIfMissing(cloudContext, dbScope);
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    await upsertUserVocabContext({ user, ownerId, generation, context: localContext });
  }

  return buildNextTableCursors(tableCursors, allCloudContexts, localContexts);
};

const toLocalRelatedKnownRelation = (relation) => ({
  language: relation.language ?? 'ko',
  mainWord: relation.main_word ?? relation.mainWord,
  mainHanja: relation.main_hanja ?? relation.mainHanja ?? null,
  mainDefinition: relation.main_definition ?? relation.mainDefinition ?? null,
  relatedWord: relation.related_word ?? relation.relatedWord ?? relation.korean,
  relatedHanja: relation.related_hanja ?? relation.relatedHanja ?? relation.hanja ?? null,
  relatedDefinition: relation.related_definition ?? relation.relatedDefinition ?? relation.meaning ?? null,
  sourceHanja: relation.source_hanja ?? relation.sourceHanja ?? null,
  markedAt: relation.marked_at ?? relation.markedAt ?? new Date().toISOString(),
  updatedAt: relation.updated_at ?? relation.updatedAt ?? relation.marked_at ?? relation.markedAt,
  deletedAt: relation.deleted_at ?? relation.deletedAt ?? null,
});

const syncRelatedKnownWordsFromCloud = async (
  user,
  scope,
  generation,
  tableCursors,
  cloudRelationsOverride = null
) => {
  const { ownerId, profileId, language } = scope;
  const useDelta = canUseDeltaSync(tableCursors);
  const cloudRelationsPromise = cloudRelationsOverride
    ? Promise.resolve(cloudRelationsOverride)
    : fetchUserRelatedKnownWords(user.id, {
        includeDeleted: true,
        updatedAfter: useDelta ? tableCursors.cloud : null,
      });
  const [allCloudRelations, localRelations, localVocabRows, allLocalVocabRows] = await Promise.all([
    cloudRelationsPromise,
    // includeDeleted: un-mark tombstones come back as relations with deletedAt.
    getAllRelatedKnownWords({
      ownerId,
      profileId,
      language,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
    viewData({ ownerId, profileId, language }),
    viewData({
      ownerId,
      profileId,
      language,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
  ]);
  if (!shouldContinueSync(generation)) {
    return;
  }
  const cloudRelations = filterToScopeLanguage(allCloudRelations, scope);
  const localRelationScope = { ownerId, profileId };
  const localVocabKeys = new Set(
    localVocabRows.map((row) => makeUserVocabKey({
      language: row.language ?? 'ko',
      word: row.word,
      hanja: row.hanja,
      definition: row.def,
    }))
  );
  const deletedLocalVocabByKey = new Map(
    allLocalVocabRows
      .filter((row) => row.deleted_at || row.deletedAt)
      .map((row) => [makeUserVocabKey({
        language: row.language ?? 'ko',
        word: row.word,
        hanja: row.hanja,
        definition: row.def,
      }), row])
  );
  const cloudByKey = new Map(
    cloudRelations.map((relation) => [makeUserRelatedKnownWordKey(relation), relation])
  );
  const localByKey = new Map(
    localRelations.map((relation) => [makeUserRelatedKnownWordKey(relation), relation])
  );
  const allKeys = new Set([...cloudByKey.keys(), ...localByKey.keys()]);

  for (const key of allKeys) {
    if (!shouldContinueSync(generation)) {
      return;
    }

    const cloudRelation = cloudByKey.get(key);
    const localRelation = localByKey.get(key);
    const localDeletedAt = getTimestamp(localRelation, ['deletedAt', 'deleted_at']);

    if (localRelation && localDeletedAt) {
      // Local un-mark tombstone.
      const cloudDeleted = Boolean(cloudRelation?.deleted_at || cloudRelation?.deletedAt);
      if (cloudDeleted) {
        continue;
      }

      if (cloudRelation) {
        const cloudUpdatedAt = Math.max(
          getTimestamp(cloudRelation, ['updated_at', 'updatedAt']),
          getTimestamp(cloudRelation, ['marked_at', 'markedAt'])
        );

        if (cloudUpdatedAt > localDeletedAt) {
          // Re-marked on another device after the local un-mark.
          await addRelatedKnownWordForEntry({
            ...toLocalRelatedKnownRelation(cloudRelation),
            ...localRelationScope,
          });
          continue;
        }
      } else if (!useDelta) {
        // Full sync with no cloud row: nothing to delete remotely.
        continue;
      }

      assertCanUploadForOwner({ ownerId, user });
      await softDeleteUserRelatedKnownWord({ user, ownerId, generation, relation: localRelation });
      continue;
    }

    if (!cloudRelation && localRelation) {
      const vocabKey = makeUserVocabKey({
        language: localRelation.language ?? 'ko',
        word: localRelation.mainWord,
        hanja: localRelation.mainHanja,
        definition: localRelation.mainDefinition,
      });

      if (localVocabKeys.has(vocabKey)) {
        assertCanUploadForOwner({ ownerId, user });
        await upsertUserRelatedKnownWord({ user, ownerId, generation, relation: localRelation });
      }
      continue;
    }

    if (cloudRelation && !localRelation) {
      if (cloudRelation.deleted_at || cloudRelation.deletedAt) {
        await removeRelatedKnownWordForEntry({
          ...toLocalRelatedKnownRelation(cloudRelation),
          ...localRelationScope,
        });
      } else {
        const vocabKey = makeUserVocabKey({
          language: cloudRelation.language ?? 'ko',
          word: cloudRelation.main_word ?? cloudRelation.mainWord,
          hanja: cloudRelation.main_hanja ?? cloudRelation.mainHanja,
          definition: cloudRelation.main_definition ?? cloudRelation.mainDefinition,
        });
        const deletedLocalVocab = deletedLocalVocabByKey.get(vocabKey);
        const localDeletedAt = getTimestamp(deletedLocalVocab, ['deleted_at', 'deletedAt']);
        const cloudUpdatedAt = Math.max(
          getTimestamp(cloudRelation, ['updated_at', 'updatedAt']),
          getTimestamp(cloudRelation, ['marked_at', 'markedAt'])
        );

        if (deletedLocalVocab && localDeletedAt >= cloudUpdatedAt) {
          assertCanUploadForOwner({ ownerId, user });
          await softDeleteRelatedKnownWordsForMainWord({
            user,
            ownerId,
            generation,
            entry: {
              language: cloudRelation.language ?? 'ko',
              word: cloudRelation.main_word ?? cloudRelation.mainWord,
              hanja: cloudRelation.main_hanja ?? cloudRelation.mainHanja,
              definition: cloudRelation.main_definition ?? cloudRelation.mainDefinition,
            },
          });
          continue;
        }

        await addRelatedKnownWordForEntry({
          ...toLocalRelatedKnownRelation(cloudRelation),
          ...localRelationScope,
        });
      }
      continue;
    }

    if (!cloudRelation || !localRelation) {
      continue;
    }

    const cloudUpdatedAt = Math.max(
      getTimestamp(cloudRelation, ['updated_at', 'updatedAt']),
      getTimestamp(cloudRelation, ['marked_at', 'markedAt'])
    );
    const localUpdatedAt = Math.max(
      getTimestamp(localRelation, ['updated_at', 'updatedAt']),
      getTimestamp(localRelation, ['marked_at', 'markedAt'])
    );
    const cloudDeletedAt = getTimestamp(cloudRelation, ['deleted_at', 'deletedAt']);

    if (cloudDeletedAt && cloudDeletedAt >= localUpdatedAt) {
      await removeRelatedKnownWordForEntry({
        ...toLocalRelatedKnownRelation(cloudRelation),
        ...localRelationScope,
      });
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await addRelatedKnownWordForEntry({
        ...toLocalRelatedKnownRelation(cloudRelation),
        ...localRelationScope,
      });
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    await upsertUserRelatedKnownWord({ user, ownerId, generation, relation: localRelation });
  }

  if (useDelta) {
    const deletedLocalVocabRows = allLocalVocabRows.filter((row) => row.deleted_at || row.deletedAt);
    for (const deletedLocalVocab of deletedLocalVocabRows) {
      if (!shouldContinueSync(generation)) {
        return null;
      }

      assertCanUploadForOwner({ ownerId, user });
      await softDeleteCloudRelatedKnownWordsForEntry({
        user,
        ownerId,
        generation,
        entry: deletedLocalVocab,
      });
    }
  }

  return buildNextTableCursors(tableCursors, allCloudRelations, localRelations);
};

export const syncUserDataFromCloud = async ({ user, ownerId, generation }) => {
  if (!user?.id) {
    return;
  }

  if (isCloudSyncPaused()) {
    return;
  }

  if (!isCurrentSyncGeneration(generation)) {
    return;
  }

  if (ownerId !== user.id) {
    throw new Error('Refusing user-data sync for mismatched owner');
  }

  // Cloud rows carry no profile id, so they land in the active profile. Until
  // AppContext has loaded it, that would be the placeholder ('ko_default'),
  // filing every pulled word under a profile the user isn't looking at.
  // AppContext requests a sync once the profile is loaded.
  if (!isRuntimeActiveProfileLoaded()) {
    return;
  }

  // Capture the profile (and its language) once, so a profile switch mid-sync
  // can't send the rest of this pass's rows or cursors to the new profile.
  const scope = resolveSyncScope(ownerId);
  let cursors = await readSyncCursors(ownerId, scope.profileId);
  const tableCursors = {
    vocab: getTableCursors(cursors, SYNC_TABLES.vocab),
    vocabContexts: getTableCursors(cursors, SYNC_TABLES.vocabContexts),
    relatedKnownWords: getTableCursors(cursors, SYNC_TABLES.relatedKnownWords),
  };
  let pulledCloudRows = null;

  try {
    pulledCloudRows = await pullUserLearningSync({
      vocabUpdatedAfter: canUseDeltaSync(tableCursors.vocab) ? tableCursors.vocab.cloud : null,
      contextsUpdatedAfter: canUseDeltaSync(tableCursors.vocabContexts)
        ? tableCursors.vocabContexts.cloud
        : null,
      relatedUpdatedAfter: canUseDeltaSync(tableCursors.relatedKnownWords)
        ? tableCursors.relatedKnownWords.cloud
        : null,
    });
  } catch (error) {
    console.warn('[userDataSync] Falling back to table sync fetches:', error?.message ?? error);
  }

  const vocabCursors = await syncVocabFromCloud(
    user,
    scope,
    generation,
    tableCursors.vocab,
    pulledCloudRows?.vocab
  );
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }
  if (vocabCursors) {
    cursors = await persistTableCursors(scope, cursors, SYNC_TABLES.vocab, vocabCursors);
  }

  const contextCursors = await syncVocabContextsFromCloud(
    user,
    scope,
    generation,
    getTableCursors(cursors, SYNC_TABLES.vocabContexts),
    pulledCloudRows?.contexts
  );
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }
  if (contextCursors) {
    cursors = await persistTableCursors(
      scope,
      cursors,
      SYNC_TABLES.vocabContexts,
      contextCursors
    );
  }

  const relatedKnownWordCursors = await syncRelatedKnownWordsFromCloud(
    user,
    scope,
    generation,
    getTableCursors(cursors, SYNC_TABLES.relatedKnownWords),
    pulledCloudRows?.relatedKnownWords
  );
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }
  if (relatedKnownWordCursors) {
    await persistTableCursors(
      scope,
      cursors,
      SYNC_TABLES.relatedKnownWords,
      relatedKnownWordCursors
    );
  }

  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }

  // Push-only mirror of the append-only interaction event log. Non-fatal: a
  // failure here must not abort or roll back the vocab sync above.
  try {
    await pushInteractionEvents({ user, ownerId, generation });
  } catch (error) {
    console.warn('[userDataSync] Interaction events push failed:', error?.message ?? error);
  }

  // Push-only mirror of the per-profile ability estimate (theta). Non-fatal for
  // the same reason.
  try {
    await pushProfileAbilities({ user, ownerId, generation });
  } catch (error) {
    console.warn('[userDataSync] Profile ability push failed:', error?.message ?? error);
  }

  // Push-only mirror of the ability log (why the level moved), for the admin
  // dashboard. Non-fatal for the same reason.
  try {
    await pushAbilityLog({ user, ownerId, generation });
  } catch (error) {
    console.warn('[userDataSync] Ability log push failed:', error?.message ?? error);
  }
};
