jest.mock('../hanjaDatabase', () => ({
    initializeHanjaDatabase: jest.fn().mockResolvedValue(undefined),
}));

import * as SQLite from 'expo-sqlite';
import {
    applyWordCheckResults,
    createAbilityLogTable,
    createDictionaryCacheTable,
    createInteractionEventsTable,
    createProfileAbilityTable,
    getAbilityLog,
    getReaderLevel,
} from '../Database';
import { readerState, seedState } from '../levelEngine';
import {
    WORD_CHECK_PSEUDO,
    WORD_CHECK_REAL,
    createWordCheck,
    hasWordCheck,
    pseudoSlots,
    wordCheckPool,
} from '../wordCheck';

const { __resetMockDatabases } = SQLite;

const run = (check, answerFor) => {
    let prompt = check.next();
    while (prompt) {
        check.answer(answerFor(prompt));
        prompt = check.next();
    }
    return check.result();
};

describe('word check', () => {
    it('ships pools for Korean and Chinese with made-up words outside the real ones', () => {
        expect(hasWordCheck('ko')).toBe(true);
        expect(hasWordCheck('zh')).toBe(true);
        expect(hasWordCheck('en')).toBe(false);
        ['ko', 'zh'].forEach((language) => {
            const pool = wordCheckPool(language);
            expect(pool.words.length).toBeGreaterThan(200);
            expect(pool.pseudo.length).toBeGreaterThanOrEqual(WORD_CHECK_PSEUDO);
            const real = new Set(pool.words.map((item) => item.word));
            expect(pool.pseudo.some((word) => real.has(word))).toBe(false);
            pool.words.forEach((item) => expect(Number.isFinite(item.difficulty)).toBe(true));
        });
    });

    it('spreads the made-up words over the test, never first', () => {
        let seed = 7;
        const random = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        const slots = pseudoSlots(36, 8, random);
        expect(slots.size).toBe(8);
        expect(slots.has(0)).toBe(false);
        expect(Math.max(...slots)).toBeLessThan(36);
    });

    it('asks every word once and mixes in the made-up ones', () => {
        const check = createWordCheck({ language: 'ko', reader: readerState(null), seed: 3 });
        const seen = [];
        const result = run(check, (prompt) => {
            seen.push(prompt);
            return prompt.pseudo ? 0 : 1;
        });
        expect(seen).toHaveLength(WORD_CHECK_REAL + WORD_CHECK_PSEUDO);
        expect(new Set(seen.map((p) => p.word)).size).toBe(seen.length);
        expect(seen.filter((p) => p.pseudo)).toHaveLength(WORD_CHECK_PSEUDO);
        expect(result).toMatchObject({ real: WORD_CHECK_REAL, known: WORD_CHECK_REAL, pseudoClaimed: 0 });
    });

    it('follows the reader: knowing everything climbs, knowing nothing falls', () => {
        const start = seedState(readerState(null), { theta: 0 });
        const high = run(createWordCheck({ language: 'zh', reader: start, seed: 11 }), (p) => (p.pseudo ? 0 : 1));
        const low = run(createWordCheck({ language: 'zh', reader: start, seed: 11 }), () => 0);
        expect(high.theta).toBeGreaterThan(1.5);
        expect(low.theta).toBeLessThan(-1.5);
    });

    it('trusts "I know it" less from a reader who claims made-up words', () => {
        const start = seedState(readerState(null), { theta: 0 });
        // Knows the words below difficulty 0.5; the claimer also says yes to made-up ones.
        const knows = (p) => (p.difficulty < 0.5 ? 1 : 0);
        const honest = run(createWordCheck({ language: 'ko', reader: start, seed: 5 }), (p) => (p.pseudo ? 0 : knows(p)));
        const claimer = run(createWordCheck({ language: 'ko', reader: start, seed: 5 }), (p) => (p.pseudo ? 1 : knows(p)));
        expect(claimer.pseudoClaimed).toBe(WORD_CHECK_PSEUDO);
        expect(claimer.guessRate).toBeGreaterThan(honest.guessRate);
        expect(claimer.theta).toBeLessThan(honest.theta);
    });
});

describe('applyWordCheckResults', () => {
    beforeEach(async () => {
        __resetMockDatabases();
        await createProfileAbilityTable();
        await createDictionaryCacheTable();
        await createInteractionEventsTable();
        await createAbilityLogTable();
    });

    it('saves the answers as events and log rows, and moves the level', async () => {
        const answers = [
            { word: '사람', pseudo: false, outcome: 1, difficulty: -2.5, at: '2026-10-19T01:00:00.000Z' },
            { word: '거게', pseudo: true, outcome: 0, at: '2026-10-19T01:00:05.000Z' },
            { word: '공동묘지', pseudo: false, outcome: 1, difficulty: 1.2, at: '2026-10-19T01:00:10.000Z' },
        ];
        const state = await applyWordCheckResults({ ownerId: 'u1', language: 'ko', answers });

        expect(state.theta).toBeGreaterThan(0);
        const level = await getReaderLevel({ ownerId: 'u1', language: 'ko' });
        expect(level.theta).toBeCloseTo(state.theta, 10);
        expect(level.guessTotal).toBe(1);

        const logs = await getAbilityLog({ ownerId: 'u1', language: 'ko' });
        expect(logs.map((row) => row.signal).sort()).toEqual(['check', 'check', 'check_start', 'pseudo']);

        const events = await new Promise((resolve) => {
            SQLite.openDatabase('fluentfable.db').transaction((tx) => {
                tx.executeSql('SELECT event_type, word, stem, outcome FROM interaction_events ORDER BY created_at', [], (_, r) => resolve(r.rows._array));
            });
        });
        expect(events).toEqual([
            { event_type: 'check', word: '사람', stem: '사람', outcome: 1 },
            { event_type: 'check_pseudo', word: '거게', stem: null, outcome: 0 },
            { event_type: 'check', word: '공동묘지', stem: '공동묘지', outcome: 1 },
        ]);
    });
});
