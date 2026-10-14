import { useCallback, useRef, useState } from 'react';
import { findNodeHandle } from 'react-native';
import {
    sendFocusNavCommand,
    supportsImperativeFocusNav,
} from '../modules/native-epub-reader/src/NativeEpubReaderView';

const INITIAL_FOCUS_INFO = { index: 0, count: 1, total: 0 };

/**
 * useFocusNavigation — focus (sentence beam) wiring for a NativeEpubReaderView,
 * matching Read.js:
 *   • focus info (sentence index/total) is pushed to a single subscriber
 *     (FocusControls) instead of screen state, so beam steps don't re-render
 *     the whole reader
 *   • prev/next goes straight to the native view when the imperative command
 *     is available, falling back to the focusNavToken prop
 *
 * @param {object} viewRef ref attached to the NativeEpubReaderView
 */
const useFocusNavigation = (viewRef) => {
    const [focusNavToken, setFocusNavToken] = useState('none:0');
    const focusNavCounterRef = useRef(0);
    const focusInfoRef = useRef(INITIAL_FOCUS_INFO);
    const focusInfoListenerRef = useRef(null);

    const publishFocusInfo = useCallback((next) => {
        focusInfoRef.current = next;
        focusInfoListenerRef.current?.(next);
    }, []);

    const subscribeFocusInfo = useCallback((listener) => {
        focusInfoListenerRef.current = listener;
        listener(focusInfoRef.current);
        return () => {
            if (focusInfoListenerRef.current === listener) {
                focusInfoListenerRef.current = null;
            }
        };
    }, []);

    const handleFocusSentenceChange = useCallback((event = {}) => {
        publishFocusInfo({
            index: Number.isInteger(event.index) ? event.index : 0,
            count: Number.isInteger(event.count) && event.count > 0 ? event.count : 1,
            total: Number.isInteger(event.total) ? event.total : 0,
        });
    }, [publishFocusInfo]);

    const sendFocusNav = useCallback((direction) => {
        if (supportsImperativeFocusNav) {
            const viewTag = findNodeHandle(viewRef.current);
            if (viewTag != null) {
                sendFocusNavCommand(viewTag, direction).catch((error) => {
                    console.warn('[useFocusNavigation] Focus nav failed:', error?.message ?? error);
                });
                return;
            }
        }
        focusNavCounterRef.current += 1;
        setFocusNavToken(`${direction}:${focusNavCounterRef.current}`);
    }, [viewRef]);

    const resetFocusNavigation = useCallback(() => {
        publishFocusInfo(INITIAL_FOCUS_INFO);
        focusNavCounterRef.current = 0;
        setFocusNavToken('none:0');
    }, [publishFocusInfo]);

    return {
        focusNavToken,
        subscribeFocusInfo,
        handleFocusSentenceChange,
        sendFocusNav,
        resetFocusNavigation,
    };
};

export default useFocusNavigation;
