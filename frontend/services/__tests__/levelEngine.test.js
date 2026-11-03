jest.mock('../../constants/proficiencyLevels', () => ({
    PROFICIENCY_LEVEL_OPTIONS: {
        ko: [1, 2, 3, 4, 5, 6],
        zh: [1, 2, 3, 4, 5, 6, 7],
        en: [1, 2, 3, 4, 5, 6],
    },
}));
jest.mock('../flashcardNomination', () => ({ remainingExposureFactor: () => 0 }));

const {
    LOOKUP_GIVEN_KNOWN,
    applySignal,
    buildWordKnowledge,
    difficultyFromZipf,
    driftVariance,
    groupKeys,
    lookupRateOf,
    readerState,
    seedState,
    widenState,
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

    it('learns the reader\'s lookup habit from what they look up', () => {
        // Same level, different habits: one taps most unknown words, one few.
        const sigmoid = (x) => 1 / (1 + Math.exp(-x));
        let seed = 3;
        const random = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        const read = (rate, checks = 0) => {
            let state = seedState(fresh(), { theta: 0, variance: 1 });
            for (let i = 0; i < 600; i += 1) {
                const difficulty = -3 + 6 * random();
                const known = random() < sigmoid(0.3 - difficulty);
                if (checks && i % Math.floor(600 / checks) === 0) {
                    state = applySignal(state, { type: 'check', difficulty, outcome: known ? 1 : 0 }).state;
                    continue;
                }
                const looked = known ? random() < LOOKUP_GIVEN_KNOWN : random() < rate;
                state = applySignal(state, { type: looked ? 'lookup' : 'pass', difficulty }).state;
            }
            return state;
        };
        const tapper = read(0.85);
        const skimmer = read(0.2);
        expect(lookupRateOf(tapper)).toBeGreaterThan(0.65);
        expect(lookupRateOf(skimmer)).toBeLessThan(0.35);
        // A reader who taps most unknown words gives their level away by
        // reading alone; one who rarely taps needs a few word-check answers.
        expect(Math.abs(tapper.theta - 0.3)).toBeLessThan(0.4);
        expect(Math.abs(read(0.2, 15).theta - 0.3)).toBeLessThan(0.4);
    });

    it('keeps the learned habit when the level is set again', () => {
        let state = seedState(fresh(), { theta: 0 });
        for (let i = 0; i < 50; i += 1) state = applySignal(state, { type: 'lookup', difficulty: 2 }).state;
        const rate = lookupRateOf(state);
        const reseeded = seedState(state, { theta: 1 });
        expect(reseeded.theta).toBe(1);
        expect(lookupRateOf(reseeded)).toBeCloseTo(rate, 10);
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

    it('never moves the level against the signal, whatever the habits learn', () => {
        // Many habits, settled low: re-weighing them used to drag the mixed
        // level down on a word read past and up on a lookup.
        let state = seedState(fresh(), { theta: -2.3, variance: 0.04 });
        for (let i = 0; i < 300; i += 1) {
            state = applySignal(state, { type: i % 3 ? 'pass' : 'lookup', difficulty: (i % 13) * 0.45 - 2.7 }).state;
        }
        [-2.5, -1, 0, 1.5, 2.8].forEach((difficulty) => {
            const pass = applySignal(state, { type: 'pass', difficulty }).log;
            const lookup = applySignal(state, { type: 'lookup', difficulty }).log;
            const yes = applySignal(state, { type: 'check', difficulty, outcome: 1 }).log;
            const no = applySignal(state, { type: 'review', difficulty, outcome: 0 }).log;
            expect(pass.thetaAfter).toBeGreaterThanOrEqual(pass.thetaBefore - 1e-12);
            expect(lookup.thetaAfter).toBeLessThanOrEqual(lookup.thetaBefore + 1e-12);
            expect(yes.thetaAfter).toBeGreaterThanOrEqual(yes.thetaBefore - 1e-12);
            expect(no.thetaAfter).toBeLessThanOrEqual(no.thetaBefore + 1e-12);
        });
    });

    it('widens every habit, not just the summary', () => {
        const settled = seedState(fresh(), { theta: 1, variance: 0.05 });
        const wide = widenState(settled, 2);
        expect(wide.theta).toBe(1);
        expect(wide.variance).toBeCloseTo(2, 5);
        wide.hypotheses.forEach((h) => expect(h.variance).toBe(2));
        const moved = applySignal(wide, { type: 'check', difficulty: 1, outcome: 1 }).state.theta;
        const stuck = applySignal(settled, { type: 'check', difficulty: 1, outcome: 1 }).state.theta;
        expect(moved - 1).toBeGreaterThan(5 * (stuck - 1));
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

describe('Chinese difficulty', () => {
    const { compoundDifficulty, compoundSplits } = require('../levelEngine');

    it('spreads HSK 7–9 by frequency between the HSK 6 position and the top', () => {
        const at = (zipf) => wordDifficulty({ language: 'zh', levelRank: 7, zipf }).parts.band;
        expect(at(5.5)).toBeCloseTo(2, 6);
        expect(at(4)).toBeCloseTo(2.5, 6);
        expect(at(2.5)).toBeCloseTo(3, 6);
        // Without a frequency, the band stays where it was; other languages too.
        expect(wordDifficulty({ language: 'zh', levelRank: 7 }).parts.band).toBe(3);
        expect(wordDifficulty({ language: 'ko', levelRank: 6, zipf: 5 }).parts.band).toBe(3);
    });

    it('splits verb + complement and three-character compounds, not idioms', () => {
        expect(compoundSplits('zh', '铐起来')).toContainEqual({ kind: 'complement', parts: ['铐', '起来'] });
        expect(compoundSplits('zh', '面包店')).toContainEqual({ kind: 'compound', parts: ['面包', '店'] });
        expect(compoundSplits('zh', '灵机一动')).toEqual([]);
        expect(compoundSplits('ko', '먹었다')).toEqual([]);
    });

    it('takes the easiest reading of the parts, and none when a part is unknown', () => {
        const known = { 吃: -3, 孩子: -2.5, 野: 0.5 };
        const of = (part) => (part in known ? known[part] : null);
        expect(compoundDifficulty('zh', '吃掉', of)).toEqual({ difficulty: -2.8, parts: ['吃', '掉'] });
        expect(compoundDifficulty('zh', '野孩子', of)).toEqual({ difficulty: 0.9, parts: ['野', '孩子'] });
        expect(compoundDifficulty('zh', '蒲公英', of)).toBeNull();
    });

    it('lowers a word with its own difficulty by at most MAX_COMPOUND_EASE', () => {
        const { MAX_COMPOUND_EASE } = require('../levelEngine');
        const of = (part) => ({ 想: -3 }[part] ?? null);
        // 想开 "get over it": an idiom, not think + open.
        expect(compoundDifficulty('zh', '想开', of, 1.92).difficulty).toBeCloseTo(1.92 - MAX_COMPOUND_EASE, 6);
        expect(compoundDifficulty('zh', '想开', of, -3)).toBeNull();
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
