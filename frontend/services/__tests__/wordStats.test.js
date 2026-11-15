jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
    createAccountLookupWordsTable,
    createDictionaryCacheTable,
    createInteractionEventsTable,
    createTable,
    createVocabContextTable,
    getLearnedWords,
    getWordStats,
    insertData,
    logInteractionEvent,
    migrateInteractionEventsTable,
    migrateVocabTable,
    recordSavedWordSightings,
    removeData,
} from '../Database';
import { SAVED_WORD_FADE_GAP_MS, SAVED_WORD_FADE_STEPS } from '../savedWordFade';

const { __resetMockDatabases } = SQLite;
const OWNER = 'stats-owner';
const scope = { ownerId: OWNER, language: 'ko' };

const lookup = (word, stem, extra = {}) => logInteractionEvent({ ...scope, word, stem, eventType: 'lookup', ...extra });

const learn = async (word) => {
    let now = Date.UTC(2026, 10, 15, 9);
    for (let step = 1; step <= SAVED_WORD_FADE_STEPS; step += 1) {
        now += SAVED_WORD_FADE_GAP_MS;
        await recordSavedWordSightings({ ...scope, words: [word], now });
    }
};

describe('getWordStats', () => {
    beforeEach(async () => {
        __resetMockDatabases();
        await createTable();
        await migrateVocabTable();
        await createVocabContextTable();
        await createDictionaryCacheTable();
        await createInteractionEventsTable();
        await migrateInteractionEventsTable();
        await createAccountLookupWordsTable();
    });

    it('is all zeros before the reader has done anything', async () => {
        expect(await getWordStats(scope)).toEqual({ met: 0, learning: 0, learned: 0 });
    });

    it('counts a looked-up word once, whatever form was tapped and however often', async () => {
        await lookup('누워', '눕다');
        await lookup('누웠다', '눕다');
        await lookup('눕다', '눕다');
        await lookup('감자', '감자');
        // Reading past a word is not meeting a new one.
        await logInteractionEvent({ ...scope, word: '사과', stem: '사과', eventType: 'exposure' });

        expect(await getWordStats(scope)).toEqual({ met: 2, learning: 0, learned: 0 });
    });

    it('counts a saved word as met even with no lookup on record, and not twice with one', async () => {
        await insertData('소문', null, 'rumor', { ...scope });
        await insertData('감자', null, 'potato', { ...scope });
        await lookup('감자를', '감자');

        expect(await getWordStats(scope)).toEqual({ met: 2, learning: 2, learned: 0 });
    });

    it('moves a faded-out word from learning to learned, matching the Learned list', async () => {
        await insertData('소문', null, 'rumor', { ...scope });
        await insertData('감자', null, 'potato', { ...scope });
        await learn('소문');

        const stats = await getWordStats(scope);
        expect(stats).toEqual({ met: 2, learning: 1, learned: 1 });
        const list = await getLearnedWords(scope);
        expect(list.map((row) => row.word)).toEqual(['소문']);
        expect(list).toHaveLength(stats.learned);
    });

    it('stops counting a removed word as learning, but keeps it as met if it was looked up', async () => {
        await insertData('소문', null, 'rumor', { ...scope });
        await lookup('소문', '소문');
        await removeData('소문', null, 'rumor', 'ko', { ...scope });

        expect(await getWordStats(scope)).toEqual({ met: 1, learning: 0, learned: 0 });
    });

    it('keeps other languages and owners out', async () => {
        await lookup('감자', '감자');
        await logInteractionEvent({ ownerId: OWNER, language: 'en', word: 'rumor', stem: 'rumor', eventType: 'lookup' });
        await logInteractionEvent({ ownerId: 'someone-else', language: 'ko', word: '소문', stem: '소문', eventType: 'lookup' });

        expect(await getWordStats(scope)).toEqual({ met: 1, learning: 0, learned: 0 });
    });
});
