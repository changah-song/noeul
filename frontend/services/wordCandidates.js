// ─── "Before you go" word candidates — pure selection + presentation ──────────
//
// The DB orchestrator (getBookWordCandidates in Database.js) produces a ranked,
// dictionary-hydrated list of unsaved words worth keeping. Everything here is
// pure so it can be unit-tested and reasoned about without SQLite:
//
//   • deriveCandidateReason — the badge shown per word ("Rare in this book" /
//     "Worth a closer look" / "New here"), derived from the model's own signals.
//   • selectDailyCandidates — the daily-rotating subset. The panel promises a
//     fresh set each day, so we rotate deterministically by the calendar day:
//     the same words show all day, a different slice shows tomorrow, and it never
//     depends on wall-clock time within a day.
//   • pickExampleSentence — the in-book sentence to show the word in context.

/**
 * Reason keys map to i18n badge labels (read.candidateReason.*).
 *   rare       — the book barely uses this word again, so exposure won't teach it.
 *   new        — we think the reader probably doesn't know it yet (low P(known)).
 *   closerLook — genuinely uncertain (P near 0.5); worth a deliberate look.
 */
export const CANDIDATE_REASONS = ['rare', 'new', 'closerLook'];

export const deriveCandidateReason = (candidate = {}) => {
  const remaining = Number(candidate.remainingCount);
  if (Number.isFinite(remaining) && remaining <= 1) {
    return 'rare';
  }
  const pKnown = Number(candidate.pKnown);
  if (Number.isFinite(pKnown) && pKnown < 0.4) {
    return 'new';
  }
  return 'closerLook';
};

/**
 * dayNumber — whole days since the Unix epoch for the given date, in the local
 * timezone (so "today's picks" flip at local midnight, not UTC midnight).
 */
export const dayNumber = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 0;
  const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.floor(localMidnight / 86400000);
};

/**
 * selectDailyCandidates — pick up to `count` candidates for the given day.
 *
 * The input is already ranked best-first. We rotate the ranked list by the day
 * number so the surfaced slice changes daily but stays stable within a day, then
 * attach the display `reason`. Deterministic and side-effect free.
 */
export const selectDailyCandidates = (candidates = [], { date = new Date(), count = 3 } = {}) => {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (list.length === 0) return [];
  const take = Math.max(0, Math.min(count, list.length));
  if (take === 0) return [];

  const offset = ((dayNumber(date) % list.length) + list.length) % list.length;
  const rotated = [...list.slice(offset), ...list.slice(0, offset)];

  return rotated.slice(0, take).map((candidate) => ({
    ...candidate,
    reason: deriveCandidateReason(candidate),
  }));
};

// Sentence boundaries for Korean + latin prose. Keeps the terminator with the
// sentence so context reads naturally.
const SENTENCE_SPLIT = /(?<=[.!?。！？…])\s+|\n+/;

/**
 * pickExampleSentence — the first sentence in `text` that contains `surface`.
 * Returns a trimmed sentence, or null if the word isn't found. `maxLength` guards
 * against a runaway un-punctuated block.
 */
export const pickExampleSentence = (text, surface, { maxLength = 160 } = {}) => {
  const haystack = typeof text === 'string' ? text : '';
  const needle = typeof surface === 'string' ? surface.trim() : '';
  if (!haystack || !needle) return null;

  const sentences = haystack.split(SENTENCE_SPLIT);
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence && sentence.includes(needle) && sentence.length <= maxLength) {
      return sentence;
    }
  }
  // Fall back to a trimmed window around the first match if every containing
  // sentence is too long (or unpunctuated).
  const index = haystack.indexOf(needle);
  if (index === -1) return null;
  const start = Math.max(0, index - Math.floor((maxLength - needle.length) / 2));
  const slice = haystack.slice(start, start + maxLength).trim();
  return slice || null;
};
