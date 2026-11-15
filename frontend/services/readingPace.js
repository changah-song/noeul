import { normalizeBookLanguage } from '../constants/languages';
import { exposureDwellIsPlausible } from './abilityModel';

// ─── Is the reader actually reading? ──────────────────────────────────────────
//
// Words read past only say something about the reader's level when the text
// was read. A single unit's dwell can't tell: in scroll mode a paragraph's
// dwell is the time it takes to cross the screen, so a steady fast scroll
// gives every paragraph several seconds "on screen" while nothing is read.
//
// So the reader's pace is measured over the last PACE_WINDOW_MS of everything
// that went past, in characters per second, and a unit only counts when
//
//   1. it was on screen at least as long as the fastest reader would need, and
//   2. the pace over the window is one a person can read at.
//
// After skimming, the skimmed text stays in the window, so nothing counts
// again until the reader has settled back into reading for a while.
// Lookups are not gated here: a tap is deliberate whatever the pace.

// The fastest pace still called reading, in characters per second. Generous:
// a quick native reader, not a learner (English ~400 words a minute, Korean
// ~1200 syllables, Chinese ~700 characters).
export const MAX_READING_PACE = { zh: 12, ja: 12, ko: 20 };
export const DEFAULT_MAX_READING_PACE = 40;
export const PACE_WINDOW_MS = 30 * 1000;
// The shortest stretch a pace is worked out over (a lone short unit).
const MIN_SPAN_MS = 1000;

export const maxReadingPace = (language) => (
    MAX_READING_PACE[normalizeBookLanguage(language)] ?? DEFAULT_MAX_READING_PACE
);

/**
 * createReadingPaceTracker — judges each closed exposure unit (a page, a focus
 * span, a scrolled-past paragraph) as read or skimmed.
 *
 * Call observe() for every unit native reports, in order. Pure apart from the
 * clock, which tests pass in.
 */
export const createReadingPaceTracker = () => {
    // Units that ended inside the window: { start, end, chars }.
    let units = [];
    let firstStart = null;

    return {
        /**
         * @param {object} unit
         * @param {string} unit.language
         * @param {number} unit.chars    text length of the unit
         * @param {number} unit.dwellMs  how long it was on screen
         * @param {number} [unit.now]    when it closed (ms)
         * @returns {boolean} true when the unit was read
         */
        observe({ language, chars, dwellMs, now = Date.now() } = {}) {
            const size = Math.max(0, Number(chars) || 0);
            const dwell = Math.max(0, Number(dwellMs) || 0);
            const maxPace = maxReadingPace(language);
            const windowStart = now - PACE_WINDOW_MS;

            units = units.filter((unit) => unit.end > windowStart);
            units.push({ start: now - dwell, end: now, chars: size });
            if (firstStart == null || now - dwell < firstStart) firstStart = now - dwell;

            // Each unit's text, shared out over the time it was on screen:
            // what fell inside the window.
            const charsInWindow = units.reduce((sum, unit) => {
                const length = unit.end - unit.start;
                if (length <= 0) return sum + unit.chars;
                const inside = unit.end - Math.max(unit.start, windowStart);
                return sum + unit.chars * Math.min(1, Math.max(0, inside / length));
            }, 0);
            const span = Math.min(PACE_WINDOW_MS, Math.max(MIN_SPAN_MS, now - firstStart));
            const pace = charsInWindow / (span / 1000);

            const unitRead = exposureDwellIsPlausible(size, dwell) && dwell >= (size / maxPace) * 1000;
            return unitRead && pace <= maxPace;
        },
        reset() {
            units = [];
            firstStart = null;
        },
    };
};
