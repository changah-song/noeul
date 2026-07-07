// ─── Flashcard nomination + scheduling priors (Phase 4.4) ─────────────────────
//
// Flashcards are the ONLY consumer wired in Phase 4 (design doc §5.2, §6) — the
// one channel whose first-review outcome is an unconfounded label. Two jobs here,
// both pure (no SQLite): (1) score which words are worth turning into cards, and
// (2) seed a brand-new card's initial FSRS state from its P(known) instead of a
// generic default.
//
// (1) NOMINATION. A word deserves a card when we're UNCERTAIN whether the user
// knows it AND the book won't teach it incidentally:
//
//     nomination_score = uncertainty(P_known) × (1 − remaining_in_book_exposure)
//
// Uncertainty peaks at P = 0.5 (we have no idea) and falls to 0 at the extremes
// (we're confident either way). Remaining-exposure suppresses words that recur
// often in the text — incidental-acquisition research puts the "learned from
// exposure alone" threshold around 8–12 encounters, so a word appearing that many
// more times needs no deliberate card (design doc §5.2).
//
// (2) SCHEDULING PRIOR. FSRS starts every new card from a generic default; it has
// no cross-item transfer, so it can't know a word is probably-already-known. We
// seed the initial stability/difficulty from P(known): a likely-known word starts
// with a longer interval + lower difficulty, a likely-unknown one shorter + harder.

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Encounters at which a word is treated as fully "the book will teach it" (design
// doc §5.2, ~8–12 range). Remaining exposure saturates here.
export const EXPOSURE_SATURATION = 10;

// FSRS anchors — MUST match DEFAULT_STABILITY / DEFAULT_DIFFICULTY in Database.js.
// A word at P = 0.5 (no information) seeds to exactly these defaults, so the prior
// only ever nudges away from today's behavior, never jumps it.
const DEFAULT_STABILITY = 1.0;   // ≈ 1-day first interval at retention 0.9
const DEFAULT_DIFFICULTY = 5.0;  // FSRS difficulty midpoint on [1, 10]
export const INITIAL_STABILITY_MIN = 0.5;
export const INITIAL_STABILITY_MAX = 7.0;   // a week for a very-likely-known word
const DIFFICULTY_SPREAD = 4.0;              // P 0→+4 harder, 1→−4 easier around 5

const toProb = (p) => {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return clamp(n, 0, 1);
};

/**
 * wordUncertainty — normalized Bernoulli variance 4·p·(1−p): 1 at P = 0.5, 0 at
 * P ∈ {0, 1}. The productive "we don't know" zone the nominator wants.
 */
export const wordUncertainty = (pKnown) => {
  const p = toProb(pKnown);
  if (p == null) return 0;
  return 4 * p * (1 - p);
};

/**
 * remainingExposureFactor — how much the book will teach this word on its own, in
 * [0, 1]. 0 = appears no more (needs a card); 1 = appears ≥ saturation more times
 * (incidental acquisition will handle it). Unknown/absent count → 0 (don't
 * suppress a word just because we can't see its frequency).
 */
export const remainingExposureFactor = (remainingCount, saturation = EXPOSURE_SATURATION) => {
  const n = Number(remainingCount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const sat = Number(saturation) > 0 ? Number(saturation) : EXPOSURE_SATURATION;
  return clamp(n / sat, 0, 1);
};

/**
 * nominationScore — uncertainty × (1 − remaining exposure), in [0, 1]. Higher =
 * better flashcard candidate (uncertain AND rare-in-book).
 */
export const nominationScore = (pKnown, remainingCount, saturation = EXPOSURE_SATURATION) =>
  wordUncertainty(pKnown) * (1 - remainingExposureFactor(remainingCount, saturation));

/**
 * initialFsrsFromPKnown — seed a new card's FSRS state from P(known).
 *
 * stability scales multiplicatively around the default with an exponential in
 * (2P − 1), so P = 0.5 → default, P = 1 → the max (long interval), P = 0 → the
 * floor. difficulty moves linearly the opposite way around the midpoint. Both
 * clamped to sane FSRS ranges.
 *
 * @param {number} pKnown  P(known) in [0, 1]
 * @returns {{ stability:number, difficulty:number }}
 */
export const initialFsrsFromPKnown = (pKnown) => {
  const p = toProb(pKnown);
  if (p == null) {
    return { stability: DEFAULT_STABILITY, difficulty: DEFAULT_DIFFICULTY };
  }
  const alpha = Math.log(INITIAL_STABILITY_MAX / DEFAULT_STABILITY); // P=1 → MAX
  const stability = clamp(
    DEFAULT_STABILITY * Math.exp(alpha * (2 * p - 1)),
    INITIAL_STABILITY_MIN,
    INITIAL_STABILITY_MAX
  );
  const difficulty = clamp(
    DEFAULT_DIFFICULTY - DIFFICULTY_SPREAD * (2 * p - 1),
    1,
    10
  );
  return { stability, difficulty };
};

/**
 * rankNominations — sort scored candidates by nomination score (desc) and take
 * the top `limit`. Pure over an array of
 * { stem, pKnown, remainingCount } → adds { uncertainty, nominationScore }.
 */
export const rankNominations = (candidates = [], { limit = 20, saturation = EXPOSURE_SATURATION } = {}) => {
  const scored = (Array.isArray(candidates) ? candidates : []).map((c) => ({
    ...c,
    uncertainty: wordUncertainty(c.pKnown),
    nominationScore: nominationScore(c.pKnown, c.remainingCount, saturation),
  }));
  scored.sort((a, b) => b.nominationScore - a.nominationScore);
  return typeof limit === 'number' && limit >= 0 ? scored.slice(0, limit) : scored;
};
