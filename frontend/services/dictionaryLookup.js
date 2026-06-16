import { api } from './api/client';
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
import {
    getActiveOwnerId,
    getSyncGeneration,
    isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { getRuntimeInterfaceLanguage, getRuntimeTargetLanguage } from './interfaceLanguage';
import { normalizeBookLanguage } from '../constants/languages';

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
const ENGLISH_EDGE_RE = /^[^A-Za-z]+|[^A-Za-z]+$/g;
const CHINESE_EDGE_RE = /^[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+|[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+$/g;
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
const normalizeEnglishSurfaceWord = (word) => cleanValue(word).replace(ENGLISH_EDGE_RE, '').toLowerCase();
const normalizeChineseSurfaceWord = (word) => cleanValue(word).replace(CHINESE_EDGE_RE, '');
const normalizeSurfaceWordForLanguage = (word, language) => {
    const targetLanguage = normalizeBookLanguage(language);
    if (targetLanguage === 'en') {
        return normalizeEnglishSurfaceWord(word);
    }
    if (targetLanguage === 'zh') {
        return normalizeChineseSurfaceWord(word);
    }
    return normalizeSurfaceWord(word);
};

const uniqueValues = (values) => [...new Set(
    (values || [])
        .map(cleanValue)
        .filter(Boolean)
)];

const cacheEntryToLookupResult = async ({
    entry,
    surface,
    sourceSentence,
    ownerId,
    includeEnrichment = true,
    wordOptions = [],
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage(),
}) => {
    const primary = cacheEntryToDefinitionEntry(entry, surface);
    const liveEntries = includeEnrichment
        ? await fetchLiveEntriesForStem(primary.word, interfaceLanguage, targetLanguage)
        : [];
    const alternatives = includeEnrichment
        ? normalizeLiveAlternatives(liveEntries.slice(1), primary, targetLanguage).slice(0, MAX_ALTERNATIVES)
        : [];

    return buildLookupResult({
        surface,
        sourceSentence,
        primary,
        alternatives,
        ownerId,
        includeRomanization: includeEnrichment,
        wordOptions,
        targetLanguage,
    });
};

const liveEntryToCacheEntry = (
    stem,
    entry,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage()
) => ({
    stem,
    language: normalizeBookLanguage(targetLanguage),
    definition: normalizeBookLanguage(targetLanguage) === 'ko'
        ? nullableValue(entry?.transWord)
        : nullableValue(entry?.definition),
    gloss: normalizeBookLanguage(targetLanguage) === 'ko' ? null : nullableValue(entry?.gloss),
    hanja: normalizeBookLanguage(targetLanguage) === 'ko' ? nullableValue(entry?.origin) : null,
    pos: nullableValue(entry?.pos),
    domain: null,
    ipa: normalizeBookLanguage(targetLanguage) === 'zh'
        ? nullableValue(entry?.pinyin) || nullableValue(entry?.ipa)
        : nullableValue(entry?.ipa),
    audio_us: normalizeBookLanguage(targetLanguage) === 'en' ? nullableValue(entry?.audio_us) : null,
    audio_uk: normalizeBookLanguage(targetLanguage) === 'en' ? nullableValue(entry?.audio_uk) : null,
    etymology: normalizeBookLanguage(targetLanguage) === 'en' ? nullableValue(entry?.etymology) : null,
    derived: normalizeBookLanguage(targetLanguage) === 'en' ? entry?.derived : null,
    related: normalizeBookLanguage(targetLanguage) === 'en' ? entry?.related : null,
    word_parts: normalizeBookLanguage(targetLanguage) === 'en' ? (entry?.word_parts ?? entry?.wordParts ?? null) : null,
    interfaceLanguage,
});

const cacheEntryToDefinitionEntry = (entry, fallbackWord) => ({
    word: cleanValue(entry?.stem) || cleanValue(entry?.word) || fallbackWord,
    definition: nullableValue(entry?.definition),
    hanja: nullableValue(entry?.hanja),
    pos: nullableValue(entry?.pos),
    romanization: nullableValue(entry?.romanization) || nullableValue(entry?.pinyin) || nullableValue(entry?.ipa),
    audio_us: nullableValue(entry?.audio_us),
    audio_uk: nullableValue(entry?.audio_uk),
    wordParts: entry?.word_parts ?? entry?.wordParts ?? null,
    saved: false,
});

const liveEntryToDefinitionEntry = (entry, fallbackWord, targetLanguage = getRuntimeTargetLanguage()) => ({
    word: cleanValue(entry?.word) || cleanValue(entry?.stem) || fallbackWord,
    definition: nullableValue(entry?.transWord) || nullableValue(entry?.definition),
    hanja: normalizeBookLanguage(targetLanguage) === 'ko'
        ? nullableValue(entry?.origin) || nullableValue(entry?.hanja)
        : null,
    pos: nullableValue(entry?.pos),
    romanization: nullableValue(entry?.romanization) || nullableValue(entry?.pinyin) || nullableValue(entry?.ipa),
    audio_us: nullableValue(entry?.audio_us),
    audio_uk: nullableValue(entry?.audio_uk),
    wordParts: entry?.word_parts ?? entry?.wordParts ?? null,
    saved: false,
});

const definitionEntryKey = (entry) => [
    cleanValue(entry?.word),
    nullableValue(entry?.hanja) || '',
    nullableValue(entry?.definition) || '',
].join('|');

const normalizeLiveAlternatives = (entries, primary, targetLanguage = getRuntimeTargetLanguage()) => {
    const seen = new Set([definitionEntryKey(primary)]);

    return (entries || [])
        .map(entry => liveEntryToDefinitionEntry(entry, primary.word, targetLanguage))
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

const fetchLiveDictionary = async (
    stems,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage()
) => {
    if (!stems.length) {
        return [];
    }

    const normalizedTargetLanguage = normalizeBookLanguage(targetLanguage);
    if (normalizedTargetLanguage === 'en') {
        return Promise.all(stems.map(async (stem) => {
            const response = await api.get('/en_dict_search/', {
                params: { stem, interface_language: interfaceLanguage },
                timeout: 10000,
            });
            const result = response.data?.result;
            return result ? [result] : [];
        }));
    }

    if (normalizedTargetLanguage === 'zh') {
        return Promise.all(stems.map(async (stem) => {
            const response = await api.get('/zh_dict_search/', {
                params: { stem, interface_language: interfaceLanguage },
                timeout: 10000,
            });
            const resultList = response.data?.results;
            if (Array.isArray(resultList)) {
                return resultList;
            }
            const result = response.data?.result;
            return result ? [result] : [];
        }));
    }

    const response = await api.post('/krdict_search/', {
        queries: stems,
        language: interfaceLanguage,
    }, {
        timeout: 10000,
    });

    return response.data?.results ?? [];
};

const fetchLiveEntriesForStem = async (
    stem,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage()
) => {
    const cleanedStem = cleanValue(stem);
    if (!cleanedStem) {
        return [];
    }

    try {
        const results = await fetchLiveDictionary([cleanedStem], interfaceLanguage, targetLanguage);
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
        const response = await api.get('/romanize/', {
            params: { text: cleanedTerm },
            timeout: 6000,
        });
        return nullableValue(response.data?.romanization);
    } catch (error) {
        return null;
    }
};

const hydrateDefinitionEntry = async (entry, ownerId, options = {}) => {
    const word = cleanValue(entry?.word);
    const definition = nullableValue(entry?.definition);
    const hanja = nullableValue(entry?.hanja);
    const includeRomanization = options.includeRomanization !== false;
    const targetLanguage = normalizeBookLanguage(options.targetLanguage ?? getRuntimeTargetLanguage());
    const pronunciation = nullableValue(entry?.romanization)
        || nullableValue(entry?.pinyin)
        || nullableValue(entry?.ipa);

    return {
        word,
        definition,
        hanja,
        pos: nullableValue(entry?.pos),
        romanization: pronunciation
            || (includeRomanization && targetLanguage === 'ko' ? await fetchRomanization(word) : null),
        audio_us: nullableValue(entry?.audio_us),
        audio_uk: nullableValue(entry?.audio_uk),
        wordParts: entry?.wordParts ?? entry?.word_parts ?? null,
        saved: definition ? await vocabEntryExists(word, hanja, definition, targetLanguage, { ownerId }) : false,
    };
};

const buildLookupResult = async ({
    surface,
    sourceSentence,
    primary,
    alternatives = [],
    ownerId,
    includeRomanization = true,
    wordOptions = [],
    targetLanguage = getRuntimeTargetLanguage(),
}) => {
    const normalizedTargetLanguage = normalizeBookLanguage(targetLanguage);
    const hydratedPrimary = await hydrateDefinitionEntry(primary, ownerId, {
        includeRomanization,
        targetLanguage: normalizedTargetLanguage,
    });
    const hydratedAlternatives = await Promise.all(
        alternatives
            .slice(0, MAX_ALTERNATIVES)
            .map((entry) => hydrateDefinitionEntry(entry, ownerId, {
                includeRomanization,
                targetLanguage: normalizedTargetLanguage,
            }))
    );

    return {
        surface,
        stem: hydratedPrimary.word || surface,
        definition: hydratedPrimary.definition,
        hanja: hydratedPrimary.hanja,
        pos: hydratedPrimary.pos,
        romanization: hydratedPrimary.romanization,
        wordParts: hydratedPrimary.wordParts,
        saved: hydratedPrimary.saved,
        sourceSentence: cleanValue(sourceSentence),
        alternatives: hydratedAlternatives,
        wordOptions: uniqueValues(wordOptions).length > 0
            ? uniqueValues(wordOptions)
            : uniqueValues([hydratedPrimary.word]),
    };
};

export const lookupWordForOverlay = async ({
    surface,
    sourceSentence = '',
    includeEnrichment = true,
}) => {
    const rawSurface = cleanValue(surface);
    const targetLanguage = normalizeBookLanguage(getRuntimeTargetLanguage());
    const normalizedSurface = normalizeSurfaceWordForLanguage(rawSurface, targetLanguage) || rawSurface;
    const ownerId = getActiveOwnerId();
    const interfaceLanguage = getRuntimeInterfaceLanguage();
    const cacheScope = {
        language: targetLanguage,
        interfaceLanguage,
    };

    if (!normalizedSurface) {
        throw new Error('No text selected.');
    }

    const directRows = await lookupCacheByStems([normalizedSurface], cacheScope);
    if (directRows.length > 0) {
        return cacheEntryToLookupResult({
            entry: directRows[0],
            surface: rawSurface || normalizedSurface,
            sourceSentence,
            ownerId,
            includeEnrichment,
            wordOptions: [directRows[0].stem],
            interfaceLanguage,
            targetLanguage,
        });
    }

    const stemCandidates = uniqueValues(await stemWord({
        query: rawSurface || normalizedSurface,
        language: targetLanguage,
    })).filter((stem) => targetLanguage !== 'ko' || !STOP_STEMS.has(stem));
    const stems = stemCandidates.length > 0 ? stemCandidates : [normalizedSurface];
    const cachedRows = await lookupCacheByStems(stems, cacheScope);

    if (cachedRows.length > 0) {
        return cacheEntryToLookupResult({
            entry: cachedRows[0],
            surface: rawSurface || normalizedSurface,
            sourceSentence,
            ownerId,
            includeEnrichment,
            wordOptions: stems,
            interfaceLanguage,
            targetLanguage,
        });
    }

    const liveResults = await fetchLiveDictionary(stems, interfaceLanguage, targetLanguage);
    const cacheEntries = stems
        .map((stem, index) => {
            const first = liveResults[index]?.[0];
            return first ? liveEntryToCacheEntry(stem, first, interfaceLanguage, targetLanguage) : null;
        })
        .filter(Boolean);

    if (cacheEntries.length > 0) {
        await insertCacheEntries(cacheEntries, cacheScope);
        const firstResultIndex = liveResults.findIndex(entries => entries?.[0]);
        const primaryStem = stems[firstResultIndex] || cacheEntries[0].stem;
        const liveEntries = liveResults[firstResultIndex] ?? [];
        const primary = liveEntryToDefinitionEntry(liveEntries[0], primaryStem, targetLanguage);
        const alternatives = includeEnrichment
            ? normalizeLiveAlternatives(liveEntries.slice(1), primary, targetLanguage).slice(0, MAX_ALTERNATIVES)
            : [];

        return buildLookupResult({
            surface: rawSurface || normalizedSurface,
            sourceSentence,
            primary,
            alternatives,
            ownerId,
            includeRomanization: includeEnrichment,
            wordOptions: stems,
            targetLanguage,
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
        wordOptions: stems,
    };
};

export const saveOverlayLookupResult = async ({
    stem,
    definition,
    hanja = null,
    sourceSentence = '',
}) => {
    const ownerId = getActiveOwnerId();
    const generation = getSyncGeneration();
    const targetLanguage = normalizeBookLanguage(getRuntimeTargetLanguage());
    const word = cleanValue(stem);
    const cleanedDefinition = cleanValue(definition);
    const cleanedHanja = nullableValue(hanja);
    const createdAt = new Date().toISOString();
    const normalizedSourceSentence = cleanValue(sourceSentence) || null;

    if (!word || !cleanedDefinition) {
        throw new Error('No definition to save.');
    }

    const alreadySaved = await vocabEntryExists(word, cleanedHanja, cleanedDefinition, targetLanguage, { ownerId });
    if (!alreadySaved) {
        await insertData(word, cleanedHanja, cleanedDefinition, {
            ownerId,
            level: 'unorganized',
            sourceBookUri: null,
            sourceBookTitle: 'Floating OCR',
            contextSentence: normalizedSourceSentence,
            createdAt,
            updatedAt: createdAt,
            language: targetLanguage,
        });
    }
    const recordedContext = await recordVocabContext({
        ownerId,
        word,
        hanja: cleanedHanja,
        definition: cleanedDefinition,
        sentence: sourceSentence,
        sourceBookTitle: 'Floating OCR',
        language: targetLanguage,
    });

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user && ownerId === user.id && isCurrentSyncGeneration(generation)) {
        await upsertUserVocabEntry({
            user,
            ownerId,
            generation,
            entry: {
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
                language: targetLanguage,
            },
        });
        if (recordedContext) {
            upsertUserVocabContext({
                user,
                ownerId,
                generation,
                context: recordedContext,
            }).catch((error) => {
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
    const ownerId = getActiveOwnerId();
    const generation = getSyncGeneration();
    const targetLanguage = normalizeBookLanguage(getRuntimeTargetLanguage());
    const word = cleanValue(stem);
    const cleanedDefinition = cleanValue(definition);
    const cleanedHanja = nullableValue(hanja);

    if (!word || !cleanedDefinition) {
        throw new Error('No definition to unsave.');
    }

    await removeData(word, cleanedHanja, cleanedDefinition, targetLanguage, { ownerId });

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user && ownerId === user.id && isCurrentSyncGeneration(generation)) {
        const cloudEntry = {
            word,
            hanja: cleanedHanja,
            definition: cleanedDefinition,
            language: targetLanguage,
        };
        await softDeleteUserVocabEntry({ user, ownerId, generation, entry: cloudEntry });
        await softDeleteUserVocabContextsForWord({ user, ownerId, generation, entry: cloudEntry });
        await softDeleteRelatedKnownWordsForMainWord({ user, ownerId, generation, entry: cloudEntry });
    }

    return { saved: false };
};
