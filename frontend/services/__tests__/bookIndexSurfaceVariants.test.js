/**
 * lookupBookIndexBySurfaceVariants runs real SQL against the in-memory SQLite
 * mock: a tapped bare word must find the row preprocessing stored under its
 * punctuated eojeol ("갔다.").
 */

jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
    createBookIndexTable,
    createDictionaryCacheTable,
    insertBookIndexEntries,
    insertCacheEntries,
    lookupBookIndexBySurface,
    lookupBookIndexBySurfaceVariants,
    lookupCacheByStems,
} from '../Database';

const { __resetMockDatabases } = SQLite;
const SCOPE = { language: 'ko', interfaceLanguage: 'en' };

beforeEach(async () => {
    __resetMockDatabases();
    await createDictionaryCacheTable();
    await createBookIndexTable();
    await insertCacheEntries([
        { stem: '가다', definition: 'go' },
        { stem: '눕다', definition: 'lie down' },
    ], SCOPE);
    const rows = await lookupCacheByStems(['가다', '눕다'], SCOPE);
    const idByStem = Object.fromEntries(rows.map((row) => [row.stem, row.id]));
    await insertBookIndexEntries('book-1', [
        { surface: '갔다.', stem_id: idByStem['가다'] },
        { surface: '“누워', stem_id: idByStem['눕다'] },
    ], { ownerId: 'owner-1', language: 'ko' });
});

test('the exact surface lookup misses a punctuated eojeol', async () => {
    expect(await lookupBookIndexBySurface('owner-1', 'book-1', '갔다', SCOPE)).toEqual([]);
});

test('the variant lookup returns it with the stored surface', async () => {
    const rows = await lookupBookIndexBySurfaceVariants('owner-1', 'book-1', '갔다', SCOPE);
    expect(rows).toEqual([
        expect.objectContaining({ index_surface: '갔다.', stem: '가다', definition: 'go' }),
    ]);

    const quoted = await lookupBookIndexBySurfaceVariants('owner-1', 'book-1', '누워', SCOPE);
    expect(quoted.map((row) => row.stem)).toEqual(['눕다']);
});

test('the variant lookup is scoped to the owner and book', async () => {
    expect(await lookupBookIndexBySurfaceVariants('owner-2', 'book-1', '갔다', SCOPE)).toEqual([]);
    expect(await lookupBookIndexBySurfaceVariants('owner-1', 'book-2', '갔다', SCOPE)).toEqual([]);
});

test('LIKE wildcards in the fragment never reach SQL', async () => {
    expect(await lookupBookIndexBySurfaceVariants('owner-1', 'book-1', '%', SCOPE)).toEqual([]);
});
