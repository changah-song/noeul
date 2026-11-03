import { ABILITY_THETA_MAX, pKnown, underlineCategory } from './abilityModel';
import { wordDifficulty } from './levelEngine';
import { adjustedPKnown } from './wordEvidence';
import { isLevelSample } from './levelSample';

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

// An English phrase ("gave up") with no level of its own is a little harder
// than its harder word. Phrases normally carry their own CEFR level
// (backend/data/en_expressions.tsv), so this is only a fallback.
export const PHRASE_EXTRA = 0.7;

const isPhrase = (surface) => /\S\s+\S/.test(surface);
const hasOwnGrade = (row) => [row?.level_rank, row?.proficiency_rank, row?.difficulty_percentile, row?.zipf]
    .some((value) => value != null && value !== '');

/**
 * phraseDifficultyFromParts — the fallback difficulty of a phrase from its
 * words' difficulties: the hardest plus PHRASE_EXTRA, at most the top of the
 * scale. Null when none of its words is known.
 */
export const phraseDifficultyFromParts = (partDifficulties) => {
    const known = (partDifficulties || []).filter((value) => Number.isFinite(value));
    if (known.length === 0) return null;
    return Math.min(ABILITY_THETA_MAX, Math.max(...known) + PHRASE_EXTRA);
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
    // Single words' difficulties, for a phrase graded by its words (below).
    const wordDifficultyBySurface = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim().toLowerCase() : '';
        if (!surface || isPhrase(surface) || !hasOwnGrade(row)) return;
        const difficulty = rowDifficulty(row, language);
        if (!(wordDifficultyBySurface.get(surface) >= difficulty)) wordDifficultyBySurface.set(surface, difficulty);
    });
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        if (!surface) {
            return;
        }
        let difficulty = rowDifficulty(row, language);
        if (isPhrase(surface) && !hasOwnGrade(row)) {
            const fromParts = phraseDifficultyFromParts(
                surface.toLowerCase().split(/\s+/).map((word) => wordDifficultyBySurface.get(word))
            );
            if (fromParts != null) difficulty = fromParts;
        }
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

/**
 * buildLevelExposureTerms — the graded surfaces that are NOT underlined but
 * whose word is in the level sample (services/levelSample.js): the reader
 * reports reading past them without drawing anything, so the level sees both
 * outcomes for them. `{ text, stem }`, one per surface.
 */
export const buildLevelExposureTerms = (rows, underlined = []) => {
    const marked = new Set((underlined || []).map((term) => term?.text).filter(Boolean));
    const out = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        const stem = typeof row?.stem === 'string' ? row.stem.trim() : '';
        if (!surface || !stem || marked.has(surface) || out.has(surface)) return;
        if (isLevelSample(stem)) out.set(surface, { text: surface, stem });
    });
    return [...out.values()];
};
