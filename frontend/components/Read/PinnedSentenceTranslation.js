import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { chapterTranslations } from '../../services/chapterTranslations';
import { fontFamilies, useTheme } from '../../theme';
import {
    PINNED_TRANSLATION_FONT_DEFAULT,
    PINNED_TRANSLATION_GRIP_HEIGHT,
    PINNED_TRANSLATION_PADDING_V,
    clampPinnedTranslationFontSize,
    pinnedTranslationLineHeight,
} from './pinnedTranslationSize';

/**
 * PinnedSentenceTranslation — the translation of the sentence being read, in
 * its own space between the reader's header and the page, with a grip under
 * it that resizes it (0 to 4 lines). It never hides on its own: before the
 * first tap it says how to fill it, then it holds the last tapped word's
 * sentence (`sentence`), or, in focus mode (`followFocus`), the lit sentence,
 * which it gets from `subscribeFocusText` so a focus step doesn't re-render
 * the reader. The open chapter's sentences are fetched ahead
 * (services/chapterTranslations.js), so a sentence normally shows at once; one
 * the chapter didn't cover is fetched on the spot. A longer translation
 * scrolls inside the bar.
 *
 * `heightAnim` is the bar's height above the grip (the reader animates it
 * between line counts while the grip is dragged); `gripHandlers` are the
 * grip's pan handlers and `gripAccessibility` its adjustable-role props.
 * `gripTilt` bends the grip's handle into a chevron: -1 ⌃ (being pushed up,
 * smaller), 0 flat, 1 ⌄ (being pulled down, or folded away and waiting to be).
 */
const PinnedSentenceTranslation = ({
    sentence,
    followFocus = false,
    subscribeFocusText,
    sourceLanguage,
    targetLanguage,
    fontSize = PINNED_TRANSLATION_FONT_DEFAULT,
    heightAnim,
    topInset = 0,
    gripHandlers,
    gripAccessibility,
    gripTilt,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const size = clampPinnedTranslationFontSize(fontSize);
    const styles = useMemo(() => createStyles(colors, size), [colors, size]);

    const [focusText, setFocusText] = useState('');
    useEffect(() => {
        if (!followFocus || !subscribeFocusText) return undefined;
        return subscribeFocusText(setFocusText);
    }, [followFocus, subscribeFocusText]);

    const source = followFocus && focusText ? focusText : sentence;
    const cleanedSentence = typeof source === 'string' ? source.trim() : '';
    const [state, setState] = useState({ status: 'idle', text: '' });
    const [retryToken, setRetryToken] = useState(0);
    const scrollRef = useRef(null);
    // A new translation fades in over the old one rather than cutting to it.
    const textFade = useRef(new Animated.Value(1)).current;

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

    const statusText = state.status === 'loading'
        ? t('read.pinnedTranslationLoading')
        : state.status === 'error'
            ? t('read.pinnedTranslationError')
            : t('read.pinnedTranslationPlaceholder');
    const hasTranslation = state.status === 'ok' && Boolean(state.text);
    // Each half of the handle turns about the middle: down at the outer ends
    // for ⌃, up for ⌄.
    const leftTurn = gripTilt
        ? gripTilt.interpolate({ inputRange: [-1, 1], outputRange: ['-20deg', '20deg'] })
        : '0deg';
    const rightTurn = gripTilt
        ? gripTilt.interpolate({ inputRange: [-1, 1], outputRange: ['20deg', '-20deg'] })
        : '0deg';
    return (
        <View style={[styles.wrap, { paddingTop: topInset }]}>
            <Animated.View style={[styles.bar, { height: heightAnim }]} accessibilityLiveRegion="polite">
                <ScrollView
                    ref={scrollRef}
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                >
                    <Animated.View style={{ opacity: textFade }}>
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
                    </Animated.View>
                </ScrollView>
            </Animated.View>
            {/* The divide between the translation and the book: drag to show
                0–4 lines, tap to fold away or bring back. */}
            <View style={styles.grip} {...gripHandlers} {...gripAccessibility}>
                <View style={styles.gripLine} />
                <View style={styles.gripHandle}>
                    <Animated.View style={[styles.gripHalf, styles.gripHalfLeft, { transform: [{ rotate: leftTurn }] }]} />
                    <Animated.View style={[styles.gripHalf, styles.gripHalfRight, { transform: [{ rotate: rightTurn }] }]} />
                </View>
                <View style={styles.gripLine} />
            </View>
        </View>
    );
};

const createStyles = (colors, fontSize) => {
    const lineHeight = pinnedTranslationLineHeight(fontSize);
    return StyleSheet.create({
        wrap: {
            backgroundColor: colors.readerPaper,
        },
        // Full width, on the page's own paper. The padding is the scroll
        // content's, so the bar can fold all the way to nothing.
        bar: {
            overflow: 'hidden',
        },
        scroll: {
            flex: 1,
        },
        scrollContent: {
            paddingHorizontal: 24,
            paddingVertical: PINNED_TRANSLATION_PADDING_V,
        },
        // Noto Serif KR: a plain book serif (it covers Latin and Hangul alike),
        // calm next to the page without being decorative.
        translationText: {
            fontFamily: fontFamilies.krSerifRegular,
            fontSize,
            lineHeight,
            color: colors.readerBodyInk,
        },
        mutedText: {
            fontFamily: fontFamilies.sansRegular,
            fontSize: Math.max(14, fontSize - 3),
            lineHeight,
            color: colors.readerMutedInk,
        },
        retryText: {
            fontFamily: fontFamilies.sansRegular,
            color: colors.readerBodyInk,
            textDecorationLine: 'underline',
        },
        // A hairline across with a small pill in the middle: the handle.
        grip: {
            height: PINNED_TRANSLATION_GRIP_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
        },
        gripLine: {
            flex: 1,
            height: StyleSheet.hairlineWidth,
            backgroundColor: colors.readerHairline,
        },
        // Two halves meeting in the middle, so the pill can bend into a chevron.
        gripHandle: {
            width: 36,
            height: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
        },
        gripHalf: {
            width: 20,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: colors.dotInactive,
        },
        // They overlap where they meet, so the bend never opens a gap.
        gripHalfLeft: {
            marginRight: -2,
        },
        gripHalfRight: {
            marginLeft: -2,
        },
    });
};

export default memo(PinnedSentenceTranslation);
