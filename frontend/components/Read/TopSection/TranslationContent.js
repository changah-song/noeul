import React, { useState, useEffect, useMemo } from 'react';
import { ActivityIndicator, Text, View, ScrollView, StyleSheet } from 'react-native';
import { translateWithPinyin } from '../../../services/api/googleTranslate';
import { useTranslation } from '../../../hooks/useTranslation';
import { spacing, textStyles, useTheme } from '../../../theme';
import LookupLoadingSkeleton from './LookupLoadingSkeleton';

const TranslationContent = ({
    highlightedWord,
    onContentLoaded,
    sourceLanguage = 'ko',
    targetLanguage = 'en',
    compact = false,
    inline = false,
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
        translateWithPinyin({
            query,
            source: sourceLanguage,
            target: targetLanguage,
        })
            .then(({ translatedText: translation }) => {
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
            translatedText: effectiveTranslatedText,
        });
    }, [effectiveErrorMessage, effectiveIsLoading, effectiveTranslatedText, onStatusChange]);

    // One compact line for the word panel's inline translation row.
    if (inline) {
        if (effectiveIsLoading) {
            return (
                <View style={styles.inlineLoading}>
                    <ActivityIndicator size="small" color={colors.textTertiary} />
                </View>
            );
        }
        return (
            <Text
                selectable
                style={effectiveErrorMessage
                    ? [styles.inlineError, { color: palette.muted }]
                    : [styles.inlineText, { color: palette.text }]}
            >
                {effectiveErrorMessage || effectiveTranslatedText}
            </Text>
        );
    }

    if (compact) {
        const compactContent = (
            <>
                {effectiveIsLoading ? (
                    <LookupLoadingSkeleton
                        firstLineOffset={4}
                        secondLineOffset={11}
                        shortLineWidth="68%"
                    />
                ) : effectiveErrorMessage ? (
                    <Text style={[styles.translationErrorText, { color: palette.muted }]}>
                        {effectiveErrorMessage}
                    </Text>
                ) : effectiveTranslatedText ? (
                    <>
                        <Text
                            style={[styles.translationText, { color: palette.text }]}
                            numberOfLines={boundedScrollStyle ? undefined : 4}
                        >
                            {effectiveTranslatedText}
                        </Text>
                    </>
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
                    <LookupLoadingSkeleton
                        firstLineOffset={4}
                        secondLineOffset={11}
                        shortLineWidth="68%"
                    />
                ) : effectiveErrorMessage ? (
                    <Text style={[styles.offlineText, { color: palette.muted }]}>{effectiveErrorMessage}</Text>
                ) : effectiveTranslatedText ? (
                    <>
                        <Text style={[styles.translationText, { color: palette.text }]}>{effectiveTranslatedText}</Text>
                    </>
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
    offlineText: {
        ...textStyles.caption,
        color: colors.textMuted,
        fontStyle: 'italic',
    },
    translationText: {
        flexShrink: 1,
        fontFamily: textStyles.body.fontFamily,
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
    },
    translationErrorText: {
        fontFamily: textStyles.body.fontFamily,
        fontSize: 14,
        lineHeight: 22,
        fontStyle: 'italic',
        color: colors.textTertiary,
    },
    inlineLoading: {
        height: 21,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    inlineText: {
        fontFamily: textStyles.body.fontFamily,
        fontSize: 15,
        lineHeight: 21,
        color: colors.text,
    },
    inlineError: {
        fontFamily: textStyles.body.fontFamily,
        fontSize: 14,
        lineHeight: 21,
        fontStyle: 'italic',
        color: colors.textTertiary,
    },
});

export default TranslationContent;
