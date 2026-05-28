import React from 'react';
import { Platform, Text, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

const NativeView = Platform.OS === 'android'
    ? requireNativeViewManager('NativeEpubReader')
    : null;

const NativeEpubReaderView = ({
    bookManifest,
    chapterBlocks,
    chapterResources,
    restorePosition,
    chapterTransitionDirection = 'none',
    fontSize = 18,
    lineHeight = 1.5,
    theme = 'light',
    onPageChange,
    onChapterEnd,
    onChapterStart,
    style,
}) => {
    if (!NativeView) {
        return (
            <View style={style}>
                <Text>Native EPUB rendering is only enabled on Android for now.</Text>
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

    return (
        <NativeView
            style={style}
            bookManifest={bookManifest || {}}
            chapterBlocks={chapterBlocks || []}
            chapterResources={chapterResources || []}
            restorePosition={restorePosition || {}}
            chapterTransitionDirection={chapterTransitionDirection}
            fontSize={fontSize}
            lineHeight={lineHeight}
            theme={theme}
            onPageChange={handlePageChange}
            onChapterEnd={handleChapterEnd}
            onChapterStart={handleChapterStart}
        />
    );
};

export default NativeEpubReaderView;
