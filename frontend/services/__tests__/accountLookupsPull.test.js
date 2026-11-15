jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

// A stand-in for the `user_interaction_events` table: rows in memory, with
// just the query calls the pull makes.
jest.mock('../supabase', () => {
    const table = { rows: [], failWith: null, queries: 0 };
    const select = () => {
        const filters = { eq: {}, from: null, range: [0, 999] };
        const query = {
            eq: (column, value) => {
                filters.eq[column] = value;
                return query;
            },
            gte: (_column, value) => {
                filters.from = value;
                return query;
            },
            order: () => query,
            range: (from, to) => {
                filters.range = [from, to];
                return query;
            },
            then: (resolve) => {
                table.queries += 1;
                if (table.failWith) return resolve({ data: null, error: table.failWith });
                const data = table.rows
                    .filter((row) => Object.entries(filters.eq).every(([column, value]) => row[column] === value))
                    .filter((row) => !filters.from || row.inserted_at >= filters.from)
                    .sort((a, b) => a.inserted_at.localeCompare(b.inserted_at)
                        || a.client_event_id.localeCompare(b.client_event_id))
                    .slice(filters.range[0], filters.range[1] + 1);
                return resolve({ data, error: null });
            },
        };
        return query;
    };
    return { supabase: { from: () => ({ select }) }, __table: table };
});

jest.mock('../localOwnerCoordinator', () => ({
    assertCanUploadForOwner: jest.fn(),
    isCloudSyncPaused: () => false,
    isCurrentSyncGeneration: () => true,
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {
    clearSqliteUserData,
    getWordStats,
    initAllTables,
    logInteractionEvent,
} from '../Database';
import { pullAccountLookups } from '../interactionEventsCloudSync';

const { __table: cloud } = jest.requireMock('../supabase');
const { __resetMockDatabases } = SQLite;
const USER = { id: 'user-1' };
const sync = { user: USER, ownerId: USER.id, generation: 1 };
const scope = { ownerId: USER.id, language: 'ko' };

let counter = 0;
const cloudEvent = (stem, extra = {}) => {
    counter += 1;
    return {
        user_id: USER.id,
        client_event_id: `evt_${String(counter).padStart(6, '0')}`,
        profile_id: null,
        language: 'ko',
        word: stem,
        stem,
        event_type: 'lookup',
        inserted_at: new Date(Date.UTC(2026, 10, 1, 0, 0, counter)).toISOString(),
        ...extra,
    };
};

describe('pullAccountLookups', () => {
    beforeEach(async () => {
        __resetMockDatabases();
        await AsyncStorage.clear();
        cloud.rows = [];
        cloud.failWith = null;
        cloud.queries = 0;
        counter = 0;
        await initAllTables();
    });

    it('counts the account\'s lookups as words met on a fresh install', async () => {
        cloud.rows = [
            cloudEvent('눕다', { word: '누워' }),
            cloudEvent('눕다', { word: '누웠다' }),
            cloudEvent('감자'),
            // Not lookups, another language, someone else: none of these count.
            cloudEvent('사과', { event_type: 'exposure' }),
            cloudEvent('rumor', { language: 'en' }),
            cloudEvent('소문', { user_id: 'user-2' }),
        ];

        expect(await pullAccountLookups(sync)).toBe(4);
        expect(await getWordStats(scope)).toEqual({ met: 2, learning: 0, learned: 0 });
        expect((await getWordStats({ ...scope, language: 'en' })).met).toBe(1);
    });

    it('does not count a word twice when this phone looked it up too', async () => {
        cloud.rows = [cloudEvent('감자')];
        await logInteractionEvent({ ...scope, word: '감자를', stem: '감자', eventType: 'lookup' });
        await logInteractionEvent({ ...scope, word: '소문', stem: '소문', eventType: 'lookup' });

        await pullAccountLookups(sync);
        expect((await getWordStats(scope)).met).toBe(2);
    });

    it('only asks for what the account received since the last pull', async () => {
        cloud.rows = [cloudEvent('감자'), cloudEvent('소문')];
        await pullAccountLookups(sync);

        cloud.rows.push(cloudEvent('바람'));
        // The newest row already seen is read again, plus the new one.
        expect(await pullAccountLookups(sync)).toBe(2);
        expect((await getWordStats(scope)).met).toBe(3);
    });

    it('reads a long history page by page, even when a batch shares one time', async () => {
        const sharedTime = new Date(Date.UTC(2026, 10, 2)).toISOString();
        cloud.rows = Array.from({ length: 2300 }, (_, index) => cloudEvent(`w${index}`, {
            // Pushed 200 at a time, each batch stamped once.
            inserted_at: index < 200 ? sharedTime : new Date(Date.UTC(2026, 10, 3, 0, 0, Math.floor(index / 200))).toISOString(),
        }));

        await pullAccountLookups(sync);
        expect((await getWordStats(scope)).met).toBe(2300);
    });

    it('asks for everything again after this phone\'s data was cleared', async () => {
        cloud.rows = [cloudEvent('감자'), cloudEvent('소문')];
        await pullAccountLookups(sync);
        await clearSqliteUserData(USER.id);
        expect((await getWordStats(scope)).met).toBe(0);

        await pullAccountLookups(sync);
        expect((await getWordStats(scope)).met).toBe(2);
    });

    it('does nothing without an account, or for another owner\'s data', async () => {
        cloud.rows = [cloudEvent('감자')];
        expect(await pullAccountLookups({ user: null, ownerId: 'guest', generation: 1 })).toBe(0);
        expect(await pullAccountLookups({ user: USER, ownerId: 'guest', generation: 1 })).toBe(0);
        expect(cloud.queries).toBe(0);
    });

    it('fails loudly when the account can\'t be read, leaving the counts as they were', async () => {
        cloud.failWith = { message: 'offline' };
        await expect(pullAccountLookups(sync)).rejects.toEqual({ message: 'offline' });
        expect((await getWordStats(scope)).met).toBe(0);
    });
});
