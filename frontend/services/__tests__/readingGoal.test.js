import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetReadingClock,
  __tickReadingClock,
  getReadingSnapshot,
  goalHighlights,
  goalStats,
  IDLE_AFTER_MS,
  loadReadingDays,
  loadReadingGoal,
  mergeReadingDays,
  monthDays,
  noteReadingActivity,
  recentDaySlots,
  setGoalMinutes,
  startReadingClock,
  stopReadingClock,
  subscribeGoalReached,
  sunsetStage,
} from '../readingGoal';

const met = (ms = 600000) => ({ ms, metAt: '2026-01-01T00:00:00Z' });

describe('streaks', () => {
  // 2026-10-29 is a Thursday; that week starts Monday 2026-10-26.
  const today = '2026-10-29';

  it('counts days in a row, and weeks with at least one goal day', () => {
    const days = {
      '2026-10-27': met(), '2026-10-28': met(), '2026-10-29': met(900000),
      '2026-10-21': met(), // last week
      '2026-10-13': met(), // the week before
      '2026-09-01': met(),
    };
    expect(goalStats(days, today)).toEqual({
      dayStreak: 3, weekStreak: 3, daysThisWeek: 3, totalDays: 6, bestDayMs: 900000,
    });
  });

  it('keeps the streaks alive while today is not done yet', () => {
    const days = { '2026-10-28': met(), '2026-10-20': met() };
    expect(goalStats(days, today)).toMatchObject({ dayStreak: 1, weekStreak: 2, daysThisWeek: 1 });
  });

  it('a day with reading but no goal is not a goal day', () => {
    expect(goalStats({ '2026-10-29': { ms: 120000 } }, today)).toMatchObject({ totalDays: 0, weekStreak: 0 });
  });
});

describe('what the congratulations says', () => {
  it('always has something, the first goal first', () => {
    const first = goalHighlights({
      stats: { totalDays: 1, weekStreak: 1, dayStreak: 1, daysThisWeek: 1 }, todayMs: 600000, previousBestMs: 0,
    });
    expect(first.map((item) => item.kind)).toEqual(['first', 'week']);
  });

  it('names a new best day and streaks', () => {
    const items = goalHighlights({
      stats: { totalDays: 9, weekStreak: 3, dayStreak: 4, daysThisWeek: 4 }, todayMs: 1500000, previousBestMs: 1200000,
    });
    expect(items.map((item) => item.kind)).toEqual(['best', 'weeks', 'days', 'week']);
    expect(items[0].minutes).toBe(25);
  });
});

describe('the reading clock', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetReadingClock();
    jest.useFakeTimers({ now: new Date('2026-10-29T10:00:00') });
  });
  afterEach(() => {
    stopReadingClock();
    jest.useRealTimers();
  });

  it('counts reading time and celebrates the goal once', async () => {
    await setGoalMinutes(5);
    const reached = jest.fn();
    subscribeGoalReached(reached);
    await startReadingClock('user-1');
    for (let second = 0; second < 5 * 60 + 2; second += 1) {
      jest.setSystemTime(Date.now() + 1000);
      if (second % 60 === 0) noteReadingActivity();
      __tickReadingClock();
    }
    expect(getReadingSnapshot().met).toBe(true);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(reached.mock.calls[0][0]).toMatchObject({ goalMinutes: 5 });
    stopReadingClock();
    const days = await loadReadingDays('user-1');
    expect(days['2026-10-29'].metAt).toBeTruthy();
  });

  it('stops counting when the reader is idle', async () => {
    await startReadingClock('user-1');
    jest.setSystemTime(Date.now() + IDLE_AFTER_MS + 60000);
    __tickReadingClock();
    expect(getReadingSnapshot().todayMs).toBe(0);
    expect(getReadingSnapshot().idle).toBe(true);
  });

  it('holds the time on the first page until a page turn, then credits it', async () => {
    await startReadingClock('user-1');
    for (let second = 0; second < 40; second += 1) {
      jest.setSystemTime(Date.now() + 1000);
      __tickReadingClock();
    }
    // Opened, not turned: nothing yet.
    expect(getReadingSnapshot().todayMs).toBe(0);
    noteReadingActivity();
    expect(getReadingSnapshot().todayMs).toBe(40000);
  });

  it('never counts a book left open without turning a page', async () => {
    await startReadingClock('user-1');
    for (let second = 0; second < 600; second += 1) {
      jest.setSystemTime(Date.now() + 1000);
      __tickReadingClock();
    }
    noteReadingActivity();
    // Idle after 3 minutes: the long stare isn't credited on the late turn.
    expect(getReadingSnapshot().todayMs).toBe(0);
  });
});

