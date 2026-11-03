/**
 * purgeEnglishLexicalizedParticipleRows runs real SQL against the in-memory
 * SQLite mock: an English book indexed before the backend kept "born" as its
 * own adjective has "born" under bear (glossed 곰). book_index only gains rows,
 * so those rows are dropped once; analysing the book again (PREPROCESS_VERSION
 * 13) adds the right ones.
 */

jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {
    PREPROCESS_VERSION,
    createBookIndexTable,
    createDictionaryCacheTable,
    insertBookIndexEntries,
    insertCacheEntries,
    lookupBookIndexBySurface,
    lookupCacheByStems,
    purgeEnglishLexicalizedParticipleRows,
} from '../Database';

const { __resetMockDatabases } = SQLite;
const EN = { language: 'en', interfaceLanguage: 'ko' };
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
    const stems = ['bear', 'born', 'lose', 'lost', 'break', 'leave', 'see', 'saw'];
    await insertCacheEntries(stems.map((stem) => ({ stem, definition: stem, gloss: stem })), EN);
    const rows = await lookupCacheByStems(stems, EN);
    const id = Object.fromEntries(rows.map((row) => [row.stem, row.id]));
    const index = [
        // Wrong: the participle under its verb.
        ['born', 'bear'], ['Born', 'bear'], ['lost', 'lose'], ['broken', 'break'],
        // Right, and kept.
        ['born', 'born'], ['lost', 'lost'], ['bore', 'bear'], ['left', 'leave'],
        ['saw', 'see'], ['saw', 'saw'],
    ];
    await insertBookIndexEntries('book-1', index.map(([surface, stem]) => ({ surface, stem_id: id[stem] })), OWNER);
});

test('the version makes English books analysed again', () => {
    expect(PREPROCESS_VERSION).toBeGreaterThanOrEqual(13);
});

test('drops the participles indexed under their verb and keeps the rest', async () => {
    expect(await stemsOf('born')).toEqual(['bear', 'born']);

    await purgeEnglishLexicalizedParticipleRows();

    expect(await stemsOf('born')).toEqual(['born']);
    expect(await stemsOf('Born')).toEqual([]);
    expect(await stemsOf('lost')).toEqual(['lost']);
    expect(await stemsOf('broken')).toEqual([]);
    expect(await stemsOf('bore')).toEqual(['bear']);
    expect(await stemsOf('left')).toEqual(['leave']);
    expect(await stemsOf('saw')).toEqual(['saw', 'see']);
});

test('leaves other languages alone and runs once', async () => {
    await insertCacheEntries([{ stem: 'bear', definition: 'ko row' }], KO);
    const [koBear] = await lookupCacheByStems(['bear'], KO);
    await insertBookIndexEntries('book-ko', [{ surface: 'born', stem_id: koBear.id }], { ownerId: 'owner-1', language: 'ko' });

    await purgeEnglishLexicalizedParticipleRows();
    expect(await stemsOf('born', 'book-ko', KO)).toEqual(['bear']);

    const [enBear] = await lookupCacheByStems(['bear'], EN);
    await insertBookIndexEntries('book-1', [{ surface: 'born', stem_id: enBear.id }], OWNER);
    await purgeEnglishLexicalizedParticipleRows();
    expect(await stemsOf('born')).toEqual(['bear', 'born']);
});
