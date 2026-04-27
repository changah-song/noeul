import { useEffect, useState, useCallback } from 'react';
import { insertDataIfMissing, viewData } from '../services/Database';
import { fetchUserVocab, supabase, upsertUserVocabEntries } from '../services/supabase';

const FILE_TAG = '[useAuth]';

const makeVocabKey = (word, hanja, definition) => `${word}::${hanja ?? ''}::${definition ?? ''}`;

const syncVocabFromCloud = async (user) => {
  console.log(`${FILE_TAG} syncing vocab for user ${user.id}`);

  const [cloudRows, localRows] = await Promise.all([
    fetchUserVocab(user.id),
    viewData(),
  ]);

  const cloudKeys = new Set(
    cloudRows.map((row) => makeVocabKey(row.word, row.hanja, row.definition))
  );

  let pulledCount = 0;
  for (const row of cloudRows) {
    const inserted = await insertDataIfMissing(
      row.word,
      row.hanja,
      row.definition,
      row.status ?? 'unorganized'
    );

    if (inserted) {
      pulledCount += 1;
    }
  }

  const localOnlyRows = localRows.filter(
    (row) => !cloudKeys.has(makeVocabKey(row.word, row.hanja, row.def))
  );

  if (localOnlyRows.length > 0) {
    await upsertUserVocabEntries(
      user.id,
      localOnlyRows.map((row) => ({
        word: row.word,
        hanja: row.hanja,
        definition: row.def,
        level: row.level,
      }))
    );
  }

  console.log(
    `${FILE_TAG} vocab sync complete -> pulled=${pulledCount} pushed=${localOnlyRows.length} cloud=${cloudRows.length} local=${localRows.length}`
  );
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
          await syncVocabFromCloud(currentSession.user);
        }
      } catch (error) {
        console.log(`${FILE_TAG} failed to restore session:`, error.message);
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
      console.log(`${FILE_TAG} auth state changed -> ${event}`);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession?.user) {
        setTimeout(() => {
          syncVocabFromCloud(nextSession.user).catch((error) => {
            console.log(`${FILE_TAG} vocab sync failed:`, error.message);
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
    console.log(`${FILE_TAG} updateProfile start`, {
      patchKeys: Object.keys(patch || {}),
      hasUser: !!user?.id,
      userId: user?.id ?? null,
      ts: Date.now(),
    });

    const { data, error } = await supabase.auth.updateUser({
      data: patch,
    });

    console.log(`${FILE_TAG} updateProfile resolved`, {
      hasError: !!error,
      errorMessage: error?.message ?? null,
      hasUser: !!data?.user,
      metadataKeys: data?.user?.user_metadata ? Object.keys(data.user.user_metadata) : [],
      ts: Date.now(),
    });

    if (error) {
      console.log(`${FILE_TAG} updateProfile throwing error`, error.message);
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
      console.log(`${FILE_TAG} updateProfile applying local user state`, {
        username: nextUser?.user_metadata?.username ?? null,
        displayName: nextUser?.user_metadata?.display_name ?? null,
        ts: Date.now(),
      });
      setUser(nextUser);
      setSession((prev) => (prev ? { ...prev, user: nextUser } : prev));
    }

    console.log(`${FILE_TAG} updateProfile complete`, { ts: Date.now() });
    return nextUser;
  }, [user]);

  const updateUsername = useCallback(async (username) => {
    const trimmed = username.trim();

    console.log(`${FILE_TAG} updateUsername start`, {
      original: username,
      trimmed,
      ts: Date.now(),
    });

    const result = await updateProfile({
      username: trimmed,
      display_name: trimmed,
    });
    console.log(`${FILE_TAG} updateUsername complete`, {
      username: result?.user_metadata?.username ?? null,
      displayName: result?.user_metadata?.display_name ?? null,
      ts: Date.now(),
    });
    return result;
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
