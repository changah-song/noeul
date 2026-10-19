import { pKnown, underlineCategory } from './abilityModel';
import { wordDifficulty } from './levelEngine';
import { adjustedPKnown } from './wordEvidence';

// Shared by the book reader (screens/Read.js) and the song reader
// (components/Songs/SongReader.js, via hooks/useLevelUnderlineTerms) so both
// shade graded words identically.

/**
 * rowDifficulty — a surface row's difficulty: level band (or the finer Korean
 * percentile), how common the word is, and the Korean loanword flag (see
 * services/levelEngine.js wordDifficulty). A word with none of these is the
 * hardest: rare words are the ones most worth marking.
 */
export const rowDifficulty = (row, language) => {
    const rawPercentile = row?.difficulty_percentile;
    return wordDifficulty({
        language,
        levelRank: row?.level_rank ?? row?.proficiency_rank ?? null,
        percentile: rawPercentile == null || rawPercentile === '' ? null : rawPercentile,
        zipf: row?.zipf ?? null,
        loanword: row?.loanword ?? null,
    }).difficulty;
};

/**
 * buildLevelUnderlineTerms — turn the book's graded surfaces into the weighted
 * term list the native reader shades its underlines with.
 *
 * The weight is a position on the green→amber→red gradient derived from
 * P(known). With `options.knowledge` (a stem → { p } function from
 * levelEngine.buildWordKnowledge) P comes from the reader's level and their
 * history with the word, its family or its characters; without it, from the
 * level and difficulty alone (plus `options.evidence`, the older per-word
 * adjustment). A word the model thinks you know is dropped entirely. Native
 * owns the actual colors so the gradient can follow the reader theme.
 *
 * Ambiguous surfaces (one surface, several stems) keep their HARDEST reading.
 * Each term carries its `stem` so a word read past can be credited to the
 * dictionary form (소문을 → 소문).
 */
export const buildLevelUnderlineTerms = (rows, language, theta, options = {}) => {
    if (!Number.isFinite(Number(theta))) {
        return [];
    }
    const knowledge = typeof options.knowledge === 'function' ? options.knowledge : null;
    const evidence = options.evidence instanceof Map ? options.evidence : null;
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

    // Per surface keep its hardest reading AND that stem's in-book occurrence
    // count (stem_count) — the "future exposure" signal that splits hard words
    // into study vs reinforced.
    const surfaceInfo = new Map();
    // Pinyin (dc.ipa for zh) rides along so the native reader can annotate
    // underlined words. Only present for Chinese.
    const surfacePinyin = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        if (!surface) {
            return;
        }
        const difficulty = rowDifficulty(row, language);
        const stem = typeof row?.stem === 'string' ? row.stem.trim() : '';

        const pinyin = typeof row?.ipa === 'string' ? row.ipa.trim() : '';
        if (pinyin && !surfacePinyin.has(surface)) {
            surfacePinyin.set(surface, pinyin);
        }

        const count = Number(row?.stem_count);
        const previous = surfaceInfo.get(surface);
        // Ties keep the first stem seen, which the query orders by surface length.
        if (!previous || difficulty > previous.difficulty) {
            surfaceInfo.set(surface, { difficulty, stem, count: Number.isFinite(count) ? count : 0 });
        }
    });

    const terms = [];
    surfaceInfo.forEach(({ difficulty, stem, count }, surface) => {
        let p;
        if (knowledge && stem) {
            p = knowledge(stem).p;
        } else {
            p = pKnown(theta, difficulty);
            if (evidence && stem && evidence.has(stem)) {
                p = adjustedPKnown(p, evidence.get(stem), now);
            }
        }
        const shade = underlineCategory(p, count);
        if (shade != null) {
            const term = { text: surface, weight: shade.weight, category: shade.category };
            if (stem) {
                term.stem = stem;
            }
            const pinyin = surfacePinyin.get(surface);
            if (pinyin) {
                term.pinyin = pinyin;
            }
            terms.push(term);
        }
    });

    return terms;
};
