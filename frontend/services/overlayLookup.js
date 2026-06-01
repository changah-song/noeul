import { Platform } from 'react-native';

import {
    addOverlayHanjaRequestedListener,
    addOverlayLookupRequestedListener,
    addOverlayRelatedKnownToggleRequestedListener,
    addOverlaySaveRequestedListener,
    rejectOverlayLookup,
    rejectOverlaySave,
    rejectOverlayHanja,
    resolveOverlayLookup,
    resolveOverlaySave,
    resolveOverlayHanja,
} from '../modules/screen-ocr-overlay/src';
import { fetchHanjaRelated } from './api/hanjaRelated';
import { addRelatedKnownWord, getRelatedKnownWords, removeRelatedKnownWord } from './Database';
import { lookupWordForOverlay, saveOverlayLookupResult, unsaveOverlayLookupResult } from './dictionaryLookup';

let subscriptions = [];
let isInitialized = false;

const HANJA_CHARACTER_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const MAX_HANJA_LOOKUP_CACHE_SIZE = 160;
const hanjaLookupCache = new Map();

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');
const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const uniqueCleanValues = (values = []) => [...new Set(values.map(cleanValue).filter(Boolean))];
const extractHanjaCharacters = (value) => uniqueCleanValues(
    Array.from(cleanValue(value)).filter(char => HANJA_CHARACTER_PATTERN.test(char))
);
const gradeRank = (grade) => {
    switch (cleanValue(grade)) {
        case '초급':
            return 0;
        case '중급':
            return 1;
        case '고급':
            return 2;
        default:
            return 3;
    }
};

const getCachedHanjaRelated = (character) => {
    const cacheKey = cleanValue(character);

    if (!cacheKey) {
        return Promise.resolve({
            firstTableData: [],
            similarWordsTableData: [],
        });
    }

    const cachedLookup = hanjaLookupCache.get(cacheKey);
    if (cachedLookup) {
        return cachedLookup;
    }

    const lookupPromise = fetchHanjaRelated(cacheKey).catch((error) => {
        hanjaLookupCache.delete(cacheKey);
        throw error;
    });

    hanjaLookupCache.set(cacheKey, lookupPromise);

    while (hanjaLookupCache.size > MAX_HANJA_LOOKUP_CACHE_SIZE) {
        const oldestKey = hanjaLookupCache.keys().next().value;
        hanjaLookupCache.delete(oldestKey);
    }

    return lookupPromise;
};

const preloadHanjaCharacters = async (characters = []) => {
    const uniqueCharacters = uniqueCleanValues(characters);

    if (uniqueCharacters.length === 0) {
        return;
    }

    await Promise.allSettled(uniqueCharacters.map(getCachedHanjaRelated));
};

const getLookupHanjaPreloadTargets = (result, fallbackSourceWord) => {
    const targets = [];
    const seen = new Set();
    const addTargets = (sourceWord, hanja) => {
        const cleanedSourceWord = cleanValue(sourceWord) || fallbackSourceWord;

        extractHanjaCharacters(hanja).forEach((character) => {
            const key = `${cleanedSourceWord}|${character}`;
            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            targets.push({
                sourceWord: cleanedSourceWord,
                character,
            });
        });
    };

    addTargets(cleanValue(result?.stem) || cleanValue(result?.surface), result?.hanja);

    const alternatives = Array.isArray(result?.alternatives) ? result.alternatives : [];
    alternatives.forEach((alternative) => {
        addTargets(cleanValue(alternative?.word) || cleanValue(alternative?.stem), alternative?.hanja);
    });

    return targets;
};

const preloadOverlayHanjaForLookupResult = async (result, fallbackSourceWord = '') => {
    const targets = getLookupHanjaPreloadTargets(result, cleanValue(fallbackSourceWord));
    const characters = targets.map(target => target.character);

    if (characters.length === 0) {
        return [];
    }

    await preloadHanjaCharacters(characters);
    const preloadResults = await Promise.allSettled(targets.map(async (target) => {
        const cachedResult = await getCachedHanjaRelated(target.character);
        const normalized = await normalizeOverlayHanjaResult({
            requestId: '',
            character: target.character,
            sourceWord: target.sourceWord,
            result: cachedResult,
        });

        return {
            sourceWord: target.sourceWord,
            character: target.character,
            meaning: normalized.meaning,
            sound: normalized.sound,
            relatedWords: normalized.relatedWords,
        };
    }));

    return preloadResults
        .filter(settledResult => settledResult.status === 'fulfilled')
        .map(settledResult => settledResult.value);
};

