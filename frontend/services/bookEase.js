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
// This is deliberately a coarse, book-level estimate (one band, one ability). A
// per-token refinement over the book's actual words (`bookEaseFromWordScores`) needs
// no anchor — each word uses the real word-level sigmoid — and can layer on later.
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
export const bookEaseFromLevel = ({ theta, language, levelRank } = {}) => {
  if (levelRank == null || !Number.isFinite(Number(levelRank))) {
    return null;
  }
  const safeTheta = Number.isFinite(Number(theta)) ? Number(theta) : 0;
  const difficulty = difficultyFromLevelRank(language, levelRank);
  return sigmoid((safeTheta - difficulty) + BOOK_LEVEL_ANCHOR_LOGIT);
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
