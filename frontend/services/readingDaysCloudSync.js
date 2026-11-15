import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  assertCanUploadForOwner,
  isCloudSyncPaused,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { makeScopedStorageKey } from './localDataScope';
import {
  daySignature,
  mergeReadingDays,
  readReadingDays,
  updateReadingDays,
} from './readingGoal';
import { supabase } from './supabase';

// The reading goal's day log (services/readingGoal.js) kept in the account
// too, one row per day in `user_reading_days` (supabase/user_reading_days.sql),
// so streaks survive a reinstall or a new phone and two phones add up.
//
// Each sync: take the account's days that changed since last time and merge
// them into this phone's log, then send the days this phone has that the
// account hasn't seen. A day only grows, so merging is safe in any order (the
// table's trigger merges the same way if two phones send the same day).

const FILE_TAG = '[readingDaysCloudSync]';
const READING_DAYS_TABLE = 'user_reading_days';
const CURSOR_KEY = 'sync/reading-days-cursor';
const PAGE_SIZE = 1000;
const PUSH_CHUNK = 500;

const canContinue = (generation) =>
  !isCloudSyncPaused() && isCurrentSyncGeneration(generation);

const cursorStorageKey = (ownerId) => makeScopedStorageKey(ownerId, CURSOR_KEY);

const toIso = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

// An account row as a day entry, marked as already in the account.
const toLocalEntry = (row) => {
  const metAt = toIso(row.met_at);
  const entry = {
    ms: Math.max(0, Number(row.ms) || 0),
    ...(row.goal_ms != null ? { goalMs: Number(row.goal_ms) } : {}),
    ...(metAt ? { metAt } : {}),
  };
  return { ...entry, pushed: daySignature(entry) };
};

const toCloudRow = (userId, day, entry) => ({
  user_id: userId,
  day,
  ms: Math.round(Number(entry.ms) || 0),
  goal_ms: entry.goalMs != null ? Math.round(Number(entry.goalMs)) : null,
  met_at: entry.metAt ?? null,
});

// The account's rows changed after `cursor` (all of them without one).
const pullRows = async (userId, cursor) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(READING_DAYS_TABLE)
      .select('day, ms, goal_ms, met_at, server_updated_at')
      .eq('user_id', userId);
    if (cursor) query = query.gt('server_updated_at', cursor);
    const { data, error } = await query
      .order('server_updated_at', { ascending: true })
      .order('day', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
};

/**
 * syncReadingDays — merge the account's reading days into this phone's log
 * and send this phone's new ones.
 *
 * @returns {Promise<{ pulled: number, pushed: number } | null>} null when
 *   skipped (no account, sync paused, the local log unreadable).
 */
export const syncReadingDays = async ({ user, ownerId, generation } = {}) => {
  if (!user?.id || ownerId !== user.id || !canContinue(generation)) {
    return null;
  }

  const local = await readReadingDays(ownerId);
  if (!local) {
    return null;
  }

  // A phone with no days yet (new, or cleared) asks for everything.
  const cursor = Object.keys(local).length > 0
    ? await AsyncStorage.getItem(cursorStorageKey(ownerId)).catch(() => null)
    : null;
  const rows = await pullRows(user.id, cursor);
  if (!canContinue(generation)) {
    return null;
  }

  let days = local;
  if (rows.length > 0) {
    const cloudDays = Object.fromEntries(rows.map((row) => [row.day, toLocalEntry(row)]));
    days = await updateReadingDays(ownerId, (current) => mergeReadingDays(current, cloudDays));
    if (!days) {
      return null;
    }
    const newest = rows
      .map((row) => toIso(row.server_updated_at))
      .filter(Boolean)
      .sort()
      .pop();
    if (newest) {
      await AsyncStorage.setItem(cursorStorageKey(ownerId), newest).catch(() => {});
    }
  }

  // Days the account hasn't got as they are now.
  const unsent = Object.entries(days).filter(([, entry]) => (
    ((Number(entry.ms) || 0) > 0 || entry.metAt) && entry.pushed !== daySignature(entry)
  ));
  for (let start = 0; start < unsent.length; start += PUSH_CHUNK) {
    if (!canContinue(generation)) {
      return null;
    }
    assertCanUploadForOwner({ ownerId, user });
    const chunk = unsent.slice(start, start + PUSH_CHUNK);
    const { error } = await supabase
      .from(READING_DAYS_TABLE)
      .upsert(chunk.map(([day, entry]) => toCloudRow(user.id, day, entry)), { onConflict: 'user_id,day' });
    if (error) {
      console.warn(`${FILE_TAG} push failed:`, error?.message ?? error);
      throw error;
    }
    // Marked with what was sent: minutes read meanwhile leave the day unsent.
    const sent = Object.fromEntries(chunk.map(([day, entry]) => [day, daySignature(entry)]));
    await updateReadingDays(ownerId, (current) => {
      const next = { ...current };
      Object.entries(sent).forEach(([day, signature]) => {
        if (next[day]) next[day] = { ...next[day], pushed: signature };
      });
      return next;
    });
  }

  return { pulled: rows.length, pushed: unsent.length };
};
