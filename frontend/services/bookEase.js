import { difficultyFromLevelRank, sigmoid } from './abilityModel';

// ─── Book reading-ease estimate ───────────────────────────────────────────────
//
// "How easy will this book be for THIS reader, right now?" — a single personalized
// number: the expected fraction of the book's vocabulary the reader already knows.
// Higher = easier. It's derived from the same Phase 2/3 ability model that scores
// individual words, and because `theta` moves with every review/lookup (Phase 3) it
// updates over time as we learn more about the reader — no re-training required.
//
// IMPORTANT — a book level is NOT a word difficulty. A word's difficulty feeds the
// Rasch scorer `P(known) = sigmoid(theta − difficulty)`, where P = 0.5 exactly when
// the reader's ability equals that one word's difficulty. A BOOK's `level_rank`,
// though, is an aggregate threshold: both the bundled catalog and the reader's own
// accumulator (screens/Read.js `BOOK_LEVEL_PERCENTILE`) define a book's level as the
// band at which the reader's cumulative KNOWN vocabulary reaches the 80th percentile.
// So a reader *at* a book's level already knows ~80% of it — not 50%. Feeding
// `level_rank` straight into the word-level sigmoid would wrongly report 50% ease for
// a perfectly-matched reader (an advanced reader on an advanced book). We correct for
// this by anchoring the curve so at-level ease = the leveling percentile:
//
//     ease = sigmoid((theta − difficulty_book) + logit(BOOK_LEVEL_COMPREHENSION_ANCHOR))
//
// At theta = difficulty this is exactly the anchor (0.80); it rises toward 1 as the
// reader out-levels the book and falls toward 0 as the book out-levels the reader.
//
// This is deliberately a coarse, book-level estimate (one band, one ability). Two
// finer estimates layer on top when their inputs exist:
//   • `bookEaseFromDistribution` — the book's per-band word counts (the same
//     `book_level_stats.distribution` the leveling accumulator already stores).
//     Each band uses the REAL word-level sigmoid, weighted by how many of the
//     book's words sit in that band, so no anchor is needed and the result is
//     continuous instead of collapsing to one number per band. This matters most
//     with few levels (ko has 6), which otherwise quantize every book to 6 values.
//   • `bookEaseFromWordScores` — the full per-token refinement over actual scored
//     words (needs a book_index ⋈ word_scores join; not wired into the read path
//     yet).
//
// Pure by design (no SQLite, no React Native) so the math is unit-testable; the
// Database orchestrator supplies `theta`.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// The comprehension a reader at a book's own level is assumed to have. Must match
// the percentile the book levels were assigned at (screens/Read.js
// `BOOK_LEVEL_PERCENTILE` and the bundled catalog's "80th_percentile_known_vocab"
// method), so "at level" reports that same fraction known rather than a bare 50%.
export const BOOK_LEVEL_COMPREHENSION_ANCHOR = 0.8;
const BOOK_LEVEL_ANCHOR_LOGIT = Math.log(
  BOOK_LEVEL_COMPREHENSION_ANCHOR / (1 - BOOK_LEVEL_COMPREHENSION_ANCHOR)
);

// Bands for the human-readable label next to the percentage. Thresholds chosen so
// that a book AT the reader's level (P≈0.5) reads as "challenging", and the label
// only says "comfortable" once most of the vocabulary is already known.
export const EASE_BANDS = [
  { key: 'comfortable', min: 0.9 },
  { key: 'approachable', min: 0.75 },
  { key: 'challenging', min: 0.55 },
  { key: 'difficult', min: 0 },
];

/**
 * bookEaseFromLevel — the coarse, always-available estimate.
 *
 * @param {object} args
 * @param {number|null} args.theta      reader ability on the shared [-3, 3] scale
 *                                       (null/non-finite → neutral midpoint 0)
 * @param {string} args.language        target language code (ko | zh | en)
 * @param {number|null} args.levelRank  the book's graded band (1-based), or
 *                                       null/undefined if the book has no level yet
 * @returns {number|null} expected fraction of the book's vocabulary known, in
 *                        (0, 1) — anchored so an at-level reader gets
 *                        BOOK_LEVEL_COMPREHENSION_ANCHOR — or null when the book's
 *                        level is unknown (we return null rather than guessing
 *                        "hard", so the UI can say "we'll estimate this later"
 *                        instead of scaring the reader off an unleveled book).
 */
// ─── Legacy Korean book stats ────────────────────────────────────────────────
//
// Before the 6-level rescale (Phase 2, Aug 2026) the backend graded Korean books
// on the 3 NIKL grades and tagged the result `proficiency_system: 'NIKL'` with
// labels 초급 / 중급 / 고급. Books preprocessed back then still carry those stats
// on device, and reading them as reading levels 1-3 makes the book look far
// easier than it is. Remap each grade onto the LOWER level of its pair, the same
// mapping Database.js applies to legacy dictionary_cache rows.
export const LEGACY_NIKL_TO_READING_LEVEL = { 1: 1, 2: 3, 3: 5 };

export const isLegacyKoreanStats = (stats, language) => {
  if (!stats || typeof stats !== 'object') {
    return false;
  }
  const lang = String(stats.language || language || '').toLowerCase();
  if (lang && !lang.startsWith('ko')) {
    return false;
  }
  // Only an explicit tag counts: the backend has always recorded the system,
  // and grade labels alone are ambiguous.
  const system = stats.proficiency_system ?? stats.level_system ?? stats.book_level_system;
  return system === 'NIKL';
};

