import { exposureDwellIsPlausible } from './abilityModel';

// Cap per exposure unit so dense typesetting can't move ability further than
// sparse — a property of the layout, not of the reader. (Same value as Read.js.)
export const EXPOSURE_MAX_PER_UNIT = 5;

/**
 * selectExposureCredits — pick which graded words in a closed exposure unit (a
 * page, a focus span, or a scrolled-past block) to credit as "skipped because
 * known". Pure version of the filter in Read.js handleNativeExposure.
 *
 * Three subtractions before anything counts:
 *   1. units left too fast for their length — never really read (dwell gate)
 *   2. words looked up recently — a lookup already logged stronger evidence
 *   3. saved words — already earning graded evidence through the SRS loop
 *
 * Survivors are ranked by how uncertain the model is about them (underline
 * weight nearest 0.5) and the top `max` are returned.
 *
 * @returns {string[]} surfaces to credit (possibly empty)
 */
export const selectExposureCredits = ({
    terms,
    chars,
    dwellMs,
    lookedUp = new Set(),
    saved = new Set(),
    weights = new Map(),
    max = EXPOSURE_MAX_PER_UNIT,
} = {}) => {
    if (!Array.isArray(terms) || terms.length === 0) {
        return [];
    }
    if (!exposureDwellIsPlausible(chars, dwellMs)) {
        return [];
    }

    const seen = new Set();
    return terms
        .filter((term) => {
            if (typeof term !== 'string' || !term || seen.has(term)) {
                return false;
            }
            seen.add(term);
            return !lookedUp.has(term) && !saved.has(term);
        })
        .sort((a, b) => (
            Math.abs((weights.get(a) ?? 1) - 0.5) - Math.abs((weights.get(b) ?? 1) - 0.5)
        ))
        .slice(0, max);
};
