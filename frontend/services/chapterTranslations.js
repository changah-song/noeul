// Sentence translations a chapter at a time, for listen mode's translation
// mode and the reader's pinned translation bar.
//
// Google bills per character, so batching doesn't change the cost; it keeps a
// whole night of listening to a few dozen requests (under the per-user daily
// quota) and makes every sentence instant once its chapter is in. Translations
// are kept in memory, saved on the phone (sentence_translations) and cached on
// the server, so a chapter is only ever paid for once per language.
//
// Sentences are matched in their normalized form (services/sentenceSplit.js),
// and a span of several sentences (focus mode's span setting) is looked up
// sentence by sentence and joined.

import { getSentenceTranslations, saveSentenceTranslations } from './Database';
import { normalizeTranslationLanguageCode, translateSentences, translateText } from './api/googleTranslate';
import { chapterSentences, normalizeSentence, sentencesOf } from './sentenceSplit';

// Per request: under the server's 128 sentences / 12,000 characters.
const BATCH_MAX_ITEMS = 100;
const BATCH_MAX_CHARS = 10000;
const MEMORY_MAX_ENTRIES = 6000;
// When the batch request fails (e.g. a server without /translate_sentences/),
// a sentence being read right now falls back to one request per sentence; a
// span longer than this waits for the batch path instead.
const SINGLE_FALLBACK_MAX = 6;
// Languages written without spaces between sentences.
const UNSPACED_TARGETS = new Set(['zh', 'zh-TW', 'ja', 'th']);

const languagesOf = (source, target) => ({
    source: normalizeTranslationLanguageCode(source, 'ko'),
    target: normalizeTranslationLanguageCode(target, 'en'),
});

const sentencesInText = (text) => {
    const parts = sentencesOf(String(text || ''));
    if (parts.length > 0) return parts;
    const whole = normalizeSentence(text);
    return whole ? [whole] : [];
};

const batchesOf = (sentences) => {
    const batches = [];
    let current = [];
    let chars = 0;
    sentences.forEach((sentence) => {
        if (current.length > 0 && (current.length >= BATCH_MAX_ITEMS || chars + sentence.length > BATCH_MAX_CHARS)) {
            batches.push(current);
            current = [];
            chars = 0;
        }
        current.push(sentence);
        chars += sentence.length;
    });
    if (current.length > 0) batches.push(current);
    return batches;
};

