import {
    ABILITY_THETA_MAX,
    ABILITY_THETA_MIN,
    OOV_DIFFICULTY,
    difficultyFromLevelRank,
    difficultyFromPercentile,
    sigmoid,
} from './abilityModel';

// ─── Level engine (difficulty model v2) ───────────────────────────────────────
//
// One update rule for every signal the reader gives us, and a measure of how
// sure we are. Pure: no SQLite, no React. Database.js persists the state and
// logs every change (ability_log) so the admin dashboard can show why the
// level moved.
//
// The reader's level is a belief, not a number: a mean `theta` and a
// `variance`. P(known) for a word is sigmoid(theta − difficulty), as before.
//
// Every signal is a noisy yes/no observation about whether the word is known:
//
//     P(observation) = hit · P(known) + falseAlarm · (1 − P(known))
//
//   lookup / read past   observation = "looked it up"
//                        hit        = P(look up | known)      ≈ 0.03
//                        falseAlarm = P(look up | unknown)    = the reader's
//                                     lookup rate, learned per reader
//   word check           observation = "said I know it"
//                        hit ≈ 0.97, falseAlarm = guess rate (from made-up words)
//   flashcard review     observation = "recalled it"
//                        hit ≈ 0.9, falseAlarm ≈ 0.35 (the card was studied)
//
// One step of Bayesian filtering moves the belief: the posterior is computed
// on a grid and matched back to a mean and variance. Early on (wide belief) a few
// signals move the level a lot; with hundreds behind it, little. Between
// sessions the variance grows a little per day, so the level can follow real
// progress.
//
// The same rule runs per word (wordPosterior): a word gets its own offset from
// the reader's level, moved by what the reader did with that word, its word
// family (Korean) or its characters (Chinese).

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const DAY_MS = 24 * 60 * 60 * 1000;

// Belief about the reader's level.
export const PRIOR_VARIANCE = 2.0;        // a reader we know nothing about (sd ≈ 1.4)
export const SEED_VARIANCE = 0.6;         // after the vocabulary picker (sd ≈ 0.8)
export const CHECK_SEED_VARIANCE = 0.35;  // after a full word check
export const MIN_VARIANCE = 0.02;
export const DRIFT_PER_DAY = 0.004;       // variance regained per day without signals
export const MAX_STEP = 0.6;              // no single signal moves the level further

// Observation models (see the header).
export const LOOKUP_GIVEN_KNOWN = 0.03;
export const LOOKUP_RATE_PRIOR = { hits: 3, expected: 6 }; // Beta(3, 3): 0.5
export const LOOKUP_RATE_MIN = 0.1;
export const LOOKUP_RATE_MAX = 0.95;
export const CHECK_YES_GIVEN_KNOWN = 0.97;
export const GUESS_RATE_PRIOR = { yes: 1, total: 20 };     // 0.05
export const GUESS_RATE_MAX = 0.6;
export const REVIEW_RECALL_GIVEN_KNOWN = 0.9;
export const REVIEW_RECALL_GIVEN_UNKNOWN = 0.35;

// How far each kind of signal is trusted (a power on its likelihood).
// Reviews are of words the reader is deliberately studying, so they say less
// about the reader's general level than about the word.
export const SIGNAL_WEIGHTS = {
    lookup: 1,
    pass: 1,
    check: 1,
    review: 0.5,
};

/**
 * observationModel — hit / false-alarm rates for a signal, given the reader's
 * learned rates.
 */
export const observationModel = (signal, { lookupRate, guessRate } = {}) => {
    switch (signal) {
    case 'lookup':
    case 'pass':
        return {
            hit: LOOKUP_GIVEN_KNOWN,
            falseAlarm: clamp(Number(lookupRate) || 0.5, LOOKUP_RATE_MIN, LOOKUP_RATE_MAX),
        };
    case 'check':
        return {
            hit: CHECK_YES_GIVEN_KNOWN,
            falseAlarm: clamp(Number(guessRate) || 0.05, 0.01, GUESS_RATE_MAX),
        };
    case 'review':
        return { hit: REVIEW_RECALL_GIVEN_KNOWN, falseAlarm: REVIEW_RECALL_GIVEN_UNKNOWN };
    default:
        return null;
    }
};

