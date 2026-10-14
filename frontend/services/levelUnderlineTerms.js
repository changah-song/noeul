import {
    difficultyFromLevelRank,
    pKnown,
    underlineCategory,
} from './abilityModel';

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
export const buildLevelUnderlineTerms = (rows, language, theta) => {
    if (!Number.isFinite(Number(theta))) {
        return [];
    }

    // Per surface keep its hardest rank (conservative) AND that stem's in-book
    // occurrence count (stem_count, from the window function) — the §8 "future
    // exposure" signal that splits hard words into study vs reinforced.
    const surfaceInfo = new Map();
    // Pinyin (dc.ipa for zh) rides along so the native reader can annotate underlined
    // words. Only present for Chinese; harmless (unused) for other languages.
    const surfacePinyin = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        const rank = Number(row?.level_rank ?? row?.proficiency_rank);
        if (!surface || !Number.isFinite(rank)) {
            return;
        }

        const pinyin = typeof row?.ipa === 'string' ? row.ipa.trim() : '';
        if (pinyin && !surfacePinyin.has(surface)) {
            surfacePinyin.set(surface, pinyin);
        }

        const count = Number(row?.stem_count);
        const previous = surfaceInfo.get(surface);
        if (!previous || rank > previous.rank) {
            surfaceInfo.set(surface, { rank, count: Number.isFinite(count) ? count : 0 });
        }
    });

    // P(known) depends only on the rank, and there are at most 7 ranks, so memoize it
    // per rank instead of recomputing a sigmoid per surface. underlineCategory turns
    // (P, remaining count) into { weight, category } — same weight as before, plus the
    // study/reinforced split.
    const pKnownByRank = new Map();
    const pKnownForRank = (rank) => {
        if (!pKnownByRank.has(rank)) {
            pKnownByRank.set(rank, pKnown(theta, difficultyFromLevelRank(language, rank)));
        }
        return pKnownByRank.get(rank);
    };

    const terms = [];
    surfaceInfo.forEach(({ rank, count }, surface) => {
        const shade = underlineCategory(pKnownForRank(rank), count);
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
