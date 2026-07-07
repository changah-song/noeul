import { assembleFeatures, toNumericVector } from './featureAssembly';
import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  LOOKUP_LEARNING_RATE,
  THETA_LEARNING_RATE,
  difficultyFromLevelRank,
  seedThetaFromRank,
  updateThetaOnline,
} from './abilityModel';
import { normalizeBookLanguage } from '../constants/languages';

// ─── Training-dataset builder (Phase 4.2 feature bridge) ──────────────────────
//
// Turns the raw interaction event log into the (feature-vector, label) rows the
// offline Python trainer consumes. The whole point is NO TRAIN/SERVE SKEW: this
// reuses the exact `assembleFeatures` that the device serves with, so a feature
// means the same thing at training time and at score time.
//
// Like the baseline metric (§3.2), it is a PREQUENTIAL replay: it walks each
// profile's events in time order and, for every graded review, assembles the
// feature vector from state AS OF JUST BEFORE that outcome, then folds the outcome
// in. So no label leaks into its own features.
//
// PRE-CARD FRAMING (design doc §6): the model's job is to predict P(known) before
// a word becomes a flashcard, so SRS state is deliberately NOT a training feature
// (it also can't be faithfully reconstructed from the event log — the log stores
// the grade, not the resulting FSRS stability). Reconstructable behavioral state
// IS used: evolving theta, prior lookup/review counts for the word, and the
// user's known-hanja set (cross-word transfer), all built from the stream.
//
// Pure (no SQLite/clock beyond each event's own timestamp): the CLI
// (scripts/exportFeatureDataset.js) loads events and writes the dataset JSON.

const NEUTRAL_THETA = (ABILITY_THETA_MIN + ABILITY_THETA_MAX) / 2;
const CJK = /[一-鿿㐀-䶿]/g;

const toEpoch = (value) => {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
};
const groupKey = (e) => `${e.ownerId} ${e.profileId} ${e.language}`;

const addHanjaChars = (set, hanja) => {
  (typeof hanja === 'string' ? hanja.match(CJK) : null)?.forEach((c) => set.add(c));
};

/**
 * buildProfileRows — prequential replay of one profile, emitting a training row
 * per graded review event.
 *
 * @param {object}   args
 * @param {object[]} args.events          this profile's events
 * @param {string}   args.language
 * @param {number|null} args.selfReportRank
 * @returns {object[]} training rows { label, cold, vector, mask, categorical, ... }
 */
export const buildProfileRows = ({ events = [], language = 'ko', selfReportRank = null } = {}) => {
  const lang = normalizeBookLanguage(language) || 'ko';
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const ta = toEpoch(a.event.createdAt);
      const tb = toEpoch(b.event.createdAt);
      if (ta !== tb) return ta - tb;
      const ca = a.event.clientEventId ?? '';
      const cb = b.event.clientEventId ?? '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ event }) => event);

  const theta0 = selfReportRank != null ? seedThetaFromRank(lang, selfReportRank) : null;
  let theta = theta0 == null ? NEUTRAL_THETA : theta0;
  let foldedCount = 0;
  const seen = new Set();
  const aggByStem = new Map(); // stem → { reviewCount, lookupCount, lastLookupAt }
  const knownHanjaSet = new Set();
  const rows = [];

  for (const event of ordered) {
    const stem = typeof event.stem === 'string' && event.stem.trim() ? event.stem.trim() : event.word;
    const levelRank = event.levelRank ?? null;
    const isFallback = levelRank == null;
    const difficulty = difficultyFromLevelRank(lang, levelRank);
    const dict = {
      level_rank: levelRank,
      hanja: event.hanja ?? null,
      pos: event.pos ?? null,
      definition: event.definition ?? null,
    };
    const agg = aggByStem.get(stem) ?? { reviewCount: 0, lookupCount: 0, lastLookupAt: null };
    const now = toEpoch(event.createdAt) || Date.now();

    if (event.eventType === 'review' && (event.outcome === 0 || event.outcome === 1)) {
      // Assemble BEFORE folding this outcome. vocab:null — pre-card framing.
      const features = assembleFeatures({
        language: lang,
        stem,
        dict,
        ability: { theta, self_report_rank: selfReportRank, event_count: foldedCount },
        vocab: null,
        inBookFreq: event.inBookFreq,
        events: agg,
        knownHanjaSet,
        now,
      });
      const { vector, mask, categorical } = toNumericVector(features);
      rows.push({
        label: event.outcome,
        cold: !seen.has(stem),
        owner: event.ownerId,
        language: lang,
        stem,
        createdAt: event.createdAt ?? null,
        vector,
        mask,
        categorical,
      });
    }

    // Fold the event into theta (same rules the device runs; OOV skips update).
    if (!isFallback) {
      let outcome = null;
      let learningRate = THETA_LEARNING_RATE;
      if (event.eventType === 'review' && (event.outcome === 0 || event.outcome === 1)) {
        outcome = event.outcome;
      } else if (event.eventType === 'lookup') {
        outcome = 0;
        learningRate = LOOKUP_LEARNING_RATE;
      }
      if (outcome != null) {
        theta = updateThetaOnline({ theta, difficulty, outcome, eventCount: foldedCount, theta0, learningRate });
        foldedCount += 1;
      }
    }

    // Update per-stem behavioral aggregates AFTER scoring (so features see prior state).
    if (event.eventType === 'review') agg.reviewCount += 1;
    if (event.eventType === 'lookup') { agg.lookupCount += 1; agg.lastLookupAt = event.createdAt ?? null; }
    aggByStem.set(stem, agg);

    // A reviewed or explicitly-saved word contributes its hanja to the known set
    // (matches how the serving-side orchestrator builds it from saved vocab).
    if (event.eventType === 'review' || event.eventType === 'save') {
      addHanjaChars(knownHanjaSet, dict.hanja);
    }
    if (stem) seen.add(stem);
  }

  return rows;
};

/**
 * buildTrainingDataset — replay every profile in a mixed event list and return a
 * dataset object ready to serialize for the Python trainer.
 */
export const buildTrainingDataset = (events = [], meta = {}) => {
  const groups = new Map();
  for (const event of events) {
    const key = groupKey(event);
    if (!groups.has(key)) {
      groups.set(key, { events: [], language: event.language ?? 'ko', selfReportRank: null });
    }
    const g = groups.get(key);
    g.events.push(event);
    if (g.selfReportRank == null && event.selfReportRank != null) g.selfReportRank = event.selfReportRank;
  }

  const rows = [];
  for (const g of groups.values()) rows.push(...buildProfileRows(g));

  // A stable, sorted union of numeric feature keys present anywhere — the trainer
  // uses this as the fixed column order.
  const featureKeys = new Set();
  const categoricalKeys = new Set();
  for (const r of rows) {
    Object.keys(r.vector).forEach((k) => featureKeys.add(k));
    Object.keys(r.categorical).forEach((k) => categoricalKeys.add(k));
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      profiles: groups.size,
      totalEvents: events.length,
      rowCount: rows.length,
      featureKeys: Array.from(featureKeys).sort(),
      categoricalKeys: Array.from(categoricalKeys).sort(),
      ...meta,
    },
    rows,
  };
};
