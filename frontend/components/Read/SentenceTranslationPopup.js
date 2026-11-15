import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translationTextSize } from './readerTextSizing';
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import usePresence from '../../hooks/usePresence';
import { chapterTranslations } from '../../services/chapterTranslations';
import { fontFamilies, panelLift, useTheme } from '../../theme';

// The pane is never taller than this many lines, however long the sentence:
// a longer translation scrolls inside it, opening at the part that goes with
// the tapped word.
const MAX_LINES = 3;
const PADDING_V = 12;
const PANE_RADIUS = 24;
// The iOS reader draws the book at the reader's font size exactly, ignoring
// the phone's text-size setting, so the pane must too or it outgrows the page.
// (On Android both follow the setting.)
const FOLLOW_PHONE_TEXT_SIZE = Platform.OS !== 'ios';

// How far through its sentence the tapped word sits, 0..1 (0 when unknown).
export const wordPositionInSentence = (sentence, word) => {
    const text = typeof sentence === 'string' ? sentence : '';
    const target = typeof word === 'string' ? word.trim() : '';
    if (!text || !target) return 0;
    const index = text.indexOf(target);
    const span = text.length - target.length;
    if (index <= 0 || span <= 0) return 0;
    return Math.min(1, index / span);
};

/**
 * SentenceTranslationPopup — the translation of the tapped word's sentence,
 * in a pane across the top of the page: the dictionary panel's twin (the same
 * surface, edge to edge, lifted off the page by a soft shadow), hanging from the header the way that one
 * rises from the bottom. It is at most MAX_LINES tall; a longer translation
 * opens scrolled to about where the tapped word (`focusWord`) falls in its
 * sentence, an estimate from the word's place in the original, since the
 * translation doesn't say which of its words go with which.
 * It shows while `sentence` is set: the reader clears
 * it when the reading moves on (a page turn, a tap elsewhere, a new chapter),
 * and the card fades away with the last translation still in it. The open
 * chapter's sentences are fetched ahead (services/chapterTranslations.js), so
 * a sentence normally shows at once; one the chapter didn't cover is fetched
 * on the spot. `top` is where the page starts under the header; in full
 * screen the pane starts at the screen's top edge and `topInset` keeps its
 * text clear of the status bar.
 */
const SentenceTranslationPopup = ({
    sentence,
    focusWord = '',
    sourceLanguage,
    targetLanguage,
    top = 0,
    topInset = 0,
    readerFontSize,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const textSize = translationTextSize(readerFontSize, {
        bookLanguage: sourceLanguage,
        translationLanguage: targetLanguage,
    });
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
    const contentHeightRef = useRef(0);
    const focusFraction = wordPositionInSentence(shownSentence, focusWord);
    const maxTextHeight = textSize.lineHeight * MAX_LINES;
    // Bring the part of a long translation that goes with the tapped word
    // into the pane.
    const scrollToFocus = useCallback((animated) => {
        const overflow = contentHeightRef.current - (maxTextHeight + PADDING_V * 2);
        // Whole lines only, so no line is cut in half at the pane's edge.
        const lineHeight = textSize.lineHeight;
        const y = overflow > 0
            ? Math.min(overflow, Math.round((overflow * focusFraction) / lineHeight) * lineHeight)
            : 0;
        scrollRef.current?.scrollTo?.({ y, animated });
    }, [focusFraction, maxTextHeight, textSize.lineHeight]);
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

    // Another word in the same sentence: the pane moves along to it.
    useEffect(() => {
        scrollToFocus(true);
    }, [scrollToFocus]);

    // A new translation fades in softly.
    useEffect(() => {
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
                styles.pane,
                {
                    top,
                    paddingTop: topInset,
                    opacity: progress,
                    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                },
            ]}
        >
            <ScrollView
                ref={scrollRef}
                style={[styles.scroll, { maxHeight: maxTextHeight + PADDING_V * 2 }]}
                contentContainerStyle={styles.scrollContent}
                onContentSizeChange={(_width, height) => {
                    contentHeightRef.current = height;
                    scrollToFocus(false);
                }}
                nestedScrollEnabled
            >
                <Animated.View style={{ opacity: textFade }}>
                    {hasTranslation ? (
                        <Text style={styles.translationText} allowFontScaling={FOLLOW_PHONE_TEXT_SIZE} selectable>{state.text}</Text>
                    ) : state.status === 'error' ? (
                        <TouchableOpacity onPress={retry} accessibilityRole="button">
                            <Text style={styles.mutedText} allowFontScaling={FOLLOW_PHONE_TEXT_SIZE}>
                                {t('read.pinnedTranslationError')}
                                {'  '}
                                <Text style={styles.retryText} allowFontScaling={FOLLOW_PHONE_TEXT_SIZE}>{t('common.tryAgain')}</Text>
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <Text style={styles.mutedText} allowFontScaling={FOLLOW_PHONE_TEXT_SIZE}>{t('read.pinnedTranslationLoading')}</Text>
                    )}
                </Animated.View>
            </ScrollView>
        </Animated.View>
    );
};

const createStyles = (colors, textSize) => StyleSheet.create({
    // The dictionary panel upside down: the same surface and hairline, edge
    // to edge, rounded on the side that faces the page, with the same soft
    // shadow falling onto it. Nothing here clips (the scroll view keeps its
    // own text in), since clipping would cut the shadow off on iOS.
    pane: {
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 2,
        borderBottomLeftRadius: PANE_RADIUS,
        borderBottomRightRadius: PANE_RADIUS,
        backgroundColor: colors.readerSurface,
        borderColor: colors.readerBorder,
        borderWidth: StyleSheet.hairlineWidth,
        borderTopWidth: 0,
        ...panelLift(colors, 'down'),
    },
    scroll: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingHorizontal: 24,
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
