import AsyncStorage from '@react-native-async-storage/async-storage';
import { GUEST_OWNER_ID, makeScopedStorageKey } from './localDataScope';

// The daily reading goal: minutes read each day, counted only while a book is
// open in front of the reader (screens/Read.js runs the clock), with streaks
// that forgive a missed day (weeks with at least one goal day in a row).
//
// - The goal (minutes) is a device setting, chosen in onboarding.
// - Each owner keeps a day log, `reading-days`: { 'YYYY-MM-DD': { ms, goalMs,
//   metAt } } (merged with the account's on guest import, localUserData.js).

export const GOAL_OPTIONS = [5, 10, 15, 20, 30];
export const DEFAULT_GOAL_MINUTES = 10;
const GOAL_KEY = 'readingGoal.minutes';
const DAYS_KEY = 'reading-days';
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
 * padding, else `{ key, day, state }` with state 'met', 'read' (a minute or
 * more), 'none', 'today' (goal not reached yet) or 'future'.
 */
export const monthDays = (days = {}, year, month, today = dayKey()) => {
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
    cells.push({ key, day, state });
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

export const loadReadingDays = async (ownerId) => {
  try {
    const raw = await AsyncStorage.getItem(daysStorageKey(ownerId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const saveReadingDays = (ownerId, days) => (
  AsyncStorage.setItem(daysStorageKey(ownerId), JSON.stringify(days)).catch(() => {})
);

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
  const [days, minutes] = await Promise.all([loadReadingDays(ownerId), getGoalMinutes()]);
  if (clock.ownerId !== ownerId) {
    clock = { ...clock, ownerId, days, today: dayKey() };
  } else if (!clock.running) {
    // The same reader: a save may still be on its way to storage, so a day
    // keeps whichever copy has more reading.
    const merged = { ...days };
    Object.entries(clock.days).forEach(([key, entry]) => {
      if ((Number(entry?.ms) || 0) >= (Number(merged[key]?.ms) || 0)) merged[key] = entry;
    });
    clock = { ...clock, days: merged, today: dayKey() };
  }
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

const save = () => {
  clock.lastSavedAt = Date.now();
  return saveReadingDays(clock.ownerId, clock.days);
};

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
    today: dayKey(), lastTickAt: 0, lastActivityAt: 0, lastSavedAt: 0, confirmed: false, heldMs: 0,
  };
  listeners.clear();
  goalListeners.clear();
};
export const __tickReadingClock = tick;
