import {
    difficultyFromLevelRank,
    pKnown,
    updateThetaOnline,
    LOOKUP_LEARNING_RATE,
    EXPOSURE_LEARNING_RATE,
    THETA_LEARNING_RATE,
} from './abilityModel';
import {
    CHARACTER_SHARE,
    FAMILY_SHARE,
    WORD_DRIFT_PER_DAY,
    WORD_PRIOR_VARIANCE,
    applySignal,
    groupKeys,
    repeatWeight,
    guessRateOf,
    lookupRateOf,
    noisyBinaryStep,
    observationModel,
    observedValue,
    pKnownWithUncertainty,
    readerState,
    wordDifficulty,
    UNCERTAINTY_SHADE,
} from './levelEngine';

// ─── Offline evaluation: level engine vs the previous model ──────────────────
//
// Replays a reader's interaction events in time order and, BEFORE each event
// updates anything, records what each model predicted:
//
//   reading   for a lookup or a word read past: the chance the reader looks
//             the word up. Scored by AUC (does the model rank looked-up words
//             above read-past ones?) and log loss.
//   check     for a word-check answer: P(known) against "I know it".
//   review    for a flashcard review: P(known) against recalled.
//
// "previous" is the model this replaced (one level, fixed learning rates,
// band-only difficulty, lookups and passes as plain outcomes), so the two
// columns compare like for like on the same events. Pure; the CLI is
// scripts/levelEngineEval.js.

const EVENT_SIGNALS = { lookup: 'lookup', exposure: 'pass', review: 'review', check: 'check' };
const DAY_MS = 24 * 60 * 60 * 1000;
const clampP = (p) => Math.min(1 - 1e-6, Math.max(1e-6, p));

export const rocAuc = (pairs) => {
    const pos = pairs.filter((p) => p.y === 1).map((p) => p.score);
    const neg = pairs.filter((p) => p.y === 0).map((p) => p.score);
    if (!pos.length || !neg.length) return null;
    const all = [...pos.map((s) => ({ s, y: 1 })), ...neg.map((s) => ({ s, y: 0 }))].sort((a, b) => a.s - b.s);
    let rankSum = 0;
    let i = 0;
    while (i < all.length) {
        let j = i;
        while (j + 1 < all.length && all[j + 1].s === all[i].s) j += 1;
        const avg = (i + j + 2) / 2;
        for (let k = i; k <= j; k += 1) if (all[k].y === 1) rankSum += avg;
        i = j + 1;
    }
    return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
};

export const logLoss = (pairs) => {
    if (!pairs.length) return null;
    return -pairs.reduce((sum, p) => sum + (p.y ? Math.log(clampP(p.score)) : Math.log(1 - clampP(p.score))), 0) / pairs.length;
};

export const brier = (pairs) => (pairs.length
    ? pairs.reduce((sum, p) => sum + (p.score - p.y) ** 2, 0) / pairs.length
    : null);

const summarize = (pairs) => ({
    n: pairs.length,
    positives: pairs.filter((p) => p.y === 1).length,
    auc: rocAuc(pairs),
    logLoss: logLoss(pairs),
    brier: brier(pairs),
});

/**
 * replayProfile — one (owner, profile, language) stream, oldest first.
 * Events: { eventType, stem, outcome, createdAt, levelRank, percentile, zipf, loanword }.
 */
