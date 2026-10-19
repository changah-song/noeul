import { exposureDwellIsPlausible } from './abilityModel';

// Safety cap per exposure unit (a very dense page). Every underlined word read
// past counts: the level engine learns the reader's lookup habit by comparing
// lookups with words read past, so crediting only a few per page would make
// the reader look like they tap far more than they do.
export const EXPOSURE_MAX_PER_UNIT = 40;

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
 * weight nearest 0.5), so the cap, when it bites, keeps the informative ones.
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
