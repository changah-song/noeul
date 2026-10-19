import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getSavedWordFades,
    recordSavedWordSightings,
    resetSavedWordFade,
} from '../services/Database';
import { savedWordsForSurfaces } from '../services/savedWordFade';
import { requestUserDataSync } from '../services/userDataSyncQueue';

/**
 * useSavedWordFades — how far each saved word has faded, and the two events
 * that move it: the reader passed some saved words without looking them up
 * (onSavedPassed), or looked one up (onLookedUp). `onLearned(words)` fires
 * when words fade out completely and become learned.
 */
const useSavedWordFades = ({ ownerId, language, onLearned }) => {
    const [fades, setFades] = useState(() => new Map());
    const onLearnedRef = useRef(onLearned);
    onLearnedRef.current = onLearned;

    useEffect(() => {
        let active = true;
        getSavedWordFades({ ownerId, language })
            .then((map) => { if (active) setFades(map); })
            .catch(() => { if (active) setFades(new Map()); });
        return () => {
            active = false;
        };
    }, [ownerId, language]);

    const onSavedPassed = useCallback(async ({ surfaces, surfaceToWord, lookedUp }) => {
        const words = savedWordsForSurfaces(surfaces, surfaceToWord, lookedUp);
        if (words.length === 0) return;
        try {
            const { faded, learned } = await recordSavedWordSightings({ ownerId, language, words });
            if (faded.size > 0) {
                setFades((previous) => {
                    const next = new Map(previous);
                    faded.forEach((seen, word) => next.set(word, seen));
                    learned.forEach((word) => next.delete(word));
                    return next;
                });
            }
            if (learned.length > 0) {
                // The 'learned' level syncs like any other vocab change.
                requestUserDataSync('saved-word-learned');
                onLearnedRef.current?.(learned);
            }
        } catch (error) {
            console.warn('[useSavedWordFades] Failed to record saved word sightings:', error?.message ?? error);
        }
    }, [ownerId, language]);

    const onLookedUp = useCallback((words) => {
        const list = (Array.isArray(words) ? words : [words]).filter(Boolean);
        if (list.length === 0) return;
        setFades((previous) => {
            if (!list.some((word) => previous.has(word))) return previous;
            const next = new Map(previous);
            list.forEach((word) => next.delete(word));
            return next;
        });
        resetSavedWordFade({ ownerId, language, words: list }).catch(() => {});
    }, [ownerId, language]);

    return { fades, onSavedPassed, onLookedUp };
};

export default useSavedWordFades;
