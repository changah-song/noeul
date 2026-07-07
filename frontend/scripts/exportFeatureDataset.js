/* eslint-disable no-console */
//
// Phase 4.2 CLI — export the training dataset (feature vectors + review-outcome
// labels) for the offline Python trainer (backend/ml/train_pknown.py).
//
// Features are built by ../services/featureDataset.js, which reuses the SAME
// assembleFeatures the device serves with, so there is no train/serve skew. We
// load that ESM through @babel/register (project babel-preset-expo).
//
// USAGE
//   node scripts/exportFeatureDataset.js --sqlite path/to/fluentfable.db --out dataset.json
//       Faithful local export: read the on-device SQLite, attaching per-event
//       dictionary_cache fields (level_rank, hanja, pos, definition) and the
//       profile's self_report_rank, then replay to (features, label) rows.
//   node scripts/exportFeatureDataset.js --input events.json --out dataset.json
//       Replay a JSON array of normalized events (see baselineMetric.js schema,
//       plus optional levelRank/hanja/pos/definition/inBookFreq/selfReportRank).
//   node scripts/exportFeatureDataset.js --demo
//       A tiny hand-built stream — smoke-tests the exporter end to end. (The
//       authoritative "beats baseline" demonstration lives in the Python trainer's
//       --synthetic mode.)
//
// Output JSON: { meta: { featureKeys, categoricalKeys, ... }, rows: [ { label,
// cold, owner, vector, mask, categorical } ] } — consumed by train_pknown.py.

require('@babel/register')({ extensions: ['.js'], ignore: [/node_modules/], cache: false });

const fs = require('fs');
const path = require('path');

const { buildTrainingDataset } = require('../services/featureDataset');

const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

const toNumOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pick = (o, camel, snake) => (o[camel] != null ? o[camel] : o[snake]);
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
  hanja: pick(r, 'hanja', 'hanja') ?? null,
  pos: pick(r, 'pos', 'pos') ?? null,
  definition: pick(r, 'definition', 'definition') ?? null,
  inBookFreq: toNumOrNull(pick(r, 'inBookFreq', 'in_book_freq')),
  selfReportRank: toNumOrNull(pick(r, 'selfReportRank', 'self_report_rank')),
});

const loadFromJson = (file) => {
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed.events;
  if (!Array.isArray(rows)) throw new Error('JSON input must be an array of events, or { events: [...] }.');
  return rows.map(normalizeRecord);
};

const loadFromSqlite = (file) => {
  const Database = require('better-sqlite3');
  const db = new Database(path.resolve(file), { readonly: true, fileMustExist: true });
  const rows = db
    .prepare(
      `SELECT e.owner_id, e.profile_id, e.language, e.word, e.stem,
              e.event_type, e.outcome, e.created_at, e.client_event_id,
              dc.level_rank AS level_rank, dc.hanja AS hanja, dc.pos AS pos,
              dc.definition AS definition,
              pa.self_report_rank AS self_report_rank
         FROM interaction_events e
         LEFT JOIN (
           SELECT language, stem,
                  MIN(level_rank) AS level_rank,
                  MAX(hanja) AS hanja, MAX(pos) AS pos, MAX(definition) AS definition
             FROM dictionary_cache
            GROUP BY language, stem
         ) dc ON dc.language = e.language AND dc.stem = e.stem
         LEFT JOIN profile_ability pa
           ON pa.owner_id = e.owner_id AND pa.profile_id = e.profile_id AND pa.language = e.language
        WHERE e.deleted_at IS NULL
        ORDER BY e.created_at ASC`
    )
    .all();
  db.close();
  return rows.map(normalizeRecord);
};

const demoEvents = () => {
  // A small multi-user 學-family stream — enough for the Python trainer to fit on
  // (mixed outcomes, >1 user, shared hanja so cross-word overlap has signal). The
  // authoritative "beats baseline" demo is the trainer's own --synthetic mode.
  const vocab = [
    { stem: '학교', hanja: '學校', rank: 1 },
    { stem: '학생', hanja: '學生', rank: 1 },
    { stem: '생일', hanja: '生日', rank: 1 },
    { stem: '교실', hanja: '敎室', rank: 2 },
  ];
  const events = [];
  let day = 1;
  for (let u = 0; u < 3; u += 1) {
    const base = { ownerId: `demo-${u}`, profileId: 'ko_default', language: 'ko', selfReportRank: 1 + u };
    vocab.forEach((w, i) => {
      // Weaker users lapse the harder words; deterministic pattern for both classes.
      const outcome = (i + u) % 2 === 0 ? 1 : 0;
      day += 1;
      events.push({
        ...base, word: w.stem, stem: w.stem, eventType: 'review', outcome,
        levelRank: w.rank, hanja: w.hanja, pos: 'noun',
        createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`,
        clientEventId: `demo-${u}-${i}`,
      });
    });
  }
  return events;
};

const main = () => {
  let events;
  let source;
  if (args.includes('--demo')) { events = demoEvents(); source = 'demo'; }
  else if (getFlag('--sqlite')) { const f = getFlag('--sqlite'); events = loadFromSqlite(f); source = `sqlite:${f}`; }
  else if (getFlag('--input')) { const f = getFlag('--input'); events = loadFromJson(f); source = `json:${f}`; }
  else {
    console.error('Usage: node scripts/exportFeatureDataset.js (--demo | --sqlite <db> | --input <events.json>) [--out <file>]');
    process.exit(1);
    return;
  }

  const dataset = buildTrainingDataset(events, { source });
  const out = getFlag('--out');
  const json = JSON.stringify(dataset, null, out ? 0 : 2);
  if (out) {
    fs.writeFileSync(path.resolve(out), json);
    console.log(`Wrote ${dataset.rows.length} training rows (${dataset.meta.profiles} profiles) → ${out}`);
    console.log(`Feature keys: ${dataset.meta.featureKeys.length} numeric, ${dataset.meta.categoricalKeys.length} categorical`);
  } else {
    console.log(json);
  }
};

main();
