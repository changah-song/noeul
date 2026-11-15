import AsyncStorage from '@react-native-async-storage/async-storage';
import { GUEST_OWNER_ID, makeScopedStorageKey } from './localDataScope';

// The daily reading goal: minutes read each day, counted only while a book is
// open in front of the reader (screens/Read.js runs the clock), with streaks
// that forgive a missed day (weeks with at least one goal day in a row).
//
// - The goal (minutes) is a device setting, chosen in onboarding.
// - Each owner keeps a day log, `reading-days`: { 'YYYY-MM-DD': { ms, goalMs,
//   metAt, pushed } }. A day only ever grows (more minutes, a goal reached),
//   so two copies of the log are combined day by day with mergeReadingDays and
//   nothing is lost whichever order they arrive in: the guest's log on
//   sign-up (localUserData.js), the backup copy below, and the account's copy
//   (readingDaysCloudSync.js; `pushed` is what the account last received).

export const GOAL_OPTIONS = [5, 10, 15, 20, 30];
export const DEFAULT_GOAL_MINUTES = 10;
const GOAL_KEY = 'readingGoal.minutes';
const DAYS_KEY = 'reading-days';
// A second copy, written once a day, read whenever the log is: if the main
// copy is ever unreadable the streak comes back from here.
const DAYS_BACKUP_KEY = 'reading-days-backup';
const MINUTE = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE;
// No page turn, tap or lookup for this long: the reader stepped away, and the
// clock stops counting until they're back.
export const IDLE_AFTER_MS = 3 * MINUTE;
const SAVE_EVERY_MS = 15 * 1000;

// ─── Dates (local) ───────────────────────────────────────────────────────────

export const dayKey = (date = new Date()) => {
  const value = date instanceof Date ? date : new Date(date);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
};