const normalizeOverlayHanjaResult = async ({ requestId, character, sourceWord, result }) => {
    const readings = uniqueCleanValues((result?.firstTableData ?? []).map(row => row?.reading));
    const meanings = uniqueCleanValues((result?.firstTableData ?? []).map(row => (
        row?.meaning || row?.hun_english || row?.hun_korean
    )));
    const characters = uniqueCleanValues((result?.firstTableData ?? []).map(row => row?.hanja));
    const knownWords = sourceWord ? await getRelatedKnownWords(sourceWord).catch(() => []) : [];
    const knownKeys = new Set(knownWords.map(relatedWordKey));
    const relatedWords = (result?.similarWordsTableData ?? [])
        .slice()
        .sort((left, right) => (
            gradeRank(left?.word_grade) - gradeRank(right?.word_grade)
            || cleanValue(left?.korean).localeCompare(cleanValue(right?.korean), 'ko')
        ))
        .map(item => {
            const relatedWord = {
                korean: cleanValue(item?.korean),
                hanja: cleanValue(item?.hanja),
                meaning: cleanValue(item?.meaning),
            };

            return {
                ...relatedWord,
                known: knownKeys.has(relatedWordKey(relatedWord)),
            };
        })
        .filter(item => item.korean || item.hanja || item.meaning);

    return {
        requestId,
        character: characters[0] || character,
        meaning: meanings.length > 0 ? meanings.join('; ') : null,
        sound: readings.length > 0 ? readings.join(' / ') : null,
        relatedWords,
    };
};

export const initializeOverlayLookupBridge = () => {
    if (Platform.OS !== 'android' || isInitialized) {
        return () => {};
    }

    isInitialized = true;

    const lookupSubscription = addOverlayLookupRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);
        const selectedText = cleanValue(event.selectedText);

        if (!requestId) {
            return;
        }

        try {
            const result = await lookupWordForOverlay({
                surface: selectedText,
                sourceSentence: cleanValue(event.selectedLineText),
            });
            const hanjaPreloads = await preloadOverlayHanjaForLookupResult(result, selectedText);

            await resolveOverlayLookup(requestId, {
                requestId,
                ...result,
                hanjaPreloads,
            });
        } catch (error) {
            await rejectOverlayLookup(requestId, error?.message || 'Lookup failed.');
        }
    });

    const saveSubscription = addOverlaySaveRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);

        if (!requestId) {
            return;
        }

        try {
            const payload = {
                stem: event.stem,
                definition: event.definition,
                hanja: event.hanja,
                sourceSentence: event.sourceSentence,
            };
            const result = event.action === 'unsave'
                ? await unsaveOverlayLookupResult(payload)
                : await saveOverlayLookupResult(payload);

            await resolveOverlaySave(requestId, {
                requestId,
                ...result,
            });
        } catch (error) {
            await rejectOverlaySave(requestId, error?.message || 'Save failed.');
        }
    });

    const hanjaSubscription = addOverlayHanjaRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);
        const character = cleanValue(event.character);
        const sourceWord = cleanValue(event.sourceWord);

        if (!requestId) {
            return;
        }

        try {
            const result = await getCachedHanjaRelated(character);
            await resolveOverlayHanja(requestId, await normalizeOverlayHanjaResult({
                requestId,
                character,
                sourceWord,
                result,
            }));
        } catch (error) {
            await rejectOverlayHanja(requestId, error?.message || 'Hanja lookup failed.');
        }
    });

    const relatedKnownSubscription = addOverlayRelatedKnownToggleRequestedListener(async (event = {}) => {
        const sourceWord = cleanValue(event.sourceWord);
        const relatedWord = event.relatedWord ?? {};
        const entry = {
            korean: cleanValue(relatedWord.korean),
            hanja: cleanValue(relatedWord.hanja),
            meaning: cleanValue(relatedWord.meaning),
            sourceHanja: cleanValue(event.sourceHanja) || cleanValue(relatedWord.sourceHanja),
        };

        if (!sourceWord || (!entry.korean && !entry.hanja)) {
            return;
        }

        try {
            if (event.known) {
                await addRelatedKnownWord(sourceWord, entry);
            } else {
                await removeRelatedKnownWord(sourceWord, entry);
            }
        } catch (error) {
            console.log(`[overlayLookup] related known word toggle failed for "${sourceWord}":`, error?.message);
        }
    });

    subscriptions = [lookupSubscription, saveSubscription, hanjaSubscription, relatedKnownSubscription];

    return () => {
        subscriptions.forEach((subscription) => subscription?.remove?.());
        subscriptions = [];
        isInitialized = false;
    };
};
