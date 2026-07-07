import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import {
  getUnsyncedInteractionEvents,
  markInteractionEventsSynced,
} from './Database';
import { supabase } from './supabase';

// Phase 1 of the personalized vocabulary model: mirror the on-device
// append-only interaction event log to Supabase. This channel is PUSH-ONLY —
// events are immutable, so we never pull them back down; we only send local rows
// the device hasn't synced yet. Dedupe is by (user_id, client_event_id) via an
// upsert that ignores duplicates, which makes re-sends after a flaky connection
// harmless.

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
