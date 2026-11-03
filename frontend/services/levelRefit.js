import { LEVEL_THETA_MAX, LEVEL_THETA_MIN, sigmoid } from './abilityModel';
import {
    CHECK_YES_GIVEN_KNOWN,
    GUESS_RATE_MAX,
    GUESS_RATE_PRIOR,
    ITEM_SLOPE,
    PRIOR_VARIANCE,
    REVIEW_RECALL_GIVEN_KNOWN,
    REVIEW_RECALL_GIVEN_UNKNOWN,
    SIGNAL_WEIGHTS,
    repeatWeight,
} from './levelEngine';
import { isObservedLevelMark } from './levelSample';

// ─── Batch refit: the level from the whole recent log ─────────────────────────
//
// The online engine (levelEngine.applySignal) nudges the level once per
// signal. That is cheap and immediate, but the answer depends on the order
// signals came in, a habit re-weighting can push the level the wrong way, and
// thousands of signals from the same few sessions make it far surer than it
// should be (one reader ended at ±0.20 while being two levels off).
//
// The refit instead finds the level that best explains everything at once:
//
//   P(known)            = sigmoid(ITEM_SLOPE · (θ − difficulty))
//   P(look up)          = h · P(known) + r · (1 − P(known))
//   P(says "know")      = 0.97 · P(known) + g · (1 − P(known))
//   P(recalls a card)   = 0.9 · P(known) + 0.35 · (1 − P(known))
//
// with three things learned per reader: the level θ, how often they look up a
// word they don't know (r), and how often they tap one they do know (h: for
// the pinyin, the audio, the sentence translation). g, the guess rate, comes
// from made-up words in the word check.
//
// Each signal is weighted by:
//   age       half the weight every HALF_LIFE_DAYS (the level moves slowly)
//   repeats   a word seen again counts less (levelEngine.repeatWeight)
//   session   a session's reading counts at most SESSION_CAP signals in total:
//             500 words from one evening are not 500 independent tests
//
// Fitted by EM (which reading signals came from known words), then the level's
// uncertainty is read off its exact posterior on a grid, with a floor.
// Pure; Database.refitReaderLevel feeds it the log and saves the result.

export const HALF_LIFE_DAYS = 90;
export const SESSION_CAP = 40;
// The level is never reported surer than this (sd ≈ 0.25): the word
// difficulties it is measured against are themselves approximate.
export const MIN_LEVEL_VARIANCE = 0.06;
// Priors on the two tap rates: Beta(2, 2) for r (any habit), Beta(2, 18)
// for h (mean 0.1).
const R_PRIOR = { a: 2, b: 2 };
const H_PRIOR = { a: 2, b: 18 };
const R_RANGE = [0.05, 0.95];
const H_RANGE = [0.005, 0.5];

const DAY_MS = 24 * 60 * 60 * 1000;
const GRID_POINTS = 121;
const R_GRID = Array.from({ length: 13 }, (_, i) => 0.05 + i * 0.075);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const log = (x) => Math.log(clamp(x, 1e-12, 1));

const toTime = (value) => {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
};

/**
 * prepareRefitEvents — turn logged events into weighted signals.
 *
 * @param {object[]} events  { type: 'lookup'|'pass'|'check'|'review'|'pseudo',
 *        stem, difficulty, outcome, at, source, levelMark } — levelMark, on
 *        lookups from the book reader, says whether reading past the word
 *        was being logged then (1 underlined, 2 sampled, 0 neither)
 * @returns {{ reading, labelled, pseudo }} reading/labelled items carry
 *          { type, difficulty, y, w, stem }
 */
