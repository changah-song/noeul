import { useEffect, useState, useCallback } from 'react';
import {
  getAllVocabContexts,
  getAllRelatedKnownWords,
  insertVocabContextIfMissing,
  addRelatedKnownWordForEntry,
  removeRelatedKnownWordForEntry,
  removeData,
  upsertVocabEntryFromCloud,
  viewData,
} from '../services/Database';
import {
  fetchUserVocabContexts,
  fetchUserRelatedKnownWords,
  fetchUserVocab,
  makeUserVocabContextKey,
  makeUserRelatedKnownWordKey,
  makeUserVocabKey,
  softDeleteUserVocabEntry,
  supabase,
  upsertUserVocabContext,
  upsertUserRelatedKnownWord,
  upsertUserVocabEntry,
} from '../services/supabase';

const FILE_TAG = '[useAuth]';

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

const syncVocabFromCloud = async (user) => {
  const [cloudRows, localRows] = await Promise.all([
    fetchUserVocab(user.id, { includeDeleted: true }),
    viewData({ includeDeleted: true }),
  ]);

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
    const cloudRow = cloudByKey.get(key);
    const localRow = localByKey.get(key);

    if (!cloudRow && localRow) {
      if (localRow.deleted_at) {
        continue;
      }

      await upsertUserVocabEntry(user.id, localRow);
      continue;
    }

    if (cloudRow && !localRow) {
      if (!cloudRow.deleted_at) {
        await upsertVocabEntryFromCloud(cloudRow);
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
      await removeData(localRow.word, localRow.hanja, localRow.def, localRow.language ?? 'ko');
      continue;
    }

    if (localDeletedAt && localDeletedAt >= cloudUpdatedAt) {
      await softDeleteUserVocabEntry(user.id, localRow);
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await upsertVocabEntryFromCloud(cloudRow);
      continue;
    }

    await upsertUserVocabEntry(user.id, localRow);
  }
};

const syncVocabContextsFromCloud = async (user) => {
  const [cloudContexts, localContexts, localVocabRows] = await Promise.all([
    fetchUserVocabContexts(user.id, { includeDeleted: true }),
    getAllVocabContexts(),
    viewData(),
  ]);

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
        await upsertUserVocabContext(user.id, localContext);
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
        await insertVocabContextIfMissing(cloudContext);
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
      await insertVocabContextIfMissing(cloudContext);
      continue;
    }

    await upsertUserVocabContext(user.id, localContext);
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

const syncRelatedKnownWordsFromCloud = async (user) => {
  const [cloudRelations, localRelations, localVocabRows] = await Promise.all([
    fetchUserRelatedKnownWords(user.id, { includeDeleted: true }),
    getAllRelatedKnownWords(),
    viewData(),
  ]);
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
        await upsertUserRelatedKnownWord(user.id, localRelation);
      }
      continue;
    }

    if (cloudRelation && !localRelation) {
      if (!cloudRelation.deleted_at) {
        await addRelatedKnownWordForEntry(toLocalRelatedKnownRelation(cloudRelation));
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
      await removeRelatedKnownWordForEntry(toLocalRelatedKnownRelation(cloudRelation));
      continue;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      await addRelatedKnownWordForEntry(toLocalRelatedKnownRelation(cloudRelation));
      continue;
    }

    await upsertUserRelatedKnownWord(user.id, localRelation);
  }
};

const syncUserDataFromCloud = async (user) => {
  await syncVocabFromCloud(user);
  await syncVocabContextsFromCloud(user);
  await syncRelatedKnownWordsFromCloud(user);
};

const useAuth = () => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const bootstrapSession = async () => {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!isMounted) {
          return;
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          await syncUserDataFromCloud(currentSession.user);
        }
      } catch (error) {
        console.warn(`${FILE_TAG} failed to restore session:`, error.message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession?.user) {
        setTimeout(() => {
          syncUserDataFromCloud(nextSession.user).catch((error) => {
            console.warn(`${FILE_TAG} user data sync failed:`, error.message);
          });
        }, 0);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const { data, error } = await supabase.auth.updateUser({
      data: patch,
    });

    if (error) {
      throw error;
    }

    const nextUser = data?.user
      ? {
          ...data.user,
          user_metadata: {
            ...(user?.user_metadata ?? {}),
            ...(data.user.user_metadata ?? {}),
            ...patch,
          },
        }
      : (user
          ? {
              ...user,
              user_metadata: {
                ...(user.user_metadata ?? {}),
                ...patch,
              },
            }
          : null);

    if (nextUser) {
      setUser(nextUser);
      setSession((prev) => (prev ? { ...prev, user: nextUser } : prev));
    }

    return nextUser;
  }, [user]);

  const updateUsername = useCallback(async (username) => {
    const trimmed = username.trim();

    return updateProfile({
      username: trimmed,
      display_name: trimmed,
    });
  }, [updateProfile]);

  return {
    user,
    session,
    loading,
    signOut,
    updateProfile,
    updateUsername,
  };
};

export default useAuth;
