jest.mock('../../constants/proficiencyLevels', () => ({
    PROFICIENCY_LEVEL_OPTIONS: {
        ko: [1, 2, 3, 4, 5, 6],
        zh: [1, 2, 3, 4, 5, 6, 7],
        en: [1, 2, 3, 4, 5, 6],
    },
}));
jest.mock('../flashcardNomination', () => ({ remainingExposureFactor: () => 0 }));

const {
    applySignal,
    buildWordKnowledge,
    difficultyFromZipf,
    driftVariance,
    groupKeys,
    lookupRateOf,
    readerState,
    seedState,
    wordDifficulty,
} = require('../levelEngine');

const DAY = 24 * 60 * 60 * 1000;
const fresh = () => readerState(null);

describe('reader level', () => {
    it('drops on a lookup and rises when a word is read past', () => {
        const start = seedState(fresh(), { theta: 0 });
        const looked = applySignal(start, { type: 'lookup', difficulty: 0 });
        const passed = applySignal(start, { type: 'pass', difficulty: 0 });
        expect(looked.state.theta).toBeLessThan(0);
        expect(passed.state.theta).toBeGreaterThan(0);
        expect(looked.log).toMatchObject({ signal: 'lookup', outcome: 1, thetaBefore: 0 });
    });

    it('moves a lot while unsure and little once settled', () => {
        const unsure = applySignal(seedState(fresh(), { theta: 0, variance: 2 }), { type: 'check', difficulty: 0, outcome: 0 });
        const settled = applySignal(seedState(fresh(), { theta: 0, variance: 0.1 }), { type: 'check', difficulty: 0, outcome: 0 });
        expect(Math.abs(unsure.log.thetaAfter)).toBeGreaterThan(4 * Math.abs(settled.log.thetaAfter));
        expect(unsure.state.variance).toBeLessThan(2);
    });

    it('trusts a read-past word more from a reader who taps everything', () => {
        const base = seedState(fresh(), { theta: 0 });
        const tapper = { ...base, lookupHits: 40, lookupExpected: 45 };
        const skimmer = { ...base, lookupHits: 2, lookupExpected: 30 };
        expect(lookupRateOf(tapper)).toBeGreaterThan(0.8);
        expect(lookupRateOf(skimmer)).toBeLessThan(0.2);
        const fromTapper = applySignal(tapper, { type: 'pass', difficulty: 0 }).log;
        const fromSkimmer = applySignal(skimmer, { type: 'pass', difficulty: 0 }).log;
        expect(fromTapper.thetaAfter).toBeGreaterThan(fromSkimmer.thetaAfter);
    });

    it('learns the lookup rate only from words it was unsure about', () => {
        const base = seedState(fresh(), { theta: 0 });
        const unsure = applySignal(base, { type: 'lookup', difficulty: 0.5 }).state;
        const easy = applySignal(base, { type: 'lookup', difficulty: -3 }).state;
        expect(unsure.lookupHits).toBe(1);
        expect(unsure.lookupExpected).toBeGreaterThan(0.5);
        expect(easy.lookupHits).toBe(0);
    });

    it('discounts "I know it" from a reader who claims made-up words', () => {
        let honest = seedState(fresh(), { theta: 0 });
        let claimer = seedState(fresh(), { theta: 0 });
        for (let i = 0; i < 10; i += 1) {
            honest = applySignal(honest, { type: 'pseudo', outcome: 0 }).state;
            claimer = applySignal(claimer, { type: 'pseudo', outcome: 1 }).state;
        }
        const a = applySignal(honest, { type: 'check', difficulty: 1, outcome: 1 }).log;
        const b = applySignal(claimer, { type: 'check', difficulty: 1, outcome: 1 }).log;
        expect(a.thetaAfter).toBeGreaterThan(b.thetaAfter);
    });

    it('regains variance between sessions, up to the prior', () => {
        const now = Date.UTC(2026, 9, 19);
        expect(driftVariance(0.1, new Date(now - 10 * DAY), new Date(now))).toBeCloseTo(0.14, 5);
        expect(driftVariance(1.9, new Date(now - 1000 * DAY), new Date(now))).toBe(2);
    });

    it('reads old rows: no stored variance means the event count decides', () => {
        expect(readerState({ theta: 1, event_count: 0 }).variance).toBe(2);
        expect(readerState({ theta: 1, event_count: 300 }).variance).toBeLessThan(0.2);
        expect(readerState({ theta: 1, theta_var: 0.4, event_count: 300 }).variance).toBe(0.4);
    });

    it('ignores a signal without a difficulty', () => {
        const start = fresh();
        expect(applySignal(start, { type: 'lookup' })).toEqual({ state: start, log: null });
    });
});

