import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { chapterTranslations } from '../../services/chapterTranslations';
import { fontFamilies, useTheme } from '../../theme';
import {
    PINNED_TRANSLATION_FONT_DEFAULT,
    PINNED_TRANSLATION_PADDING_V,
    clampPinnedTranslationFontSize,
    pinnedTranslationBarHeight,
    pinnedTranslationLineHeight,
} from './pinnedTranslationSize';

/**
 * PinnedSentenceTranslation — the translation of the last tapped word's
 * sentence, in a full-width bar under the header (and at the top of the page
 * in fullscreen). The open chapter's sentences are fetched ahead
 * (services/chapterTranslations.js), so a tap normally shows its translation
 * at once; a sentence the chapter didn't cover is fetched on the spot.
 *
 * Three lines tall; a longer translation scrolls inside the bar. A line
 * separates it from the page. It is turned on and off from the reader menu.
 */
const PinnedSentenceTranslation = ({
    sentence,
    sourceLanguage,
    targetLanguage,
    fontSize = PINNED_TRANSLATION_FONT_DEFAULT,
    topInset = 0,
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
        <View
            style={[styles.bar, { paddingTop: topInset + PINNED_TRANSLATION_PADDING_V, height: topInset + pinnedTranslationBarHeight(size) }]}
            accessibilityLiveRegion="polite"
        >
            <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator
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
    );
};

const createStyles = (colors, fontSize) => {
    const lineHeight = pinnedTranslationLineHeight(fontSize);
    return StyleSheet.create({
        // Full width, on the page's own paper, with a line under it.
        bar: {
            backgroundColor: colors.readerPaper,
            // The padding sits outside the scroll area, so exactly three lines
            // show and the next never peeks in under them.
            paddingBottom: PINNED_TRANSLATION_PADDING_V - 1,
            borderBottomWidth: 1,
            borderBottomColor: colors.readerHairline,
        },
        scroll: {
            flex: 1,
        },
        scrollContent: {
            paddingHorizontal: 22,
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