const parseDay = (key) => {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Monday of the week a day falls in.
const weekStartKey = (key) => {
  const date = parseDay(key);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return dayKey(date);
};

const addDays = (key, count) => {
  const date = parseDay(key);
  date.setDate(date.getDate() + count);
  return dayKey(date);
};

// ─── Stats (pure) ────────────────────────────────────────────────────────────

const isMet = (entry) => Boolean(entry?.metAt);

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** What a day holds, as one string: changed if and only if the day changed. */
export const daySignature = (entry) => `${Number(entry?.ms) || 0}|${entry?.metAt ?? ''}`;

const mergeDay = (one, two) => {
  if (!one || typeof one !== 'object') return two;
  if (!two || typeof two !== 'object') return one;
  const oneMs = Number(one.ms) || 0;
  const twoMs = Number(two.ms) || 0;
  const [lead, other] = oneMs >= twoMs ? [one, two] : [two, one];
  // ISO timestamps sort as text: the goal was reached at the earlier one.
  const metAt = [one.metAt, two.metAt].filter(Boolean).sort()[0];
  const goalMs = lead.goalMs ?? other.goalMs;
  const pushed = lead.pushed ?? other.pushed;
  return {
    ms: Math.max(oneMs, twoMs),
    ...(goalMs != null ? { goalMs } : {}),
    ...(metAt ? { metAt } : {}),
    ...(pushed ? { pushed } : {}),
  };
};

/**
 * mergeReadingDays — two copies of a day log as one: every day from both,
 * and for a day in both the longer reading time and the goal if either
 * reached it. Anything that isn't a day entry is dropped.
 */
export const mergeReadingDays = (one = {}, two = {}) => {
  const merged = {};
  [one, two].forEach((days) => {
    if (!days || typeof days !== 'object' || Array.isArray(days)) return;
    Object.entries(days).forEach(([key, entry]) => {
      if (!DAY_KEY_PATTERN.test(key) || !entry || typeof entry !== 'object') return;
      merged[key] = mergeDay(merged[key], entry);
    });
  });
  return merged;
};

/**
 * goalStats — from the day log: `{ dayStreak, weekStreak, daysThisWeek,
 * totalDays, bestDayMs }`. The day streak runs back from today (or
 * yesterday, while today isn't done yet); the week streak counts weeks in a
 * row with at least one goal day, this week included once it has one.
 */
export const goalStats = (days = {}, today = dayKey()) => {
  const metDays = Object.keys(days).filter((key) => isMet(days[key]));
  const metSet = new Set(metDays);

  let dayStreak = 0;
  let cursor = metSet.has(today) ? today : addDays(today, -1);
  while (metSet.has(cursor)) {
    dayStreak += 1;
    cursor = addDays(cursor, -1);
  }

  const metWeeks = new Set(metDays.map(weekStartKey));
  const thisWeek = weekStartKey(today);
  let weekStreak = 0;
  let week = metWeeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  while (metWeeks.has(week)) {
    weekStreak += 1;
    week = addDays(week, -7);
  }

  const daysThisWeek = metDays.filter((key) => weekStartKey(key) === thisWeek).length;
  const bestDayMs = Object.values(days).reduce((best, entry) => Math.max(best, Number(entry?.ms) || 0), 0);
  return { dayStreak, weekStreak, daysThisWeek, totalDays: metDays.length, bestDayMs };
};

/**
 * goalHighlights — what to say when today's goal is reached; there is always
 * at least one. Newest first: first goal, a new best day, a week streak of
 * 2+, a day streak of 3+, then the days this week.
 */
export const goalHighlights = ({ stats, todayMs, previousBestMs }) => {
  const items = [];
  if (stats.totalDays === 1) items.push({ kind: 'first' });
  if (stats.totalDays > 1 && todayMs > previousBestMs) items.push({ kind: 'best', minutes: Math.floor(todayMs / MINUTE) });
  if (stats.weekStreak >= 2) items.push({ kind: 'weeks', count: stats.weekStreak });
  if (stats.dayStreak >= 3) items.push({ kind: 'days', count: stats.dayStreak });
  items.push({ kind: 'week', count: stats.daysThisWeek });
  return items;
};

// ─── The sunset (reading past the goal) ──────────────────────────────────────

// Every 15 minutes past the goal the sun sets a little further, then stars
// come out: 0 not reached yet, 1 golden hour (the goal), 2 sunset, 3 dusk,
// 4–6 one, two and three stars.
export const SUNSET_STEP_MS = 15 * MINUTE;
export const MAX_SUNSET_STAGE = 6;

export const sunsetStage = (ms, goalMs) => {
  const read = Number(ms) || 0;
  const goal = Number(goalMs) || DEFAULT_GOAL_MINUTES * MINUTE;
  if (read < goal) return 0;
  return Math.min(MAX_SUNSET_STAGE, 1 + Math.floor((read - goal) / SUNSET_STEP_MS));
};

/** A logged day's stage, judged by the goal that day had (0 if not reached). */
export const daySunsetStage = (entry, fallbackGoalMs) => (
  isMet(entry) ? Math.max(1, sunsetStage(entry.ms, entry.goalMs ?? fallbackGoalMs)) : 0
);

/**
 * recentDaySlots — the last `count` days, oldest first, today last, for
 * Home's dots: 'met' (goal reached), 'missed' (a past day without it),
 * 'today' (not reached yet) or 'empty' (before the first day on record).
 */
export const recentDaySlots = (days = {}, today = dayKey(), count = 6) => {
  const firstDay = Object.keys(days).sort()[0] ?? today;
  return Array.from({ length: count }, (_, index) => {
    const key = addDays(today, index - (count - 1));
    if (isMet(days[key])) return 'met';
    if (key === today) return 'today';
    return key < firstDay ? 'empty' : 'missed';
  });
};

/**
 * monthDays — one month's cells for the calendar, Monday first: null for
 * padding, else `{ key, day, state, stage, ms }` with state 'met', 'read' (a
 * minute or more), 'none', 'today' (goal not reached yet) or 'future', and
 * stage the day's sunset stage (see sunsetStage; 0 unless met).
 */
export const monthDays = (days = {}, year, month, today = dayKey(), goalMs) => {
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= count; day += 1) {
    const key = dayKey(new Date(year, month, day));
    let state = 'none';
    if (isMet(days[key])) state = 'met';
    else if (key === today) state = 'today';
    else if (key > today) state = 'future';
    else if ((Number(days[key]?.ms) || 0) >= MINUTE) state = 'read';
    cells.push({ key, day, state, stage: daySunsetStage(days[key], goalMs), ms: Number(days[key]?.ms) || 0 });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
};

// ─── Storage ─────────────────────────────────────────────────────────────────

// Home's title peeks at the timer once a day (the first visit, until the
// goal is done), so it's clear the title is the timer.
const PEEK_KEY = 'readingGoal.peekDay';
export const takeDailyPeek = async (today = dayKey()) => {
  try {
    if ((await AsyncStorage.getItem(PEEK_KEY)) === today) return false;
    await AsyncStorage.setItem(PEEK_KEY, today);
    return true;
  } catch {
    return false;
  }
};

export const getGoalMinutes = async () => {
  try {
    const value = Number(await AsyncStorage.getItem(GOAL_KEY));
    return GOAL_OPTIONS.includes(value) ? value : DEFAULT_GOAL_MINUTES;
  } catch {
    return DEFAULT_GOAL_MINUTES;
  }
};

const daysStorageKey = (ownerId) => makeScopedStorageKey(ownerId || GUEST_OWNER_ID, DAYS_KEY);
const backupStorageKey = (ownerId) => makeScopedStorageKey(ownerId || GUEST_OWNER_ID, DAYS_BACKUP_KEY);

const parseDays = (raw) => {
  if (!raw) return {};
  try {
    return mergeReadingDays(JSON.parse(raw));
  } catch {
    return null;
  }
};

// `{ ok, days }` from storage. `ok: false` means storage couldn't be read at
// all, so `days` is NOT the log (it must never be saved over the real one).
// A copy that can't be parsed is skipped and the other one used.
const readStoredDays = async (ownerId) => {
  let pairs;
  try {
    pairs = await AsyncStorage.multiGet([daysStorageKey(ownerId), backupStorageKey(ownerId)]);
  } catch (error) {
    console.warn('[readingGoal] Could not read the day log:', error?.message ?? error);
    return { ok: false, days: {} };
  }
  const [main, backup] = pairs.map(([, raw]) => parseDays(raw));
  if (main === null) console.warn('[readingGoal] The day log was unreadable; using its backup.');
  return { ok: true, days: mergeReadingDays(main ?? {}, backup ?? {}) };
};

const writeStoredDays = async (ownerId, days) => {
  try {
    await AsyncStorage.setItem(daysStorageKey(ownerId), JSON.stringify(days));
    return true;
  } catch (error) {
    console.warn('[readingGoal] Could not save the day log:', error?.message ?? error);
    return false;
  }
};

export const loadReadingDays = async (ownerId) => (await readStoredDays(ownerId)).days;

// Once a day per owner (and only from a log that was read in full).
let backedUp = null;
const backUpDays = (ownerId, days) => {
  const mark = `${ownerId || GUEST_OWNER_ID}:${dayKey()}`;
  if (backedUp === mark || Object.keys(days).length === 0) return;
  backedUp = mark;
  AsyncStorage.setItem(backupStorageKey(ownerId), JSON.stringify(days)).catch(() => {
    backedUp = null;
  });
};

// ─── The live clock ──────────────────────────────────────────────────────────

let clock = {
  ownerId: null,
  running: false,
  goalMs: DEFAULT_GOAL_MINUTES * MINUTE,
  days: {},
  today: dayKey(),
  lastTickAt: 0,
  lastActivityAt: 0,
  lastSavedAt: 0,
  // False when the log couldn't be read from storage: `days` is then only
  // what was read since, and is merged into the stored log (never written
  // over it) once storage answers again.
  storageOk: true,
  // False from opening the book until the first page turn or lookup; the
  // time until then is held in heldMs and credited on that first turn.
  confirmed: false,
  heldMs: 0,
};
let timer = null;
const listeners = new Set();
const goalListeners = new Set();

const todayEntry = () => clock.days[clock.today] ?? { ms: 0 };

export const getReadingSnapshot = () => {
  const entry = todayEntry();
  return {
    running: clock.running,
    idle: clock.running && Date.now() - clock.lastActivityAt > IDLE_AFTER_MS,
    todayMs: Number(entry.ms) || 0,
    goalMs: clock.goalMs,
    met: isMet(entry),
    sunsetStage: daySunsetStage(entry, clock.goalMs),
    stats: goalStats(clock.days, clock.today),
  };
};

const notify = () => {
  const snapshot = getReadingSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // A listener's failure doesn't stop the others.
    }
  });
};

