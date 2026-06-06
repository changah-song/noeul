import {
  getAllVocabContexts,
  getAllRelatedKnownWords,
  insertVocabContextIfMissing,
  addRelatedKnownWordForEntry,
  removeRelatedKnownWordForEntry,
  removeData,
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

const syncVocabFromCloud = async (user, ownerId, generation) => {
  const [cloudRows, localRows] = await Promise.all([
    fetchUserVocab(user.id, { includeDeleted: true }),
    viewData({ ownerId, includeDeleted: true }),
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
        continue;
      }

      assertCanUploadForOwner({ ownerId, user });
      await upsertUserVocabEntry({ user, ownerId, generation, entry: localRow });
      continue;
    }

    if (cloudRow && !localRow) {
      if (!cloudRow.deleted_at) {
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
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await upsertVocabEntryFromCloud(cloudRow, { ownerId });
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    await upsertUserVocabEntry({ user, ownerId, generation, entry: localRow });
  }
};

const syncVocabContextsFromCloud = async (user, ownerId, generation) => {
  const [cloudContexts, localContexts, localVocabRows] = await Promise.all([
    fetchUserVocabContexts(user.id, { includeDeleted: true }),
    getAllVocabContexts({ ownerId }),
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
      continue;
    }

    if (!cloudContext && localContext) {
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

    if (cloudUpdatedAt > localUpdatedAt) {
      await insertVocabContextIfMissing(cloudContext, { ownerId });
      continue;
    }

    assertCanUploadForOwner({ ownerId, user });
    await upsertUserVocabContext({ user, ownerId, generation, context: localContext });
  }
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

const syncRelatedKnownWordsFromCloud = async (user, ownerId, generation) => {
  const [cloudRelations, localRelations, localVocabRows] = await Promise.all([
    fetchUserRelatedKnownWords(user.id, { includeDeleted: true }),
    getAllRelatedKnownWords({ ownerId }),
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
      if (!cloudRelation.deleted_at) {
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

  await syncVocabFromCloud(user, ownerId, generation);
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }

  await syncVocabContextsFromCloud(user, ownerId, generation);
  if (isCloudSyncPaused() || !isCurrentSyncGeneration(generation)) {
    return;
  }

  await syncRelatedKnownWordsFromCloud(user, ownerId, generation);
};