/**
 * observedValue — the yes/no outcome a signal reports, in its model's terms:
 * 1 = looked up / said "know" / recalled.
 */
export const observedValue = (signal, outcome) => {
    if (signal === 'lookup') return 1;
    if (signal === 'pass') return 0;
    return outcome ? 1 : 0;
};

// Points the belief is evaluated on for each step: mean ± GRID_SDS standard
// deviations.
const GRID_POINTS = 61;
const GRID_SDS = 5;

/**
 * noisyBinaryStep — one filtering step for a belief N(mean, variance) on the
 * logit of P(known), given a noisy observation of "known".
 *
 * The posterior is computed exactly on a grid and matched back to a normal
 * (assumed-density filtering). A local (Laplace) step under-reacts to strong
 * evidence: three lookups of one word say far more than three small nudges.
 *
 * @param {object} args
 * @param {number} args.mean        current mean (theta, or a word's offset)
 * @param {number} args.variance    current variance
 * @param {number} args.offset      added to mean before the sigmoid (−difficulty)
 * @param {0|1}    args.observed
 * @param {number} args.hit         P(observed = 1 | known)
 * @param {number} args.falseAlarm  P(observed = 1 | unknown)
 * @param {number} [args.weight=1]  likelihood power (trust)
 * @returns {{mean:number, variance:number, delta:number, pKnown:number, pObserved:number}}
 */
export const noisyBinaryStep = ({
    mean,
    variance,
    offset = 0,
    observed,
    hit,
    falseAlarm,
    weight = 1,
    maxStep = MAX_STEP,
}) => {
    const m = Number(mean);
    const v = Math.max(MIN_VARIANCE, Number(variance));
    const sd = Math.sqrt(v);
    const w = Math.max(0, Number(weight) || 0);
    let total = 0;
    let first = 0;
    let second = 0;
    let predicted = 0;
    let priorTotal = 0;
    for (let i = 0; i < GRID_POINTS; i += 1) {
        const z = -GRID_SDS + (2 * GRID_SDS * i) / (GRID_POINTS - 1);
        const x = m + z * sd;
        const prior = Math.exp(-0.5 * z * z);
        const pk = sigmoid(x + offset);
        const p1 = clamp(hit * pk + falseAlarm * (1 - pk), 1e-9, 1 - 1e-9);
        const likelihood = (observed ? p1 : 1 - p1) ** w;
        const mass = prior * likelihood;
        total += mass;
        first += mass * x;
        second += mass * x * x;
        predicted += prior * p1;
        priorTotal += prior;
    }
    const pk = sigmoid(m + offset);
    const pObserved = predicted / priorTotal;
    if (!(total > 0)) {
        return { mean: m, variance: v, delta: 0, pKnown: pk, pObserved };
    }
    const postMean = first / total;
    const postVariance = Math.max(MIN_VARIANCE, Math.min(v, second / total - postMean * postMean));
    const delta = clamp(postMean - m, -maxStep, maxStep);
    return { mean: m + delta, variance: postVariance, delta, pKnown: pk, pObserved };
};

/** Variance regained since the last signal, capped at the prior. */
export const driftVariance = (variance, lastAt, now, perDay = DRIFT_PER_DAY, cap = PRIOR_VARIANCE) => {
    const v = Number(variance);
    const last = new Date(lastAt ?? NaN).getTime();
    const t = new Date(now ?? NaN).getTime();
    if (!Number.isFinite(v)) return cap;
    if (!Number.isFinite(last) || !Number.isFinite(t) || t <= last) return v;
    return Math.min(cap, v + perDay * ((t - last) / DAY_MS));
};

// ─── Reader state ─────────────────────────────────────────────────────────────

/**
 * readerState — the engine's view of a profile_ability row, with defaults for
 * a row from before v2 (no variance yet: its old event count says how settled
 * it is).
 */
