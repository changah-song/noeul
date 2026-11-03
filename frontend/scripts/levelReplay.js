/* eslint-disable no-console */
//
// Score level-engine versions on a reader's real level log, side by side.
// See services/levelReplay.js for what is measured.
//
// USAGE
//   node scripts/levelReplay.js --log reader-zh.json [--engine a.js --engine b.js] [--once-per-day]
//
//   --log      the reader's ability_log rows as JSON (the Level model page's
//              data: admin_level_model(p_user, p_language).log)
//   --engine   a level engine module (default services/levelEngine.js). Pass
//              it twice to compare, e.g. an older copy saved with
//              `git show origin/main:frontend/services/levelEngine.js`.
//   --once-per-day  a word's second lookup in a day is not a signal (the app
//              does this from PR fix/level-engine-bugs on)
//   --only-marked  a lookup of a word that wasn't underlined is not a signal
//   --app      both, as the app does from fix/level-engine-bugs on
//   --json     print the full result as JSON

require('@babel/register')({
    extensions: ['.js'],
    ignore: [/node_modules/],
    cache: false,
});

const fs = require('fs');
const path = require('path');
const { eventsFromAbilityLog, replayLevelLog } = require('../services/levelReplay');

const args = process.argv.slice(2);
const values = (name) => args.flatMap((arg, i) => (arg === name && i + 1 < args.length ? [args[i + 1]] : []));
const has = (name) => args.includes(name);

const logFile = values('--log')[0];
if (!logFile) {
    console.error('usage: node scripts/levelReplay.js --log reader.json [--engine file.js ...] [--once-per-day] [--json]');
    process.exit(1);
}
const engines = values('--engine');
if (engines.length === 0) engines.push(path.join(__dirname, '../services/levelEngine.js'));

const events = eventsFromAbilityLog(JSON.parse(fs.readFileSync(path.resolve(logFile), 'utf8')));
const results = engines.map((file) => ({
    name: path.basename(file),
    // eslint-disable-next-line global-require, import/no-dynamic-require
    result: replayLevelLog(events, require(path.resolve(file)), {
        lookupOncePerDay: has('--once-per-day') || has('--app'),
        lookupOnlyIfMarked: has('--only-marked') || has('--app'),
    }),
}));

if (has('--json')) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
}

const f = (v, d = 3) => (v == null ? '–' : Number(v).toFixed(d));
const row = (label, pick) => `${label.padEnd(28)}${results.map(({ result }) => pick(result).padStart(14)).join('')}`;

console.log(`events ${events.length}  (${events[0]?.at?.slice(0, 10)} → ${events[events.length - 1]?.at?.slice(0, 10)})\n`);
console.log(row('', () => '').replace(/\s+$/, '') + results.map(({ name }) => name.slice(0, 13).padStart(14)).join(''));
[
    ['reading', 'reading (looked up?)'],
    ['check', 'word check (know?)'],
    ['fromReading', 'check, from reading only'],
    ['review', 'review (recalled?)'],
].forEach(([key, label]) => {
    console.log(row(`${label} n`, (r) => String(r[key].n)));
    console.log(row('  AUC', (r) => f(r[key].auc)));
    console.log(row('  log loss', (r) => f(r[key].logLoss)));
    console.log(row('  predicted vs observed', (r) => (r[key].n ? `${f(r[key].meanPredicted, 2)}/${f(r[key].positives / r[key].n, 2)}` : '–')));
    console.log(row('  calibration error', (r) => f(r[key].calibrationError)));
});
console.log(row('final level', (r) => `${f(r.final.theta, 2)} ± ${f(Math.sqrt(r.final.variance), 2)}`));
console.log(row('skipped signals', (r) => String(r.skipped)));
