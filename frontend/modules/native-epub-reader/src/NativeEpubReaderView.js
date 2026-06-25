import React from 'react';
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

const NativeEpubReaderView = ({
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
    sameLevelTerms = [],
    aboveLevelTerms = [],
    clearSelectionToken = 0,
    onPageChange,
    onChapterEnd,
    onChapterStart,
    onChapterCommit,
    onWordSelected,
    onTextSelected,
    onSelectionCleared,
    style,
}) => {
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

    return (
        <NativeView
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
            sameLevelTerms={sameLevelTerms || []}
            aboveLevelTerms={aboveLevelTerms || []}
            clearSelectionToken={clearSelectionToken}
            onPageChange={handlePageChange}
            onChapterEnd={handleChapterEnd}
            onChapterStart={handleChapterStart}
            onChapterCommit={handleChapterCommit}
            onWordSelected={handleWordSelected}
            onTextSelected={handleTextSelected}
            onSelectionCleared={handleSelectionCleared}
        />
    );
};

export default NativeEpubReaderView;