export const readerState = (row) => {
    const theta = Number(row?.theta);
    const events = Number(row?.event_count) || 0;
    const storedVariance = Number(row?.theta_var);
    const variance = Number.isFinite(storedVariance) && storedVariance > 0
        ? storedVariance
        : (row ? Math.max(0.15, PRIOR_VARIANCE / (1 + events / 15)) : PRIOR_VARIANCE);
    return {
        theta: Number.isFinite(theta) ? clamp(theta, ABILITY_THETA_MIN, ABILITY_THETA_MAX) : 0,
        variance,
        lookupHits: Number(row?.lookup_hits) || 0,
        lookupExpected: Number(row?.lookup_expected) || 0,
        guessYes: Number(row?.guess_yes) || 0,
        guessTotal: Number(row?.guess_total) || 0,
        lastEventAt: row?.last_event_at ?? row?.updated_at ?? null,
        eventCount: events,
    };
};

/** The reader's learned lookup rate: P(look up | word unknown). */
export const lookupRateOf = (state) => clamp(
    (LOOKUP_RATE_PRIOR.hits + (state?.lookupHits || 0))
        / (LOOKUP_RATE_PRIOR.expected + (state?.lookupExpected || 0)),
    LOOKUP_RATE_MIN,
    LOOKUP_RATE_MAX,
);

/** The reader's guess rate: how often they claim to know a made-up word. */
export const guessRateOf = (state) => clamp(
    (GUESS_RATE_PRIOR.yes + (state?.guessYes || 0))
        / (GUESS_RATE_PRIOR.total + (state?.guessTotal || 0)),
    0.01,
    GUESS_RATE_MAX,
);

// Only words the model is unsure about teach us the lookup rate: a word it
// is sure the reader knows says nothing about how often they tap unknown ones.
const LOOKUP_RATE_UNSURE_BELOW = 0.85;

/**
 * applySignal — fold one signal into the reader's state.
 *
 * @param {object} state      from readerState()
 * @param {object} signal
 * @param {'lookup'|'pass'|'check'|'review'|'pseudo'} signal.type
 * @param {number} [signal.difficulty]  word difficulty (not for 'pseudo')
 * @param {0|1}    [signal.outcome]     check: 1 = "know"; review: 1 = recalled;
 *                                      pseudo: 1 = claimed a made-up word
 * @param {string|Date} [signal.at]
 * @returns {{state:object, log:object|null}}  the new state and the log entry
 *          (null when the signal changes nothing).
 */
export const applySignal = (state, signal = {}) => {
    const at = signal.at ? new Date(signal.at).toISOString() : new Date().toISOString();
    const base = { ...state };

    if (signal.type === 'pseudo') {
        const next = {
            ...base,
            guessYes: base.guessYes + (signal.outcome ? 1 : 0),
            guessTotal: base.guessTotal + 1,
        };
        return {
            state: next,
            log: {
                signal: 'pseudo',
                outcome: signal.outcome ? 1 : 0,
                thetaBefore: base.theta,
                thetaAfter: base.theta,
                varianceBefore: base.variance,
                varianceAfter: base.variance,
                guessRate: guessRateOf(next),
                at,
            },
        };
    }

    const difficulty = Number(signal.difficulty);
    const model = observationModel(signal.type, {
        lookupRate: lookupRateOf(base),
        guessRate: guessRateOf(base),
    });
    if (!model || !Number.isFinite(difficulty)) {
        return { state: base, log: null };
    }

    const drifted = driftVariance(base.variance, base.lastEventAt, at);
    const observed = observedValue(signal.type, signal.outcome);
    const step = noisyBinaryStep({
        mean: base.theta,
        variance: drifted,
        offset: -difficulty,
        observed,
        hit: model.hit,
        falseAlarm: model.falseAlarm,
        weight: SIGNAL_WEIGHTS[signal.type] ?? 1,
    });

    const next = {
        ...base,
        theta: clamp(step.mean, ABILITY_THETA_MIN, ABILITY_THETA_MAX),
        variance: step.variance,
        lastEventAt: at,
        eventCount: base.eventCount + 1,
    };
    if ((signal.type === 'lookup' || signal.type === 'pass') && step.pKnown < LOOKUP_RATE_UNSURE_BELOW) {
        next.lookupExpected = base.lookupExpected + (1 - step.pKnown);
        if (signal.type === 'lookup') next.lookupHits = base.lookupHits + 1;
    }

    return {
        state: next,
        log: {
            signal: signal.type,
            outcome: observed,
            difficulty,
            pKnown: step.pKnown,
            pObserved: step.pObserved,
            thetaBefore: base.theta,
            thetaAfter: next.theta,
            varianceBefore: drifted,
            varianceAfter: next.variance,
            lookupRate: model.falseAlarm,
            at,
        },
    };
};

