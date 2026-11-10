/**
 * insertCacheEntries with keepSenses (chapter and song preprocessing): a
 * book is sent in pieces, and each piece's response may word a translation
 * differently. The first one a preprocessing version wrote stays, so the label
 * under a word doesn't change as the reader reads on. Runs real SQL against
 * the in-memory SQLite mock.
 */

jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { createDictionaryCacheTable, insertCacheEntries, lookupCacheByStems } from '../Database';

const { __resetMockDatabases } = SQLite;
const EN = { language: 'en', interfaceLanguage: 'ko' };
const PREPROCESS = { keepSenses: true };

const rowFor = async (stem) => (await lookupCacheByStems([stem], EN))[0];

beforeEach(async () => {
    __resetMockDatabases();
    await AsyncStorage.clear();
    await createDictionaryCacheTable();
});

test('a later piece keeps the first gloss and definition', async () => {
    await insertCacheEntries([{ stem: 'father', gloss: '아버지', definition: 'a male parent' }], EN, PREPROCESS);
    await insertCacheEntries([{ stem: 'father', gloss: '아빠', definition: 'dad' }], EN, PREPROCESS);
    expect(await rowFor('father')).toMatchObject({ gloss: '아버지', definition: 'a male parent' });
});

test('an empty gloss is still filled in', async () => {
    await insertCacheEntries([{ stem: 'tide', gloss: null, definition: null }], EN, PREPROCESS);
    await insertCacheEntries([{ stem: 'tide', gloss: '조수' }], EN, PREPROCESS);
    expect((await rowFor('tide')).gloss).toBe('조수');
});

test('rows from before (or another version) are replaced', async () => {
    await insertCacheEntries([{ stem: 'bore', gloss: '곰' }], EN);
    await insertCacheEntries([{ stem: 'bore', gloss: '지루하게 하다' }], EN, PREPROCESS);
    await insertCacheEntries([{ stem: 'bore', gloss: '구멍' }], EN, PREPROCESS);
    expect((await rowFor('bore')).gloss).toBe('지루하게 하다');
});

test('a live lookup still replaces the gloss', async () => {
    await insertCacheEntries([{ stem: 'keeper', gloss: '관리인' }], EN, PREPROCESS);
    await insertCacheEntries([{ stem: 'keeper', gloss: '수호자' }], EN);
    expect((await rowFor('keeper')).gloss).toBe('수호자');
});