/** The day log as the clock has it (load it first with loadReadingGoal). */
export const getReadingDays = () => clock.days;

export const subscribeReading = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Today's goal just reached: { goalMinutes, todayMs, stats, highlights }.
export const subscribeGoalReached = (listener) => {
  goalListeners.add(listener);
  return () => goalListeners.delete(listener);
};

/** Load the owner's log and goal (Home, the reader and the calendar call it). */
export const loadReadingGoal = async (ownerId) => {
  const [stored, minutes] = await Promise.all([readStoredDays(ownerId), getGoalMinutes()]);
  if (clock.ownerId !== ownerId) {
    clock = { ...clock, ownerId, days: stored.days, storageOk: stored.ok, today: dayKey() };
  } else {
    // The same reader: a save may still be on its way to storage (or storage
    // has days from the account), so a day keeps whichever copy has more.
    clock = {
      ...clock,
      days: mergeReadingDays(clock.days, stored.days),
      storageOk: clock.storageOk || stored.ok,
      today: dayKey(),
    };
  }
  if (clock.storageOk) backUpDays(ownerId, clock.days);
  clock.goalMs = minutes * MINUTE;
  notify();
  return getReadingSnapshot();
};

export const setGoalMinutes = async (minutes) => {
  if (!GOAL_OPTIONS.includes(minutes)) return;
  await AsyncStorage.setItem(GOAL_KEY, String(minutes)).catch(() => {});
  clock.goalMs = minutes * MINUTE;
  notify();
};

