import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getUnsyncedInteractionEvents,
  hasAccountLookupWords,
  markInteractionEventsSynced,
  saveAccountLookupWords,
} from './Database';
import { makeScopedStorageKey } from './localDataScope';
import { supabase } from './supabase';

// Phase 1 of the personalized vocabulary model: mirror the on-device
// append-only interaction event log to Supabase. The log itself is PUSH-ONLY —
// events are immutable, so we never pull them back into the local log; we only
// send local rows the device hasn't synced yet. Dedupe is by (user_id,
// client_event_id) via an upsert that ignores duplicates, which makes re-sends
// after a flaky connection harmless.
//
// One thing does come back (pullAccountLookups): which words the account has
// looked up, for Profile's "new words met". Those go to their own small table,
// not the event log (see Database.js account_lookup_words for why).

const FILE_TAG = '[interactionEventsCloudSync]';
const USER_INTERACTION_EVENTS_TABLE = 'user_interaction_events';
const PUSH_BATCH_SIZE = 200;

// Shape a local SQLite row into a Supabase row. `owner_id` becomes `user_id`;
// local-only bookkeeping columns (id, synced_at, deleted_at) are dropped.
const toCloudRow = (userId, event) => ({
  user_id: userId,
  client_event_id: event.client_event_id,
  profile_id: event.profile_id ?? null,
  language: event.language ?? 'ko',
  word: event.word ?? null,
  stem: event.stem ?? null,
  def_key: event.def_key ?? null,
  hanja: event.hanja ?? null,
  event_type: event.event_type,
  grade: event.grade ?? null,
  outcome: event.outcome ?? null,
  value_num: event.value_num ?? null,
  source_book_uri: event.source_book_uri ?? null,
  sentence: event.sentence ?? null,
  vocab_id: event.vocab_id ?? null,
  created_at: event.created_at ?? null,
});

const canContinue = (generation) =>
  !isCloudSyncPaused() && isCurrentSyncGeneration(generation);

/**
 * pushInteractionEvents — send all locally-unsynced interaction events for the
 * owner to Supabase, marking them synced as each batch lands. Safe to call on
 * every sync cycle; when there's nothing new it's a single cheap query.
 *
 * @returns {Promise<number>} count of events pushed this call.
 */
export const pushInteractionEvents = async ({ user, ownerId, generation } = {}) => {
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

  let totalPushed = 0;

  // Loop so a large backlog (e.g. after a long offline stretch) drains fully,
  // not just one batch per sync cycle.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!canContinue(generation)) {
      break;
    }

    const events = await getUnsyncedInteractionEvents(ownerId, { limit: PUSH_BATCH_SIZE });
    if (events.length === 0) {
      break;
    }

    // Re-assert ownership right before the network write (it can throw if the
    // session changed underneath us); let that propagate to the caller.
    assertCanUploadForOwner({ ownerId, user });

    const rows = events.map((event) => toCloudRow(user.id, event));
    const { error } = await supabase
      .from(USER_INTERACTION_EVENTS_TABLE)
      .upsert(rows, {
        onConflict: 'user_id,client_event_id',
        ignoreDuplicates: true,
      });

    if (error) {
      console.warn(`${FILE_TAG} push failed:`, error?.message ?? error);
      throw error;
    }

    await markInteractionEventsSynced(events.map((event) => event.client_event_id));
    totalPushed += events.length;

    // A short final batch means we've drained the backlog.
    if (events.length < PUSH_BATCH_SIZE) {
      break;
    }
  }

  return totalPushed;
};

const LOOKUP_CURSOR_KEY = 'sync/account-lookups-cursor';
const PULL_PAGE_SIZE = 1000;

const lookupCursorKey = (ownerId) => makeScopedStorageKey(ownerId, LOOKUP_CURSOR_KEY);

/**
 * pullAccountLookups — bring the words this account has looked up (on any
 * install) to this phone, so "new words met" counts them. Only lookups the
 * account received since the last pull are asked for; a phone holding none
 * yet (new, or cleared) asks for all of them.
 *
 * @returns {Promise<number>} lookup events read this call.
 */
export const pullAccountLookups = async ({ user, ownerId, generation } = {}) => {
  if (!user?.id || ownerId !== user.id || !canContinue(generation)) {
    return 0;
  }

  const key = lookupCursorKey(ownerId);
  let cursor = (await hasAccountLookupWords(ownerId))
    ? await AsyncStorage.getItem(key).catch(() => null)
    : null;
  let total = 0;

  // A page at a time, each saved before the next is asked for, so a pull cut
  // short carries on from where it stopped. `gte` because a batch pushed
  // together shares one inserted_at: the rows at the cursor are read again
  // (saving a word twice does nothing) rather than risk skipping some.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .from(USER_INTERACTION_EVENTS_TABLE)
      .select('profile_id, language, word, stem, inserted_at, client_event_id')
      .eq('user_id', user.id)
      .eq('event_type', 'lookup');
    if (cursor) query = query.gte('inserted_at', cursor);
    const { data, error } = await query
      .order('inserted_at', { ascending: true })
      .order('client_event_id', { ascending: true })
      .range(0, PULL_PAGE_SIZE - 1);
    if (error) {
      console.warn(`${FILE_TAG} lookup pull failed:`, error?.message ?? error);
      throw error;
    }
    const rows = data ?? [];
    if (rows.length === 0 || !canContinue(generation)) {
      break;
    }

    await saveAccountLookupWords(ownerId, rows);
    total += rows.length;

    const newest = rows[rows.length - 1].inserted_at;
    // A full page all stamped with the cursor's own time can't be stepped
    // past with `gte`; stop rather than ask for it forever.
    const stuck = rows.length === PULL_PAGE_SIZE && newest === cursor;
    if (newest) {
      cursor = newest;
      await AsyncStorage.setItem(key, newest).catch(() => {});
    }
    if (rows.length < PULL_PAGE_SIZE || stuck || !newest) {
      break;
    }
  }

  return total;
};
