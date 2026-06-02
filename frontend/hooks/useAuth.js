import { useEffect, useState, useCallback } from 'react';
import { insertDataIfMissing, updateVocabLearningState, viewData } from '../services/Database';
import { fetchUserVocab, supabase, upsertUserVocabEntries } from '../services/supabase';
import { MATURITY_ORDER } from '../services/vocabLearning';

const FILE_TAG = '[useAuth]';

const makeVocabKey = (word, hanja, definition) => `${word}::${hanja ?? ''}::${definition ?? ''}`;

const countValue = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.trunc(numberValue)) : 0;
};

const dateTime = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const newestDate = (a, b) => {
  const aTime = dateTime(a);
  const bTime = dateTime(b);

  if (aTime === null) return b ?? null;
  if (bTime === null) return a ?? null;
  return bTime > aTime ? b : a;
};

const earliestDate = (a, b) => {
  const aTime = dateTime(a);
  const bTime = dateTime(b);

  if (aTime === null) return b ?? null;
  if (bTime === null) return a ?? null;
  return bTime < aTime ? b : a;
};

const compareDates = (a, b) => {
  const aTime = dateTime(a);
  const bTime = dateTime(b);

  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return -1;
  if (bTime === null) return 1;
  return aTime - bTime;
};

const maturityRank = (maturity) => {
  const index = MATURITY_ORDER.indexOf(String(maturity ?? '').toLowerCase());
  return index === -1 ? 0 : index;
};

const highestMaturity = (localMaturity, cloudMaturity, graduatedAt) => {
  if (graduatedAt || localMaturity === 'graduated' || cloudMaturity === 'graduated') {
    return 'graduated';
  }

  return maturityRank(cloudMaturity) > maturityRank(localMaturity)
    ? cloudMaturity
    : (localMaturity || cloudMaturity || 'new');
};

const cloudRowToLocalShape = (row) => ({
  word: row.word,
  hanja: row.hanja ?? null,
  def: row.definition ?? null,
  level: row.status ?? 'unorganized',
  encounter_count: countValue(row.encounter_count),
  last_encountered_at: row.last_encountered_at ?? null,
  last_encounter_source_uri: row.last_encounter_source_uri ?? null,
  last_encounter_source_title: row.last_encounter_source_title ?? null,
  maturity: row.maturity ?? 'new',
  graduated_at: row.graduated_at ?? null,
  implicit_review_count: countValue(row.implicit_review_count),
  last_reviewed_at: row.last_reviewed_at ?? null,
  next_review_at: row.next_review_at ?? null,
  correct_count: countValue(row.correct_count),
  wrong_count: countValue(row.wrong_count),
});

const toInsertOptions = (row) => ({
  level: row.level ?? 'unorganized',
  encounterCount: countValue(row.encounter_count),
  lastEncounteredAt: row.last_encountered_at ?? null,
  lastEncounterSourceUri: row.last_encounter_source_uri ?? null,
  lastEncounterSourceTitle: row.last_encounter_source_title ?? null,
  maturity: row.maturity ?? 'new',
  graduatedAt: row.graduated_at ?? null,
  implicitReviewCount: countValue(row.implicit_review_count),
  lastReviewedAt: row.last_reviewed_at ?? null,
  nextReviewAt: row.next_review_at ?? null,
  correctCount: countValue(row.correct_count),
  wrongCount: countValue(row.wrong_count),
});

const chooseMergedLevel = (localRow, cloudRow) => {
  const reviewComparison = compareDates(localRow.last_reviewed_at, cloudRow.last_reviewed_at);
  if (reviewComparison < 0) return cloudRow.level ?? localRow.level ?? 'unorganized';
  return localRow.level ?? cloudRow.level ?? 'unorganized';
};

const chooseMergedNextReview = (localRow, cloudRow, mergedMaturity, mergedLevel) => {
  const localStateMatches = localRow.maturity === mergedMaturity && localRow.level === mergedLevel;
  const cloudStateMatches = cloudRow.maturity === mergedMaturity && cloudRow.level === mergedLevel;

  if (localStateMatches && cloudStateMatches) {
    return newestDate(localRow.next_review_at, cloudRow.next_review_at);
  }

  if (localStateMatches) return localRow.next_review_at ?? null;
  if (cloudStateMatches) return cloudRow.next_review_at ?? null;
  return localRow.next_review_at ?? cloudRow.next_review_at ?? null;
};