const save = async () => {
  clock.lastSavedAt = Date.now();
  const ownerId = clock.ownerId;
  if (!clock.storageOk) {
    // The log was never read: read it now and add to it, or don't write.
    const stored = await readStoredDays(ownerId);
    if (!stored.ok || clock.ownerId !== ownerId) return false;
    clock.days = mergeReadingDays(clock.days, stored.days);
    clock.storageOk = true;
  }
  return writeStoredDays(ownerId, clock.days);
};

/**
 * updateReadingDays — change an owner's log from outside the clock (the
 * account's days arriving, days marked as sent): `change(days)` returns the
 * new log, which is saved and shown. Null if storage couldn't be read.
 */
export const updateReadingDays = async (ownerId, change) => {
  if (clock.ownerId === ownerId) {
    if (!clock.storageOk && !(await save())) return null;
    if (clock.ownerId === ownerId) {
      clock.days = change(clock.days);
      await save();
      notify();
      return clock.days;
    }
  }
  const stored = await readStoredDays(ownerId);
  if (!stored.ok) return null;
  const next = change(stored.days);
  await writeStoredDays(ownerId, next);
  return next;
};

/** The owner's whole log, the clock's unsaved minutes included; null if unreadable. */
export const readReadingDays = async (ownerId) => updateReadingDays(ownerId, (days) => days);

const tick = () => {
  const now = Date.now();
  const nowDay = dayKey(new Date(now));
  if (nowDay !== clock.today) {
    save();
    clock.today = nowDay;
  }
  const elapsed = Math.min(now - clock.lastTickAt, 5000);
  clock.lastTickAt = now;
  if (now - clock.lastActivityAt > IDLE_AFTER_MS) {
    notify();
    return;
  }
  // Until the reader turns a page (or looks something up), the time is held:
  // a book left open on its first page isn't reading.
  if (!clock.confirmed) {
    clock.heldMs += Math.max(0, elapsed);
    return;
  }
  credit(Math.max(0, elapsed), now);
};

const credit = (addMs, now = Date.now()) => {
  const before = todayEntry();
  const ms = (Number(before.ms) || 0) + addMs;
  const previousBestMs = Object.entries(clock.days)
    .filter(([key]) => key !== clock.today)
    .reduce((best, [, entry]) => Math.max(best, Number(entry?.ms) || 0), 0);
  const reachedNow = !isMet(before) && ms >= clock.goalMs;
  clock.days = {
    ...clock.days,
    [clock.today]: {
      ms,
      goalMs: clock.goalMs,
      ...(reachedNow ? { metAt: new Date(now).toISOString() } : before.metAt ? { metAt: before.metAt } : {}),
    },
  };
  if (reachedNow || now - clock.lastSavedAt > SAVE_EVERY_MS) save();
  notify();
  if (reachedNow) {
    const stats = goalStats(clock.days, clock.today);
    const event = {
      goalMinutes: Math.round(clock.goalMs / MINUTE),
      todayMs: ms,
      stats,
      highlights: goalHighlights({ stats, todayMs: ms, previousBestMs }),
    };
    goalListeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignored.
      }
    });
  }
};

/** The reader is in front of a book: count (while there's activity). */
export const startReadingClock = async (ownerId) => {
  if (clock.running && clock.ownerId === ownerId) return;
  if (clock.ownerId !== ownerId) await loadReadingGoal(ownerId);
  const now = Date.now();
  clock = { ...clock, running: true, lastTickAt: now, lastActivityAt: now, confirmed: false, heldMs: 0 };
  if (!timer) timer = setInterval(tick, 1000);
  notify();
};

/** Away from the book (another screen, the app in the background). */
export const stopReadingClock = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!clock.running) return;
  clock.running = false;
  save();
  notify();
};

/** A page turn, tap or lookup: the reader is reading. */
export const noteReadingActivity = () => {
  const now = Date.now();
  const wasIdle = now - clock.lastActivityAt > IDLE_AFTER_MS;
  clock.lastActivityAt = now;
  if (wasIdle) {
    // Back after a break: the break itself doesn't count.
    clock.lastTickAt = now;
    clock.heldMs = 0;
  }
  if (clock.running && !clock.confirmed) {
    // The first page turn: the time spent on that first page was reading.
    clock.confirmed = true;
    const held = Math.min(clock.heldMs, IDLE_AFTER_MS);
    clock.heldMs = 0;
    if (held > 0) credit(held, now);
  }
  if (wasIdle) notify();
};

// For tests.
export const __resetReadingClock = () => {
  stopReadingClock();
  clock = {
    ownerId: null, running: false, goalMs: DEFAULT_GOAL_MINUTES * MINUTE, days: {},
    today: dayKey(), lastTickAt: 0, lastActivityAt: 0, lastSavedAt: 0, storageOk: true, confirmed: false, heldMs: 0,
  };
  backedUp = null;
  listeners.clear();
  goalListeners.clear();
};
export const __tickReadingClock = tick;
