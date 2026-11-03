// ─── Level sample: known words observed both ways ─────────────────────────────
//
// The reader reports words read past only for words it is told about, and it
// is told about the underlined ones. A word the model thinks is known isn't
// underlined, so tapping it was logged and reading past it never was: one-sided
// evidence that dragged the level down (docs/difficulty-model/level-engine.md).
//
// A fixed share of words is therefore always observed, underlined or not: the
// reader also reports reading past them (exposure-only terms, never drawn), and
// their lookups count toward the level. Which words is decided by a hash of the
// dictionary form, so the same words are in the sample on every page, in every
// book and in the replay, and lookups and words read past stay balanced.

export const LEVEL_SAMPLE_RATE = 0.25;

// FNV-1a, 32-bit, then MurmurHash3's finalizer: FNV alone spreads similar
// keys (词1, 词2, …) unevenly over the high bits the rate is compared on.
const hash = (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
};

/** Whether a word (by its dictionary form) is in the always-observed sample. */
export const isLevelSample = (stem) => {
    const key = typeof stem === 'string' ? stem.trim() : '';
    if (!key) return false;
    return hash(key) / 4294967296 < LEVEL_SAMPLE_RATE;
};