export const createChapterTranslations = ({
    translateBatch = translateSentences,
    translateOne = translateText,
    loadSaved = getSentenceTranslations,
    save = saveSentenceTranslations,
} = {}) => {
    const memory = new Map();
    const pending = new Map();
    const chapters = new Map();

    const keyOf = (source, target, sentence) => `${source}\u0001${target}\u0001${sentence}`;

    const remember = (source, target, sentence, translated) => {
        const key = keyOf(source, target, sentence);
        memory.delete(key);
        memory.set(key, translated);
        while (memory.size > MEMORY_MAX_ENTRIES) memory.delete(memory.keys().next().value);
    };

    const join = (parts, target) => parts.join(UNSPACED_TARGETS.has(target) ? '' : ' ');

    // Saved on the phone but not yet in memory.
    const loadFromPhone = async (source, target, sentences) => {
        const unknown = sentences.filter((sentence) => !memory.has(keyOf(source, target, sentence)));
        if (unknown.length === 0) return;
        const saved = await loadSaved({ source, target, sentences: unknown }).catch(() => ({}));
        Object.entries(saved || {}).forEach(([sentence, translated]) => remember(source, target, sentence, translated));
    };

    // Translate sentences nobody has asked for yet, in batches; sentences already
    // on their way wait for that request instead of sending another.
    const fetchMissing = async (source, target, sentences) => {
        const waits = [];
        const fresh = [];
        sentences.forEach((sentence) => {
            const key = keyOf(source, target, sentence);
            if (memory.has(key)) return;
            if (pending.has(key)) waits.push(pending.get(key));
            else fresh.push(sentence);
        });
        const requests = batchesOf(fresh).map((batch) => {
            const request = translateBatch({ texts: batch, source, target })
                .then(async (translations) => {
                    const entries = [];
                    batch.forEach((sentence, index) => {
                        const translated = translations?.[index];
                        if (translated) {
                            remember(source, target, sentence, translated);
                            entries.push([sentence, translated]);
                        }
                    });
                    await save({ source, target, entries }).catch(() => {});
                })
                .finally(() => {
                    batch.forEach((sentence) => pending.delete(keyOf(source, target, sentence)));
                });
            batch.forEach((sentence) => pending.set(keyOf(source, target, sentence), request));
            return request;
        });
        await Promise.allSettled([...waits, ...requests]);
    };

    /** The translation if every sentence of `text` is already in memory, else null. */
    const peek = (text, sourceLanguage, targetLanguage) => {
        const { source, target } = languagesOf(sourceLanguage, targetLanguage);
        if (source === target) return normalizeSentence(text) || null;
        const parts = sentencesInText(text).map((sentence) => memory.get(keyOf(source, target, sentence)));
        return parts.length > 0 && parts.every(Boolean) ? join(parts, target) : null;
    };

    /**
     * Translation of `text` (a sentence or a span of them): from memory or the
     * phone when the chapter is in, otherwise fetched now. Resolves '' when a
     * sentence couldn't be translated.
     */
    const translate = async (text, sourceLanguage, targetLanguage) => {
        const { source, target } = languagesOf(sourceLanguage, targetLanguage);
        const sentences = sentencesInText(text);
        if (sentences.length === 0) return '';
        if (source === target) return join(sentences, target);
        await loadFromPhone(source, target, sentences);
        await fetchMissing(source, target, sentences);
        const stillMissing = sentences.filter((sentence) => !memory.has(keyOf(source, target, sentence)));
        if (stillMissing.length > 0 && stillMissing.length <= SINGLE_FALLBACK_MAX) {
            const entries = [];
            await Promise.allSettled(stillMissing.map(async (sentence) => {
                const translated = String(await translateOne({ query: sentence, source, target }) || '').trim();
                if (translated) {
                    remember(source, target, sentence, translated);
                    entries.push([sentence, translated]);
                }
            }));
            await save({ source, target, entries }).catch(() => {});
        }
        const parts = sentences.map((sentence) => memory.get(keyOf(source, target, sentence)));
        return parts.every(Boolean) ? join(parts, target) : '';
    };

    /**
     * Fetch a whole chapter's translations ahead of time. `key` names the chapter
     * (book + chapter), so asking again while it loads, or after, is free.
     * `paragraphs` are the chapter's paragraphs, or its text one per line.
     */
    const prefetchChapter = ({ key, paragraphs, source: sourceLanguage, target: targetLanguage }) => {
        const { source, target } = languagesOf(sourceLanguage, targetLanguage);
        if (source === target) return Promise.resolve({ total: 0 });
        const chapterKey = `${key}\u0001${source}\u0001${target}`;
        if (chapters.has(chapterKey)) return chapters.get(chapterKey);
        const job = (async () => {
            const sentences = chapterSentences(paragraphs);
            await loadFromPhone(source, target, sentences);
            await fetchMissing(source, target, sentences);
            const done = sentences.filter((sentence) => memory.has(keyOf(source, target, sentence))).length;
            return { total: sentences.length, done };
        })();
        chapters.set(chapterKey, job);
        // A chapter that came back incomplete (offline, quota) may be retried.
        job.then(({ total, done }) => { if (done < total) chapters.delete(chapterKey); })
            .catch(() => chapters.delete(chapterKey));
        return job;
    };

    return { peek, translate, prefetchChapter };
};

// One shared instance for the app.
export const chapterTranslations = createChapterTranslations();