export const prepareRefitEvents = (events = [], { now = Date.now() } = {}) => {
    const ordered = (events || [])
        .map((e) => ({ ...e, t: toTime(e.at) }))
        .filter((e) => e.t != null)
        .sort((a, b) => a.t - b.t);
    const decay = (t) => 0.5 ** (Math.max(0, now - t) / DAY_MS / HALF_LIFE_DAYS);

    const seen = new Map();
    const lookedUpOn = new Set();
    const exposed = new Set();
    const reading = [];
    const labelled = [];
    let pseudo = { yes: 0, total: 0 };

    for (const e of ordered) {
        if (e.type === 'pseudo') {
            pseudo = { yes: pseudo.yes + (e.outcome ? 1 : 0), total: pseudo.total + 1 };
            continue;
        }
        const difficulty = Number(e.difficulty);
        if (!Number.isFinite(difficulty) || !e.stem) continue;
        const day = new Date(e.t).toISOString().slice(0, 10);
        if (e.type === 'lookup' || e.type === 'pass') {
            const previous = seen.get(e.stem) || 0;
            seen.set(e.stem, previous + 1);
            if (e.type === 'lookup') {
                // A word's second lookup in a day is not new evidence.
                const key = `${e.stem}|${day}`;
                if (lookedUpOn.has(key)) continue;
                lookedUpOn.add(key);
            } else {
                exposed.add(e.stem);
            }
            reading.push({
                type: e.type,
                stem: e.stem,
                difficulty,
                y: e.type === 'lookup' ? 1 : 0,
                w: decay(e.t) * repeatWeight(previous),
                session: `${day}|${e.source || ''}`,
                levelMark: e.levelMark == null ? null : Number(e.levelMark),
            });
        } else if (e.type === 'check' || e.type === 'review') {
            labelled.push({
                type: e.type,
                stem: e.stem,
                difficulty,
                y: e.outcome ? 1 : 0,
                w: decay(e.t) * (SIGNAL_WEIGHTS[e.type] ?? 1),
            });
        }
    }

    // A session's reading counts at most SESSION_CAP signals.
    const totals = new Map();
    reading.forEach((r) => totals.set(r.session, (totals.get(r.session) || 0) + r.w));
    reading.forEach((r) => {
        const total = totals.get(r.session);
        if (total > SESSION_CAP) r.w *= SESSION_CAP / total;
        // A lookup counts only when reading past the same word was being
        // logged then (underlined, or in the level sample); otherwise it is
        // evidence one way only. The reader records that on the lookup
        // (levelMark). Older lookups lack it: they count when the word has
        // been seen read past at all. That rule is biased upward (a hard word
        // tapped every time never is), but judging from the level, then or now,
        // was worse: on one real log, words below difficulty −2 were looked
        // up 98 times and never logged read past. Older lookups fade with age.
        if (r.type === 'pass') r.counts = true;
        else if (r.levelMark != null) r.counts = isObservedLevelMark(r.levelMark);
        else r.counts = exposed.has(r.stem);
    });
    return { reading, labelled, pseudo };
};

const guessRateFor = (pseudo) => clamp(
    (GUESS_RATE_PRIOR.yes + pseudo.yes) / (GUESS_RATE_PRIOR.total + pseudo.total),
    0.01,
    GUESS_RATE_MAX,
);

const rates = (item, { r, h, g }) => {
    if (item.type === 'lookup' || item.type === 'pass') return { hit: h, falseAlarm: r };
    if (item.type === 'check') return { hit: CHECK_YES_GIVEN_KNOWN, falseAlarm: g };
    return { hit: REVIEW_RECALL_GIVEN_KNOWN, falseAlarm: REVIEW_RECALL_GIVEN_UNKNOWN };
};

// A lookup is only evidence about the level when reading past the same word
// would have been logged: the word was underlined then, or is a sampled word
// whose reading past is logged (levelEngine.lookupCountsForLevel).
const counts = (item) => item.counts !== false;

// Signals of one kind with the same outcome and (to 0.05) the same difficulty
// say the same thing: summing their weights first makes a fit over thousands
// of signals take a few hundred terms.
const DIFFICULTY_STEP = 0.05;
const aggregate = (items) => {
    const groups = new Map();
    items.forEach((item) => {
        const difficulty = Math.round(item.difficulty / DIFFICULTY_STEP) * DIFFICULTY_STEP;
        const key = `${item.type}|${item.y}|${difficulty}`;
        const group = groups.get(key);
        if (group) group.w += item.w;
        else groups.set(key, { type: item.type, y: item.y, difficulty, w: item.w });
    });
    return [...groups.values()];
};

const logLikelihood = (items, theta, params) => items.reduce((sum, item) => {
    if (!counts(item)) return sum;
    const pk = sigmoid(ITEM_SLOPE * (theta - item.difficulty));
    const { hit, falseAlarm } = rates(item, params);
    const p1 = hit * pk + falseAlarm * (1 - pk);
    return sum + item.w * (item.y ? log(p1) : log(1 - p1));
}, 0);

/**
 * fitReaderLevel — the level, both tap rates and the level's uncertainty that
 * best explain a reader's weighted signals.
 *
 * @param {object} prepared  from prepareRefitEvents
 * @param {object} [prior]   { theta, variance } (the level picker's pick, or 0)
 * @returns {{ theta, variance, lookupRate, knownTapRate, guessRate,
 *             readingWeight, labelledWeight }}
 */
