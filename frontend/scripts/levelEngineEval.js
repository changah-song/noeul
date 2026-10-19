/* eslint-disable no-console */
//
// Compare the level engine (services/levelEngine.js) with the model it
// replaced, on real or simulated reading data. See services/engineEvaluation.js
// for what is measured.
//
// USAGE
//   node scripts/levelEngineEval.js --sqlite path/to/fluentfable.db
//       A database pulled from a phone (see the phone-data-pull notes): reads
//       interaction_events joined to dictionary_cache for each word's level,
//       percentile, frequency and loanword flag.
//
//   node scripts/levelEngineEval.js --demo
//       Simulated readers with a known true level and lookup habit.

require('@babel/register')({
    extensions: ['.js'],
    ignore: [/node_modules/],
    cache: false,
});

const path = require('path');
const { evaluateEngine, formatEngineReport } = require('../services/engineEvaluation');

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

const loadFromSqlite = (file) => {
    const Database = require('better-sqlite3');
    const db = new Database(path.resolve(file), { readonly: true, fileMustExist: true });
    const columns = new Set(db.prepare('PRAGMA table_info(dictionary_cache)').all().map((c) => c.name));
    const has = (name) => columns.has(name);
    const rows = db.prepare(
        `SELECT e.owner_id, e.profile_id, e.language, e.word, e.stem, e.event_type, e.outcome, e.created_at,
                dc.level_rank, dc.difficulty_percentile, dc.zipf, dc.loanword
           FROM interaction_events e
           LEFT JOIN (
             SELECT language, stem,
                    MIN(level_rank) AS level_rank,
                    MIN(difficulty_percentile) AS difficulty_percentile,
                    ${has('zipf') ? 'MAX(zipf)' : 'NULL'} AS zipf,
                    ${has('loanword') ? 'MAX(loanword)' : 'NULL'} AS loanword
               FROM dictionary_cache
              GROUP BY language, stem
           ) dc ON dc.language = e.language AND dc.stem = e.stem
          WHERE e.deleted_at IS NULL
            AND e.event_type IN ('lookup', 'exposure', 'review', 'check')
          ORDER BY e.created_at ASC`
    ).all();
    db.close();
    return rows.map((r) => ({
        ownerId: r.owner_id,
        profileId: r.profile_id,
        language: r.language,
        word: r.word,
        stem: r.stem,
        eventType: r.event_type,
        outcome: r.outcome,
        createdAt: r.created_at,
        levelRank: r.level_rank,
        percentile: r.difficulty_percentile,
        zipf: r.zipf,
        loanword: r.loanword,
    }));
};

const mulberry32 = (seed) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Simulated readers: each word has a true difficulty (level + frequency +
// noise); each reader knows each word with P = sigmoid(truth − difficulty),
// once, and looks up an unknown word with their own habit and rarely a
// known one.
const buildDemoEvents = () => {
    const random = mulberry32(20261019);
    const sigmoid = (x) => 1 / (1 + Math.exp(-x));
    const vocab = Array.from({ length: 2500 }, (_, i) => {
        const rank = 1 + Math.floor(random() * 6);
        const zipf = 6.5 - ((rank - 1) / 5) * 4 + (random() - 0.5) * 1.6;
        const truth = ((rank - 1) / 5) * 6 - 3 + (random() - 0.5) * 2.4;
        return { stem: `w${i}`, rank, zipf, truth };
    });
    const readers = [
        { id: 'tapper', truth: 0.8, lookupRate: 0.8 },
        { id: 'skimmer', truth: 0.2, lookupRate: 0.25 },
        { id: 'beginner', truth: -1.4, lookupRate: 0.5 },
    ];
    const events = [];
    const start = Date.UTC(2026, 8, 1);
    readers.forEach((reader) => {
        // Whether this reader knows each word is fixed, not re-rolled per sighting.
        const knows = vocab.map((word) => random() < sigmoid(reader.truth - word.truth));
        for (let i = 0; i < 2500; i += 1) {
            const index = Math.floor(Math.pow(random(), 1.3) * vocab.length);
            const word = vocab[index];
            const known = knows[index];
            const lookedUp = known ? random() < 0.03 : random() < reader.lookupRate;
            const base = {
                ownerId: reader.id, profileId: 'ko_default', language: 'ko', stem: word.stem, word: word.stem,
                createdAt: new Date(start + i * 15 * 60000).toISOString(), levelRank: word.rank, zipf: word.zipf,
            };
            if (i % 60 === 0) events.push({ ...base, eventType: 'check', outcome: known ? 1 : 0 });
            else if (lookedUp) events.push({ ...base, eventType: 'lookup', outcome: null });
            else events.push({ ...base, eventType: 'exposure', outcome: 1 });
        }
    });
    return events;
};

const main = () => {
    let events;
    let label;
    if (args.includes('--demo')) {
        events = buildDemoEvents();
        label = 'SIMULATED READERS (seeded) — checks the pipeline, not a real reading';
    } else if (flag('--sqlite')) {
        events = loadFromSqlite(flag('--sqlite'));
        label = `sqlite: ${flag('--sqlite')}`;
    } else {
        console.error('Usage: node scripts/levelEngineEval.js (--demo | --sqlite <db>)');
        process.exit(1);
    }
    console.log(`\nsource: ${label}\nevents: ${events.length}\n`);
    console.log(formatEngineReport(evaluateEngine(events)));
};

main();