const replayProfile = (events, language) => {
    const out = { v2: { reading: [], check: [], review: [] }, previous: { reading: [], check: [], review: [] } };
    let reader = readerState(null);
    let oldTheta = 0;
    let oldCount = 0;
    const words = new Map();
    const groups = new Map();
    const seen = new Map();
    const isZh = String(language || '').startsWith('zh');
    const share = isZh ? CHARACTER_SHARE : FAMILY_SHARE;

    const drifted = (entry, t) => {
        if (!entry || entry.lastAt == null) return entry;
        const days = Math.max(0, (t - entry.lastAt) / DAY_MS);
        return { ...entry, variance: Math.min(WORD_PRIOR_VARIANCE, entry.variance + WORD_DRIFT_PER_DAY * days) };
    };
    const groupMean = (keys) => {
        if (!keys.length) return 0;
        const offsets = keys.map((k) => groups.get(k)?.mean ?? 0);
        return isZh ? Math.min(...offsets) : offsets[0];
    };

    for (const event of events) {
        const signal = EVENT_SIGNALS[event.eventType];
        if (!signal) continue;
        const stem = event.stem || event.word;
        if (!stem) continue;
        const t = new Date(event.createdAt).getTime();
        const resolved = wordDifficulty({
            language,
            levelRank: event.levelRank,
            percentile: event.percentile,
            zipf: event.zipf,
            loanword: event.loanword,
        });
        const keys = groupKeys(language, stem);
        const rates = { lookupRate: lookupRateOf(reader), guessRate: guessRateOf(reader) };
        const model = observationModel(signal, rates);
        const y = observedValue(signal, event.outcome);

        // ── predictions before the event ──
        const word = drifted(words.get(stem), t) || { mean: share * groupMean(keys), variance: WORD_PRIOR_VARIANCE, lastAt: null };
        const pk = pKnownWithUncertainty(reader.theta - resolved.difficulty + word.mean, UNCERTAINTY_SHADE * (word.variance + reader.variance));
        const oldDifficulty = difficultyFromLevelRank(language, event.levelRank);
        const oldPk = pKnown(oldTheta, oldDifficulty);
        if (signal === 'lookup' || signal === 'pass') {
            out.v2.reading.push({ score: model.hit * pk + model.falseAlarm * (1 - pk), y });
            out.previous.reading.push({ score: 1 - oldPk, y });
        } else {
            out.v2[signal].push({ score: pk, y });
            out.previous[signal].push({ score: oldPk, y });
        }

        // ── updates ──
        if (resolved.graded) {
            const previous = signal === 'check' ? 0 : (seen.get(stem) || 0);
            reader = applySignal(reader, {
                type: signal, difficulty: resolved.difficulty, outcome: event.outcome, at: event.createdAt, weight: repeatWeight(previous),
            }).state;
        }
        if (signal === 'lookup' || signal === 'pass') seen.set(stem, (seen.get(stem) || 0) + 1);
        const step = noisyBinaryStep({
            mean: word.mean,
            variance: word.variance,
            offset: reader.theta - resolved.difficulty,
            observed: y,
            hit: model.hit,
            falseAlarm: model.falseAlarm,
            maxStep: 1.5,
        });
        words.set(stem, { mean: step.mean, variance: step.variance, lastAt: t });
        keys.forEach((key) => {
            const g = drifted(groups.get(key), t) || { mean: 0, variance: WORD_PRIOR_VARIANCE, lastAt: null };
            const gs = noisyBinaryStep({
                mean: g.mean, variance: g.variance, offset: reader.theta - resolved.difficulty, observed: y,
                hit: model.hit, falseAlarm: model.falseAlarm, maxStep: 1.5,
            });
            groups.set(key, { mean: gs.mean, variance: gs.variance, lastAt: t });
        });

        if (event.levelRank != null) {
            const outcome = signal === 'lookup' ? 0 : (signal === 'pass' ? 1 : (event.outcome ? 1 : 0));
            const lr = signal === 'lookup' ? LOOKUP_LEARNING_RATE : (signal === 'pass' ? EXPOSURE_LEARNING_RATE : THETA_LEARNING_RATE);
            oldTheta = updateThetaOnline({ theta: oldTheta, difficulty: oldDifficulty, outcome, eventCount: oldCount, learningRate: lr });
            oldCount += 1;
        }
    }
    return { ...out, final: { theta: reader.theta, variance: reader.variance, lookupRate: lookupRateOf(reader) } };
};

/**
 * evaluateEngine — replay every profile and pool the predictions.
 * @returns {{ v2: object, previous: object, profiles: object[] }}
 */
export const evaluateEngine = (events = []) => {
    const byProfile = new Map();
    [...events]
        .filter((e) => e && e.createdAt)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .forEach((event) => {
            const key = `${event.ownerId}|${event.profileId}|${event.language}`;
            if (!byProfile.has(key)) byProfile.set(key, { language: event.language, events: [] });
            byProfile.get(key).events.push(event);
        });

    const pooled = { v2: { reading: [], check: [], review: [] }, previous: { reading: [], check: [], review: [] } };
    const profiles = [];
    byProfile.forEach(({ language, events: list }, key) => {
        const result = replayProfile(list, language);
        ['v2', 'previous'].forEach((model) => {
            ['reading', 'check', 'review'].forEach((kind) => pooled[model][kind].push(...result[model][kind]));
        });
        profiles.push({ key, language, events: list.length, ...result.final });
    });

    const report = (model) => ({
        reading: summarize(pooled[model].reading),
        check: summarize(pooled[model].check),
        review: summarize(pooled[model].review),
    });
    return { v2: report('v2'), previous: report('previous'), profiles };
};

const fmt = (value, digits = 3) => (value == null ? '   –  ' : Number(value).toFixed(digits));

export const formatEngineReport = (result) => {
    const lines = [];
    lines.push('Level engine vs previous model (predictions made before each event)');
    lines.push('');
    lines.push('                          n     AUC(prev)  AUC(v2)   logloss(prev)  logloss(v2)');
    [['reading (looked up?)', 'reading'], ['word check (know?)', 'check'], ['review (recalled?)', 'review']].forEach(([label, kind]) => {
        const p = result.previous[kind];
        const v = result.v2[kind];
        lines.push(`${label.padEnd(24)}${String(v.n).padStart(5)}    ${fmt(p.auc)}     ${fmt(v.auc)}     ${fmt(p.logLoss)}          ${fmt(v.logLoss)}`);
    });
    lines.push('');
    lines.push('AUC: 0.5 = no better than chance, 1 = perfect ranking. Lower log loss is better.');
    lines.push('Reading log loss for "previous" uses 1 − P(known) as the lookup chance, which it never claimed to be; compare AUC there.');
    if (result.profiles.length) {
        lines.push('');
        lines.push('Profiles (final state):');
        result.profiles.forEach((p) => {
            lines.push(`  ${p.key}  events ${p.events}  level ${fmt(p.theta, 2)} ± ${fmt(Math.sqrt(p.variance), 2)}  lookup rate ${fmt(p.lookupRate, 2)}`);
        });
    }
    return lines.join('\n');
};
