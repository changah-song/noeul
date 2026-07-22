import React, { forwardRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
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

export const sendFocusNavCommand = (viewTag, direction) => (
    NativeModule?.focusNav?.(viewTag, direction) ?? androidOnly()
);

// Imperative jump to a saved checkpoint. The restorePosition prop also carries
// the passive position echo pushed on every page event, so a jump sent that way
// can be dropped as a no-op; this command is unambiguous. The flag lets callers
// detect an older native binary that predates it.
export const supportsSeekToPosition = typeof NativeModule?.seekToPosition === 'function';

export const sendSeekToPosition = (viewTag, position) => (
    NativeModule?.seekToPosition?.(viewTag, position) ?? androidOnly()
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
    levelTerms = [],
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
    style,
}, ref) => {
    const { t } = useTranslation();

    if (!NativeView) {
        return (
            <View style={style}>
                <Text>{t('read.nativeReaderAndroidOnly')}</Text>
            </View>
        );
    }

    const handlePageChange = (event) => {
        onPageChange?.(event?.nativeEvent || event || {});
    };

    const handleChapterEnd = () => {
        onChapterEnd?.();
    };

    const handleChapterStart = () => {
        onChapterStart?.();
    };

    const handleChapterCommit = (event) => {
        onChapterCommit?.(event?.nativeEvent || event || {});
    };

    const handleWordSelected = (event) => {
        onWordSelected?.(event?.nativeEvent || event || {});
    };

    const handleTextSelected = (event) => {
        onTextSelected?.(event?.nativeEvent || event || {});
    };

    const handleSelectionCleared = (event) => {
        onSelectionCleared?.(event?.nativeEvent || event || {});
    };

    const handleFocusSentenceChange = (event) => {
        onFocusSentenceChange?.(event?.nativeEvent || event || {});
    };

    return (
        <NativeView
            ref={ref}
            style={style}
            bookManifest={bookManifest || {}}
            chapterBlocks={chapterBlocks || []}
            chapterResources={chapterResources || []}
            chapterWindow={chapterWindow || []}
            restorePosition={restorePosition || {}}
            chapterTransitionDirection={chapterTransitionDirection}
            fontSize={fontSize}
            lineHeight={lineHeight}
            theme={theme}
            themeTokens={themeTokens || {}}
            renderMode={renderMode}
            readerEdgeStateEnabled={readerEdgeStateEnabled}
            highlightTerms={highlightTerms || []}
            levelTerms={levelTerms || []}
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
        />
    );
});

NativeEpubReaderView.displayName = 'NativeEpubReaderView';

export default NativeEpubReaderView;
