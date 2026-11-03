import { logLoss, rocAuc } from './engineEvaluation';

// ─── Replay: score a level engine on a reader's real log ─────────────────────
//
// Feeds a reader's level log (the uploaded ability_log rows, or rows rebuilt
// from a phone database) through an engine, oldest first, and records what
// the engine predicted BEFORE each signal moved it:
//
//   reading   lookups and words read past: P(looks it up)
//   check     word-check answers: P(says "I know it")
//   review    flashcard reviews: P(recalls it)
//   fromReading  each word-check answer predicted from the level just before
//             the check began, so from reading alone: the cleanest test of
//             whether reading put the reader in the right place
//
// The engine is passed in (services/levelEngine.js, or an older copy of it),
// so two versions are compared on exactly the same events. Pure; the CLI is
// scripts/levelReplay.js.

const READING = new Set(['lookup', 'pass']);
const LABELLED = new Set(['check', 'review']);
const BINS = 10;

const dayOf = (at) => String(at || '').slice(0, 10);

/** Rows from the dashboard export (user_ability_log) as replay events. */
export const eventsFromAbilityLog = (rows = []) => (rows || [])
    .filter((row) => row && row.signal && row.created_at)
    .map((row) => ({
        signal: row.signal,
        stem: row.stem || row.word || null,
        outcome: row.outcome,
        difficulty: row.difficulty == null ? null : Number(row.difficulty),
        details: row.details || null,
        thetaBefore: row.theta_before == null ? null : Number(row.theta_before),
        thetaAfter: row.theta_after == null ? null : Number(row.theta_after),
        varianceBefore: row.var_before == null ? null : Number(row.var_before),
        at: row.created_at,
        source: row.source_book_uri || null,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

/** Predicted vs observed in tenths: { bin, n, predicted, observed }. */
export const calibration = (pairs) => {
    const bins = Array.from({ length: BINS }, () => ({ n: 0, predicted: 0, observed: 0 }));
    pairs.forEach(({ score, y }) => {
        const b = bins[Math.min(BINS - 1, Math.max(0, Math.floor(score * BINS)))];
        b.n += 1;
        b.predicted += score;
        b.observed += y;
    });
    return bins
        .map((b, i) => ({ bin: i, n: b.n, predicted: b.n ? b.predicted / b.n : null, observed: b.n ? b.observed / b.n : null }))
        .filter((b) => b.n > 0);
};

/** Mean |predicted − observed| over bins, weighted by count. */
export const calibrationError = (pairs) => {
    const bins = calibration(pairs);
    const total = bins.reduce((sum, b) => sum + b.n, 0);
    return total ? bins.reduce((sum, b) => sum + b.n * Math.abs(b.predicted - b.observed), 0) / total : null;
};

const summarize = (pairs) => ({
    n: pairs.length,
    positives: pairs.filter((p) => p.y === 1).length,
    meanPredicted: pairs.length ? pairs.reduce((s, p) => s + p.score, 0) / pairs.length : null,
    auc: rocAuc(pairs),
    logLoss: logLoss(pairs),
    calibrationError: calibrationError(pairs),
});

/**
 * replayLevelLog — run one reader's events through an engine.
 *
 * @param {object[]} events  from eventsFromAbilityLog
 * @param {object}   engine  the level engine's exports (readerState,
 *        applySignal, seedState, and widenState when it has one)
 * @param {object}   [policy]  what the app does around the engine:
 *        lookupOncePerDay — a word's second lookup of the day is not a signal
 *        lookupOnlyIfMarked — a lookup of a word that wasn't underlined is
 *          not a signal (engine.lookupCountsForLevel)
 *        difficultyOf(event) — recompute a word's difficulty (default: logged)
 *        checkStartVariance — how unsure a word check starts (default: engine's)
 * @returns {{ reading, check, review, fromReading, final, daily, skipped }}
 */
export const replayLevelLog = (events, engine, policy = {}) => {
    const { readerState, applySignal, seedState, widenState } = engine;
    const startVariance = policy.checkStartVariance ?? engine.CHECK_START_VARIANCE ?? 1;
    const difficultyOf = policy.difficultyOf || ((event) => event.difficulty);
    const pairs = { reading: [], check: [], review: [], fromReading: [] };
    const lookedUpToday = new Set();
    // Lookups and passes of each word so far: as in the app, a word seen
    // again counts less toward the level (engine.repeatWeight).
    const seen = new Map();
    const daily = new Map();
    // Start where the reader was when the log begins (the level is older than
    // its log), not at a blank prior.
    const first = events.find((e) => Number.isFinite(e.thetaBefore));
    let state = first
        ? seedState(readerState(null), { theta: first.thetaBefore, variance: first.varianceBefore ?? 2, at: first.at })
        : readerState(null);
    let today = null;
    let skipped = 0;
    let beforeCheck = null;

    for (const event of events) {
        const day = dayOf(event.at);
        if (day !== today) {
            today = day;
            lookedUpToday.clear();
        }
        if (event.signal === 'seed') {
            if (Number.isFinite(event.thetaAfter)) {
                state = seedState(state, { theta: event.thetaAfter, at: event.at });
            }
            beforeCheck = null;
            continue;
        }
        if (event.signal === 'check_start') {
            beforeCheck = state;
            state = widenState
                ? widenState(state, startVariance)
                : { ...state, variance: Math.max(state.variance, startVariance) };
            continue;
        }
        if (event.signal === 'pseudo') {
            state = applySignal(state, { type: 'pseudo', outcome: event.outcome, at: event.at }).state;
            continue;
        }
        if (!READING.has(event.signal) && !LABELLED.has(event.signal)) continue;
        if (READING.has(event.signal)) beforeCheck = null;

        const difficulty = difficultyOf(event);
        if (!Number.isFinite(difficulty)) {
            skipped += 1;
            continue;
        }
        let weight = 1;
        if (READING.has(event.signal) && event.stem) {
            const previous = seen.get(event.stem) || 0;
            seen.set(event.stem, previous + 1);
            if (engine.repeatWeight) weight = engine.repeatWeight(previous);
        }
        if (event.signal === 'lookup' && policy.lookupOnlyIfMarked && engine.lookupCountsForLevel
            && !engine.lookupCountsForLevel(state.theta, difficulty)) {
            skipped += 1;
            continue;
        }
        if (event.signal === 'lookup' && policy.lookupOncePerDay && event.stem) {
            if (lookedUpToday.has(event.stem)) {
                skipped += 1;
                continue;
            }
            lookedUpToday.add(event.stem);
        }

        if (event.signal === 'check' && beforeCheck) {
            const prior = applySignal(beforeCheck, { type: 'check', difficulty, outcome: event.outcome, at: event.at }).log;
            if (prior) pairs.fromReading.push({ score: prior.pObserved, y: event.outcome ? 1 : 0, stem: event.stem });
        }

        const { state: next, log } = applySignal(state, {
            type: event.signal,
            difficulty,
            outcome: event.outcome,
            at: event.at,
            weight,
        });
        if (!log) {
            skipped += 1;
            continue;
        }
        const y = log.outcome ? 1 : 0;
        const bucket = READING.has(event.signal) ? 'reading' : event.signal;
        pairs[bucket].push({ score: log.pObserved, y, stem: event.stem, difficulty });
        state = next;
        daily.set(day, state.theta);
    }

    return {
        reading: summarize(pairs.reading),
        check: summarize(pairs.check),
        review: summarize(pairs.review),
        fromReading: summarize(pairs.fromReading),
        calibration: { reading: calibration(pairs.reading), check: calibration(pairs.check) },
        final: { theta: state.theta, variance: state.variance },
        daily: [...daily.entries()].map(([day, theta]) => ({ day, theta })),
        skipped,
    };
};
