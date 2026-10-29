import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import {
  getUnsyncedAbilityLog,
  markAbilityLogSynced,
} from './Database';
import { supabase } from './supabase';

// Mirror the on-device ability_log (every change to a reader's level and what
// caused it; see services/levelEngine.js) to Supabase for the admin
// dashboard's Level model page. PUSH-ONLY and append-only, like the
// interaction event log: dedupe is by (user_id, client_log_id), so re-sends
// are harmless. Until supabase/user_ability_log.sql is applied the push fails
// and the rows simply wait on the device.

const FILE_TAG = '[abilityLogCloudSync]';
const USER_ABILITY_LOG_TABLE = 'user_ability_log';
const PUSH_BATCH_SIZE = 300;

const toCloudRow = (userId, row) => ({
  user_id: userId,
  client_log_id: row.client_log_id,
  profile_id: row.profile_id ?? null,
  language: row.language ?? 'ko',
  signal: row.signal,
  word: row.word ?? null,
  stem: row.stem ?? null,
  outcome: row.outcome ?? null,
  difficulty: row.difficulty ?? null,
  p_known: row.p_known ?? null,
  p_observed: row.p_observed ?? null,
  theta_before: row.theta_before ?? null,
  theta_after: row.theta_after ?? null,
  var_before: row.var_before ?? null,
  var_after: row.var_after ?? null,
  lookup_rate: row.lookup_rate ?? null,
  guess_rate: row.guess_rate ?? null,
  source_book_uri: row.source_book_uri ?? null,
  details: (() => {
    if (!row.details) return null;
    try {
      return JSON.parse(row.details);
    } catch {
      return null;
    }
  })(),
  created_at: row.created_at ?? null,
});

const canContinue = (generation) =>
  !isCloudSyncPaused() && isCurrentSyncGeneration(generation);

/**
 * pushAbilityLog — send all locally-unsynced ability log rows for the owner,
 * marking them synced as each batch lands.
 *
 * @returns {Promise<number>} rows pushed this call.
 */
export const pushAbilityLog = async ({ user, ownerId, generation } = {}) => {
  if (!user?.id || ownerId !== user.id || !canContinue(generation)) {
    return 0;
  }

  let totalPushed = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!canContinue(generation)) {
      break;
    }
    const rows = await getUnsyncedAbilityLog(ownerId, { limit: PUSH_BATCH_SIZE });
    if (rows.length === 0) {
      break;
    }
    assertCanUploadForOwner({ ownerId, user });
    const { error } = await supabase
      .from(USER_ABILITY_LOG_TABLE)
      .upsert(rows.map((row) => toCloudRow(user.id, row)), {
        onConflict: 'user_id,client_log_id',
        ignoreDuplicates: true,
      });
    if (error) {
      console.warn(`${FILE_TAG} push failed:`, error?.message ?? error);
      throw error;
    }
    await markAbilityLogSynced(rows.map((row) => row.id));
    totalPushed += rows.length;
    if (rows.length < PUSH_BATCH_SIZE) {
      break;
    }
  }
  return totalPushed;
};

/**
 * fetchCloudLevelHistory — the account's level history for one language, for
 * Profile's chart on a phone that doesn't have it (a new device, cleared
 * data): `{ rows, startRows }`, the newest rows (created_at, theta_after,
 * var_after) and the set-the-level rows (picks, word checks), oldest first.
 * Empty when it can't be read.
 */
export const fetchCloudLevelHistory = async (userId, language) => {
  if (!userId) return { rows: [], startRows: [] };
  try {
    const [history, starts] = await Promise.all([
      supabase
        .from(USER_ABILITY_LOG_TABLE)
        .select('created_at, theta_after, var_after')
        .eq('user_id', userId)
        .eq('language', language)
        .not('theta_after', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from(USER_ABILITY_LOG_TABLE)
        .select('signal, theta_after, created_at')
        .eq('user_id', userId)
        .eq('language', language)
        .in('signal', ['seed', 'check_start', 'check', 'pseudo'])
        .order('created_at', { ascending: true })
        .limit(300),
    ]);
    if (history.error) throw history.error;
    if (starts.error) throw starts.error;
    return { rows: history.data ?? [], startRows: starts.data ?? [] };
  } catch (error) {
    console.warn(`${FILE_TAG} history fetch failed:`, error?.message ?? error);
    return { rows: [], startRows: [] };
  }
};
