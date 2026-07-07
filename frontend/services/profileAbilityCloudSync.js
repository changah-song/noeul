import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import {
  getUnsyncedProfileAbilities,
  markProfileAbilitiesSynced,
} from './Database';
import { supabase } from './supabase';

// Phase 2 of the personalized vocabulary model: mirror the on-device
// `profile_ability` table (the user's latent ability `theta` per profile) to
// Supabase. PUSH-ONLY for now: theta is device-authoritative (recomputed from
// local behavior in Phase 3), so we upload the latest local value and never pull
// it back down — pulling could clobber a behaviorally-updated theta with a stale
// remote seed. Unlike interaction events these rows are MUTABLE, so on conflict we
// UPDATE (not ignore) to the newest value.

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

  const cloudRows = rows.map((row) => toCloudRow(user.id, row));
  const { error } = await supabase
    .from(PROFILE_ABILITY_TABLE)
    .upsert(cloudRows, {
      onConflict: 'user_id,profile_id,language',
    });

  if (error) {
    console.warn(`${FILE_TAG} push failed:`, error?.message ?? error);
    throw error;
  }

  await markProfileAbilitiesSynced(rows);
  return rows.length;
};
