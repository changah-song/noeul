import {
    difficultyFromLevelRank,
    difficultyFromPercentile,
    pKnown,
    underlineCategory,
} from './abilityModel';
import { adjustedPKnown } from './wordEvidence';

// Rank stand-in for an ungraded word (above every real band).
const OOV_RANK = Number.POSITIVE_INFINITY;

// Shared by the book reader (screens/Read.js) and the song reader
// (components/Songs/SongReader.js) so both shade graded words identically.

/**
 * buildLevelUnderlineTerms — turn the book's graded surfaces into the weighted
 * term list the native reader shades its underlines with.
 *
 * The weight is a position on the green→amber→red gradient derived from
 * P(known | theta, word difficulty), NOT from the user's self-reported band. A
 * word the model thinks you know is dropped entirely; the rest ramp from "nearly
 * known" to "well above you". Native owns the actual colors so the gradient can
 * follow the reader theme without a recompute here.
 *
 * Ambiguous surfaces (one surface, several stems) keep their HARDEST rank — the
 * conservative read, matching what the old rank-bucketed version did.
 */
export const buildLevelUnderlineTerms = (rows, language, theta, options = {}) => {
    if (!Number.isFinite(Number(theta))) {
        return [];
    }
    // Phase 2 inputs: per-stem evidence (services/wordEvidence.js) and the
    // clock it decays against. Both optional; without them the shade is the
    // plain baseline.
    const evidence = options.evidence instanceof Map ? options.evidence : null;
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

    // Per surface keep its hardest rank (conservative) AND that stem's in-book
    // occurrence count (stem_count, from the window function) — the §8 "future
    // exposure" signal that splits hard words into study vs reinforced.
    const surfaceInfo = new Map();
    // Pinyin (dc.ipa for zh) rides along so the native reader can annotate underlined
    // words. Only present for Chinese; harmless (unused) for other languages.
    const surfacePinyin = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        if (!surface) {
            return;
        }
        // A word outside the graded lists (rank null) is treated as the
        // hardest band: rare words are the ones most worth marking. Its
        // difficulty is the ceiling (OOV_DIFFICULTY) unless a percentile is
        // known. Graded words use their percentile when present — a finer
        // position than the band, whose sizes are very uneven.
        const rawRank = row?.level_rank ?? row?.proficiency_rank;
        const rank = rawRank == null ? OOV_RANK : Number(rawRank);
        if (!Number.isFinite(rank) && rank !== OOV_RANK) {
            return;
        }
        // Only a real percentile counts: Number(null) is 0, the easiest word.
        const rawPercentile = row?.difficulty_percentile;
        const percentile = rawPercentile == null || rawPercentile === '' ? NaN : Number(rawPercentile);
        const difficulty = Number.isFinite(percentile)
            ? difficultyFromPercentile(percentile)
            : difficultyFromLevelRank(language, rawRank == null ? null : rank);
        const stem = typeof row?.stem === 'string' ? row.stem.trim() : '';

        const pinyin = typeof row?.ipa === 'string' ? row.ipa.trim() : '';
        if (pinyin && !surfacePinyin.has(surface)) {
            surfacePinyin.set(surface, pinyin);
        }

        const count = Number(row?.stem_count);
        const previous = surfaceInfo.get(surface);
        // Per surface keep the hardest reading (conservative); ties keep the
        // first stem seen, which the query orders by surface length.
        if (!previous || difficulty > previous.difficulty) {
            surfaceInfo.set(surface, { rank, difficulty, stem, count: Number.isFinite(count) ? count : 0 });
        }
    });

    const terms = [];
    surfaceInfo.forEach(({ difficulty, stem, count }, surface) => {
        let p = pKnown(theta, difficulty);
        // Phase 2: what the reader did with this word (lookups, reviews,
        // exposures, saves) moves it on the logit scale.
        if (evidence && stem && evidence.has(stem)) {
            p = adjustedPKnown(p, evidence.get(stem), now);
        }
        const shade = underlineCategory(p, count);
        if (shade != null) {
            const term = { text: surface, weight: shade.weight, category: shade.category };
            const pinyin = surfacePinyin.get(surface);
            if (pinyin) {
                term.pinyin = pinyin;
            }
            terms.push(term);
        }
    });

    return terms;
};
