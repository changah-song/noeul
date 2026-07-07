/* eslint-disable no-console */
//
// Phase 3.2 CLI — print the IRT baseline metric (Brier + calibration table,
// segmented cold vs. warm). This is the number Phase 4's pooled model must beat.
//
// The scoring math lives in ../services/baselineMetric.js and imports the REAL
// abilityModel functions, so what this prints IS the deployed baseline (no drift).
// We load that ESM through @babel/register (the project's babel-preset-expo
// transform), so `node scripts/baselineMetric.js` just works.
//
// USAGE
//   node scripts/baselineMetric.js --demo
//       Run on a seeded synthetic event stream — proves the pipeline end-to-end
//       and prints a real report without needing any exported data.
//
//   node scripts/baselineMetric.js --sqlite path/to/fluentfable.db
//       The faithful local export: read the on-device SQLite directly, joining
//       interaction_events → dictionary_cache (level_rank) → profile_ability
//       (self_report_rank), exactly the inputs the device scored with.
//
//   node scripts/baselineMetric.js --input events.json
//       Read a JSON array of normalized event records (see NORMALIZED SCHEMA).
//
// NORMALIZED SCHEMA (one object per event; snake_case keys are also accepted):
//   { ownerId, profileId, language, word, stem, eventType, outcome,
//     createdAt, clientEventId, levelRank, selfReportRank }
//   - eventType: 'review' (outcome 0/1) drives the labeled metric; 'lookup'
//     (outcome null → treated as 0) only advances theta.
//   - levelRank: KB band (NIKL 1-3 / HSK 1-7 / CEFR 1-6) or null (ungraded → OOV).
//   - selfReportRank: onboarding rank for this profile → theta_0 (null → neutral).
//
// SUPABASE (pooled) EXPORT NOTE: user_interaction_events + profile_ability live in
// Supabase, but level_rank does NOT (dictionary_cache is device-only). To evaluate
// pooled data, attach level_rank from a device dictionary_cache export or the
// backend proficiency_levels.db before feeding the JSON in.

require('@babel/register')({
  extensions: ['.js'],
  // Transpile our source (ESM) but not node_modules; picks up babel.config.js.
  ignore: [/node_modules/],
  cache: false,
});

const fs = require('fs');
const path = require('path');

const {
  evaluateBaseline,
  formatReport,
} = require('../services/baselineMetric');

// ── arg parsing ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);

// ── record normalization ──────────────────────────────────────────────────────
const pick = (obj, camel, snake) => (obj[camel] != null ? obj[camel] : obj[snake]);
const toNumOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const normalizeRecord = (r) => ({
  ownerId: pick(r, 'ownerId', 'owner_id') ?? 'guest',
  profileId: pick(r, 'profileId', 'profile_id') ?? 'ko_default',
  language: pick(r, 'language', 'language') ?? 'ko',
  word: pick(r, 'word', 'word') ?? null,
  stem: pick(r, 'stem', 'stem') ?? null,
  eventType: pick(r, 'eventType', 'event_type') ?? null,
  outcome: toNumOrNull(pick(r, 'outcome', 'outcome')),
  createdAt: pick(r, 'createdAt', 'created_at') ?? null,
  clientEventId: pick(r, 'clientEventId', 'client_event_id') ?? null,
  levelRank: toNumOrNull(pick(r, 'levelRank', 'level_rank')),
  selfReportRank: toNumOrNull(pick(r, 'selfReportRank', 'self_report_rank')),
});

// ── loaders ───────────────────────────────────────────────────────────────────
const loadFromJson = (file) => {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.events;
  if (!Array.isArray(rows)) {
    throw new Error('JSON input must be an array of events, or { events: [...] }.');
  }
  return rows.map(normalizeRecord);
};

