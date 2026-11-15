import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetReadingClock, loadReadingDays } from '../readingGoal';
import { syncReadingDays } from '../readingDaysCloudSync';

// A stand-in for the `user_reading_days` table: rows in memory, with just the
// query calls the sync makes. It merges on upsert the way the table's trigger
// does and stamps each change with a rising `server_updated_at`.
jest.mock('../supabase', () => {
  const table = { rows: new Map(), clock: 0, failWith: null, upserts: [] };
  const stamp = () => {
    table.clock += 1;
    return new Date(Date.UTC(2026, 9, 29, 0, 0, table.clock)).toISOString();
  };
  const select = () => {
    const filters = { after: null, range: [0, 999] };
    const query = {
      eq: () => query,
      gt: (_column, value) => {
        filters.after = value;
        return query;
      },
      order: () => query,
      range: (from, to) => {
        filters.range = [from, to];
        return query;
      },
      then: (resolve) => {
        if (table.failWith) return resolve({ data: null, error: table.failWith });
        const data = [...table.rows.values()]
          .filter((row) => !filters.after || row.server_updated_at > filters.after)
          .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at))
          .slice(filters.range[0], filters.range[1] + 1);
        return resolve({ data, error: null });
      },
    };
    return query;
  };
  const upsert = async (rows) => {
    if (table.failWith) return { error: table.failWith };
    table.upserts.push(rows);
    rows.forEach((row) => {
      const old = table.rows.get(row.day);
      table.rows.set(row.day, {
        ...row,
        ms: Math.max(old?.ms ?? 0, row.ms),
        met_at: [old?.met_at, row.met_at].filter(Boolean).sort()[0] ?? null,
        server_updated_at: stamp(),
      });
    });
    return { error: null };
  };
  return { supabase: { from: () => ({ select, upsert }) }, __table: table, __stamp: stamp };
});

jest.mock('../localOwnerCoordinator', () => ({
  assertCanUploadForOwner: jest.fn(),
  isCloudSyncPaused: () => false,
  isCurrentSyncGeneration: () => true,
}));

const { __table: table, __stamp: stamp } = require('../supabase');

const user = { id: 'user-1' };
const args = { user, ownerId: 'user-1', generation: 1 };
const MAIN_KEY = '@ff/user-data/user-1/reading-days';
const metDay = (ms, metAt) => ({ ms, goalMs: 600000, metAt });
const cloudRow = (day, ms, metAt = null) => ({
  user_id: 'user-1', day, ms, goal_ms: 600000, met_at: metAt, server_updated_at: stamp(),
});

describe('reading days and the account', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetReadingClock();
    table.rows.clear();
    table.upserts.length = 0;
    table.failWith = null;
  });

  it('sends this phone\'s days, and only once', async () => {
    await AsyncStorage.setItem(MAIN_KEY, JSON.stringify({
      '2026-10-28': metDay(650000, '2026-10-28T20:00:00.000Z'),
      '2026-10-29': { ms: 120000, goalMs: 600000 },
    }));
    expect(await syncReadingDays(args)).toEqual({ pulled: 0, pushed: 2 });
    expect(table.rows.get('2026-10-28')).toMatchObject({ ms: 650000, met_at: '2026-10-28T20:00:00.000Z' });
    // Nothing changed since: the second sync has nothing to send.
    expect((await syncReadingDays(args)).pushed).toBe(0);
    expect(table.upserts).toHaveLength(1);
  });

  it('brings the streak back on a phone with no days (a reinstall)', async () => {
    table.rows.set('2026-10-27', cloudRow('2026-10-27', 700000, '2026-10-27T08:00:00+00:00'));
    table.rows.set('2026-10-28', cloudRow('2026-10-28', 650000, '2026-10-28T20:00:00+00:00'));
    expect(await syncReadingDays(args)).toEqual({ pulled: 2, pushed: 0 });
    const days = await loadReadingDays('user-1');
    expect(days['2026-10-27']).toMatchObject({ ms: 700000, metAt: '2026-10-27T08:00:00.000Z' });
    expect(days['2026-10-28'].metAt).toBeTruthy();
  });

  it('adds two phones together: the longer time and the goal win, both ways', async () => {
    // The other phone reached today's goal; this one read longer yesterday.
    table.rows.set('2026-10-28', cloudRow('2026-10-28', 60000));
    table.rows.set('2026-10-29', cloudRow('2026-10-29', 610000, '2026-10-29T07:00:00+00:00'));
    await AsyncStorage.setItem(MAIN_KEY, JSON.stringify({
      '2026-10-28': metDay(900000, '2026-10-28T21:00:00.000Z'),
      '2026-10-29': { ms: 30000, goalMs: 600000 },
    }));
    expect(await syncReadingDays(args)).toEqual({ pulled: 2, pushed: 1 });
    const days = await loadReadingDays('user-1');
    expect(days['2026-10-29']).toMatchObject({ ms: 610000, metAt: '2026-10-29T07:00:00.000Z' });
    expect(table.rows.get('2026-10-28')).toMatchObject({ ms: 900000, met_at: '2026-10-28T21:00:00.000Z' });
  });

  it('leaves the phone\'s log alone when the account can\'t be reached', async () => {
    const local = { '2026-10-28': metDay(650000, '2026-10-28T20:00:00.000Z') };
    await AsyncStorage.setItem(MAIN_KEY, JSON.stringify(local));
    table.failWith = { message: 'relation "user_reading_days" does not exist' };
    await expect(syncReadingDays(args)).rejects.toBeTruthy();
    expect(await loadReadingDays('user-1')).toEqual(local);
  });

  it('does nothing for a guest', async () => {
    expect(await syncReadingDays({ user: null, ownerId: 'guest', generation: 1 })).toBeNull();
  });
});
