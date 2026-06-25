import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAllVocabContexts,
  getAllRelatedKnownWords,
  insertVocabContextIfMissing,
  addRelatedKnownWordForEntry,
  removeRelatedKnownWordForEntry,
  removeData,
  softDeleteVocabContextsForWord,
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
import { makeScopedStorageKey } from './localDataScope';

const USER_DATA_SYNC_CURSOR_KEY = 'sync/user-data-cursors-v1';
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

const getCursorStorageKey = (ownerId) => makeScopedStorageKey(ownerId, USER_DATA_SYNC_CURSOR_KEY);

const normalizeCursorTimestamp = (value) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const readSyncCursors = async (ownerId) => {
  try {
    const raw = await AsyncStorage.getItem(getCursorStorageKey(ownerId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[userDataSync] Failed to read sync cursors:', error?.message ?? error);
    return {};
  }
};

const writeSyncCursors = async (ownerId, cursors) => {
  try {
    await AsyncStorage.setItem(getCursorStorageKey(ownerId), JSON.stringify(cursors));
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

const buildNextTableCursors = (
  tableCursors,
  cloudRows,
  localRows,
  { localAppliedRows = [] } = {}
) => ({
  cloud: maxCursorValue(
    tableCursors.cloud,
    ...rowTimestampValues(cloudRows, ['server_updated_at', 'serverUpdatedAt', 'updated_at', 'updatedAt'])
  ),
  local: maxCursorValue(
    tableCursors.local,
    ...rowTimestampValues(localRows),
    ...rowTimestampValues(localAppliedRows)
  ),
});

const persistTableCursors = async (ownerId, cursors, table, tableCursors) => {
  const nextCursors = {
    ...cursors,
    [table]: {
      ...cursors?.[table],
      ...tableCursors,
    },
  };

  await writeSyncCursors(ownerId, nextCursors);
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

const syncVocabFromCloud = async (user, ownerId, generation, tableCursors, cloudRowsOverride = null) => {
  const useDelta = canUseDeltaSync(tableCursors);
  const cloudRowsPromise = cloudRowsOverride
    ? Promise.resolve(cloudRowsOverride)
    : fetchUserVocab(user.id, {
        includeDeleted: true,
        updatedAfter: useDelta ? tableCursors.cloud : null,
      });
  const [cloudRows, localRows] = await Promise.all([
    cloudRowsPromise,
    viewData({
      ownerId,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
  ]);

  if (!shouldContinueSync(generation)) {
    return;
  }

  const cloudByKey = new Map(
    cloudRows.map((row) => [makeUserVocabKey(row), row])
  );
  const localByKey = new Map(
    localRows.map((row) => [makeUserVocabKey({
      language: row.language ?? 'ko',
      word: row.word,
      hanja: row.hanja,
      definition: row.def,
    }), row])
  );
  const allKeys = new Set([...cloudByKey.keys(), ...localByKey.keys()]);

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
      await upsertUserVocabEntry({ user, ownerId, generation, entry: localRow });
      continue;
    }

    if (cloudRow && !localRow) {
      if (cloudRow.deleted_at) {
        await removeData(
          cloudRow.word,
          cloudRow.hanja,
          cloudRow.definition,
          cloudRow.language ?? 'ko',
          { ownerId }
        );
      } else {
        await upsertVocabEntryFromCloud(cloudRow, { ownerId });
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
      await removeData(localRow.word, localRow.hanja, localRow.def, localRow.language ?? 'ko', { ownerId });
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
      await upsertVocabEntryFromCloud(cloudRow, { ownerId });
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    await upsertUserVocabEntry({ user, ownerId, generation, entry: localRow });
  }

  return buildNextTableCursors(tableCursors, cloudRows, localRows, {
    localAppliedRows: cloudRows,
  });
};

const syncVocabContextsFromCloud = async (
  user,
  ownerId,
  generation,
  tableCursors,
  cloudContextsOverride = null
) => {
  const useDelta = canUseDeltaSync(tableCursors);
  const cloudContextsPromise = cloudContextsOverride
    ? Promise.resolve(cloudContextsOverride)
    : fetchUserVocabContexts(user.id, {
        includeDeleted: true,
        updatedAfter: useDelta ? tableCursors.cloud : null,
      });
  const [cloudContexts, localContexts, localVocabRows] = await Promise.all([
    cloudContextsPromise,
    getAllVocabContexts({
      ownerId,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
    viewData({ ownerId }),
  ]);

  if (!shouldContinueSync(generation)) {
    return;
  }

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
  const localByKey = new Map(
    localContexts.map((context) => [makeUserVocabContextKey(context), context])
  );
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
        await softDeleteVocabContextsForWord(
          cloudContext.word,
          cloudContext.hanja,
          cloudContext.definition,
          cloudContext.language ?? 'ko',
          { ownerId }
        );
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
        await insertVocabContextIfMissing(cloudContext, { ownerId });
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
      await insertVocabContextIfMissing(cloudContext, { ownerId });
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    await upsertUserVocabContext({ user, ownerId, generation, context: localContext });
  }

  return buildNextTableCursors(tableCursors, cloudContexts, localContexts, {
    localAppliedRows: cloudContexts,
  });
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
});

const syncRelatedKnownWordsFromCloud = async (
  user,
  ownerId,
  generation,
  tableCursors,
  cloudRelationsOverride = null
) => {
  const useDelta = canUseDeltaSync(tableCursors);
  const cloudRelationsPromise = cloudRelationsOverride
    ? Promise.resolve(cloudRelationsOverride)
    : fetchUserRelatedKnownWords(user.id, {
        includeDeleted: true,
        updatedAfter: useDelta ? tableCursors.cloud : null,
      });
  const [cloudRelations, localRelations, localVocabRows, allLocalVocabRows] = await Promise.all([
    cloudRelationsPromise,
    getAllRelatedKnownWords({
      ownerId,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
    viewData({ ownerId }),
    viewData({
      ownerId,
      includeDeleted: true,
      updatedAfter: useDelta ? tableCursors.local : null,
    }),
  ]);
  if (!shouldContinueSync(generation)) {
    return;
  }
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
          ownerId,
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
          ownerId,
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
        ownerId,
      });
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await addRelatedKnownWordForEntry({
        ...toLocalRelatedKnownRelation(cloudRelation),
        ownerId,
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

  return buildNextTableCursors(tableCursors, cloudRelations, localRelations, {
    localAppliedRows: cloudRelations,
  });
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

  let cursors = await readSyncCursors(ownerId);
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
    ownerId,
    generation,
    tableCursors.vocab,
    pulledCloudRows?.vocab
  );
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }
  if (vocabCursors) {
    cursors = await persistTableCursors(ownerId, cursors, SYNC_TABLES.vocab, vocabCursors);
  }

  const contextCursors = await syncVocabContextsFromCloud(
    user,
    ownerId,
    generation,
    getTableCursors(cursors, SYNC_TABLES.vocabContexts),
    pulledCloudRows?.contexts
  );
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }
  if (contextCursors) {
    cursors = await persistTableCursors(
      ownerId,
      cursors,
      SYNC_TABLES.vocabContexts,
      contextCursors
    );
  }

  const relatedKnownWordCursors = await syncRelatedKnownWordsFromCloud(
    user,
    ownerId,
    generation,
    getTableCursors(cursors, SYNC_TABLES.relatedKnownWords),
    pulledCloudRows?.relatedKnownWords
  );
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }
  if (relatedKnownWordCursors) {
    await persistTableCursors(
      ownerId,
      cursors,
      SYNC_TABLES.relatedKnownWords,
      relatedKnownWordCursors
    );
  }
};
