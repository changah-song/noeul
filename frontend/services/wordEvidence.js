import { sigmoid } from './abilityModel';

// Per-word evidence for the underline model (difficulty phase 2).
//
// The baseline shades a word from two numbers only: the reader's ability and
// the word's difficulty. That leaves out what the reader has actually done
// with THIS word. The adjustments below move the word's P(known) on the logit
// scale, so a word the reader keeps looking up turns darker even if its band
// says "easy", and a word they have read past many times or recalled in
// review turns lighter, eventually dropping its mark.
//
// Pure: takes the aggregated event rows and a clock, returns numbers. The
// magnitudes are deliberate priors, not fitted values; the baseline metric
// (services/baselineMetric.js) is where they get checked against real data.

// A lookup is the strongest "did not know it" signal. Its weight decays with
// a 30-day half-life so an old lookup of a word since learned fades out.
export const EVIDENCE_LOOKUP_LOGIT = -0.9;
export const EVIDENCE_LOOKUP_HALF_LIFE_DAYS = 30;
export const EVIDENCE_LOOKUP_FLOOR = -2.4;

// Reading past a word without tapping is weak evidence of knowing it; it
// adds up slowly and is capped so a frequent word cannot vanish on its own.
export const EVIDENCE_EXPOSURE_LOGIT = 0.12;
export const EVIDENCE_EXPOSURE_CAP = 1.2;

// Flashcard reviews are the clean signal: each recalled / failed review moves
// the word a long way.
export const EVIDENCE_REVIEW_GOOD_LOGIT = 0.8;
export const EVIDENCE_REVIEW_BAD_LOGIT = -0.8;
export const EVIDENCE_REVIEW_CAP = 2.5;

// Saving a word means the reader is working on it: nudge it darker so it
// keeps its mark until reviews or exposures say otherwise.
export const EVIDENCE_SAVED_LOGIT = -0.4;

const DAY_MS = 24 * 60 * 60 * 1000;

const toTime = (value) => {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * summarizeEvidenceRows — fold the grouped event rows for a book's words into
 * one record per stem.
 *
 * Rows come from `lookupBookWordEvidence`: { stem, event_type, outcome, n,
 * last_at }, one per (stem, event type, outcome). `n` is the count and
 * `last_at` the latest timestamp in that group.
 *
 * @returns {Map<string, {lookups:number, lastLookupAt:number|null,
 *   exposures:number, reviewsGood:number, reviewsBad:number, saved:boolean}>}
 */
export const summarizeEvidenceRows = (rows = []) => {
  const byStem = new Map();
  for (const row of rows || []) {
    const stem = typeof row?.stem === 'string' ? row.stem.trim() : '';
    if (!stem) continue;
    const count = Number(row.n ?? row.count ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const entry = byStem.get(stem) || {
      lookups: 0, lastLookupAt: null, exposures: 0, reviewsGood: 0, reviewsBad: 0, saved: false,
    };
    const lastAt = toTime(row.last_at ?? row.lastAt);
    switch (row.event_type ?? row.eventType) {
      case 'lookup':
        entry.lookups += count;
        if (lastAt != null && (entry.lastLookupAt == null || lastAt > entry.lastLookupAt)) {
          entry.lastLookupAt = lastAt;
        }
        break;
      case 'exposure':
        entry.exposures += count;
        break;
      case 'review': {
        const outcome = Number(row.outcome);
        if (outcome === 1) entry.reviewsGood += count;
        else if (outcome === 0) entry.reviewsBad += count;
        break;
      }
      case 'save':
        entry.saved = true;
        break;
      case 'unsave':
        // A later unsave undoes the save; rows are unordered, so compare times.
        if (lastAt != null && entry.savedAt != null && lastAt > entry.savedAt) entry.saved = false;
        break;
      default:
        break;
    }
    if ((row.event_type ?? row.eventType) === 'save') entry.savedAt = lastAt;
    byStem.set(stem, entry);
  }
  byStem.forEach((entry) => { delete entry.savedAt; });
  return byStem;
};

/**
 * evidenceLogit — the logit shift this word earns from its history. Zero for
 * a word with no history, so the baseline shade is unchanged.
 */
export const evidenceLogit = (summary, now = Date.now()) => {
  if (!summary) return 0;
  let shift = 0;

  if (summary.lookups > 0) {
    const ageDays = summary.lastLookupAt != null ? Math.max(0, (now - summary.lastLookupAt) / DAY_MS) : 0;
    const recency = Math.pow(0.5, ageDays / EVIDENCE_LOOKUP_HALF_LIFE_DAYS);
    // The first lookup counts fully; repeats add with diminishing returns.
    const strength = 1 + Math.log(summary.lookups);
    shift += Math.max(EVIDENCE_LOOKUP_FLOOR, EVIDENCE_LOOKUP_LOGIT * strength * recency);
  }

  if (summary.exposures > 0) {
    shift += Math.min(EVIDENCE_EXPOSURE_CAP, EVIDENCE_EXPOSURE_LOGIT * summary.exposures);
  }

  const reviews = EVIDENCE_REVIEW_GOOD_LOGIT * (summary.reviewsGood || 0)
    + EVIDENCE_REVIEW_BAD_LOGIT * (summary.reviewsBad || 0);
  shift += clamp(reviews, -EVIDENCE_REVIEW_CAP, EVIDENCE_REVIEW_CAP);

  if (summary.saved) {
    shift += EVIDENCE_SAVED_LOGIT;
  }

  return shift;
};

/** adjustedPKnown — the baseline P(known) moved by the word's evidence. */
export const adjustedPKnown = (baseP, summary, now = Date.now()) => {
  const p = clamp(Number(baseP), 1e-6, 1 - 1e-6);
  const shift = evidenceLogit(summary, now);
  if (shift === 0) return p;
  return sigmoid(Math.log(p / (1 - p)) + shift);
};
