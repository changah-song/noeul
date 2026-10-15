import { createSentenceTranslator, sentenceTranslationKey } from '../sentenceTranslationCache';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

describe('sentenceTranslationKey', () => {
    it('separates languages and trims the sentence', () => {
        expect(sentenceTranslationKey(' 안녕. ', 'ko', 'en')).toBe(sentenceTranslationKey('안녕.', 'ko', 'en'));
        expect(sentenceTranslationKey('안녕.', 'ko', 'en')).not.toBe(sentenceTranslationKey('안녕.', 'ko', 'fr'));
    });
});

describe('createSentenceTranslator', () => {
    it('requires a translate function', () => {
        expect(() => createSentenceTranslator({})).toThrow();
    });

    it('translates and caches per (sentence, source, target)', async () => {
        const translate = jest.fn(async ({ query, target }) => ({ translatedText: `${query}->${target}` }));
        const translator = createSentenceTranslator({ translate });

        await expect(translator.request('가', 'ko', 'en')).resolves.toEqual({ status: 'ok', text: '가->en' });
        await expect(translator.request(' 가 ', 'ko', 'en')).resolves.toEqual({ status: 'ok', text: '가->en' });
        expect(translate).toHaveBeenCalledTimes(1);
        expect(translator.peek('가', 'ko', 'en')).toBe('가->en');

        await translator.request('가', 'ko', 'fr');
        expect(translate).toHaveBeenCalledTimes(2);
        expect(translator.size).toBe(2);
    });

    it('accepts a plain-string translate result', async () => {
        const translator = createSentenceTranslator({ translate: async () => '  hello ' });
        await expect(translator.request('x', 'ko', 'en')).resolves.toEqual({ status: 'ok', text: 'hello' });
    });

    it('returns empty text for an empty sentence without calling translate', async () => {
        const translate = jest.fn();
        const translator = createSentenceTranslator({ translate });
        await expect(translator.request('   ', 'ko', 'en')).resolves.toEqual({ status: 'ok', text: '' });
        expect(translate).not.toHaveBeenCalled();
    });

    it('marks a superseded request stale so only the latest tap wins', async () => {
        const first = deferred();
        const second = deferred();
        const translate = jest.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const translator = createSentenceTranslator({ translate });

        const a = translator.request('one', 'ko', 'en');
        const b = translator.request('two', 'ko', 'en');
        second.resolve({ translatedText: 'TWO' });
        first.resolve({ translatedText: 'ONE' });

        await expect(b).resolves.toEqual({ status: 'ok', text: 'TWO' });
        await expect(a).resolves.toEqual({ status: 'stale' });
        // The stale result is still cached for later.
        expect(translator.peek('one', 'ko', 'en')).toBe('ONE');
    });

    it('shares one in-flight call for the same key', async () => {
        const pending = deferred();
        const translate = jest.fn(() => pending.promise);
        const translator = createSentenceTranslator({ translate });

        const a = translator.request('same', 'ko', 'en');
        const b = translator.request('same', 'ko', 'en');
        pending.resolve({ translatedText: 'SAME' });

        await expect(a).resolves.toEqual({ status: 'stale' });
        await expect(b).resolves.toEqual({ status: 'ok', text: 'SAME' });
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('does not cache failures, so a retry calls again', async () => {
        const translate = jest.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ translatedText: 'ok now' });
        const translator = createSentenceTranslator({ translate });

        const failed = await translator.request('s', 'ko', 'en');
        expect(failed.status).toBe('error');
        expect(failed.error.message).toBe('offline');
        expect(translator.peek('s', 'ko', 'en')).toBeNull();

        await expect(translator.request('s', 'ko', 'en')).resolves.toEqual({ status: 'ok', text: 'ok now' });
        expect(translate).toHaveBeenCalledTimes(2);
    });

    it('reports an empty translation as an error and does not cache it', async () => {
        const translator = createSentenceTranslator({ translate: async () => ({ translatedText: '' }) });
        const result = await translator.request('s', 'ko', 'en');
        expect(result.status).toBe('error');
        expect(translator.size).toBe(0);
    });

    it('cancel() makes the outstanding request stale', async () => {
        const pending = deferred();
        const translator = createSentenceTranslator({ translate: () => pending.promise });
        const a = translator.request('s', 'ko', 'en');
        translator.cancel();
        pending.resolve({ translatedText: 'S' });
        await expect(a).resolves.toEqual({ status: 'stale' });
    });

    it('a superseded failure is stale, not an error', async () => {
        const pending = deferred();
        const translate = jest.fn()
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce({ translatedText: 'B' });
        const translator = createSentenceTranslator({ translate });
        const a = translator.request('a', 'ko', 'en');
        await translator.request('b', 'ko', 'en');
        pending.reject(new Error('boom'));
        await expect(a).resolves.toEqual({ status: 'stale' });
    });

    it('evicts the least recently used entry past maxEntries', async () => {
        const translate = jest.fn(async ({ query }) => ({ translatedText: query.toUpperCase() }));
        const translator = createSentenceTranslator({ translate, maxEntries: 2 });
        await translator.request('a', 'ko', 'en');
        await translator.request('b', 'ko', 'en');
        translator.peek('a', 'ko', 'en'); // touch a → b is now oldest
        await translator.request('c', 'ko', 'en');
        expect(translator.size).toBe(2);
        expect(translator.peek('b', 'ko', 'en')).toBeNull();
        expect(translator.peek('a', 'ko', 'en')).toBe('A');
        expect(translator.peek('c', 'ko', 'en')).toBe('C');
    });

    it('clear() empties the cache', async () => {
        const translator = createSentenceTranslator({ translate: async () => 'x' });
        await translator.request('a', 'ko', 'en');
        translator.clear();
        expect(translator.size).toBe(0);
    });
});
