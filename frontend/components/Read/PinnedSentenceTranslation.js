import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { chapterTranslations } from '../../services/chapterTranslations';
import { fontFamilies, lineHeights, spacing, typeScale, useTheme } from '../../theme';

// Fixed height of the pinned bar. It sits in the column between the header and
// the native reader, so its height is part of the reader's layout: any change
// re-paginates the whole chapter. It therefore never resizes with its content;
// a long translation scrolls inside the bar instead.
// 1 (hairline) + 2 × 8 (padding) + 2 × 18 (two bodySm lines) + 3 slack.
export const PINNED_TRANSLATION_BAR_HEIGHT = 56;

/**
 * PinnedSentenceTranslation — keeps the translation of the last tapped word's
 * sentence under the header. The open chapter's sentences are fetched ahead
 * (services/chapterTranslations.js), so a tap normally shows its translation at
 * once; a sentence the chapter didn't cover is fetched on the spot.
 */
const PinnedSentenceTranslation = ({ sentence, sourceLanguage, targetLanguage }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
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

    let body;
    if (state.status === 'ok') {
        body = <Text style={styles.translationText} selectable>{state.text}</Text>;
    } else if (state.status === 'loading') {
        body = <Text style={styles.mutedText}>{t('read.pinnedTranslationLoading')}</Text>;
    } else if (state.status === 'error') {
        body = (
            <TouchableOpacity onPress={retry} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8 }}>
                <Text style={styles.mutedText}>
                    {t('read.pinnedTranslationError')}
                    {'  '}
                    <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
                </Text>
            </TouchableOpacity>
        );
    } else {
        body = <Text style={styles.mutedText}>{t('read.pinnedTranslationPlaceholder')}</Text>;
    }

    return (
        <View style={styles.bar} accessibilityLiveRegion="polite">
            <MaterialIcons name="translate" size={14} color={colors.readerSubtleInk} style={styles.icon} />
            <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator
                nestedScrollEnabled
            >
                {body}
            </ScrollView>
        </View>
    );
};

// Two lines of the UI's small body type, matching the lookup panel's
// translation text rather than the book's typeface: an aid, not the page.
const barText = {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.bodySm,
    lineHeight: lineHeights.bodySm,
};

const createStyles = (colors) => StyleSheet.create({
    bar: {
        height: PINNED_TRANSLATION_BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: colors.readerPaper,
        borderBottomWidth: 1,
        borderBottomColor: colors.readerHairline,
        overflow: 'hidden',
    },
    icon: {
        marginTop: 2,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
    },
    translationText: {
        ...barText,
        color: colors.readerBodyInk,
    },
    mutedText: {
        ...barText,
        color: colors.readerMutedInk,
    },
    retryText: {
        ...barText,
        color: colors.readerBodyInk,
        textDecorationLine: 'underline',
    },
});

export default memo(PinnedSentenceTranslation);
