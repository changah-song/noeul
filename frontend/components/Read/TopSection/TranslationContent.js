import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Text, View, ScrollView, StyleSheet } from 'react-native';
import { translateText } from '../../../services/api/googleTranslate';
import { useTranslation } from '../../../hooks/useTranslation';
import { spacing, textStyles, useTheme } from '../../../theme';

const TranslationContent = ({
    highlightedWord,
    onContentLoaded,
    sourceLanguage = 'ko',
    targetLanguage = 'en',
    compact = false,
    maxScrollHeight = null,
    bottomPadding = spacing.md,
    nestedScrollEnabled = false,
    forceLoading = false,
    forceError = false,
    forceErrorMessage = '',
    forceTranslatedText = '',
    onStatusChange,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [translatedText, setTranslatedText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const shimmerAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const shouldAnimateShimmer = forceLoading || (!forceError && isLoading);
        if (!shouldAnimateShimmer) {
            return undefined;
        }
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(shimmerAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
                Animated.timing(shimmerAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [forceError, forceLoading, isLoading, shimmerAnim]);

    const palette = {
        text: colors.readerBodyInk,
        muted: colors.readerMutedInk,
    };

    useEffect(() => {
        const query = typeof highlightedWord === 'string' ? highlightedWord.trim() : '';
        let isCancelled = false;

        setTranslatedText('');
        setErrorMessage('');

        if (!query) {
            setIsLoading(false);
            onContentLoaded?.();
            return undefined;
        }

        setIsLoading(true);
        translateText({
            query,
            source: sourceLanguage,
            target: targetLanguage,
        })
            .then((translation) => {
                if (isCancelled) {
                    return;
                }
                setTranslatedText(translation || '');
                setErrorMessage(translation ? '' : t('lookup.noTranslation'));
            })
            .catch((error) => {
                if (isCancelled) {
                    return;
                }
                setErrorMessage(error?.message || t('lookup.internetRequired'));
            })
            .finally(() => {
                if (isCancelled) {
                    return;
                }
                setIsLoading(false);
                onContentLoaded?.();
            });

        return () => {
            isCancelled = true;
        };
    }, [highlightedWord, onContentLoaded, sourceLanguage, t, targetLanguage]);

    const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

    const boundedScrollStyle = Number.isFinite(maxScrollHeight)
        ? { maxHeight: maxScrollHeight }
        : null;
    const effectiveIsLoading = forceLoading || (!forceError && isLoading);
    const effectiveErrorMessage = effectiveIsLoading
        ? ''
        : (forceError ? (forceErrorMessage || t('lookup.internetRequired')) : errorMessage);
    const effectiveTranslatedText = effectiveIsLoading || effectiveErrorMessage
        ? ''
        : (forceTranslatedText || translatedText);

    useEffect(() => {
        onStatusChange?.({
            isLoading: effectiveIsLoading,
            hasError: Boolean(effectiveErrorMessage),
            hasText: Boolean(effectiveTranslatedText),
        });
    }, [effectiveErrorMessage, effectiveIsLoading, effectiveTranslatedText, onStatusChange]);

    if (compact) {
        const compactContent = (
            <>
                {effectiveIsLoading ? (
                    <View style={styles.shimmerWrap}>
                        <Animated.View style={[styles.shimmerLine, { opacity: shimmerOpacity }]} />
                        <Animated.View style={[styles.shimmerLineShort, { opacity: shimmerOpacity }]} />
                    </View>
                ) : effectiveErrorMessage ? (
                    <Text style={[styles.translationErrorText, { color: palette.muted }]}>
                        {effectiveErrorMessage}
                    </Text>
                ) : effectiveTranslatedText ? (
                    <Text
                        style={[styles.translationText, { color: palette.text }]}
                        numberOfLines={boundedScrollStyle ? undefined : 4}
                    >
                        {effectiveTranslatedText}
                    </Text>
                ) : null}
            </>
        );

        if (!boundedScrollStyle) {
            return <View>{compactContent}</View>;
        }

        return (
            <ScrollView
                style={[styles.compactScroll, boundedScrollStyle]}
                contentContainerStyle={[
                    styles.compactScrollContent,
                    { paddingBottom: bottomPadding },
                ]}
                showsVerticalScrollIndicator
                nestedScrollEnabled={nestedScrollEnabled}
                keyboardShouldPersistTaps="handled"
            >
                {compactContent}
            </ScrollView>
        );
    }

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.translationSection}
                contentContainerStyle={styles.translationContent}
                showsVerticalScrollIndicator={true}
            >
                {effectiveIsLoading ? (
                    <View style={styles.loadingRow}>
                        <ActivityIndicator size="small" color={palette.muted} />
                        <Text style={[styles.offlineText, { color: palette.muted }]}>{t('lookup.translating')}</Text>
                    </View>
                ) : effectiveErrorMessage ? (
                    <Text style={[styles.offlineText, { color: palette.muted }]}>{effectiveErrorMessage}</Text>
                ) : effectiveTranslatedText ? (
                    <Text style={[styles.translationText, { color: palette.text }]}>{effectiveTranslatedText}</Text>
                ) : null}
            </ScrollView>
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    container: {
        flex: 1,
        minHeight: 0,
    },
    translationSection: {
        flex: 1,
        minHeight: 0,
    },
    translationContent: {
        flexGrow: 1,
        paddingRight: 0,
        paddingBottom: spacing.md,
    },
    compactScroll: {
        flexGrow: 0,
        flexShrink: 1,
    },
    compactScrollContent: {
        flexGrow: 0,
        paddingRight: 0,
    },
    shimmerWrap: {
        gap: 9,
        marginTop: 4,
    },
    shimmerLine: {
        height: 11,
        borderRadius: 2,
        backgroundColor: colors.surfaceMuted,
    },
    shimmerLineShort: {
        height: 11,
        borderRadius: 2,
        backgroundColor: colors.surfaceMuted,
        width: '62%',
    },
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    offlineText: {
        ...textStyles.caption,
        color: colors.textMuted,
        fontStyle: 'italic',
    },
    translationText: {
        flexShrink: 1,
        fontFamily: textStyles.body.fontFamily,
        fontSize: 15,
        lineHeight: 24,
        color: colors.text,
    },
    translationErrorText: {
        fontFamily: textStyles.body.fontFamily,
        fontSize: 14,
        lineHeight: 22,
        fontStyle: 'italic',
        color: colors.textTertiary,
    },
});

export default TranslationContent;
