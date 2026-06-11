import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Text, View, ScrollView, StyleSheet } from 'react-native';
import { translateText } from '../../../services/api/googleTranslate';
import { useTranslation } from '../../../hooks/useTranslation';
import { colors, spacing, textStyles } from '../../../theme';

const TranslationContent = ({
    highlightedWord,
    isDarkMode,
    onContentLoaded,
    sourceLanguage = 'ko',
    targetLanguage = 'en',
}) => {
    const { t } = useTranslation();
    const [translatedText, setTranslatedText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const palette = isDarkMode
        ? {
            text: '#f3ede3',
            muted: '#b6aa99',
        }
        : {
            text: colors.text,
            muted: colors.textMuted,
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

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.translationSection}
                contentContainerStyle={styles.translationContent}
                showsVerticalScrollIndicator={true}
            >
                {isLoading ? (
                    <View style={styles.loadingRow}>
                        <ActivityIndicator size="small" color={palette.muted} />
                        <Text style={[styles.offlineText, { color: palette.muted }]}>{t('lookup.translating')}</Text>
                    </View>
                ) : errorMessage ? (
                    <Text style={[styles.offlineText, { color: palette.muted }]}>{errorMessage}</Text>
                ) : translatedText ? (
                    <Text style={[styles.translationText, { color: palette.text }]}>{translatedText}</Text>
                ) : null}
            </ScrollView>   
        </View>
    );
};

const styles = StyleSheet.create({
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
        paddingRight: spacing.xs,
        paddingBottom: spacing.md,
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
        ...textStyles.body,
        flexShrink: 1,
        color: colors.text,
        lineHeight: 24,
    },
});

export default TranslationContent;
