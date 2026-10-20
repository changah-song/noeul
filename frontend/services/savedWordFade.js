// Saved-word fading: each time a page with a saved word settles on screen, its
// highlight fades a step (the box visibly loses pixels); after
// SAVED_WORD_FADE_STEPS such pages it is gone and the word moves to the
// Learned list (Database.js recordSavedWordSightings). Looking it up again
// brings it back in full.
// Shared by the book reader and the song reader.

// The vocab level a word gets once it has faded out (cloud status 'learned').
export const LEARNED_LEVEL = 'learned';
// Pages without a lookup that fade a saved word out completely.
export const SAVED_WORD_FADE_STEPS = 6;
// Sightings closer together than this count once: a flick through pages, or
// the page right after looking the word up. (Paging back to a page already
// counted this session is skipped by the reader itself.)
export const SAVED_WORD_FADE_GAP_MS = 30 * 1000;
// How long the last step's pixels take to leave before a learned word's box
// is removed (the native SAVED_FADE_MS, plus a frame or two).
export const SAVED_WORD_LAST_FADE_MS = 1000;

/** Highlight strength for a word passed `seen` times since its last lookup. */
export const fadeStrength = (seen, steps = SAVED_WORD_FADE_STEPS) => {
    const n = Math.max(0, Number(seen) || 0);
    return Math.max(0, Math.min(1, 1 - n / steps));
};

/**
 * highlightStrengthsFor — { surface: strength } for every highlighted surface
 * whose saved word has started fading (fully drawn surfaces are left out).
 *
 * @param {string[]} terms               highlighted surfaces
 * @param {Map<string,string>} surfaceToWord  surface → saved word (inflected
 *        forms found in the book); a surface missing here is its own word
 * @param {Map<string,number>} fades     saved word → passes since last lookup
 */
export const highlightStrengthsFor = (terms, surfaceToWord, fades) => {
    const out = {};
    if (!(fades instanceof Map) || fades.size === 0) return out;
    (terms || []).forEach((term) => {
        if (typeof term !== 'string' || !term) return;
        const word = surfaceToWord?.get(term) || term;
        const seen = fades.get(word);
        if (seen > 0) out[term] = fadeStrength(seen);
    });
    return out;
};

/**
 * unseenShownTerms — the saved surfaces shown in a page (or focus span, or
 * scrolled paragraph) that haven't been counted for that unit yet, recording
 * them in `counted` (a Set the reader keeps for the session), so paging back
 * to a page doesn't fade its words again.
 */
export const unseenShownTerms = (counted, scope, unitKey, terms) => {
    if (!(counted instanceof Set) || !Array.isArray(terms)) return [];
    const fresh = [];
    terms.forEach((term) => {
        if (typeof term !== 'string' || !term) return;
        const key = `${scope}|${unitKey}|${term}`;
        if (counted.has(key)) return;
        counted.add(key);
        fresh.push(term);
    });
    return fresh;
};

/** The saved words behind a list of surfaces, without duplicates. */
export const savedWordsForSurfaces = (surfaces, surfaceToWord, exclude = new Set()) => {
    const words = new Set();
    (surfaces || []).forEach((surface) => {
        if (typeof surface !== 'string' || !surface || exclude.has(surface)) return;
        words.add(surfaceToWord?.get(surface) || surface);
    });
    return Array.from(words);
};