/**
 * seedState — set the level from the picker or a word check: the old
 * learned rates stay, the belief restarts at the given mean and variance.
 */
export const seedState = (state, { theta, variance = SEED_VARIANCE, at } = {}) => ({
    ...state,
    theta: clamp(Number(theta) || 0, ABILITY_THETA_MIN, ABILITY_THETA_MAX),
    variance,
    lastEventAt: at ? new Date(at).toISOString() : new Date().toISOString(),
});

// ─── Word difficulty ──────────────────────────────────────────────────────────

// Zipf frequency (log10 uses per billion words) mapped onto the difficulty
// axis: ~6.5 (사람, 我们) is as easy as the scale goes, ~2.5 as hard.
export const ZIPF_EASY = 6.5;
export const ZIPF_HARD = 2.5;
// How much easier a Korean loanword is than its frequency and level say: it is
// spelled out in Hangul and often recognisable from English.
export const LOANWORD_EASE = 0.8;
// Weight of the level band against frequency when both are known.
export const BAND_WEIGHT = 0.5;

export const difficultyFromZipf = (zipf) => {
    const z = Number(zipf);
    if (zipf == null || zipf === '' || !Number.isFinite(z)) return null;
    const scaled = (ZIPF_EASY - z) / (ZIPF_EASY - ZIPF_HARD);
    return ABILITY_THETA_MIN + clamp(scaled, 0, 1) * (ABILITY_THETA_MAX - ABILITY_THETA_MIN);
};

const finiteOrNull = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/**
 * wordDifficulty — one word's difficulty on the ability scale, from its level
 * band (or the finer Korean percentile), how common it is, and whether it is a
 * Korean loanword.
 *
 * @returns {{difficulty:number, graded:boolean, parts:object}}
 *          graded = false when nothing is known about the word (the hardest
 *          value is used then).
 */
export const wordDifficulty = ({
    language,
    levelRank = null,
    percentile = null,
    zipf = null,
    loanword = false,
} = {}) => {
    const pct = finiteOrNull(percentile);
    const rank = finiteOrNull(levelRank);
    const band = pct != null
        ? difficultyFromPercentile(pct)
        : (rank != null ? difficultyFromLevelRank(language, rank) : null);
    const frequency = difficultyFromZipf(zipf);
    let difficulty;
    if (band != null && frequency != null) {
        difficulty = BAND_WEIGHT * band + (1 - BAND_WEIGHT) * frequency;
    } else {
        difficulty = band ?? frequency;
    }
    const graded = difficulty != null;
    if (!graded) difficulty = OOV_DIFFICULTY;
    const isLoan = String(language || '').startsWith('ko') && (loanword === true || Number(loanword) === 1);
    if (isLoan) difficulty -= LOANWORD_EASE;
    return {
        difficulty: clamp(difficulty, ABILITY_THETA_MIN, ABILITY_THETA_MAX),
        graded,
        parts: { band, frequency, loanword: isLoan },
    };
};

// ─── Per-word knowledge ───────────────────────────────────────────────────────

// A word's own offset from the reader's level starts at 0 with this variance:
// wide, because whether one word is known varies a lot around the level.
export const WORD_PRIOR_VARIANCE = 2.0;
export const WORD_DRIFT_PER_DAY = 0.02;
// Saving a word means the reader is working on it.
export const SAVED_WORD_OFFSET = -0.4;
// How much of a word family's (Korean) or the characters' (Chinese) offset a
// word starts from.
export const FAMILY_SHARE = 0.5;
export const CHARACTER_SHARE = 0.6;
// Share of the word's and the reader's variance that pulls a shade toward 0.5.
export const UNCERTAINTY_SHADE = 0.25;

