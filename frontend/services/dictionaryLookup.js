import axios from 'axios';

import { BASE_URL } from '../config';
import {
    insertCacheEntries,
    insertData,
    lookupCacheByStems,
    recordVocabContext,
    removeData,
    vocabEntryExists,
} from './Database';
import stemWord from './api/stemWord';
import {
    softDeleteUserVocabContextsForWord,
    softDeleteRelatedKnownWordsForMainWord,
    softDeleteUserVocabEntry,
    supabase,
    upsertUserVocabContext,
    upsertUserVocabEntry,
} from './supabase';

const STOP_STEMS = new Set([
    '하다',
    '되다',
    '있다',
    '없다',
    '이다',
    '아니다',
    '같다',
    '보다',
]);

const KOREAN_RE = /[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g;
const MAX_ALTERNATIVES = 5;

const cleanValue = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    return trimmed === 'N/A' || trimmed === 'Unknown' ? '' : trimmed;
};

const nullableValue = (value) => cleanValue(value) || null;

export const normalizeSurfaceWord = (word) => cleanValue(word).replace(KOREAN_RE, '');

const uniqueValues = (values) => [...new Set(
    (values || [])
        .map(cleanValue)
        .filter(Boolean)
)];

const cacheEntryToLookupResult = async ({ entry, surface, sourceSentence }) => {
    const primary = cacheEntryToDefinitionEntry(entry, surface);
    const liveEntries = await fetchLiveEntriesForStem(primary.word);
    const alternatives = normalizeLiveAlternatives(liveEntries.slice(1), primary)
        .slice(0, MAX_ALTERNATIVES);

    return buildLookupResult({
        surface,
        sourceSentence,
        primary,
        alternatives,
    });
};

const liveEntryToCacheEntry = (stem, entry) => ({
    stem,
    definition: nullableValue(entry?.transWord),
    hanja: nullableValue(entry?.origin),
    pos: nullableValue(entry?.pos),
    domain: null,
});

const cacheEntryToDefinitionEntry = (entry, fallbackWord) => ({
    word: cleanValue(entry?.stem) || cleanValue(entry?.word) || fallbackWord,
    definition: nullableValue(entry?.definition),
    hanja: nullableValue(entry?.hanja),
    pos: nullableValue(entry?.pos),
    romanization: nullableValue(entry?.romanization),
    saved: false,
});

const liveEntryToDefinitionEntry = (entry, fallbackWord) => ({
    word: cleanValue(entry?.word) || cleanValue(entry?.stem) || fallbackWord,
    definition: nullableValue(entry?.transWord) || nullableValue(entry?.definition),
    hanja: nullableValue(entry?.origin) || nullableValue(entry?.hanja),
    pos: nullableValue(entry?.pos),
    romanization: nullableValue(entry?.romanization),
    saved: false,
});

const definitionEntryKey = (entry) => [
    cleanValue(entry?.word),
    nullableValue(entry?.hanja) || '',
    nullableValue(entry?.definition) || '',
].join('|');

