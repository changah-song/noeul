import { useCallback, useEffect, useRef } from 'react';
import { logInteractionEvent } from '../services/Database';

// What the reader did with a word card after tapping, logged when the card
// closes or another word replaces it ('lookup_detail': value_num = seconds the
// card was open, grade = LOOKUP_ACTIONS flags). A tap is not one behaviour:
// a two-second glance for the sentence translation or the pinyin says much
// less about not knowing the word than reading its definitions and saving it.
// The level engine will learn from these; for now they are only recorded.

export const LOOKUP_ACTIONS = {
    saved: 1,
};

// A card left open longer than this was put down, not read.
const MAX_OPEN_SECONDS = 600;

/**
 * lookupDetailEvent — the event for one closed card, or null when there is
 * nothing to log.
 */
export const lookupDetailEvent = (open, closedAt, scope = {}) => {
    if (!open?.word || !Number.isFinite(open.openedAt)) return null;
    const seconds = Math.max(0, (closedAt - open.openedAt) / 1000);
    return {
        ...scope,
        word: open.word,
        eventType: 'lookup_detail',
        valueNum: Math.round(Math.min(seconds, MAX_OPEN_SECONDS) * 10) / 10,
        grade: open.actions,
        createdAt: new Date(open.openedAt).toISOString(),
    };
};

/**
 * useLookupDetail — track the open word card (`word`, '' when none) and log
 * each one as it closes. Returns `noteAction(flag)` for what the reader does
 * with the open card.
 */
const useLookupDetail = ({ word, ownerId, language, sourceBookUri }) => {
    const openRef = useRef(null);
    const scopeRef = useRef({});
    scopeRef.current = { ownerId, language, sourceBookUri };

    const flush = useCallback(() => {
        const event = lookupDetailEvent(openRef.current, Date.now(), scopeRef.current);
        openRef.current = null;
        if (event) {
            logInteractionEvent(event).catch((error) => {
                console.warn('[useLookupDetail] Failed to log lookup detail:', error);
            });
        }
    }, []);

    useEffect(() => {
        const next = typeof word === 'string' ? word.trim() : '';
        if (openRef.current?.word === next) return;
        flush();
        if (next) openRef.current = { word: next, openedAt: Date.now(), actions: 0 };
    }, [word, flush]);

    useEffect(() => flush, [flush]);

    return useCallback((flag) => {
        if (openRef.current) openRef.current.actions |= flag;
    }, []);
};

export default useLookupDetail;
