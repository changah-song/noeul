jest.mock('../flashcardNomination', () => ({ remainingExposureFactor: () => 0 }));

const { ITEM_SLOPE } = require('../levelEngine');
const { MIN_LEVEL_VARIANCE, SESSION_CAP, fitReaderLevel, prepareRefitEvents } = require('../levelRefit');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const NOW = Date.UTC(2026, 10, 3);
const DAY = 24 * 60 * 60 * 1000;

const rng = (seed) => () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
};

// A reader with a true level and tap habits, reading `days` sessions.
const simulate = ({ theta, r, h, days = 20, perDay = 150, seed = 3 }) => {
    const random = rng(seed);
    const events = [];
    for (let d = 0; d < days; d += 1) {
        for (let i = 0; i < perDay; i += 1) {
            const difficulty = -3 + 6 * random();
            const known = random() < sigmoid(ITEM_SLOPE * (theta - difficulty));
            const tapped = random() < (known ? h : r);
            events.push({
                type: tapped ? 'lookup' : 'pass',
                stem: `w${Math.floor(random() * 3000)}`,
                // The reader marks every word on these pages as observed.
                levelMark: tapped ? 1 : null,
                difficulty,
                at: new Date(NOW - (days - d) * DAY + i * 1000).toISOString(),
                source: 'book://a',
            });
        }
    }
    return events;
};

describe('fitReaderLevel', () => {
    it.each([
        { theta: 0.8, r: 0.7, h: 0.05 },
        { theta: -1.2, r: 0.4, h: 0.15 },
        { theta: 0, r: 0.5, h: 0.08 },
    ])('recovers a reader at $theta who taps $r of unknown and $h of known words', (truth) => {
        const fit = fitReaderLevel(prepareRefitEvents(simulate(truth), { now: NOW }));
        expect(Math.abs(fit.theta - truth.theta)).toBeLessThan(0.45);
        expect(Math.abs(fit.lookupRate - truth.r)).toBeLessThan(0.12);
        expect(Math.abs(fit.knownTapRate - truth.h)).toBeLessThan(0.07);
    });

    it('reports a strong reader who rarely taps as unsure rather than wrong', () => {
        // From reading alone "higher level, taps more" and "lower level, taps
        // less" explain such a log almost equally well.
        [{ theta: 1.5, r: 0.25, h: 0.08 }, { theta: 2.2, r: 0.5, h: 0.05 }, { theta: -2, r: 0.5, h: 0.1 }].forEach((truth) => {
            const fit = fitReaderLevel(prepareRefitEvents(simulate(truth), { now: NOW }));
            expect(Math.abs(fit.theta - truth.theta)).toBeLessThan(2.5 * Math.sqrt(fit.variance));
        });
    });

    it('counts a long session as at most SESSION_CAP signals', () => {
        const prepared = prepareRefitEvents(simulate({ theta: 0, r: 0.5, h: 0.1, days: 1, perDay: 600 }), { now: NOW });
        const total = prepared.reading.reduce((s, x) => s + x.w, 0);
        expect(total).toBeLessThanOrEqual(SESSION_CAP + 1e-9);
    });

    it('is never surer than the floor', () => {
        const fit = fitReaderLevel(prepareRefitEvents(simulate({ theta: 0, r: 0.6, h: 0.05, days: 120 }), { now: NOW }));
        expect(fit.variance).toBeGreaterThanOrEqual(MIN_LEVEL_VARIANCE);
    });

    it('ignores lookups the reader marked as unobserved, and old unmarked ones of words never read past', () => {
        const base = simulate({ theta: 0.5, r: 0.5, h: 0.08, seed: 9 });
        // Taps on 的/了-like words, whose reading past is never logged.
        const easyTaps = Array.from({ length: 200 }, (_, i) => ({
            type: 'lookup', stem: `easy${i % 20}`, difficulty: -2.8, at: new Date(NOW - (i % 20) * DAY).toISOString(),
            levelMark: [0, null, 3][i % 3],
        }));
        const without = fitReaderLevel(prepareRefitEvents(base, { now: NOW }));
        const withTaps = fitReaderLevel(prepareRefitEvents([...base, ...easyTaps], { now: NOW }));
        expect(withTaps.theta).toBeCloseTo(without.theta, 6);
    });

    it('gives the same answer whatever order the events arrive in', () => {
        const events = simulate({ theta: 0.2, r: 0.5, h: 0.1, days: 5 });
        const a = fitReaderLevel(prepareRefitEvents(events, { now: NOW }));
        const b = fitReaderLevel(prepareRefitEvents([...events].reverse(), { now: NOW }));
        expect(b.theta).toBeCloseTo(a.theta, 8);
    });

    it('uses word-check answers and the guess rate', () => {
        const at = new Date(NOW - DAY).toISOString();
        const checks = [-2, -1, 0, 1, 2].map((difficulty, i) => ({ type: 'check', stem: `c${i}`, difficulty, outcome: difficulty < 0.5 ? 1 : 0, at }));
        const fit = fitReaderLevel(prepareRefitEvents([...checks, { type: 'pseudo', outcome: 0, at }], { now: NOW }));
        expect(fit.theta).toBeGreaterThan(-0.5);
        expect(fit.theta).toBeLessThan(1.8);
        expect(fit.guessRate).toBeCloseTo(1 / 21, 6);
    });

    it('counts a word looked up twice in a day once', () => {
        const at = (s) => new Date(NOW - DAY + s * 1000).toISOString();
        const prepared = prepareRefitEvents([
            { type: 'lookup', stem: '喉咙', difficulty: 1.9, at: at(1) },
            { type: 'lookup', stem: '喉咙', difficulty: 1.9, at: at(2) },
            { type: 'pass', stem: '喉咙', difficulty: 1.9, at: at(3) },
        ], { now: NOW });
        expect(prepared.reading.map((x) => x.type)).toEqual(['lookup', 'pass']);
    });
});