const mergeLocalAndCloudRows = (localRow, cloudRow) => {
  const graduatedAt = earliestDate(localRow.graduated_at, cloudRow.graduated_at);
  const maturity = highestMaturity(localRow.maturity, cloudRow.maturity, graduatedAt);
  const level = chooseMergedLevel(localRow, cloudRow);
  const lastEncounteredAt = newestDate(localRow.last_encountered_at, cloudRow.last_encountered_at);
  const cloudHasNewestEncounter = compareDates(cloudRow.last_encountered_at, localRow.last_encountered_at) > 0;

  return {
    ...localRow,
    level,
    encounter_count: Math.max(countValue(localRow.encounter_count), countValue(cloudRow.encounter_count)),
    last_encountered_at: lastEncounteredAt,
    last_encounter_source_uri: cloudHasNewestEncounter
      ? cloudRow.last_encounter_source_uri
      : (localRow.last_encounter_source_uri ?? cloudRow.last_encounter_source_uri ?? null),
    last_encounter_source_title: cloudHasNewestEncounter
      ? cloudRow.last_encounter_source_title
      : (localRow.last_encounter_source_title ?? cloudRow.last_encounter_source_title ?? null),
    maturity,
    graduated_at: graduatedAt,
    implicit_review_count: Math.max(countValue(localRow.implicit_review_count), countValue(cloudRow.implicit_review_count)),
    last_reviewed_at: newestDate(localRow.last_reviewed_at, cloudRow.last_reviewed_at),
    next_review_at: chooseMergedNextReview(localRow, cloudRow, maturity, level),
    correct_count: Math.max(countValue(localRow.correct_count), countValue(cloudRow.correct_count)),
    wrong_count: Math.max(countValue(localRow.wrong_count), countValue(cloudRow.wrong_count)),
  };
};

const toCloudEntry = (row) => ({
  word: row.word,
  hanja: row.hanja,
  definition: row.def ?? row.definition ?? null,
  level: row.level,
  encounter_count: row.encounter_count,
  last_encountered_at: row.last_encountered_at,
  last_encounter_source_uri: row.last_encounter_source_uri,
  last_encounter_source_title: row.last_encounter_source_title,
  maturity: row.maturity,
  graduated_at: row.graduated_at,
  implicit_review_count: row.implicit_review_count,
  last_reviewed_at: row.last_reviewed_at,
  next_review_at: row.next_review_at,
  correct_count: row.correct_count,
  wrong_count: row.wrong_count,
});

const syncVocabFromCloud = async (user) => {
  console.log(`${FILE_TAG} syncing vocab for user ${user.id}`);

  const [cloudRows, localRows] = await Promise.all([
    fetchUserVocab(user.id),
    viewData(),
  ]);

  const localRowsByKey = new Map(
    localRows.map((row) => [makeVocabKey(row.word, row.hanja, row.def), row])
  );
  const cloudKeys = new Set();

  let pulledCount = 0;
  let mergedCount = 0;
  const rowsToPush = [];

  for (const row of cloudRows) {
    const cloudLocalRow = cloudRowToLocalShape(row);
    const key = makeVocabKey(cloudLocalRow.word, cloudLocalRow.hanja, cloudLocalRow.def);
    const localRow = localRowsByKey.get(key);
    cloudKeys.add(key);

    if (!localRow) {
      const inserted = await insertDataIfMissing(
        cloudLocalRow.word,
        cloudLocalRow.hanja,
        cloudLocalRow.def,
        toInsertOptions(cloudLocalRow)
      );

      if (inserted) {
        pulledCount += 1;
      }
      continue;
    }

    const mergedRow = mergeLocalAndCloudRows(localRow, cloudLocalRow);
    await updateVocabLearningState(localRow.word, localRow.hanja, localRow.def, {
      level: mergedRow.level,
      encounter_count: mergedRow.encounter_count,
      last_encountered_at: mergedRow.last_encountered_at,
      last_encounter_source_uri: mergedRow.last_encounter_source_uri,
      last_encounter_source_title: mergedRow.last_encounter_source_title,
      maturity: mergedRow.maturity,
      graduated_at: mergedRow.graduated_at,
      implicit_review_count: mergedRow.implicit_review_count,
      last_reviewed_at: mergedRow.last_reviewed_at,
      next_review_at: mergedRow.next_review_at,
      correct_count: mergedRow.correct_count,
      wrong_count: mergedRow.wrong_count,
    });
    rowsToPush.push(toCloudEntry(mergedRow));
    mergedCount += 1;
  }

  const localOnlyRows = localRows.filter(
    (row) => !cloudKeys.has(makeVocabKey(row.word, row.hanja, row.def))
  );

  if (localOnlyRows.length > 0) {
    rowsToPush.push(...localOnlyRows.map(toCloudEntry));
  }

  if (rowsToPush.length > 0) {
    await upsertUserVocabEntries(user.id, rowsToPush);
  }

  console.log(
    `${FILE_TAG} vocab sync complete -> pulled=${pulledCount} merged=${mergedCount} pushed=${rowsToPush.length} cloud=${cloudRows.length} local=${localRows.length}`
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
