import KO_POOL from '../assets/data/word-check/ko.generated.json';
import ZH_POOL from '../assets/data/word-check/zh.generated.json';
import EN_POOL from '../assets/data/word-check/en.generated.json';
import KO_TIERS from '../assets/data/vocab-size/ko.generated.json';
import ZH_TIERS from '../assets/data/vocab-size/zh.generated.json';
import EN_TIERS from '../assets/data/vocab-size/en.generated.json';
import { normalizeBookLanguage } from '../constants/languages';
import { ITEM_SLOPE, wordDifficulty } from './levelEngine';
import { LEVEL_THETA_MAX, LEVEL_THETA_MIN, sigmoid } from './abilityModel';

// ─── What a level means, in words ─────────────────────────────────────────────
//
// The model's level θ is the difficulty at which the reader knows a word half
// the time. That is a fine internal number but a poor label: "HSK 2" used to
// mean "θ is at least the HSK 2 band's position", so a reader shown HSK 2
// knew only about half of HSK 2, and the level picker put a reader who knows
// all of HSK 4 at the point where they'd know half of it. One meaning now runs
// through the profile, the picker and the word check:
//
//   coverage(θ, band)   the share of a band's words the reader knows: the mean
//                       P(known) over the word-check pool's words in that band
//   "HSK N" / "B1"      the highest band the reader knows at least COVERAGE of
//   vocabulary size     Σ over bands of (words in the band × its counted
//                       share), the counted share rising from 0 at COUNT_FLOOR
//                       coverage to 1 at COVERAGE (see countedShare)
//   picking a level     the θ at which that band's coverage is PICK_COVERAGE
//                       (frequency tiers: at which the vocabulary is that many
//                       words)
//
// The pools (assets/data/word-check, ~50 words per band) carry each word's
// band, frequency and loanword flag, so a band's coverage follows the same
// difficulty as everything else (levelEngine.wordDifficulty).

export const COVERAGE = 0.8;
// The picker asks for the last row where you know ALL the words; a little
// above COVERAGE, so the label shows the row picked.
export const PICK_COVERAGE = 0.85;

// Counting words. Coverage is a mean of P(known) over a curve flattened for
// how much words within a band differ (levelEngine ITEM_VARIANCE), so its
// tails never reach 0 or 1: summing coverage × band size credited a reader at
// the bottom of the scale with ~730 Korean words, and an "HSK 4" reader with
// ~40% of HSK 7-9's 9,085 words (~11,000 in all). A band now counts only once
// the reader clearly knows more of it than not, and in full once it is the
// level shown:
//
//   counted share = clamp((coverage − COUNT_FLOOR) / (COVERAGE − COUNT_FLOOR), 0, 1)
//
// So a reader labelled "HSK N" is credited with every word up to HSK N plus a
// share of the bands they are partway into, and a reader who knows none of
// the first band is credited with none. Coverage itself, the labels, and the
// engine's P(known) are unchanged.
export const COUNT_FLOOR = 0.6;

/** The share of a band's words counted as known at a given coverage. */
export const countedShare = (bandCoverageValue) => Math.max(
    0,
    Math.min(1, (Number(bandCoverageValue) - COUNT_FLOOR) / (COVERAGE - COUNT_FLOOR)),
);

const POOLS = { ko: KO_POOL, zh: ZH_POOL, en: EN_POOL };
const TIERS = { ko: KO_TIERS.ko, zh: ZH_TIERS.zh, en: EN_TIERS.en };
const THETA_MIN = LEVEL_THETA_MIN;
const THETA_MAX = LEVEL_THETA_MAX;

const cache = new Map();

// Per band: its word count and its pool words' difficulties.
const bandsFor = (language) => {
    const lang = normalizeBookLanguage(language) || '';
    if (cache.has(lang)) return cache.get(lang);
    const pool = POOLS[lang];
    const counts = TIERS[lang]?.bandCounts;
    if (!pool || !counts) {
        cache.set(lang, null);
        return null;
    }
    const byBand = new Map();
    (pool.words || []).forEach((item) => {
        const band = Number(item.r);
        if (!Number.isFinite(band)) return;
        const { difficulty } = wordDifficulty({ language: lang, levelRank: item.r, percentile: item.p, zipf: item.z, loanword: item.l });
        if (!byBand.has(band)) byBand.set(band, []);
        byBand.get(band).push(difficulty);
    });
    const bands = Object.entries(counts)
        .map(([band, count]) => ({ band: Number(band), count: Number(count), difficulties: byBand.get(Number(band)) || [] }))
        .filter((b) => b.difficulties.length > 0)
        .sort((a, b) => a.band - b.band);
    cache.set(lang, bands);
    return bands;
};

const bandCoverage = (bandInfo, theta) => (
    bandInfo.difficulties.reduce((sum, d) => sum + sigmoid(ITEM_SLOPE * (theta - d)), 0) / bandInfo.difficulties.length
);

/** The share of a band's words a reader at `theta` knows (null: no data). */
export const coverage = (language, theta, band) => {
    const info = (bandsFor(language) || []).find((b) => b.band === Number(band));
    return info ? bandCoverage(info, Number(theta)) : null;
};

/**
 * Graded words a reader at `theta` knows: each band's word count times its
 * counted share (countedShare). 0 at the bottom of the scale; non-decreasing
 * in `theta`.
 */
export const vocabularySize = (language, theta) => {
    const bands = bandsFor(language);
    if (!bands) return null;
    return bands.reduce((sum, b) => sum + b.count * countedShare(bandCoverage(b, Number(theta))), 0);
};

/**
 * The words count of engine 2.4 (Σ band size × coverage, no floor), kept only
 * to read a Korean level picked then as the word count it meant.
 */
export const legacyVocabularySize = (language, theta) => {
    const bands = bandsFor(language);
    if (!bands) return null;
    return bands.reduce((sum, b) => sum + b.count * bandCoverage(b, Number(theta)), 0);
};

/**
 * The highest band (1-based) whose coverage is at least COVERAGE, or 0 when
 * even the first isn't.
 */
export const coveredBand = (language, theta) => {
    const bands = bandsFor(language);
    if (!bands) return null;
    let covered = 0;
    bands.forEach((b) => {
        if (bandCoverage(b, Number(theta)) >= COVERAGE) covered = Math.max(covered, b.band);
    });
    return covered;
};

// θ at which a monotone increasing f(θ) reaches `target`, by bisection.
const solve = (f, target) => {
    let lo = THETA_MIN;
    let hi = THETA_MAX;
    if (f(lo) >= target) return lo;
    if (f(hi) <= target) return hi;
    for (let i = 0; i < 50; i += 1) {
        const mid = (lo + hi) / 2;
        if (f(mid) < target) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
};

/** The level at which a band's coverage is `target` (default PICK_COVERAGE). */
export const thetaForBandCoverage = (language, band, target = PICK_COVERAGE) => {
    const info = (bandsFor(language) || []).find((b) => b.band === Number(band));
    return info ? solve((theta) => bandCoverage(info, theta), target) : null;
};

/**
 * The lowest level at which the vocabulary is `words` (vocabularySize is flat
 * at 0 below the first band, so the bisection lands at the start of the rise).
 */
export const thetaForVocabulary = (language, words) => {
    if (!bandsFor(language)) return null;
    return solve((theta) => vocabularySize(language, theta), Number(words));
};