export const fitReaderLevel = ({ reading = [], labelled = [], pseudo = { yes: 0, total: 0 } }, prior = {}) => {
    const mu0 = clamp(Number.isFinite(Number(prior.theta)) ? Number(prior.theta) : 0, LEVEL_THETA_MIN, LEVEL_THETA_MAX);
    const v0 = Number(prior.variance) > 0 ? Number(prior.variance) : PRIOR_VARIANCE;
    const g = guessRateFor(pseudo);
    const items = aggregate([...reading.filter(counts), ...labelled]);
    let theta = mu0;
    let r = 0.5;
    let h = 0.1;

    for (let iter = 0; iter < 60; iter += 1) {
        // E-step: the chance each signal came from a known word.
        let rNum = R_PRIOR.a - 1;
        let rDen = R_PRIOR.a + R_PRIOR.b - 2;
        let hNum = H_PRIOR.a - 1;
        let hDen = H_PRIOR.a + H_PRIOR.b - 2;
        const q = items.map((item) => {
            if (!counts(item)) return null;
            const pk = sigmoid(ITEM_SLOPE * (theta - item.difficulty));
            const { hit, falseAlarm } = rates(item, { r, h, g });
            const known = pk * (item.y ? hit : 1 - hit);
            const unknown = (1 - pk) * (item.y ? falseAlarm : 1 - falseAlarm);
            const value = known / Math.max(1e-12, known + unknown);
            if (item.type === 'lookup' || item.type === 'pass') {
                rNum += item.w * (1 - value) * item.y;
                rDen += item.w * (1 - value);
                hNum += item.w * value * item.y;
                hDen += item.w * value;
            }
            return value;
        });

        // M-step: tap rates in closed form (a known-word tap is rarer than an
        // unknown-word one, or the two would swap meanings).
        const nextR = clamp(rNum / Math.max(1e-9, rDen), R_RANGE[0], R_RANGE[1]);
        const nextH = clamp(Math.min(hNum / Math.max(1e-9, hDen), nextR - 0.02), H_RANGE[0], H_RANGE[1]);

        // The level by Newton steps on the expected log-likelihood.
        let nextTheta = theta;
        for (let step = 0; step < 8; step += 1) {
            let grad = -(nextTheta - mu0) / v0;
            let hess = -1 / v0;
            items.forEach((item, i) => {
                if (q[i] == null) return;
                const pk = sigmoid(ITEM_SLOPE * (nextTheta - item.difficulty));
                grad += item.w * ITEM_SLOPE * (q[i] - pk);
                hess -= item.w * ITEM_SLOPE * ITEM_SLOPE * pk * (1 - pk);
            });
            const move = clamp(-grad / hess, -1, 1);
            nextTheta = clamp(nextTheta + move, LEVEL_THETA_MIN, LEVEL_THETA_MAX);
            if (Math.abs(move) < 1e-5) break;
        }

        const converged = Math.abs(nextTheta - theta) < 1e-4 && Math.abs(nextR - r) < 1e-4 && Math.abs(nextH - h) < 1e-4;
        theta = nextTheta;
        r = nextR;
        h = nextH;
        if (converged) break;
    }

    // The level's posterior on a grid, averaged over the unknown-word tap
    // rate r. From reading alone a strong reader who rarely taps and a weaker
    // one who taps more can explain the same log almost equally well; fixing
    // r at its best fit would hide that and report the level far too sure.
    // h is pinned down well by the many known words, so it stays at its fit.
    const grid = [];
    for (let i = 0; i < GRID_POINTS; i += 1) {
        grid.push(LEVEL_THETA_MIN + ((LEVEL_THETA_MAX - LEVEL_THETA_MIN) * i) / (GRID_POINTS - 1));
    }
    const logPost = grid.map(() => []);
    R_GRID.forEach((rate) => {
        if (rate <= h) return;
        const logPrior = (R_PRIOR.a - 1) * Math.log(rate) + (R_PRIOR.b - 1) * Math.log(1 - rate);
        const params = { r: rate, h, g };
        grid.forEach((x, i) => {
            logPost[i].push(logPrior - 0.5 * ((x - mu0) ** 2) / v0 + logLikelihood(items, x, params));
        });
    });
    const top = Math.max(...logPost.flat());
    const mass = logPost.map((row) => row.reduce((sum, lp) => sum + Math.exp(lp - top), 0));
    const total = mass.reduce((a, b) => a + b, 0);
    const mean = grid.reduce((sum, x, i) => sum + x * mass[i], 0) / total;
    const variance = grid.reduce((sum, x, i) => sum + ((x - mean) ** 2) * mass[i], 0) / total;

    return {
        theta: mean,
        variance: Math.max(MIN_LEVEL_VARIANCE, variance),
        lookupRate: r,
        knownTapRate: h,
        guessRate: g,
        readingWeight: reading.reduce((s, x) => s + x.w, 0),
        labelledWeight: labelled.reduce((s, x) => s + x.w, 0),
    };
};
