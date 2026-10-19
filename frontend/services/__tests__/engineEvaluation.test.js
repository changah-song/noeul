jest.mock('../flashcardNomination', () => ({ remainingExposureFactor: () => 0 }));
jest.mock('../../constants/proficiencyLevels', () => ({
    PROFICIENCY_LEVEL_OPTIONS: { ko: [1, 2, 3, 4, 5, 6], zh: [1, 2, 3, 4, 5, 6, 7] },
}));

const { brier, evaluateEngine, logLoss, rocAuc } = require('../engineEvaluation');

describe('engine evaluation', () => {
    it('scores rankings and probabilities', () => {
        expect(rocAuc([{ score: 0.9, y: 1 }, { score: 0.1, y: 0 }])).toBe(1);
        expect(rocAuc([{ score: 0.1, y: 1 }, { score: 0.9, y: 0 }])).toBe(0);
        expect(rocAuc([{ score: 0.5, y: 1 }, { score: 0.5, y: 0 }])).toBe(0.5);
        expect(rocAuc([{ score: 0.5, y: 1 }])).toBeNull();
        expect(brier([{ score: 1, y: 1 }, { score: 0, y: 1 }])).toBe(0.5);
        expect(logLoss([{ score: 0.5, y: 1 }])).toBeCloseTo(Math.log(2), 10);
    });

    it('predicts before each event and keeps profiles apart', () => {
        const at = (minutes) => new Date(Date.UTC(2026, 9, 1) + minutes * 60000).toISOString();
        const events = [
            { ownerId: 'a', profileId: 'p', language: 'ko', stem: '학교', eventType: 'exposure', outcome: 1, createdAt: at(1), levelRank: 1, zipf: 5.7 },
            { ownerId: 'a', profileId: 'p', language: 'ko', stem: '공동묘지', eventType: 'lookup', outcome: null, createdAt: at(2), levelRank: 6, zipf: 3.3 },
            { ownerId: 'a', profileId: 'p', language: 'ko', stem: '감자', eventType: 'check', outcome: 1, createdAt: at(3), levelRank: 2, zipf: 4.3 },
            { ownerId: 'b', profileId: 'p', language: 'zh', stem: '厮杀', eventType: 'lookup', outcome: null, createdAt: at(1), levelRank: 7, zipf: 3.2 },
        ];
        const result = evaluateEngine(events);
        expect(result.profiles.map((p) => p.key).sort()).toEqual(['a|p|ko', 'b|p|zh']);
        expect(result.v2.reading.n).toBe(3);
        expect(result.v2.check.n).toBe(1);
        // A hard word is a likelier lookup than an easy one, before anything is learned.
        expect(result.v2.reading.auc).toBe(1);
    });
});