describe('word difficulty', () => {
    it('blends the level with how common the word is', () => {
        const rareTop = wordDifficulty({ language: 'ko', percentile: 0.65, zipf: 3.3 });
        const common = wordDifficulty({ language: 'ko', percentile: 0.002, zipf: 5.66 });
        expect(rareTop.difficulty).toBeGreaterThan(1);
        expect(common.difficulty).toBeLessThan(-2);
        expect(rareTop.graded).toBe(true);
    });

    it('uses frequency alone for an ungraded word, and the ceiling for an unknown one', () => {
        expect(wordDifficulty({ language: 'zh', zipf: 6.5 }).difficulty).toBe(-3);
        expect(wordDifficulty({ language: 'zh' })).toMatchObject({ difficulty: 3, graded: false });
        expect(difficultyFromZipf(null)).toBeNull();
    });

    it('makes Korean loanwords easier, not Chinese ones', () => {
        const ko = wordDifficulty({ language: 'ko', levelRank: 4, zipf: 4, loanword: 1 });
        const koNative = wordDifficulty({ language: 'ko', levelRank: 4, zipf: 4 });
        const zh = wordDifficulty({ language: 'zh', levelRank: 4, zipf: 4, loanword: 1 });
        const zhPlain = wordDifficulty({ language: 'zh', levelRank: 4, zipf: 4 });
        expect(ko.difficulty).toBeLessThan(koNative.difficulty);
        expect(zh.difficulty).toBe(zhPlain.difficulty);
    });
});

describe('word knowledge', () => {
    const now = Date.UTC(2026, 9, 19);
    const reader = { theta: 0, variance: 0.3, lookupRate: 0.5, guessRate: 0.05 };

    it('groups Korean words by family and Chinese words by character', () => {
        expect(groupKeys('ko', '공부하다')).toEqual(['f:공부']);
        expect(groupKeys('ko', '공부')).toEqual(['f:공부']);
        expect(groupKeys('zh', '厮杀')).toEqual(['c:厮', 'c:杀']);
    });

    it('marks a word looked up three times this week as unknown', () => {
        const knowledge = buildWordKnowledge({
            language: 'ko',
            reader,
            difficulties: new Map([['소문', 0]]),
            events: [{ stem: '소문', type: 'lookup', n: 3, at: new Date(now - DAY) }],
            now,
        });
        expect(knowledge('소문').p).toBeLessThan(0.25);
    });

    it('treats an old lookup followed by many read-pasts as learned', () => {
        const knowledge = buildWordKnowledge({
            language: 'ko',
            reader,
            difficulties: new Map([['소문', 0]]),
            events: [
                { stem: '소문', type: 'lookup', n: 1, at: new Date(now - 60 * DAY) },
                ...Array.from({ length: 20 }, (_, i) => ({
                    stem: '소문', type: 'pass', n: 1, at: new Date(now - (50 - i * 2) * DAY),
                })),
            ],
            now,
        });
        expect(knowledge('소문').p).toBeGreaterThan(0.6);
    });

    it('shares knowledge within a Korean word family', () => {
        const difficulties = new Map([['공부', 0], ['공부하다', 0]]);
        const knowledge = buildWordKnowledge({
            language: 'ko',
            reader,
            difficulties,
            events: [{ stem: '공부', type: 'lookup', n: 3, at: new Date(now - DAY) }],
            now,
        });
        const untouched = buildWordKnowledge({ language: 'ko', reader, difficulties, events: [], now });
        expect(knowledge('공부하다').p).toBeLessThan(untouched('공부하다').p);
    });

    it('makes a Chinese word as unknown as its least-known character', () => {
        const difficulties = new Map([['杀人', 0], ['手', 0], ['厮打', 0], ['厮杀', 0], ['杀手', 0]]);
        const events = [
            ...Array.from({ length: 8 }, () => ({ stem: '杀人', type: 'pass', n: 1, at: new Date(now - DAY) })),
            ...Array.from({ length: 8 }, () => ({ stem: '手', type: 'pass', n: 1, at: new Date(now - DAY) })),
            { stem: '厮打', type: 'lookup', n: 2, at: new Date(now - DAY) },
        ];
        const knowledge = buildWordKnowledge({ language: 'zh', reader, difficulties, events, now });
        const none = buildWordKnowledge({ language: 'zh', reader, difficulties, events: [], now });
        expect(knowledge('杀手').p).toBeGreaterThan(none('杀手').p);
        expect(knowledge('厮杀').p).toBeLessThan(none('厮杀').p);
    });

    it('darkens a saved word', () => {
        const difficulties = new Map([['감자', 0]]);
        const saved = buildWordKnowledge({ language: 'ko', reader, difficulties, saved: new Set(['감자']), now });
        const plain = buildWordKnowledge({ language: 'ko', reader, difficulties, now });
        expect(saved('감자').p).toBeLessThan(plain('감자').p);
    });
});