const loadFromSqlite = (file) => {
  const Database = require('better-sqlite3');
  const db = new Database(path.resolve(file), { readonly: true, fileMustExist: true });
  // Join the exact inputs the device scored with: KB difficulty from the
  // device-global dictionary_cache (dedupe per stem, easiest band on ties) and the
  // profile's self-report seed. Skip soft-deleted events.
  const rows = db
    .prepare(
      `SELECT e.owner_id, e.profile_id, e.language, e.word, e.stem,
              e.event_type, e.outcome, e.created_at, e.client_event_id,
              dc.level_rank        AS level_rank,
              pa.self_report_rank  AS self_report_rank
         FROM interaction_events e
         LEFT JOIN (
           SELECT language, stem, MIN(level_rank) AS level_rank
             FROM dictionary_cache
            WHERE level_rank IS NOT NULL
            GROUP BY language, stem
         ) dc ON dc.language = e.language AND dc.stem = e.stem
         LEFT JOIN profile_ability pa
           ON pa.owner_id = e.owner_id
          AND pa.profile_id = e.profile_id
          AND pa.language = e.language
        WHERE e.deleted_at IS NULL
        ORDER BY e.created_at ASC`
    )
    .all();
  db.close();
  return rows.map(normalizeRecord);
};

// ── synthetic demo stream (seeded, deterministic) ─────────────────────────────
const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buildDemoEvents = () => {
  const rand = mulberry32(42);
  const language = 'ko';
  const events = [];
  const learners = 6;
  const wordsPerLearner = 45;
  let t = Date.parse('2026-01-01T00:00:00Z');

  for (let u = 0; u < learners; u += 1) {
    const owner = `demo-user-${u}`;
    const profile = 'ko_default';
    // TRUE ability in [-1.5, 1.5]; self-report is a noisy (miscalibrated) proxy.
    const trueTheta = -1.5 + 3 * rand();
    const trueRankFloat = 2 + trueTheta; // theta 0 ≈ mid band (rank 2 on ko's 1-3)
    const selfReportRank = Math.min(3, Math.max(1, Math.round(trueRankFloat + (rand() - 0.5))));

    // A small vocabulary; some words recur so warm samples exist.
    const vocab = Array.from({ length: 20 }, (_, i) => ({
      stem: `w${u}_${i}`,
      levelRank: 1 + (i % 3), // spread across ko bands 1-3
    }));

    for (let e = 0; e < wordsPerLearner; e += 1) {
      const w = vocab[Math.floor(rand() * vocab.length)];
      t += 60000 + Math.floor(rand() * 60000);
      // A tenth of interactions are lookups (no label; advance theta only).
      const isLookup = rand() < 0.1;
      const difficultyRank = w.levelRank;
      // Difficulty on the shared scale for ko: rank 1→-3, 2→0, 3→+3.
      const difficulty = ((difficultyRank - 1) / (3 - 1)) * 6 - 3;
      const pTrue = 1 / (1 + Math.exp(-(trueTheta - difficulty)));
      events.push({
        ownerId: owner,
        profileId: profile,
        language,
        word: w.stem,
        stem: w.stem,
        eventType: isLookup ? 'lookup' : 'review',
        outcome: isLookup ? null : rand() < pTrue ? 1 : 0,
        createdAt: new Date(t).toISOString(),
        clientEventId: `${owner}-${e}`,
        levelRank: w.levelRank,
        selfReportRank,
      });
    }
  }
  return events;
};

// ── main ──────────────────────────────────────────────────────────────────────
const main = () => {
  let events;
  let sourceLabel;

  if (hasFlag('--demo')) {
    events = buildDemoEvents();
    sourceLabel = 'SYNTHETIC DEMO DATA (seeded) — not a real calibration reading';
  } else if (getFlag('--sqlite')) {
    const file = getFlag('--sqlite');
    events = loadFromSqlite(file);
    sourceLabel = `sqlite: ${file}`;
  } else if (getFlag('--input')) {
    const file = getFlag('--input');
    events = loadFromJson(file);
    sourceLabel = `json: ${file}`;
  } else {
    console.error(
      'Usage: node scripts/baselineMetric.js (--demo | --sqlite <db> | --input <events.json>)'
    );
    process.exit(1);
    return;
  }

  const result = evaluateBaseline(events);
  console.log(`\nsource: ${sourceLabel}`);
  console.log(formatReport(result));

  if (result.meta.reviewSamples === 0) {
    console.log(
      '\nNote: no graded review events found — Brier/calibration need review outcomes,'
    );
    console.log('the one unconfounded label channel. Lookups only move theta.');
  }
};

main();