export const remapLegacyKoreanRank = (rank) => {
  const numeric = Number(rank);
  return LEGACY_NIKL_TO_READING_LEVEL[numeric] ?? rank;
};

/**
 * Return stats with legacy NIKL grades remapped onto reading levels; stats that
 * are already on the reading-level scale (or aren't Korean) come back unchanged.
 */
export const normalizeLegacyKoreanStats = (stats, language) => {
  if (!isLegacyKoreanStats(stats, language)) {
    return stats;
  }
  return {
    ...stats,
    level_rank: stats.level_rank == null ? stats.level_rank : remapLegacyKoreanRank(stats.level_rank),
    proficiency_rank: stats.proficiency_rank == null
      ? stats.proficiency_rank
      : remapLegacyKoreanRank(stats.proficiency_rank),
    distribution: Array.isArray(stats.distribution)
      ? stats.distribution.map((row) => (row && typeof row === 'object'
        ? { ...row, rank: remapLegacyKoreanRank(row.rank) }
        : row))
      : stats.distribution,
    proficiency_system: 'Noeul Reading Levels',
    remapped_from: 'NIKL',
  };
};

export const bookEaseFromLevel = ({ theta, language, levelRank } = {}) => {
  if (levelRank == null || !Number.isFinite(Number(levelRank))) {
    return null;
  }
  const safeTheta = Number.isFinite(Number(theta)) ? Number(theta) : 0;
  const difficulty = difficultyFromLevelRank(language, levelRank);
  return sigmoid((safeTheta - difficulty) + BOOK_LEVEL_ANCHOR_LOGIT);
};

/**
 * bookEaseFromDistribution — the distribution-refined estimate: a count-weighted
 * mean of per-BAND P(known) over the book's graded vocabulary.
 *
 * `distribution` is the per-band histogram the leveling accumulator already
 * produces (see screens/Read.js `finalizeBookLevelAccumulator`): an array of
 * `{ rank, count }` where `count` is how many of the book's matched words sit in
 * that graded band. Each band maps onto the shared difficulty scale and gets the
 * real word-level sigmoid — no comprehension anchor, because these are word
 * difficulties, not an 80th-percentile aggregate (see the header note).
 *
 * OOV words (the accumulator's `unknown_count`) are deliberately EXCLUDED, same
 * as the percentile leveling itself: in practice they're dominated by proper
 * nouns and tokenizer misses, and pinning them all to the max difficulty would
 * wrongly tank every book. Coverage stays available to the caller for a
 * confidence hint instead.
 *
 * @param {object} args
 * @param {number|null} args.theta      reader ability (null/non-finite → neutral 0)
 * @param {string} args.language        target language code (ko | zh | en)
 * @param {Array<{rank:number, count:number}>} args.distribution
 * @returns {number|null} expected fraction of the book's graded vocabulary known,
 *                        or null when the distribution is empty/unusable (caller
 *                        should fall back to `bookEaseFromLevel`).
 */
export const bookEaseFromDistribution = ({ theta, language, distribution } = {}) => {
  const safeTheta = Number.isFinite(Number(theta)) ? Number(theta) : 0;
  const entries = (Array.isArray(distribution) ? distribution : [])
    .map((band) => {
      const rank = Number(band?.rank);
      const count = Number(band?.count);
      if (!Number.isFinite(rank) || !Number.isFinite(count) || count <= 0) {
        return null;
      }
      const difficulty = difficultyFromLevelRank(language, rank);
      return { pKnown: sigmoid(safeTheta - difficulty), weight: count };
    })
    .filter(Boolean);

  return bookEaseFromWordScores(entries);
};

/**
 * bookEaseFromWordScores — the refined estimate: a frequency-weighted mean of the
 * per-word P(known) over the book's actual tokens. Not wired into the read path yet
 * (needs a book_index ⋈ word_scores join), but kept here so the refinement is a
 * pure, tested drop-in when the validation gate opens the door to it.
 *
 * @param {Array<{pKnown:number, weight?:number}>} entries
 * @returns {number|null} weighted mean in (0, 1), or null if no scored tokens.
 */
export const bookEaseFromWordScores = (entries = []) => {
  let weightedSum = 0;
  let totalWeight = 0;
  entries.forEach((entry) => {
    const p = Number(entry?.pKnown);
    if (!Number.isFinite(p)) {
      return;
    }
    const rawWeight = Number(entry?.weight);
    const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
    weightedSum += p * weight;
    totalWeight += weight;
  });

  return totalWeight > 0 ? weightedSum / totalWeight : null;
};

/**
 * formatEasePercent — round an ease value to a whole percent for display.
 * Clamped to [1, 99] so we never claim the reader knows literally none or all of a
 * book (the scorer is strictly in (0, 1); this just avoids "0%"/"100%" overclaims).
 *
 * @param {number|null|undefined} ease  P(known) in (0, 1)
 * @returns {number|null} integer percent, or null when ease is unavailable.
 */
export const formatEasePercent = (ease) => {
  if (ease == null || !Number.isFinite(Number(ease))) {
    return null;
  }
  return clamp(Math.round(Number(ease) * 100), 1, 99);
};

/**
 * getEaseBandKey — the band label key for an ease value (see EASE_BANDS), or null
 * when ease is unavailable.
 */
export const getEaseBandKey = (ease) => {
  if (ease == null || !Number.isFinite(Number(ease))) {
    return null;
  }
  const value = Number(ease);
  const band = EASE_BANDS.find((entry) => value >= entry.min) ?? EASE_BANDS[EASE_BANDS.length - 1];
  return band.key;
};
