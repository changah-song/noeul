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
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      console.log(`${FILE_TAG} auth state changed -> ${event}`);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession?.user) {
        try {
          await syncVocabFromCloud(nextSession.user);
        } catch (error) {
          console.log(`${FILE_TAG} vocab sync failed:`, error.message);
        }
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

    if (data?.user) {
      setUser(data.user);
      setSession((prev) => (prev ? { ...prev, user: data.user } : prev));
    }

    return data?.user ?? null;
  }, []);

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
