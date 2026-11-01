/**
 * purgeEnglishBareVerbStemRows runs real SQL against the in-memory SQLite
 * mock: an English book indexed before the backend kept a verb's silent e has
 * "shining" under shin. book_index only gains rows, so those rows are dropped
 * once; analysing the book again (PREPROCESS_VERSION 12) adds the right ones.
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
    purgeEnglishBareVerbStemRows,
} from '../Database';

const { __resetMockDatabases } = SQLite;
const EN = { language: 'en', interfaceLanguage: 'en' };
const KO = { language: 'ko', interfaceLanguage: 'en' };
const OWNER = { ownerId: 'owner-1', language: 'en' };

const stemsOf = async (surface, bookUri = 'book-1', scope = EN) => (
    (await lookupBookIndexBySurface('owner-1', bookUri, surface, scope)).map((row) => row.stem).sort()
);

beforeEach(async () => {
    __resetMockDatabases();
    await AsyncStorage.clear();
    await createDictionaryCacheTable();
    await createBookIndexTable();
    const stems = ['shin', 'shine', 'hop', 'rid', 'bath', 'jump', 'sing', 'run', 'visit', 'door'];
    await insertCacheEntries(stems.map((stem) => ({ stem, definition: stem })), EN);
    const rows = await lookupCacheByStems(stems, EN);
    const id = Object.fromEntries(rows.map((row) => [row.stem, row.id]));
    const index = [
        // Wrong: the silent e was dropped.
        ['shining', 'shin'], ['Shining', 'shin'], ['hoping', 'hop'], ['hoped', 'hop'],
        ['rides', 'rid'], ['bathing', 'bath'],
        // Right, and kept.
        ['shining', 'shine'], ['hopping', 'hop'], ['jumping', 'jump'], ['singing', 'sing'],
        ['running', 'run'], ['doors', 'door'], ['shin', 'shin'],
    ];
    await insertBookIndexEntries('book-1', index.map(([surface, stem]) => ({ surface, stem_id: id[stem] })), OWNER);
    await insertBookIndexEntries('song:7', [{ surface: 'shining', stem_id: id.shin }], OWNER);
});

test('drops the rows that lost a silent e, in books and songs', async () => {
    expect(await stemsOf('shining')).toEqual(['shin', 'shine']);

    await purgeEnglishBareVerbStemRows();

    expect(await stemsOf('shining')).toEqual(['shine']);
    expect(await stemsOf('Shining')).toEqual([]);
    expect(await stemsOf('hoping')).toEqual([]);
    expect(await stemsOf('hoped')).toEqual([]);
    expect(await stemsOf('rides')).toEqual([]);
    expect(await stemsOf('bathing')).toEqual([]);
    expect(await stemsOf('shining', 'song:7')).toEqual([]);
});

test('keeps doubled, consonant-cluster and non-verb rows', async () => {
    await purgeEnglishBareVerbStemRows();

    expect(await stemsOf('hopping')).toEqual(['hop']);
    expect(await stemsOf('running')).toEqual(['run']);
    expect(await stemsOf('jumping')).toEqual(['jump']);
    expect(await stemsOf('singing')).toEqual(['sing']);
    expect(await stemsOf('doors')).toEqual(['door']);
    expect(await stemsOf('shin')).toEqual(['shin']);
});

test('leaves other languages alone and runs once', async () => {
    await insertCacheEntries([{ stem: 'hop', definition: 'ko row' }], KO);
    const [koHop] = await lookupCacheByStems(['hop'], KO);
    await insertBookIndexEntries('book-ko', [{ surface: 'hoping', stem_id: koHop.id }], { ownerId: 'owner-1', language: 'ko' });

    await purgeEnglishBareVerbStemRows();
    expect(await stemsOf('hoping', 'book-ko', KO)).toEqual(['hop']);

    // A row written after the purge (none should be, but the flag is what stops it) stays.
    const [enHop] = await lookupCacheByStems(['hop'], EN);
    await insertBookIndexEntries('book-1', [{ surface: 'hoping', stem_id: enHop.id }], OWNER);
    await purgeEnglishBareVerbStemRows();
    expect(await stemsOf('hoping')).toEqual(['hop']);
});
