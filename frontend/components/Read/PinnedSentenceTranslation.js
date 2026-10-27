import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { chapterTranslations } from '../../services/chapterTranslations';
import { fontFamilies, spacing, useTheme } from '../../theme';
import {
    PINNED_TRANSLATION_FONT_DEFAULT,
    PINNED_TRANSLATION_PILL_PADDING_V as PILL_PADDING_V,
    PINNED_TRANSLATION_STRIP_PADDING_V as STRIP_PADDING_V,
    clampPinnedTranslationFontSize,
    pinnedTranslationBarHeight,
    pinnedTranslationLineHeight as lineHeightFor,
} from './pinnedTranslationSize';

/**
 * PinnedSentenceTranslation — the translation of the last tapped word's
 * sentence, under the header. The open chapter's sentences are fetched ahead
 * (services/chapterTranslations.js), so a tap normally shows its translation
 * at once; a sentence the chapter didn't cover is fetched on the spot.
 *
 * A fixed-height pill showing two lines; a longer translation scrolls inside
 * it. It is turned on and off, and sized, from the reader settings.
 */
const PinnedSentenceTranslation = ({
    sentence,
    sourceLanguage,
    targetLanguage,
    fontSize = PINNED_TRANSLATION_FONT_DEFAULT,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const size = clampPinnedTranslationFontSize(fontSize);
    const styles = useMemo(() => createStyles(colors, size), [colors, size]);
    const cleanedSentence = typeof sentence === 'string' ? sentence.trim() : '';
    const [state, setState] = useState({ status: 'idle', text: '' });
    const [retryToken, setRetryToken] = useState(0);
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!cleanedSentence) {
            setState({ status: 'idle', text: '' });
            return undefined;
        }
        const ready = chapterTranslations.peek(cleanedSentence, sourceLanguage, targetLanguage);
        if (ready) {
            setState({ status: 'ok', text: ready });
            return undefined;
        }
        let cancelled = false;
        setState({ status: 'loading', text: '' });
        chapterTranslations.translate(cleanedSentence, sourceLanguage, targetLanguage)
            .then((text) => {
                if (!cancelled) setState(text ? { status: 'ok', text } : { status: 'error', text: '' });
            })
            .catch(() => {
                if (!cancelled) setState({ status: 'error', text: '' });
            });
        return () => {
            cancelled = true;
        };
    }, [cleanedSentence, retryToken, sourceLanguage, targetLanguage]);

    // A new translation starts at its first line.
    useEffect(() => {
        scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    }, [state.text]);

    const retry = useCallback(() => setRetryToken((value) => value + 1), []);

    const statusText = state.status === 'loading'
        ? t('read.pinnedTranslationLoading')
        : state.status === 'error'
            ? t('read.pinnedTranslationError')
            : t('read.pinnedTranslationPlaceholder');
    const hasTranslation = state.status === 'ok' && Boolean(state.text);

    return (
        <View style={styles.strip}>
            <View style={styles.pill} accessibilityLiveRegion="polite">
                <MaterialIcons name="translate" size={16} color={colors.readerSubtleInk} style={styles.icon} />
                <ScrollView
                    ref={scrollRef}
                    style={styles.scroll}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                >
                    {hasTranslation ? (
                        <Text style={styles.translationText} selectable>{state.text}</Text>
                    ) : state.status === 'error' ? (
                        <TouchableOpacity onPress={retry} accessibilityRole="button">
                            <Text style={styles.mutedText}>
                                {statusText}
                                {'  '}
                                <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.mutedText}>{statusText}</Text>
                    )}
                </ScrollView>
            </View>
        </View>
    );
};

const createStyles = (colors, fontSize) => {
    const lineHeight = lineHeightFor(fontSize);
    return StyleSheet.create({
        // The reserved strip: its height is fixed for a given text size.
        strip: {
            height: pinnedTranslationBarHeight(fontSize),
            paddingHorizontal: 12,
            paddingVertical: STRIP_PADDING_V,
            backgroundColor: colors.readerPaper,
        },
        pill: {
            flex: 1,
            borderRadius: 18,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.sm,
            paddingHorizontal: 14,
            paddingVertical: PILL_PADDING_V,
            backgroundColor: colors.surfaceMuted,
        },
        icon: {
            // Centered on the first line of text.
            marginTop: Math.max(0, (lineHeight - 16) / 2),
        },
        scroll: {
            flex: 1,
        },
        translationText: {
            fontFamily: fontFamilies.sansRegular,
            fontSize,
            lineHeight,
            color: colors.readerBodyInk,
        },
        mutedText: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: Math.max(14, fontSize - 2),
            lineHeight,
            color: colors.readerMutedInk,
        },
        retryText: {
            fontFamily: fontFamilies.sansRegular,
            color: colors.readerBodyInk,
            textDecorationLine: 'underline',
        },
    });
};

export default memo(PinnedSentenceTranslation);
