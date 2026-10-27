import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
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

// Steps of the fade over the bar's bottom edge (no gradient library: stacked
// strips of the bar's color, each more opaque).
const FADE_STEPS = [0.15, 0.35, 0.55, 0.75, 0.92];

/**
 * PinnedSentenceTranslation — the translation of the last tapped word's
 * sentence, in a full-width bar under the header (and at the top of the page
 * in fullscreen). The open chapter's sentences are fetched ahead
 * (services/chapterTranslations.js), so a tap normally shows its translation
 * at once; a sentence the chapter didn't cover is fetched on the spot.
 *
 * A longer translation scrolls inside the bar; while there is more below, the
 * bottom edge fades out. The small chevron folds the bar to a thin strip and
 * opens it again (`open` / `onToggle`).
 */
const PinnedSentenceTranslation = ({
    sentence,
    sourceLanguage,
    targetLanguage,
    fontSize = PINNED_TRANSLATION_FONT_DEFAULT,
    open = true,
    onToggle,
    topInset = 0,
}) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const size = clampPinnedTranslationFontSize(fontSize);
    const styles = useMemo(() => createStyles(colors, size), [colors, size]);
    const cleanedSentence = typeof sentence === 'string' ? sentence.trim() : '';
    const [state, setState] = useState({ status: 'idle', text: '' });
    const [retryToken, setRetryToken] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [scrollY, setScrollY] = useState(0);
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
        setScrollY(0);
    }, [state.text]);

    const retry = useCallback(() => setRetryToken((value) => value + 1), []);

    const statusText = state.status === 'loading'
        ? t('read.pinnedTranslationLoading')
        : state.status === 'error'
            ? t('read.pinnedTranslationError')
            : t('read.pinnedTranslationPlaceholder');
    const hasTranslation = state.status === 'ok' && Boolean(state.text);
    // More text below what's showing: fade the bottom edge.
    const hasMoreBelow = open && contentHeight - scrollY > viewportHeight + 2;

    const chevron = (
        <TouchableOpacity
            onPress={onToggle}
            style={open ? styles.chevronOpen : styles.chevronClosed}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={open ? t('read.pinnedTranslationCollapse') : t('read.pinnedTranslationExpand')}
        >
            <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.readerSubtleInk} />
        </TouchableOpacity>
    );

    if (!open) {
        return (
            <View style={[styles.bar, { paddingTop: topInset, height: topInset + pinnedTranslationBarHeight(size, false) }]}>
                {chevron}
            </View>
        );
    }

    return (
        <View
            style={[styles.bar, { paddingTop: topInset, height: topInset + pinnedTranslationBarHeight(size, true) }]}
            accessibilityLiveRegion="polite"
        >
            <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={32}
                onScroll={(event) => setScrollY(event.nativeEvent.contentOffset.y)}
                onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
                onContentSizeChange={(_, height) => setContentHeight(height)}
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
            {hasMoreBelow ? (
                <View style={styles.fade} pointerEvents="none">
                    {FADE_STEPS.map((opacity) => (
                        <View key={opacity} style={[styles.fadeStep, { opacity }]} />
                    ))}
                </View>
            ) : null}
            {chevron}
        </View>
    );
};

const createStyles = (colors, fontSize) => {
    const lineHeight = pinnedTranslationLineHeight(fontSize);
    return StyleSheet.create({
        // Full width, square, a shade off the page, with a hairline under it.
        bar: {
            backgroundColor: colors.surfaceMuted,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.readerHairline,
        },
        scroll: {
            flex: 1,
        },
        scrollContent: {
            paddingHorizontal: 22,
            paddingRight: 40,
            paddingVertical: PINNED_TRANSLATION_PADDING_V,
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
        fade: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.round(lineHeight * 0.8),
        },
        fadeStep: {
            flex: 1,
            backgroundColor: colors.surfaceMuted,
        },
        // Open: a small chevron in the bar's bottom-right corner.
        chevronOpen: {
            position: 'absolute',
            right: 10,
            bottom: 4,
            width: 24,
            height: 20,
            alignItems: 'center',
            justifyContent: 'center',
        },
        // Folded: the chevron alone, centred in the thin strip.
        chevronClosed: {
            flex: 1,
            alignSelf: 'center',
            width: 48,
            alignItems: 'center',
            justifyContent: 'center',
        },
    });
};

export default memo(PinnedSentenceTranslation);
