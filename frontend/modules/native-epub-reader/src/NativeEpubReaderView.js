import React from 'react';
import { Platform, Text, View } from 'react-native';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';

const NativeView = Platform.OS === 'android'
    ? requireNativeViewManager('NativeEpubReader')
    : null;
const NativeModule = Platform.OS === 'android'
    ? requireNativeModule('NativeEpubReader')
    : null;

const androidOnly = () => Promise.reject(new Error('Native PDF extraction is only available on Android.'));

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
    renderMode = 'paged',
    highlightTerms = [],
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
    if (!NativeView) {
        return (
            <View style={style}>
                <Text>Native book rendering is only enabled on Android for now.</Text>
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
            renderMode={renderMode}
            highlightTerms={highlightTerms || []}
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
