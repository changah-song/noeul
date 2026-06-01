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

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');
const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const normalizeOverlayHanjaResult = async ({ requestId, character, sourceWord, result }) => {
    const header = result?.firstTableData?.[0] ?? {};
    const knownWords = sourceWord ? await getRelatedKnownWords(sourceWord).catch(() => []) : [];
    const knownKeys = new Set(knownWords.map(relatedWordKey));
    const relatedWords = (result?.similarWordsTableData ?? [])
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
        .filter(item => item.korean || item.hanja || item.meaning)
        .slice(0, 5);

    return {
        requestId,
        character: cleanValue(header.hanja) || character,
        meaning: cleanValue(header.meaning) || null,
        sound: cleanValue(header.reading) || null,
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

            await resolveOverlayLookup(requestId, {
                requestId,
                ...result,
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
            const result = await fetchHanjaRelated(character);
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
