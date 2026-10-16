import React, { forwardRef, useMemo } from 'react';
import { Platform, Text, View } from 'react-native';
import { EventEmitter, requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import {
    joinKoreanInBlocks,
    joinKoreanInTerms,
    stripJoinersDeep,
} from './koreanLineBreak';
import { useTranslation } from '../../../hooks/useTranslation';
import { translate } from '../../../i18n/translations';
import { getRuntimeInterfaceLanguage } from '../../../services/interfaceLanguage';

const NativeView = Platform.OS === 'android'
    ? requireNativeViewManager('NativeEpubReader')
    : null;
const NativeModule = Platform.OS === 'android'
    ? requireNativeModule('NativeEpubReader')
    : null;

const translateRuntime = (key, params) => translate(getRuntimeInterfaceLanguage(), key, params);

const androidOnly = () => Promise.reject(new Error(translateRuntime('read.nativePdfAndroidOnly')));

export const extractPdfDocument = (options) => (
    NativeModule?.extractPdfDocument(options) ?? androidOnly()
);

export const renderPdfCover = (options) => (
    NativeModule?.renderPdfCover(options) ?? androidOnly()
);

// Imperative focus-mode beam navigation. Stepping through the focusNavToken
// prop re-renders the whole reader screen per step; this calls straight into
// the native view (looked up by its tag). The flag lets callers fall back to
// the token prop when running against an older native binary.
export const supportsImperativeFocusNav = typeof NativeModule?.focusNav === 'function';

// Resolves with the step's result: { moved, index, text, levelWords, ... }
// for the new sentence, or { moved: false, atEnd | atStart } at a chapter
// edge. Joiners are stripped like event payloads.
export const sendFocusNavCommand = (viewTag, direction) => (
    NativeModule?.focusNav?.(viewTag, direction)?.then?.(
        (result) => (result && typeof result === 'object' ? stripJoinersDeep(result) : result)
    ) ?? androidOnly()
);

// Listen mode: the sentence the beam would step to, without moving it.
// Synchronous (runs on the JS thread), so it never waits for the main thread.
export const supportsFocusPeek = typeof NativeModule?.focusPeek === 'function';

export const peekFocusSentence = (viewTag, direction) => {
    if (!supportsFocusPeek) return null;
    try {
        const result = NativeModule.focusPeek(viewTag, direction);
        return result && typeof result === 'object' ? stripJoinersDeep(result) : null;
    } catch (error) {
        console.warn('[NativeEpubReader] focus peek failed:', error?.message ?? error);
        return null;
    }
};

// Grow the long-press selection by one sentence ('previous' | 'next'). The
// native view re-sends onTextSelected with the longer text.
export const supportsExtendSelection = typeof NativeModule?.extendSelection === 'function';

export const sendExtendSelection = (viewTag, direction) => (
    NativeModule?.extendSelection?.(viewTag, direction) ?? androidOnly()
);

// Imperative jump to a saved checkpoint. The restorePosition prop also carries
// the passive position echo pushed on every page event, so a jump sent that way
// can be dropped as a no-op; this command is unambiguous. The flag lets callers
// detect an older native binary that predates it.
export const supportsSeekToPosition = typeof NativeModule?.seekToPosition === 'function';

export const sendSeekToPosition = (viewTag, position) => (
    NativeModule?.seekToPosition?.(viewTag, position) ?? androidOnly()
);

// Listen mode's foreground service: a media player on the notification shade
// and lock screen that keeps the process alive while the voice reads. The
// buttons come back as { action } events: play, pause, toggle, next,
// previous, stop.
export const supportsListenSession = typeof NativeModule?.updateListenSession === 'function';

export const updateListenSession = ({ title, subtitle, playing, cover } = {}) => {
    if (!supportsListenSession) return;
    try {
        NativeModule.updateListenSession({ title, subtitle, playing, cover });
    } catch (error) {
        console.warn('[NativeEpubReader] listen session update failed:', error?.message ?? error);
    }
};

export const stopListenSession = () => {
    if (typeof NativeModule?.stopListenSession !== 'function') return;
    try {
        NativeModule.stopListenSession();
    } catch (error) {
        console.warn('[NativeEpubReader] listen session stop failed:', error?.message ?? error);
    }
};

const listenEmitter = NativeModule ? new EventEmitter(NativeModule) : null;

export const addListenControlListener = (listener) => (
    listenEmitter?.addListener('onListenControl', listener) ?? { remove: () => {} }
);

// Listen mode: highlight the word being explained, or clear it with null. The
// native view draws it like a tapped word but sends no lookup event.
export const supportsSpokenWord = typeof NativeModule?.setSpokenWord === 'function';

export const sendSpokenWord = (viewTag, word) => (
    NativeModule?.setSpokenWord?.(viewTag, word || {}) ?? androidOnly()
);

const NativeEpubReaderView = forwardRef(({
    bookManifest,
    chapterBlocks,
    chapterResources,
    chapterWindow,
    restorePosition,
    chapterTransitionDirection = 'none',
    fontSize = 18,
    lineHeight = 1.5,
    theme = 'light',
    themeTokens = {},
    renderMode = 'paged',
    readerEdgeStateEnabled = true,
    highlightTerms = [],
    // [{ text, weight }] — weight 0..1 positions the term on the reader's
    // green→amber→red underline gradient. Native owns the colors so the gradient
    // tracks the reader theme without a round trip through JS.
    // Optional per-term `pinyin` / `gloss` are drawn above / below the word when
    // showPinyin / showGloss are on; `annotationOnly` terms draw no underline.
    levelTerms = [],
    showPinyin = false,
    showGloss = false,
    // { [spineIndex]: position } — furthest point read per chapter, restored on
    // open. Underlines before it are drawn faded while fadeReadMarks is on.
    readThrough = null,
    fadeReadMarks = true,
    // Keep the screen on (listen mode).
    keepScreenOn = false,
    clearSelectionToken = 0,
    focusSentenceCount = 1,
    focusSwipeEnabled = false,
    focusNavToken = 'none:0',
    focusPanelHeight = 0,
    onPageChange,
    onChapterEnd,
    onChapterStart,
    onChapterCommit,
    onWordSelected,
    onTextSelected,
    onSelectionCleared,
    onFocusSentenceChange,
    onExposure,
    style,
}, ref) => {
    const { t } = useTranslation();

    // Korean books: join each word's syllables so lines break only at spaces
    // (see koreanLineBreak.js). Terms get the same treatment so they still
    // match the text, and every event payload is stripped on the way out.
    const isKorean = String(bookManifest?.language || '').toLowerCase().startsWith('ko');
    const nativeChapterBlocks = useMemo(
        () => (isKorean ? joinKoreanInBlocks(chapterBlocks || []) : (chapterBlocks || [])),
        [isKorean, chapterBlocks]
    );
    // Paged/scroll modes read the text from chapterWindow (a few chapters with
    // their blocks); chapterBlocks is the older single-chapter path.
    const nativeChapterWindow = useMemo(
        () => (isKorean
            ? (chapterWindow || []).map((entry) => (
                entry && Array.isArray(entry.blocks) ? { ...entry, blocks: joinKoreanInBlocks(entry.blocks) } : entry
            ))
            : (chapterWindow || [])),
        [isKorean, chapterWindow]
    );
    const nativeHighlightTerms = useMemo(
        () => (isKorean ? joinKoreanInTerms(highlightTerms || []) : (highlightTerms || [])),
        [isKorean, highlightTerms]
    );
    const nativeLevelTerms = useMemo(
        () => (isKorean ? joinKoreanInTerms(levelTerms || []) : (levelTerms || [])),
        [isKorean, levelTerms]
    );
    const payloadOf = (event) => {
        const payload = event?.nativeEvent || event || {};
        return isKorean ? stripJoinersDeep(payload) : payload;
    };

    if (!NativeView) {
        return (
            <View style={style}>
                <Text>{t('read.nativeReaderAndroidOnly')}</Text>
            </View>
        );
    }

    const handlePageChange = (event) => {
        onPageChange?.(payloadOf(event));
    };

    const handleChapterEnd = () => {
        onChapterEnd?.();
    };

    const handleChapterStart = () => {
        onChapterStart?.();
    };

    const handleChapterCommit = (event) => {
        onChapterCommit?.(payloadOf(event));
    };

    const handleWordSelected = (event) => {
        onWordSelected?.(payloadOf(event));
    };

    const handleTextSelected = (event) => {
        onTextSelected?.(payloadOf(event));
    };

    const handleSelectionCleared = (event) => {
        onSelectionCleared?.(payloadOf(event));
    };

    const handleFocusSentenceChange = (event) => {
        onFocusSentenceChange?.(payloadOf(event));
    };

    const handleExposure = (event) => {
        onExposure?.(payloadOf(event));
    };

    return (
        <NativeView
            ref={ref}
            style={style}
            bookManifest={bookManifest || {}}
            chapterBlocks={nativeChapterBlocks}
            chapterResources={chapterResources || []}
            chapterWindow={nativeChapterWindow}
            restorePosition={restorePosition || {}}
            chapterTransitionDirection={chapterTransitionDirection}
            fontSize={fontSize}
            lineHeight={lineHeight}
            theme={theme}
            themeTokens={themeTokens || {}}
            renderMode={renderMode}
            readerEdgeStateEnabled={readerEdgeStateEnabled}
            highlightTerms={nativeHighlightTerms}
            levelTerms={nativeLevelTerms}
            showPinyin={!!showPinyin}
            showGloss={!!showGloss}
            readThrough={readThrough || {}}
            fadeReadMarks={fadeReadMarks !== false}
            keepScreenOn={!!keepScreenOn}
            clearSelectionToken={clearSelectionToken}
            focusSentenceCount={focusSentenceCount}
            focusSwipeEnabled={focusSwipeEnabled}
            focusNavToken={focusNavToken}
            focusPanelHeight={focusPanelHeight}
            onPageChange={handlePageChange}
            onChapterEnd={handleChapterEnd}
            onChapterStart={handleChapterStart}
            onChapterCommit={handleChapterCommit}
            onWordSelected={handleWordSelected}
            onTextSelected={handleTextSelected}
            onSelectionCleared={handleSelectionCleared}
            onFocusSentenceChange={handleFocusSentenceChange}
            onExposure={handleExposure}
        />
    );
});

NativeEpubReaderView.displayName = 'NativeEpubReaderView';

export default NativeEpubReaderView;