const normalizeLiveAlternatives = (entries, primary) => {
    const seen = new Set([definitionEntryKey(primary)]);

    return (entries || [])
        .map(entry => liveEntryToDefinitionEntry(entry, primary.word))
        .filter((entry) => {
            if (!entry.word && !entry.definition) {
                return false;
            }

            const key = definitionEntryKey(entry);
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
};

const fetchLiveDictionary = async (stems) => {
    if (!stems.length) {
        return [];
    }

    const response = await axios.post(`${BASE_URL}/krdict_search/`, {
        queries: stems,
    }, {
        timeout: 10000,
    });

    return response.data?.results ?? [];
};

const fetchLiveEntriesForStem = async (stem) => {
    const cleanedStem = cleanValue(stem);
    if (!cleanedStem) {
        return [];
    }

    try {
        const results = await fetchLiveDictionary([cleanedStem]);
        return results[0] ?? [];
    } catch (error) {
        return [];
    }
};

const fetchRomanization = async (term) => {
    const cleanedTerm = cleanValue(term);
    if (!cleanedTerm) {
        return null;
    }

    try {
        const response = await axios.get(`${BASE_URL}/romanize/`, {
            params: { text: cleanedTerm },
            timeout: 6000,
        });
        return nullableValue(response.data?.romanization);
    } catch (error) {
        return null;
    }
};

const hydrateDefinitionEntry = async (entry) => {
    const word = cleanValue(entry?.word);
    const definition = nullableValue(entry?.definition);
    const hanja = nullableValue(entry?.hanja);

    return {
        word,
        definition,
        hanja,
        pos: nullableValue(entry?.pos),
        romanization: nullableValue(entry?.romanization) || await fetchRomanization(word),
        saved: definition ? await vocabEntryExists(word, hanja, definition) : false,
    };
};

const buildLookupResult = async ({
    surface,
    sourceSentence,
    primary,
    alternatives = [],
}) => {
    const hydratedPrimary = await hydrateDefinitionEntry(primary);
    const hydratedAlternatives = await Promise.all(
        alternatives.slice(0, MAX_ALTERNATIVES).map(hydrateDefinitionEntry)
    );

    return {
        surface,
        stem: hydratedPrimary.word || surface,
        definition: hydratedPrimary.definition,
        hanja: hydratedPrimary.hanja,
        pos: hydratedPrimary.pos,
        romanization: hydratedPrimary.romanization,
        saved: hydratedPrimary.saved,
        sourceSentence: cleanValue(sourceSentence),
        alternatives: hydratedAlternatives,
    };
};

export const lookupWordForOverlay = async ({ surface, sourceSentence = '' }) => {
    const rawSurface = cleanValue(surface);
    const normalizedSurface = normalizeSurfaceWord(rawSurface) || rawSurface;

    if (!normalizedSurface) {
        throw new Error('No text selected.');
    }

    const directRows = await lookupCacheByStems([normalizedSurface]);
    if (directRows.length > 0) {
        return cacheEntryToLookupResult({
            entry: directRows[0],
            surface: rawSurface || normalizedSurface,
            sourceSentence,
        });
    }

    const stemCandidates = uniqueValues(await stemWord({ query: rawSurface || normalizedSurface }))
        .filter((stem) => !STOP_STEMS.has(stem));
    const stems = stemCandidates.length > 0 ? stemCandidates : [normalizedSurface];
    const cachedRows = await lookupCacheByStems(stems);

    if (cachedRows.length > 0) {
        return cacheEntryToLookupResult({
            entry: cachedRows[0],
            surface: rawSurface || normalizedSurface,
            sourceSentence,
        });
    }

    const liveResults = await fetchLiveDictionary(stems);
    const cacheEntries = stems
        .map((stem, index) => {
            const first = liveResults[index]?.[0];
            return first ? liveEntryToCacheEntry(stem, first) : null;
        })
        .filter(Boolean);

    if (cacheEntries.length > 0) {
        await insertCacheEntries(cacheEntries);
        const firstResultIndex = liveResults.findIndex(entries => entries?.[0]);
        const primaryStem = stems[firstResultIndex] || cacheEntries[0].stem;
        const liveEntries = liveResults[firstResultIndex] ?? [];
        const primary = liveEntryToDefinitionEntry(liveEntries[0], primaryStem);
        const alternatives = normalizeLiveAlternatives(liveEntries.slice(1), primary)
            .slice(0, MAX_ALTERNATIVES);

        return buildLookupResult({
            surface: rawSurface || normalizedSurface,
            sourceSentence,
            primary,
            alternatives,
        });
    }

    return {
        surface: rawSurface || normalizedSurface,
        stem: stems[0] || normalizedSurface,
        definition: null,
        hanja: null,
        pos: null,
        romanization: null,
        saved: false,
        sourceSentence: cleanValue(sourceSentence),
        alternatives: [],
    };
};

export const saveOverlayLookupResult = async ({
    stem,
    definition,
    hanja = null,
    sourceSentence = '',
}) => {
    const word = cleanValue(stem);
    const cleanedDefinition = cleanValue(definition);
    const cleanedHanja = nullableValue(hanja);
    const createdAt = new Date().toISOString();
    const normalizedSourceSentence = cleanValue(sourceSentence) || null;

    if (!word || !cleanedDefinition) {
        throw new Error('No definition to save.');
    }

    const alreadySaved = await vocabEntryExists(word, cleanedHanja, cleanedDefinition, 'ko');
    if (!alreadySaved) {
        await insertData(word, cleanedHanja, cleanedDefinition, {
            level: 'unorganized',
            sourceBookUri: null,
            sourceBookTitle: 'Floating OCR',
            contextSentence: normalizedSourceSentence,
            createdAt,
            updatedAt: createdAt,
            language: 'ko',
        });
    }
    const recordedContext = await recordVocabContext({
        word,
        hanja: cleanedHanja,
        definition: cleanedDefinition,
        sentence: sourceSentence,
        sourceBookTitle: 'Floating OCR',
        language: 'ko',
    });

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        await upsertUserVocabEntry(user.id, {
            word,
            hanja: cleanedHanja,
            definition: cleanedDefinition,
            level: 'unorganized',
            status: 'unorganized',
            sourceBookUri: null,
            sourceBookTitle: 'Floating OCR',
            contextSentence: normalizedSourceSentence,
            isFavorite: false,
            priority: 'normal',
            createdAt,
            updatedAt: createdAt,
            lastReviewedAt: null,
            nextReviewAt: null,
            correctCount: 0,
            wrongCount: 0,
            language: 'ko',
        });
        if (recordedContext) {
            upsertUserVocabContext(user.id, recordedContext).catch((error) => {
                console.warn('[overlayLookup] cloud context save failed:', error.message);
            });
        }
    }

    return { saved: true };
};

export const unsaveOverlayLookupResult = async ({
    stem,
    definition,
    hanja = null,
}) => {
    const word = cleanValue(stem);
    const cleanedDefinition = cleanValue(definition);
    const cleanedHanja = nullableValue(hanja);

    if (!word || !cleanedDefinition) {
        throw new Error('No definition to unsave.');
    }

    await removeData(word, cleanedHanja, cleanedDefinition, 'ko');

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        const cloudEntry = {
            word,
            hanja: cleanedHanja,
            definition: cleanedDefinition,
            language: 'ko',
        };
        await softDeleteUserVocabEntry(user.id, cloudEntry);
        await softDeleteUserVocabContextsForWord(user.id, cloudEntry);
        await softDeleteRelatedKnownWordsForMainWord(user.id, cloudEntry);
    }

    return { saved: false };
};
