import { PACE_WINDOW_MS, createReadingPaceTracker, maxReadingPace } from '../readingPace';

describe('reading pace', () => {
    it('counts pages read at a human pace', () => {
        const pace = createReadingPaceTracker();
        let now = 1_000_000;
        // 400 Korean characters a page, 40 seconds each: 10 a second.
        for (let i = 0; i < 5; i += 1) {
            now += 40_000;
            expect(pace.observe({ language: 'ko', chars: 400, dwellMs: 40_000, now })).toBe(true);
        }
    });

    it('rejects flicked pages, and the next page too until the pace settles', () => {
        const pace = createReadingPaceTracker();
        let now = 1_000_000;
        for (let i = 0; i < 6; i += 1) {
            now += 800;
            expect(pace.observe({ language: 'ko', chars: 400, dwellMs: 800, now })).toBe(false);
        }
        // A short stop right after the flicking is still part of the skim.
        now += 8_000;
        expect(pace.observe({ language: 'ko', chars: 120, dwellMs: 8_000, now })).toBe(false);
        // A page then read properly counts again.
        now += 45_000;
        expect(pace.observe({ language: 'ko', chars: 400, dwellMs: 45_000, now })).toBe(true);
    });

    it('rejects a steady fast scroll although each paragraph was on screen for seconds', () => {
        const pace = createReadingPaceTracker();
        let now = 1_000_000;
        const results = [];
        // English, 300 characters a paragraph, one scrolled past every 2 s
        // (150 a second); each took 8 s to cross the screen, which alone
        // looks like reading (37 a second).
        for (let i = 0; i < 12; i += 1) {
            now += 2_000;
            results.push(pace.observe({ language: 'en', chars: 300, dwellMs: 8_000, now }));
        }
        expect(results.slice(1).every((read) => read === false)).toBe(true);
    });

    it('counts scroll-mode reading, where paragraphs overlap on screen', () => {
        const pace = createReadingPaceTracker();
        let now = 1_000_000;
        // Chinese, 80 characters a paragraph, one finished every 12 s, each
        // on screen for a minute.
        for (let i = 0; i < 10; i += 1) {
            now += 12_000;
            expect(pace.observe({ language: 'zh', chars: 80, dwellMs: 60_000, now })).toBe(true);
        }
    });

    it('forgets a skim once it is older than the window', () => {
        const pace = createReadingPaceTracker();
        let now = 1_000_000;
        pace.observe({ language: 'zh', chars: 5000, dwellMs: 2_000, now });
        now += PACE_WINDOW_MS + 5_000;
        expect(pace.observe({ language: 'zh', chars: 30, dwellMs: 5_000, now })).toBe(true);
    });

    it('allows a faster pace for alphabetic text than for Chinese', () => {
        expect(maxReadingPace('en')).toBeGreaterThan(maxReadingPace('ko'));
        expect(maxReadingPace('ko')).toBeGreaterThan(maxReadingPace('zh'));
    });
});
