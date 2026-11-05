import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translationTextSize } from './readerTextSizing';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import usePresence from '../../hooks/usePresence';
import { chapterTranslations } from '../../services/chapterTranslations';
import { fontFamilies, useTheme } from '../../theme';

// The popup never takes more than this share of the screen; a longer
// translation scrolls inside it.
const MAX_HEIGHT_RATIO = 0.3;
const PADDING_V = 10;

/**
 * SentenceTranslationPopup — the translation of the tapped word's sentence,
 * in a card that drops in over the top of the page (the reader guide's
 * sentence bar, for real). It shows while `sentence` is set: the reader clears
 * it when the reading moves on (a page turn, a tap elsewhere, a new chapter),
 * and the card fades away with the last translation still in it. The open
 * chapter's sentences are fetched ahead (services/chapterTranslations.js), so
 * a sentence normally shows at once; one the chapter didn't cover is fetched
 * on the spot. `top` is where the page starts under the header or status bar.
 */
const SentenceTranslationPopup = ({ sentence, sourceLanguage, targetLanguage, top = 0, readerFontSize }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const { height: windowHeight } = useWindowDimensions();
    const textSize = translationTextSize(readerFontSize);
    const styles = useMemo(() => createStyles(colors, textSize), [colors, textSize.fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

    const cleanedSentence = typeof sentence === 'string' ? sentence.trim() : '';
    const { mounted, progress } = usePresence(Boolean(cleanedSentence), { duration: 220 });
    // The sentence on the card: the last one, while the card fades away.
    const [shownSentence, setShownSentence] = useState(cleanedSentence);
    useEffect(() => {
        if (cleanedSentence) setShownSentence(cleanedSentence);
    }, [cleanedSentence]);

    const [state, setState] = useState({ status: 'idle', text: '' });
    const [retryToken, setRetryToken] = useState(0);
    const scrollRef = useRef(null);
    // Another sentence's translation fades in over the old one rather than cutting to it.
    const textFade = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!shownSentence) {
            setState({ status: 'idle', text: '' });
            return undefined;
        }
        const ready = chapterTranslations.peek(shownSentence, sourceLanguage, targetLanguage);
        if (ready) {
            setState({ status: 'ok', text: ready });
            return undefined;
        }
        let cancelled = false;
        setState({ status: 'loading', text: '' });
        chapterTranslations.translate(shownSentence, sourceLanguage, targetLanguage)
            .then((text) => {
                if (!cancelled) setState(text ? { status: 'ok', text } : { status: 'error', text: '' });
            })
            .catch(() => {
                if (!cancelled) setState({ status: 'error', text: '' });
            });
        return () => {
            cancelled = true;
        };
    }, [shownSentence, retryToken, sourceLanguage, targetLanguage]);

    // A new translation starts at its first line, softly.
    useEffect(() => {
        scrollRef.current?.scrollTo?.({ y: 0, animated: false });
        textFade.setValue(0.25);
        Animated.timing(textFade, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [state.text, textFade]);

    const retry = useCallback(() => setRetryToken((value) => value + 1), []);

    if (!mounted) return null;

    const hasTranslation = state.status === 'ok' && Boolean(state.text);
    return (
        <Animated.View
            pointerEvents={cleanedSentence ? 'auto' : 'none'}
            accessibilityLiveRegion="polite"
            style={[
                styles.card,
                {
                    top: top + 8,
                    opacity: progress,
                    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                },
            ]}
        >
            <ScrollView
                ref={scrollRef}
                style={[styles.scroll, { maxHeight: Math.round(windowHeight * MAX_HEIGHT_RATIO) }]}
                contentContainerStyle={styles.scrollContent}
                nestedScrollEnabled
            >
                <Animated.View style={{ opacity: textFade }}>
                    {hasTranslation ? (
                        <Text style={styles.translationText} selectable>{state.text}</Text>
                    ) : state.status === 'error' ? (
                        <TouchableOpacity onPress={retry} accessibilityRole="button">
                            <Text style={styles.mutedText}>
                                {t('read.pinnedTranslationError')}
                                {'  '}
                                <Text style={styles.retryText}>{t('common.tryAgain')}</Text>
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.mutedText}>{t('read.pinnedTranslationLoading')}</Text>
                    )}
                </Animated.View>
            </ScrollView>
        </Animated.View>
    );
};

const createStyles = (colors, textSize) => StyleSheet.create({
    // A floating card, like the dictionary and AI panels.
    card: {
        position: 'absolute',
        left: 12,
        right: 12,
        zIndex: 2,
        borderRadius: 12,
        backgroundColor: colors.surfaceElevated,
        shadowColor: '#11151c',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 10,
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingHorizontal: 14,
        paddingVertical: PADDING_V,
    },
    // The plain sans (Hangul falls back to the phone's own sans), so the
    // translation reads as a quiet aid rather than part of the book.
    translationText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: textSize.fontSize,
        lineHeight: textSize.lineHeight,
        color: colors.text,
    },
    mutedText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: textSize.fontSize - 1,
        lineHeight: textSize.lineHeight,
        color: colors.textMuted,
    },
    retryText: {
        fontFamily: fontFamilies.sansRegular,
        color: colors.text,
        textDecorationLine: 'underline',
    },
});

export default memo(SentenceTranslationPopup);
