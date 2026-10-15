// Session-scoped translation cache + "latest request wins" gate for the reader's
// pinned sentence-translation bar.
//
// - Translations are cached per (source, target, sentence) in memory, so tapping
//   another word in a sentence already translated costs no network call.
// - Concurrent requests for the same key share one in-flight promise.
// - Failures are not cached, so a retry really retries.
// - Only the most recent request() resolves with status 'ok'/'error'; anything
//   superseded by a newer call (or by cancel()) resolves with status 'stale'
//   and must be ignored, so rapid taps never flash an older sentence.

const DEFAULT_MAX_ENTRIES = 300;

const cleanSentence = (sentence) => (typeof sentence === 'string' ? sentence.trim() : '');

export const sentenceTranslationKey = (sentence, source, target) => (
    `${source || ''}\u0001${target || ''}\u0001${cleanSentence(sentence)}`
);

export const createSentenceTranslator = ({
    translate,
    maxEntries = DEFAULT_MAX_ENTRIES,
} = {}) => {
    if (typeof translate !== 'function') {
        throw new Error('createSentenceTranslator requires a translate function');
    }

    // Map preserves insertion order; re-inserting on hit keeps it LRU.
    const cache = new Map();
    const inFlight = new Map();
    let latestToken = 0;

    const remember = (key, value) => {
        cache.delete(key);
        cache.set(key, value);
        while (cache.size > maxEntries) {
            cache.delete(cache.keys().next().value);
        }
    };

    // Cached translation or null. Synchronous, so the UI can paint a cache hit
    // without a loading flash.
    const peek = (sentence, source, target) => {
        const key = sentenceTranslationKey(sentence, source, target);
        if (!cache.has(key)) {
            return null;
        }
        const value = cache.get(key);
        remember(key, value);
        return value;
    };

    const fetchShared = (key, sentence, source, target) => {
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }
        const promise = Promise.resolve()
            .then(() => translate({ query: sentence, source, target }))
            .then((result) => {
                const text = typeof result === 'string'
                    ? result
                    : (result?.translatedText ?? '');
                const cleaned = String(text || '').trim();
                if (cleaned) {
                    remember(key, cleaned);
                }
                return cleaned;
            })
            .finally(() => {
                inFlight.delete(key);
            });
        inFlight.set(key, promise);
        return promise;
    };

    // Resolves { status: 'ok', text } | { status: 'error', error } |
    // { status: 'stale' }. Never rejects.
    const request = async (sentence, source, target) => {
        latestToken += 1;
        const token = latestToken;
        const cleaned = cleanSentence(sentence);
        if (!cleaned) {
            return { status: 'ok', text: '' };
        }

        const cached = peek(cleaned, source, target);
        if (cached !== null) {
            return { status: 'ok', text: cached };
        }

        const key = sentenceTranslationKey(cleaned, source, target);
        try {
            const text = await fetchShared(key, cleaned, source, target);
            if (token !== latestToken) {
                return { status: 'stale' };
            }
            if (!text) {
                return { status: 'error', error: new Error('empty translation') };
            }
            return { status: 'ok', text };
        } catch (error) {
            if (token !== latestToken) {
                return { status: 'stale' };
            }
            return { status: 'error', error };
        }
    };

    // Invalidate any outstanding request (e.g. the bar was cleared on a chapter
    // change) without dropping the cache.
    const cancel = () => {
        latestToken += 1;
    };

    const clear = () => {
        cache.clear();
        cancel();
    };

    return {
        request,
        peek,
        cancel,
        clear,
        get size() {
            return cache.size;
        },
    };
};
