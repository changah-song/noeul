import KO_POOL from '../assets/data/word-check/ko.generated.json';
import ZH_POOL from '../assets/data/word-check/zh.generated.json';
import { normalizeBookLanguage } from '../constants/languages';
import {
    CHECK_START_VARIANCE,
    applySignal,
    guessRateOf,
    wordDifficulty,
} from './levelEngine';

// ─── Word check ───────────────────────────────────────────────────────────────
//
// A three-minute "do you know this word?" test. Real words are picked one at
// a time around the current estimate of the reader's level, where an answer
// says the most; made-up words are mixed in, and a reader who claims to know
// one is guessing, so their "know" answers count for less (the level
// engine's guess rate). Every answer is also a labelled fact for the model's
// accuracy check on the admin dashboard.
//
// Pure: the modal (components/shared/WordCheckModal.js) drives it, and
// Database.js applyWordCheckResults saves the answers through the engine.
// Word pools: backend/scripts/generate_word_check.py.

export const WORD_CHECK_REAL = 28;
export const WORD_CHECK_PSEUDO = 8;
// Random spread around the estimate so the words don't all sit at one level.
const PICK_JITTER = 0.45;

const POOLS = { ko: KO_POOL, zh: ZH_POOL };

export const hasWordCheck = (language) => !!POOLS[normalizeBookLanguage(language) || ''];

const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** The pool with each word's difficulty, computed the way the reader's is. */
export const wordCheckPool = (language) => {
    const lang = normalizeBookLanguage(language) || '';
    const pool = POOLS[lang];
    if (!pool) return { words: [], pseudo: [] };
    return {
        words: (pool.words || []).map((item) => {
            const resolved = wordDifficulty({
                language: lang,
                levelRank: item.r,
                percentile: item.p,
                zipf: item.z,
                loanword: item.l,
            });
            return {
                word: item.w,
                difficulty: resolved.difficulty,
                details: { levelRank: item.r ?? null, percentile: item.p ?? null, zipf: item.z ?? null, loanword: item.l ? true : undefined },
            };
        }),
        pseudo: [...(pool.pseudo || [])],
    };
};

/**
 * pseudoSlots — the positions (0-based, among all prompts) that show a
 * made-up word: one in each equal stretch of the test, never first.
 */
export const pseudoSlots = (total, count, random) => {
    const slots = new Set();
    const span = total / count;
    for (let i = 0; i < count; i += 1) {
        const start = Math.max(1, Math.floor(i * span));
        const end = Math.max(start + 1, Math.floor((i + 1) * span));
        slots.add(start + Math.floor(random() * (end - start)));
    }
    return slots;
};

/**
 * createWordCheck — one run of the word check.
 *
 * @param {object} args
 * @param {string} args.language
 * @param {object} args.reader  the engine state to start from (readerState)
 * @param {number} [args.seed]
 * @returns {{ next: () => object|null, answer: (outcome:0|1) => void,
 *             answers: object[], progress: () => {done:number,total:number},
 *             result: () => object }}
 */
export const createWordCheck = ({ language, reader, seed = Date.now() }) => {
    const random = mulberry32(Number(seed) || 1);
    const pool = wordCheckPool(language);
    const total = Math.min(WORD_CHECK_REAL, pool.words.length) + Math.min(WORD_CHECK_PSEUDO, pool.pseudo.length);
    const slots = pseudoSlots(total, Math.min(WORD_CHECK_PSEUDO, pool.pseudo.length), random);
    const pseudo = pool.pseudo.slice();
    for (let i = pseudo.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [pseudo[i], pseudo[j]] = [pseudo[j], pseudo[i]];
    }
    const used = new Set();
    const answers = [];
    let state = { ...reader, variance: Math.max(Number(reader?.variance) || 0, CHECK_START_VARIANCE) };
    let current = null;

    const pickReal = () => {
        const target = state.theta + (random() * 2 - 1) * PICK_JITTER;
        let best = null;
        pool.words.forEach((item) => {
            if (used.has(item.word)) return;
            const distance = Math.abs(item.difficulty - target);
            if (!best || distance < best.distance) best = { item, distance };
        });
        return best ? best.item : null;
    };

    return {
        next() {
            if (current) return current;
            if (answers.length >= total) return null;
            if (slots.has(answers.length) && pseudo.length > 0) {
                current = { word: pseudo.pop(), pseudo: true };
            } else {
                const item = pickReal();
                if (!item) return null;
                current = { ...item, pseudo: false };
            }
            used.add(current.word);
            return current;
        },
        answer(outcome) {
            if (!current) return;
            const y = outcome ? 1 : 0;
            const signal = current.pseudo
                ? { type: 'pseudo', outcome: y }
                : { type: 'check', difficulty: current.difficulty, outcome: y };
            state = applySignal(state, signal).state;
            answers.push({ ...current, outcome: y, at: new Date().toISOString() });
            current = null;
        },
        answers,
        progress: () => ({ done: answers.length, total }),
        result() {
            const real = answers.filter((a) => !a.pseudo);
            const madeUp = answers.filter((a) => a.pseudo);
            return {
                theta: state.theta,
                variance: state.variance,
                answered: answers.length,
                known: real.filter((a) => a.outcome === 1).length,
                real: real.length,
                pseudoClaimed: madeUp.filter((a) => a.outcome === 1).length,
                pseudo: madeUp.length,
                guessRate: guessRateOf(state),
            };
        },
    };
};
