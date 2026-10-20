import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getSavedWordFades,
    recordSavedWordSightings,
    resetSavedWordFade,
} from '../services/Database';
import {
    SAVED_WORD_FADE_STEPS,
    SAVED_WORD_LAST_FADE_MS,
    savedWordsForSurfaces,
} from '../services/savedWordFade';
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
                    faded.forEach((seen, word) => next.set(word, Math.min(seen, SAVED_WORD_FADE_STEPS)));
                    return next;
                });
            }
            if (learned.length > 0) {
                // The 'learned' level syncs like any other vocab change.
                requestUserDataSync('saved-word-learned');
                // Its box loses its last pixels first (strength 0 still draws
                // while animating), then the word leaves the highlights.
                setTimeout(() => {
                    setFades((previous) => {
                        const next = new Map(previous);
                        learned.forEach((word) => next.delete(word));
                        return next;
                    });
                    onLearnedRef.current?.(learned);
                }, SAVED_WORD_LAST_FADE_MS);
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
