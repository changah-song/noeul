jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
    createDictionaryCacheTable,
    createTable,
    getLearnedWords,
    getSavedWordFades,
    getSavedWords,
    insertData,
    migrateVocabTable,
    recordSavedWordSightings,
    resetSavedWordFade,
    restoreLearnedWord,
    viewData,
} from '../Database';
import {
    SAVED_WORD_FADE_GAP_MS,
    SAVED_WORD_FADE_STEPS,
    fadeStrength,
    highlightStrengthsFor,
    savedWordsForSurfaces,
    unseenShownTerms,
} from '../savedWordFade';

const { __resetMockDatabases } = SQLite;
const OWNER = 'fade-owner';
const scope = { ownerId: OWNER, language: 'ko' };

describe('saved word fade helpers', () => {
    it('fades linearly to nothing over the steps', () => {
        expect(fadeStrength(0)).toBe(1);
        expect(fadeStrength(SAVED_WORD_FADE_STEPS / 2)).toBeCloseTo(0.5, 10);
        expect(fadeStrength(SAVED_WORD_FADE_STEPS)).toBe(0);
        expect(fadeStrength(99)).toBe(0);
    });

    it('gives each in-book form its saved word\'s strength, and leaves full ones out', () => {
        const surfaceToWord = new Map([['소문을', '소문'], ['소문이', '소문']]);
        const fades = new Map([['소문', 3]]);
        expect(highlightStrengthsFor(['소문', '소문을', '소문이', '감자'], surfaceToWord, fades)).toEqual({
            소문: 0.5, 소문을: 0.5, 소문이: 0.5,
        });
        expect(highlightStrengthsFor(['감자'], surfaceToWord, new Map())).toEqual({});
    });

    it('maps passed surfaces to their saved words, skipping looked-up ones', () => {
        const surfaceToWord = new Map([['소문을', '소문'], ['감자를', '감자']]);
        expect(savedWordsForSurfaces(['소문을', '소문', '감자를'], surfaceToWord, new Set(['감자를']))).toEqual(['소문']);
    });
});

describe('saved word fading in the database', () => {
    beforeEach(async () => {
        __resetMockDatabases();
        await createTable();
        await migrateVocabTable();
        await createDictionaryCacheTable();
        await insertData('소문', null, 'rumor', { ...scope });
        await insertData('감자', null, 'potato', { ...scope });
    });

    it('counts a pass once per gap, and makes the word learned after the last step', async () => {
        let now = Date.UTC(2026, 9, 19, 9);
        const first = await recordSavedWordSightings({ ...scope, words: ['소문'], now });
        expect(first.faded.get('소문')).toBe(1);

        // A flick past it again a few seconds later doesn't count again.
        const again = await recordSavedWordSightings({ ...scope, words: ['소문'], now: now + 5000 });
        expect(again.faded.size).toBe(0);

        let result;
        for (let step = 2; step <= SAVED_WORD_FADE_STEPS; step += 1) {
            now += SAVED_WORD_FADE_GAP_MS;
            result = await recordSavedWordSightings({ ...scope, words: ['소문'], now });
        }
        expect(result.learned).toEqual(['소문']);

        expect(await getSavedWords(scope)).toEqual(['감자']);
        const learned = await getLearnedWords(scope);
        expect(learned.map((row) => row.word)).toEqual(['소문']);
        // Still kept, with its definition.
        expect(learned[0].def).toBe('rumor');
        const rows = await viewData(scope);
        expect(rows.find((row) => row.word === '소문').level).toBe('learned');
    });

    it('does not fade a word on the page or sentence right after it was saved', async () => {
        await insertData('처녀', null, 'maiden', { ...scope });
        const savedAt = Date.now();
        const right = await recordSavedWordSightings({ ...scope, words: ['처녀'], now: savedAt + 2000 });
        expect(right.faded.size).toBe(0);
        const later = await recordSavedWordSightings({ ...scope, words: ['처녀'], now: savedAt + SAVED_WORD_FADE_GAP_MS + 1000 });
        expect(later.faded.get('처녀')).toBe(1);
    });

    it('brings a fading word back in full when it is looked up', async () => {
        const now = Date.UTC(2026, 9, 19, 9);
        await recordSavedWordSightings({ ...scope, words: ['감자'], now });
        await recordSavedWordSightings({ ...scope, words: ['감자'], now: now + SAVED_WORD_FADE_GAP_MS });
        expect((await getSavedWordFades(scope)).get('감자')).toBe(2);

        await resetSavedWordFade({ ...scope, words: ['감자'] });
        expect((await getSavedWordFades(scope)).has('감자')).toBe(false);
    });

    it('moves a learned word back to the saved words', async () => {
        let now = Date.UTC(2026, 9, 19, 9);
        for (let step = 1; step <= SAVED_WORD_FADE_STEPS; step += 1) {
            await recordSavedWordSightings({ ...scope, words: ['소문'], now });
            now += SAVED_WORD_FADE_GAP_MS;
        }
        const [learned] = await getLearnedWords(scope);
        await restoreLearnedWord({ ...scope, id: learned.id });

        expect((await getSavedWords(scope)).sort()).toEqual(['감자', '소문']);
        expect(await getLearnedWords(scope)).toEqual([]);
        expect((await getSavedWordFades(scope)).has('소문')).toBe(false);
    });

    it('ignores words that are not saved', async () => {
        const result = await recordSavedWordSightings({ ...scope, words: ['없는말'], now: Date.now() });
        expect(result.faded.size).toBe(0);
        expect(result.learned).toEqual([]);
    });
});

describe('unseenShownTerms', () => {
    test('counts each saved word once per page per session', () => {
        const counted = new Set();
        expect(unseenShownTerms(counted, 'book', 'paged:0:3', ['소문', '감자'])).toEqual(['소문', '감자']);
        // Paging back to the same page.
        expect(unseenShownTerms(counted, 'book', 'paged:0:3', ['소문', '감자'])).toEqual([]);
        // The next page.
        expect(unseenShownTerms(counted, 'book', 'paged:0:4', ['소문'])).toEqual(['소문']);
        // Another book's page with the same index.
        expect(unseenShownTerms(counted, 'other', 'paged:0:3', ['소문'])).toEqual(['소문']);
    });
});