const KOREAN_DERIVING_SUFFIXES = ['하다', '되다', '시키다', '스럽다', '롭다', '적', '히'];
const HAN_CHAR = /[一-鿿]/;

/**
 * groupKeys — the groups a word shares knowledge with: its Korean family
 * (공부하다 → 공부) or its Chinese characters (厮杀 → 厮, 杀).
 */
export const groupKeys = (language, stem) => {
    const word = String(stem || '').trim();
    if (!word) return [];
    const lang = String(language || '');
    if (lang.startsWith('zh')) {
        return Array.from(new Set(Array.from(word).filter((ch) => HAN_CHAR.test(ch)))).map((ch) => `c:${ch}`);
    }
    if (lang.startsWith('ko')) {
        for (const suffix of KOREAN_DERIVING_SUFFIXES) {
            if (word.endsWith(suffix) && word.length > suffix.length + 1) {
                return [`f:${word.slice(0, -suffix.length)}`];
            }
        }
        return [`f:${word}`];
    }
    return [];
};

const toTime = (value) => {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
};

/**
 * replayOffset — run a word's (or a group's) signals through the filter, in
 * time order, as an offset from the reader's level.
 *
 * @param {object[]} events  { type, outcome, n, at, base } — `base` is
 *        theta − difficulty for the word the event was about
 * @returns {{mean:number, variance:number, count:number}}
 */
export const replayOffset = (events, {
    priorMean = 0,
    priorVariance = WORD_PRIOR_VARIANCE,
    lookupRate = 0.5,
    guessRate = 0.05,
    weight = 1,
    now = Date.now(),
} = {}) => {
    let mean = priorMean;
    let variance = priorVariance;
    let lastAt = null;
    let count = 0;
    const ordered = [...(events || [])]
        .filter((e) => toTime(e.at) != null)
        .sort((a, b) => toTime(a.at) - toTime(b.at));
    for (const event of ordered) {
        const model = observationModel(event.type, { lookupRate, guessRate });
        if (!model) continue;
        const t = toTime(event.at);
        if (lastAt != null) {
            variance = Math.min(priorVariance, variance + WORD_DRIFT_PER_DAY * ((t - lastAt) / DAY_MS));
        }
        lastAt = t;
        const times = Math.max(1, Math.min(20, Math.round(Number(event.n) || 1)));
        for (let i = 0; i < times; i += 1) {
            const step = noisyBinaryStep({
                mean,
                variance,
                offset: Number(event.base) || 0,
                observed: observedValue(event.type, event.outcome),
                hit: model.hit,
                falseAlarm: model.falseAlarm,
                weight: weight * (SIGNAL_WEIGHTS[event.type] ?? 1),
                maxStep: 1.5,
            });
            mean = step.mean;
            variance = step.variance;
            count += 1;
        }
    }
    if (lastAt != null) {
        variance = Math.min(priorVariance, variance + WORD_DRIFT_PER_DAY * Math.max(0, (now - lastAt) / DAY_MS));
    }
    return { mean, variance, count };
};

/**
 * pKnownWithUncertainty — P(known) averaged over what we are unsure of (the
 * probit approximation): an uncertain word is pulled toward 0.5.
 */
export const pKnownWithUncertainty = (logit, variance) => (
    sigmoid(logit / Math.sqrt(1 + (Math.PI / 8) * Math.max(0, variance)))
);

/**
 * buildWordKnowledge — per-word P(known) for a set of words, using each
 * word's own history and what it shares with its family or characters.
 *
 * @param {object} args
 * @param {string} args.language
 * @param {{theta:number, variance:number, lookupRate:number, guessRate:number}} args.reader
 * @param {Map<string, number>} args.difficulties  stem → difficulty, for every
 *        stem that appears in `events` or `words`
 * @param {object[]} args.events  { stem, type, outcome, n, at } (daily groups)
 * @param {Set<string>} [args.saved]  saved stems
 * @param {number} [args.now]
 * @returns {(stem:string) => {p:number, offset:number, variance:number, ownSignals:number}}
 */
