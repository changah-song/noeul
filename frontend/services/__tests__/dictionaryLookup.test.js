/**
 * Word-tap lookup path (resolveDictionaryLookup): how many network round trips
 * a tap costs before the panel can render.
 *
 * Database and the HTTP client are mocked so each test states exactly what the
 * local cache holds and what the server answers.
 */

jest.mock('../Database', () => ({
    getCachedPKnown: jest.fn(),
    insertCacheEntries: jest.fn(() => Promise.resolve()),
    insertData: jest.fn(),
    logInteractionEvent: jest.fn(() => Promise.resolve()),
    lookupBookIndexBySurface: jest.fn(() => Promise.resolve([])),
    lookupBookIndexBySurfaceVariants: jest.fn(() => Promise.resolve([])),
    lookupCacheByStems: jest.fn(() => Promise.resolve([])),
    recordVocabContext: jest.fn(),
    removeData: jest.fn(),
    updateCacheRomanizations: jest.fn(() => Promise.resolve()),
    updateThetaFromOutcome: jest.fn(() => Promise.resolve(null)),
    vocabEntryExists: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('../api/client', () => ({
    api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../api/stemWord', () => jest.fn());

jest.mock('../localOwnerCoordinator', () => ({
    getActiveOwnerId: () => 'owner-1',
}));

jest.mock('../userDataSyncQueue', () => ({
    requestUserDataSync: jest.fn(),
}));

import {
    insertCacheEntries,
    logInteractionEvent,
    lookupBookIndexBySurface,
    lookupBookIndexBySurfaceVariants,
    lookupCacheByStems,
    updateThetaFromOutcome,
} from '../Database';
import { api } from '../api/client';
import stemWord from '../api/stemWord';
import {
    getEntryFallbackLanguage,
    resetLookupSessionStateForTests,
    resolveDictionaryLookup,
    withNormalizedSurfaceIndex,
} from '../dictionaryLookup';

const GADA_ENTRIES = [
    { word: '가다', origin: 'N/A', pos: '동사', romanization: 'gada', transWord: 'go' },
    { word: '가다', origin: 'N/A', pos: '보조 동사', romanization: 'gada', transWord: 'go on' },
];

const lookup = (overrides = {}) => resolveDictionaryLookup({
    surface: '갔다',
    currentBook: 'book-1',
    ownerId: 'owner-1',
    interfaceLanguage: 'en',
    targetLanguage: 'ko',
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    resetLookupSessionStateForTests();
    lookupBookIndexBySurface.mockResolvedValue([]);
    lookupBookIndexBySurfaceVariants.mockResolvedValue([]);
    lookupCacheByStems.mockResolvedValue([]);
    insertCacheEntries.mockResolvedValue();
});

describe('resolveDictionaryLookup (Korean)', () => {
    test('an uncached word costs one request that stems and searches together', async () => {
        api.post.mockResolvedValue({ data: { stems: ['가다'], results: [GADA_ENTRIES] } });

        const result = await lookup();

        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post).toHaveBeenCalledWith(
            '/krdict_lookup/',
            { surface: '갔다', language: 'en' },
            { timeout: 10000 }
        );
        expect(stemWord).not.toHaveBeenCalled();
        expect(api.get).not.toHaveBeenCalled();
        expect(result.stems).toEqual(['가다']);
        expect(result.cachedResults).toEqual([]);
        expect(result.dictionaryData).toEqual([GADA_ENTRIES]);
        expect(result.needsLiveFetch).toBe(false);
        expect(result.liveError).toBeNull();
        expect(insertCacheEntries).toHaveBeenCalledWith(
            [expect.objectContaining({ stem: '가다', definition: 'go', romanization: 'gada' })],
            { language: 'ko', interfaceLanguage: 'en' }
        );
    });

    test('the panel result does not wait for the cache write', async () => {
        api.post.mockResolvedValue({ data: { stems: ['가다'], results: [GADA_ENTRIES] } });
        insertCacheEntries.mockReturnValue(new Promise(() => {}));

        const result = await lookup();
        expect(result.dictionaryData).toEqual([GADA_ENTRIES]);
    });

    test('stems cached locally still show their cached entry', async () => {
        const cachedRow = { id: 7, stem: '가다', definition: 'go (cached)' };
        lookupCacheByStems.mockImplementation(async (stems) => (
            stems.includes('가다') ? [cachedRow] : []
        ));
        api.post.mockResolvedValue({ data: { stems: ['가다'], results: [GADA_ENTRIES] } });

        const result = await lookup();

        expect(result.cachedResults).toEqual([cachedRow]);
        expect(result.dictionaryData).toEqual([[]]);
        expect(insertCacheEntries).not.toHaveBeenCalled();
    });

    test('stop stems from the server are dropped like before', async () => {
        api.post.mockResolvedValue({
            data: { stems: ['공부', '하다'], results: [[{ word: '공부', transWord: 'study' }], [{ word: '하다' }]] },
        });

        const result = await lookup({ surface: '공부했다' });
        expect(result.stems).toEqual(['공부']);
        expect(result.dictionaryData).toEqual([[{ word: '공부', transWord: 'study' }]]);
    });

    test('no stems and no surface fallback means not found, without a second request', async () => {
        api.post.mockResolvedValue({ data: { stems: [], results: [] } });

        const result = await lookup({ surface: '은' });
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(result.stems).toEqual([]);
        expect(result.dictionaryData).toEqual([]);
    });

    test('a server without /krdict_lookup/ falls back to stem + search, once', async () => {
        const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
        api.post.mockImplementation(async (path) => {
            if (path === '/krdict_lookup/') {
                throw notFound;
            }
            return { data: { results: [GADA_ENTRIES] } };
        });
        stemWord.mockResolvedValue(['가다']);

        const first = await lookup();
        expect(api.post.mock.calls.map(([path]) => path)).toEqual(['/krdict_lookup/', '/krdict_search/']);
        expect(first.dictionaryData).toEqual([GADA_ENTRIES]);

        api.post.mockClear();
        await lookup({ surface: '먹었다' });
        expect(api.post.mock.calls.map(([path]) => path)).toEqual(['/krdict_search/']);
    });

    test('a network failure on the combined call falls back to the old path', async () => {
        api.post.mockImplementation(async (path) => {
            if (path === '/krdict_lookup/') {
                throw new Error('Network Error');
            }
            return { data: { results: [GADA_ENTRIES] } };
        });
        stemWord.mockResolvedValue(['가다']);

        const result = await lookup();
        expect(stemWord).toHaveBeenCalledTimes(1);
        expect(result.dictionaryData).toEqual([GADA_ENTRIES]);
    });

    test('a book-index hit renders with no network at all', async () => {
        const row = { id: 3, stem: '가다', definition: 'go' };
        lookupBookIndexBySurface.mockResolvedValue([row]);

        const result = await lookup();
        expect(result.cachedResults).toEqual([row]);
        expect(api.post).not.toHaveBeenCalled();
        expect(stemWord).not.toHaveBeenCalled();
    });

    test('a word indexed with punctuation ("갔다.") is found for the bare tap', async () => {
        const row = { id: 3, stem: '가다', definition: 'go' };
        lookupBookIndexBySurfaceVariants.mockResolvedValue([
            { ...row, index_surface: '갔다.' },
            { id: 9, stem: '갔다오다', definition: 'x', index_surface: '갔다오다' },
        ]);

        const result = await lookup();
        expect(lookupBookIndexBySurfaceVariants).toHaveBeenCalledWith(
            'owner-1', 'book-1', '갔다', { language: 'ko', interfaceLanguage: 'en' }
        );
        expect(result.cachedResults).toEqual([row]);
        expect(api.post).not.toHaveBeenCalled();
    });

    test('a repeat tap whose stems are now cached needs no network', async () => {
        api.post.mockResolvedValue({ data: { stems: ['가다'], results: [GADA_ENTRIES] } });
        await lookup();
        expect(api.post).toHaveBeenCalledTimes(1);

        const cachedRow = { id: 7, stem: '가다', definition: 'go' };
        lookupCacheByStems.mockImplementation(async (stems) => (
            stems.includes('가다') ? [cachedRow] : []
        ));
        api.post.mockClear();

        const second = await lookup();
        expect(api.post).not.toHaveBeenCalled();
        expect(second.stems).toEqual(['가다']);
        expect(second.cachedResults).toEqual([cachedRow]);
        expect(second.needsLiveFetch).toBe(false);
    });

    test('lookup signals are still recorded, after the lookup resolves', async () => {
        const order = [];
        lookupBookIndexBySurface.mockImplementation(async () => {
            order.push('index-read');
            return [{ id: 3, stem: '가다', definition: 'go' }];
        });
        logInteractionEvent.mockImplementation(async () => { order.push('log'); });
        updateThetaFromOutcome.mockImplementation(async () => { order.push('theta'); });

        await lookup();
        expect(order).toEqual(['index-read', 'log', 'theta']);
        // The event carries the tapped surface as the word and the resolved
        // dictionary form as the stem, which is what ability updates match on.
        expect(logInteractionEvent).toHaveBeenCalledWith(expect.objectContaining({
            word: '갔다', stem: '가다', eventType: 'lookup', sourceBookUri: 'book-1',
        }));
        expect(updateThetaFromOutcome).toHaveBeenCalledWith(expect.objectContaining({
            stem: '가다', outcome: 0,
        }));
    });

    test('a lookup that resolves nothing logs the surface itself', async () => {
        api.post.mockResolvedValue({ data: { stems: [], results: [] } });
        await lookup({ surface: '없는말' });
        expect(logInteractionEvent).toHaveBeenCalledWith(expect.objectContaining({
            word: '없는말', stem: '없는말', eventType: 'lookup',
        }));
    });
});

describe('English fallback while KRDICT is unavailable', () => {
    // What the backend sends a non-English interface when KRDICT fails: the
    // bundled snapshot's English senses, tagged fallback_language "en".
    const FALLBACK_GADA = GADA_ENTRIES.map((entry) => ({ ...entry, fallback_language: 'en' }));
    const SPANISH_GADA = [{ word: '가다', origin: 'N/A', pos: '동사', romanization: 'gada', transWord: 'ir' }];

    test('fallback entries are shown but not cached under the interface language', async () => {
        api.post.mockResolvedValue({ data: { stems: ['가다'], results: [FALLBACK_GADA] } });

        const result = await lookup({ interfaceLanguage: 'es' });

        expect(api.post).toHaveBeenCalledWith(
            '/krdict_lookup/',
            { surface: '갔다', language: 'es' },
            { timeout: 10000 }
        );
        expect(result.dictionaryData).toEqual([FALLBACK_GADA]);
        expect(result.liveError).toBeNull();
        expect(insertCacheEntries).not.toHaveBeenCalled();
    });

    test('once KRDICT recovers the next tap fetches and caches the real translation', async () => {
        api.post.mockResolvedValueOnce({ data: { stems: ['가다'], results: [FALLBACK_GADA] } });
        await lookup({ interfaceLanguage: 'es' });
        expect(insertCacheEntries).not.toHaveBeenCalled();

        // Nothing was cached, so the repeat tap goes back to the network.
        api.post.mockResolvedValueOnce({ data: { stems: ['가다'], results: [SPANISH_GADA] } });
        const second = await lookup({ interfaceLanguage: 'es' });

        expect(api.post).toHaveBeenCalledTimes(2);
        expect(second.dictionaryData).toEqual([SPANISH_GADA]);
        expect(insertCacheEntries).toHaveBeenCalledWith(
            [expect.objectContaining({ stem: '가다', definition: 'ir' })],
            { language: 'ko', interfaceLanguage: 'es' }
        );
    });

    test('only the fallback stems are skipped when a lookup mixes both', async () => {
        api.post.mockResolvedValue({
            data: {
                stems: ['공부', '가다'],
                results: [[{ word: '공부', transWord: 'estudio' }], FALLBACK_GADA],
            },
        });

        await lookup({ surface: '공부하러가다', interfaceLanguage: 'es' });

        expect(insertCacheEntries).toHaveBeenCalledTimes(1);
        expect(insertCacheEntries).toHaveBeenCalledWith(
            [expect.objectContaining({ stem: '공부', definition: 'estudio' })],
            { language: 'ko', interfaceLanguage: 'es' }
        );
    });

    test('the two-request path (/krdict_search/) skips caching fallbacks too', async () => {
        const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
        api.post.mockImplementation(async (path) => {
            if (path === '/krdict_lookup/') {
                throw notFound;
            }
            return { data: { results: [FALLBACK_GADA] } };
        });
        stemWord.mockResolvedValue(['가다']);

        const result = await lookup({ interfaceLanguage: 'fr' });

        expect(result.dictionaryData).toEqual([FALLBACK_GADA]);
        expect(insertCacheEntries).not.toHaveBeenCalled();
    });

    test('getEntryFallbackLanguage flags only a language other than the interface', () => {
        expect(getEntryFallbackLanguage(FALLBACK_GADA[0], 'es')).toBe('en');
        expect(getEntryFallbackLanguage(FALLBACK_GADA[0], 'en')).toBeNull();
        expect(getEntryFallbackLanguage(SPANISH_GADA[0], 'es')).toBeNull();
        expect(getEntryFallbackLanguage(null, 'es')).toBeNull();
    });
});

describe('withNormalizedSurfaceIndex', () => {
    test('adds the punctuation-free surface the reader taps', () => {
        expect(withNormalizedSurfaceIndex([
            { surface: '갔다.', stem: '가다' },
            { surface: '가', stem: '가다' },
            { surface: '“누워', stem: '눕다' },
            { surface: '누워', stem: '눕다' },
        ], 'ko')).toEqual([
            { surface: '갔다.', stem: '가다' },
            { surface: '갔다', stem: '가다' },
            { surface: '가', stem: '가다' },
            { surface: '“누워', stem: '눕다' },
            { surface: '누워', stem: '눕다' },
        ]);
    });
});
