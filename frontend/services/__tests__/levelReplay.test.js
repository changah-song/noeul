jest.mock('../flashcardNomination', () => ({ remainingExposureFactor: () => 0 }));

const engine = require('../levelEngine');
const { calibration, eventsFromAbilityLog, replayLevelLog } = require('../levelReplay');

const row = (signal, at, extra = {}) => ({
    signal, created_at: at, stem: extra.stem ?? null, outcome: extra.outcome ?? null,
    difficulty: extra.difficulty ?? null, theta_before: extra.thetaBefore ?? null,
    var_before: extra.varBefore ?? null, theta_after: extra.thetaAfter ?? null,
});

describe('replayLevelLog', () => {
    it('reads the dashboard export oldest first and starts from the logged level', () => {
        const events = eventsFromAbilityLog([
            row('pass', '2026-10-20T10:00:00Z', { stem: '走廊', difficulty: 1.8 }),
            row('lookup', '2026-10-19T10:00:00Z', { stem: '溪流', difficulty: 1.9, outcome: 1, thetaBefore: 0.6, varBefore: 0.3 }),
        ]);
        expect(events.map((e) => e.stem)).toEqual(['溪流', '走廊']);
        const result = replayLevelLog(events, engine);
        expect(result.reading.n).toBe(2);
        expect(result.daily[0].theta).toBeLessThan(0.6);
        expect(result.daily[0].theta).toBeGreaterThan(0);
    });

    it('applies the app\'s lookup rules when asked', () => {
        const at = (s) => `2026-10-19T10:00:${String(s).padStart(2, '0')}Z`;
        const events = eventsFromAbilityLog([
            row('seed', at(0), { thetaAfter: 0 }),
            row('lookup', at(1), { stem: '的', difficulty: -3, outcome: 1 }),
            row('lookup', at(2), { stem: '喉咙', difficulty: 1.9, outcome: 1 }),
            row('lookup', at(3), { stem: '喉咙', difficulty: 1.9, outcome: 1 }),
        ]);
        expect(replayLevelLog(events, engine).reading.n).toBe(3);
        const app = replayLevelLog(events, engine, { lookupOncePerDay: true, lookupOnlyIfMarked: true });
        expect(app.reading.n).toBe(1);
        expect(app.skipped).toBe(2);
    });

    it('scores check answers from the level before the check began', () => {
        const at = (s) => `2026-10-19T10:00:${String(s).padStart(2, '0')}Z`;
        const events = eventsFromAbilityLog([
            row('seed', at(0), { thetaAfter: -2.5 }),
            row('check_start', at(1)),
            ...[-2, -1, 0, 1].map((d, i) => row('check', at(2 + i), { stem: `w${i}`, difficulty: d, outcome: 1 })),
        ]);
        const result = replayLevelLog(events, engine);
        expect(result.fromReading.n).toBe(4);
        // From reading the reader looked weak; the answers lift the later predictions.
        expect(result.check.meanPredicted).toBeGreaterThan(result.fromReading.meanPredicted);
        expect(result.final.theta).toBeGreaterThan(-1);
    });

    it('bins predictions into tenths', () => {
        const bins = calibration([{ score: 0.05, y: 0 }, { score: 0.07, y: 1 }, { score: 0.95, y: 1 }]);
        expect(bins.map((b) => [b.bin, b.n, b.observed])).toEqual([[0, 2, 0.5], [9, 1, 1]]);
        expect(bins[0].predicted).toBeCloseTo(0.06, 10);
    });
});