export const buildWordKnowledge = ({
    language,
    reader,
    difficulties,
    events = [],
    saved = new Set(),
    now = Date.now(),
}) => {
    const theta = Number(reader?.theta) || 0;
    const readerVariance = Number(reader?.variance) || 0;
    const rates = { lookupRate: reader?.lookupRate ?? 0.5, guessRate: reader?.guessRate ?? 0.05, now };
    const baseOf = (stem) => theta - (difficulties.get(stem) ?? OOV_DIFFICULTY);

    const byStem = new Map();
    const byGroup = new Map();
    for (const event of events) {
        const stem = typeof event?.stem === 'string' ? event.stem.trim() : '';
        if (!stem || !observationModel(event.type, rates)) continue;
        const entry = { ...event, base: baseOf(stem) };
        if (!byStem.has(stem)) byStem.set(stem, []);
        byStem.get(stem).push(entry);
        for (const key of groupKeys(language, stem)) {
            if (!byGroup.has(key)) byGroup.set(key, []);
            byGroup.get(key).push(entry);
        }
    }

    const groupCache = new Map();
    const groupOffset = (key) => {
        if (!groupCache.has(key)) {
            const list = byGroup.get(key);
            groupCache.set(key, list ? replayOffset(list, rates).mean : 0);
        }
        return groupCache.get(key);
    };

    const isZh = String(language || '').startsWith('zh');
    const share = isZh ? CHARACTER_SHARE : FAMILY_SHARE;
    const cache = new Map();

    return (rawStem) => {
        const stem = String(rawStem || '').trim();
        if (cache.has(stem)) return cache.get(stem);
        const keys = groupKeys(language, stem);
        // A Chinese word is as unknown as its least-known character; a Korean
        // word starts from its family.
        let groupMean = 0;
        if (keys.length > 0) {
            const offsets = keys.map(groupOffset);
            groupMean = isZh ? Math.min(...offsets) : offsets[0];
        }
        const own = byStem.get(stem) || [];
        // The group's offset already includes the word's own signals, so a
        // word with its own history starts from half the usual share of it.
        const groupShare = own.length > 0 ? share * 0.5 : share;
        const priorMean = groupShare * groupMean + (saved.has(stem) ? SAVED_WORD_OFFSET : 0);
        const posterior = own.length > 0
            ? replayOffset(own, { ...rates, priorMean })
            : { mean: priorMean, variance: WORD_PRIOR_VARIANCE, count: 0 };
        const logit = baseOf(stem) + posterior.mean;
        // Only part of the uncertainty flattens the shade: the difficulty
        // scale already reflects how much words of a level vary.
        const result = {
            p: pKnownWithUncertainty(logit, UNCERTAINTY_SHADE * (posterior.variance + readerVariance)),
            offset: posterior.mean,
            variance: posterior.variance,
            ownSignals: posterior.count,
        };
        cache.set(stem, result);
        return result;
    };
};

const EVENT_SIGNALS = { lookup: 'lookup', exposure: 'pass', review: 'review', check: 'check' };

/**
 * signalsFromEvidenceRows — turn grouped interaction_events rows
 * ({ stem, event_type, outcome, day, n, last_at }) into engine events and the
 * set of currently saved stems.
 */
export const signalsFromEvidenceRows = (rows = []) => {
    const events = [];
    const saveTimes = new Map();
    for (const row of rows || []) {
        const stem = typeof row?.stem === 'string' ? row.stem.trim() : '';
        if (!stem) continue;
        const type = row.event_type ?? row.eventType;
        const at = row.last_at ?? row.lastAt ?? (row.day ? `${row.day}T12:00:00Z` : null);
        if (type === 'save' || type === 'unsave') {
            const t = toTime(at) ?? 0;
            const current = saveTimes.get(stem) || { save: -1, unsave: -1 };
            current[type] = Math.max(current[type], t);
            saveTimes.set(stem, current);
            continue;
        }
        const signal = EVENT_SIGNALS[type];
        if (!signal) continue;
        events.push({ stem, type: signal, outcome: row.outcome, n: Number(row.n) || 1, at });
    }
    const saved = new Set();
    saveTimes.forEach((times, stem) => {
        if (times.save > times.unsave) saved.add(stem);
    });
    return { events, saved };
};
