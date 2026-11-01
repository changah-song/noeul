/**
 * purgeEnglishRefetchStemRows runs real SQL against the in-memory SQLite mock:
 * "am" was cached as the abbreviation AM (Member of the Order of Australia)
 * and "be" with the passive-voice suffixes (-되다). Those rows are dropped once
 * so the next tap fetches the fixed entries; other words are kept.
 */

jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {
    createBookIndexTable,
    createDictionaryCacheTable,
    insertBookIndexEntries,
    insertCacheEntries,
    lookupBookIndexBySurface,
    lookupCacheByStems,
    purgeEnglishRefetchStemRows,
} from '../Database';

const { __resetMockDatabases } = SQLite;
const EN_KO = { language: 'en', interfaceLanguage: 'ko' };
const KO = { language: 'ko', interfaceLanguage: 'en' };
const OWNER = { ownerId: 'owner-1', language: 'en' };

const cachedStems = async (stems, scope = EN_KO) => (
    (await lookupCacheByStems(stems, scope)).map((row) => row.stem).sort()
);

beforeEach(async () => {
    __resetMockDatabases();
    await AsyncStorage.clear();
    await createDictionaryCacheTable();
    await createBookIndexTable();
    await insertCacheEntries([
        { stem: 'am', definition: '호주 훈장 회원.' },
        { stem: 'be', definition: '수동태', gloss: '-기다, –당하다' },
        { stem: 'awkward', definition: '어색한', gloss: '서투르다, 어색하다' },
    ], EN_KO);
    const rows = await lookupCacheByStems(['am', 'awkward'], EN_KO);
    const id = Object.fromEntries(rows.map((row) => [row.stem, row.id]));
    await insertBookIndexEntries('book-1', [
        { surface: 'am', stem_id: id.am },
        { surface: 'awkward', stem_id: id.awkward },
    ], OWNER);
});

test('drops the stale English rows and the book rows that point at them', async () => {
    await purgeEnglishRefetchStemRows();

    expect(await cachedStems(['am', 'be', 'awkward'])).toEqual(['awkward']);
    expect(await lookupBookIndexBySurface('owner-1', 'book-1', 'am', EN_KO)).toEqual([]);
    const kept = await lookupBookIndexBySurface('owner-1', 'book-1', 'awkward', EN_KO);
    expect(kept.map((row) => row.stem)).toEqual(['awkward']);
});

test('leaves other languages alone and runs once', async () => {
    await insertCacheEntries([{ stem: 'do', definition: 'ko row' }], KO);

    await purgeEnglishRefetchStemRows();
    expect(await cachedStems(['do'], KO)).toEqual(['do']);

    // Fetched again after the purge: kept.
    await insertCacheEntries([{ stem: 'am', definition: '이다' }], EN_KO);
    await purgeEnglishRefetchStemRows();
    expect(await cachedStems(['am'])).toEqual(['am']);
});