// The log must never shrink: these are the ways it used to be able to.
describe('keeping the day log safe', () => {
  const MAIN_KEY = '@ff/user-data/user-1/reading-days';
  const BACKUP_KEY = '@ff/user-data/user-1/reading-days-backup';
  const history = { '2026-10-27': met(), '2026-10-28': met() };

  const readFor = async (seconds) => {
    await startReadingClock('user-1');
    noteReadingActivity();
    for (let second = 0; second < seconds; second += 1) {
      jest.setSystemTime(Date.now() + 1000);
      __tickReadingClock();
    }
    stopReadingClock();
    // Let the save (now asynchronous) finish.
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetReadingClock();
    jest.useFakeTimers({ now: new Date('2026-10-29T10:00:00') });
  });
  afterEach(() => {
    stopReadingClock();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('merges two copies day by day: the longer time, the goal if either has it', () => {
    const merged = mergeReadingDays(
      { '2026-10-28': { ms: 60000 }, '2026-10-29': { ms: 700000, metAt: '2026-10-29T09:00:00.000Z' } },
      { '2026-10-28': { ms: 650000, metAt: '2026-10-28T20:00:00.000Z' }, '2026-10-29': { ms: 30000 }, junk: 5 }
    );
    expect(merged).toEqual({
      '2026-10-28': { ms: 650000, metAt: '2026-10-28T20:00:00.000Z' },
      '2026-10-29': { ms: 700000, metAt: '2026-10-29T09:00:00.000Z' },
    });
  });

  it('keeps a backup copy and recovers from it when the log is unreadable', async () => {
    await AsyncStorage.setItem(MAIN_KEY, JSON.stringify(history));
    await loadReadingGoal('user-1'); // writes today's backup
    await AsyncStorage.setItem(MAIN_KEY, '{"2026-10-27": {"ms": 6000'); // cut off mid-write
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    __resetReadingClock();
    await readFor(30);
    const days = await loadReadingDays('user-1');
    expect(Object.keys(days).sort()).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(goalStats(days, '2026-10-29').dayStreak).toBe(2);
    expect(JSON.parse(await AsyncStorage.getItem(BACKUP_KEY))).toMatchObject(history);
  });

  it('does not save over the log when it could not be read', async () => {
    await AsyncStorage.setItem(MAIN_KEY, JSON.stringify(history));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // The first read fails (once); the storage mock answers normally after.
    AsyncStorage.multiGet.mockRejectedValueOnce(new Error('storage busy'));
    await readFor(30);
    const days = await loadReadingDays('user-1');
    // The old days are still there, and today's reading was added to them.
    expect(days).toMatchObject(history);
    expect(days['2026-10-29'].ms).toBeGreaterThan(0);
  });
});

describe('Home dots and the calendar', () => {
  const today = '2026-10-29';

  it('shows the last six days, today last', () => {
    const days = { '2026-10-25': { ms: 120000 }, '2026-10-26': met(), '2026-10-28': met() };
    expect(recentDaySlots(days, today)).toEqual(['empty', 'missed', 'met', 'missed', 'met', 'today']);
    expect(recentDaySlots({ ...days, [today]: met() }, today).at(-1)).toBe('met');
  });

  it('lays out a month Monday first, with each day\'s state', () => {
    const days = { '2026-10-01': met(), '2026-10-02': { ms: 90000 }, '2026-10-03': { ms: 20000 } };
    const cells = monthDays(days, 2026, 9, today);
    // October 2026 starts on a Thursday: three blanks.
    expect(cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cells.slice(3, 6).map((cell) => cell.state)).toEqual(['met', 'read', 'none']);
    expect(cells.find((cell) => cell?.key === today).state).toBe('today');
    expect(cells.find((cell) => cell?.key === '2026-10-30').state).toBe('future');
    expect(cells.length % 7).toBe(0);
  });
});

describe('the sunset past the goal', () => {
  const MIN = 60000;
  const goal = 10 * MIN;

  it('moves on a stage for every 15 minutes past the goal, up to three stars', () => {
    // [minutes read, stage]: not yet, golden hour, sunset, dusk, then 1–3 stars.
    const expected = [[9, 0], [10, 1], [24, 1], [25, 2], [40, 3], [55, 4], [70, 5], [85, 6], [240, 6]];
    expected.forEach(([minutes, stage]) => {
      expect(sunsetStage(minutes * MIN, goal)).toBe(stage);
    });
  });

  it('judges each calendar day by the goal it had that day', () => {
    const days = {
      // Goal of 5 that day: 25 minutes is 20 past it, so sunset.
      '2026-10-01': { ...met(25 * MIN), goalMs: 5 * MIN },
      // No goal recorded: the current goal (10) is used, so 25 past is sunset too.
      '2026-10-02': met(35 * MIN),
      '2026-10-03': { ms: 90 * MIN },
    };
    const cells = monthDays(days, 2026, 9, '2026-10-29', goal);
    const byKey = (key) => cells.find((cell) => cell?.key === key);
    expect(byKey('2026-10-01').stage).toBe(2);
    expect(byKey('2026-10-02').stage).toBe(2);
    // Read for long but the goal wasn't marked as reached: no sunset.
    expect(byKey('2026-10-03').stage).toBe(0);
    expect(byKey('2026-10-01').ms).toBe(25 * MIN);
  });

  it('gives today\'s stage in the reading snapshot', async () => {
    await loadReadingGoal('sunset-owner');
    expect(getReadingSnapshot().sunsetStage).toBe(0);
  });
});
