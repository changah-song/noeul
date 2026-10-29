import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import {
  applyCloudProfileAbility,
  getUnsyncedProfileAbilities,
  markProfileAbilitiesSynced,
} from './Database';
import { supabase } from './supabase';

// Mirror the on-device `profile_ability` table (the reader's level per
// profile) to Supabase, whole: the level, its uncertainty and the learned
// lookup habit. Pulled back on sign-in only when the account's level has seen
// more reading than this phone's (a new device or cleared data), so a phone's
// own, newer reading is never overwritten by an older copy. Rows are MUTABLE:
// on conflict the upload UPDATEs to the newest value.

const FILE_TAG = '[profileAbilityCloudSync]';
const PROFILE_ABILITY_TABLE = 'profile_ability';

// Shape a local SQLite row into a Supabase row. `owner_id` becomes `user_id`;
// local-only bookkeeping columns (id, synced_at) are dropped.
const toCloudRow = (userId, row) => ({
  user_id: userId,
  profile_id: row.profile_id ?? null,
  language: row.language ?? 'ko',
  theta: row.theta ?? null,
  self_report_rank: row.self_report_rank ?? null,
  event_count: row.event_count ?? 0,
  seeded_at: row.seeded_at ?? null,
  updated_at: row.updated_at ?? null,
});

// The engine's full state (supabase/profile_ability_engine_state.sql).
const toFullCloudRow = (userId, row) => ({
  ...toCloudRow(userId, row),
  theta_var: row.theta_var ?? null,
  lookup_model: row.lookup_model ?? null,
  guess_yes: row.guess_yes ?? 0,
  guess_total: row.guess_total ?? 0,
  last_event_at: row.last_event_at ?? null,
});

// Until that SQL is applied the table lacks these columns; upload the level
// alone rather than nothing.
const isMissingColumnError = (error) => /column|schema cache/i.test(String(error?.message ?? ''));

const canContinue = (generation) =>
  !isCloudSyncPaused() && isCurrentSyncGeneration(generation);

/**
 * pushProfileAbilities — upload all locally-unsynced ability rows for the owner
 * to Supabase, marking them synced on success. Cheap when there's nothing new
 * (a single query returning zero rows).
 *
 * @returns {Promise<number>} count of rows pushed this call.
 */
export const pushProfileAbilities = async ({ user, ownerId, generation } = {}) => {
  if (!user?.id) {
    return 0;
  }
  if (ownerId !== user.id) {
    // Same guard the rest of the sync layer uses: never upload one owner's data
    // under another owner's session.
    return 0;
  }
  if (!canContinue(generation)) {
    return 0;
  }

  const rows = await getUnsyncedProfileAbilities(ownerId);
  if (rows.length === 0) {
    return 0;
  }

  if (!canContinue(generation)) {
    return 0;
  }

  // Re-assert ownership right before the network write (it can throw if the
  // session changed underneath us); let that propagate to the caller.
  assertCanUploadForOwner({ ownerId, user });

  const upsert = (cloudRows) => supabase
    .from(PROFILE_ABILITY_TABLE)
    .upsert(cloudRows, {
      onConflict: 'user_id,profile_id,language',
    });
  let { error } = await upsert(rows.map((row) => toFullCloudRow(user.id, row)));
  if (error && isMissingColumnError(error)) {
    ({ error } = await upsert(rows.map((row) => toCloudRow(user.id, row))));
  }

  if (error) {
    console.warn(`${FILE_TAG} push failed:`, error?.message ?? error);
    throw error;
  }

  await markProfileAbilitiesSynced(rows);
  return rows.length;
};

/**
 * pullProfileAbility — on sync, take the account's level for this language if
 * it has seen more reading than the phone's (see applyCloudProfileAbility).
 *
 * @returns {Promise<boolean>} whether the local level changed.
 */
export const pullProfileAbility = async ({ user, ownerId, generation, profileId, language } = {}) => {
  if (!user?.id || ownerId !== user.id || !canContinue(generation)) {
    return false;
  }
  const { data, error } = await supabase
    .from(PROFILE_ABILITY_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .eq('language', language)
    .order('event_count', { ascending: false })
    .limit(1);
  if (error) {
    console.warn(`${FILE_TAG} pull failed:`, error?.message ?? error);
    return false;
  }
  const cloud = data?.[0];
  if (!cloud || !canContinue(generation)) {
    return false;
  }
  return applyCloudProfileAbility({ ownerId, profileId, language, cloud });
};
