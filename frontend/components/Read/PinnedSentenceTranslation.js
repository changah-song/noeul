import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { chapterTranslations } from '../../services/chapterTranslations';
import { normalizeSentence } from '../../services/sentenceSplit';
import { fontFamilies, lineHeights, spacing, typeScale, useTheme } from '../../theme';

// Height the bar reserves under the header. It is part of the reader's layout,
// so it never changes: any change would re-paginate the chapter. Collapsed, the
// bar is a pill inside this strip; expanded, a card drops over the top of the
// page from it (an overlay, so the text never moves).
export const PINNED_TRANSLATION_BAR_HEIGHT = 40;
// The expanded card's text area scrolls past this.
const CARD_MAX_TEXT_HEIGHT = 168;

/**
 * PinnedSentenceTranslation — the translation of the last tapped word's
 * sentence, under the header. The open chapter's sentences are fetched ahead
 * (services/chapterTranslations.js), so a tap normally shows its translation
 * at once; a sentence the chapter didn't cover is fetched on the spot.
 *
 * Collapsed: a pill with a one-line preview. Expanded: a card with the source
 * sentence and the full translation. `onExpandedChange` persists the choice;
 * `onCardHeightChange` reports how far the card reaches below the strip so the
 * lookup panel and focus pill can sit under it.
 */
const PinnedSentenceTranslation = ({
    sentence,
    sourceLanguage,
    targetLanguage,
    expanded = true,
    onExpandedChange,
    onCardHeightChange,
}) => {
    const { t } = useTranslation();
    const { colors, isDarkMode: isDark } = useTheme();
    const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
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

    useEffect(() => {
        if (!expanded) onCardHeightChange?.(0);
    }, [expanded, onCardHeightChange]);

    const retry = useCallback(() => setRetryToken((value) => value + 1), []);
    const toggle = useCallback(() => onExpandedChange?.(!expanded), [expanded, onExpandedChange]);

    const statusText = state.status === 'loading'
        ? t('read.pinnedTranslationLoading')
        : state.status === 'error'
            ? t('read.pinnedTranslationError')
            : t('read.pinnedTranslationPlaceholder');
    const hasTranslation = state.status === 'ok' && Boolean(state.text);

    const renderChevron = (name) => (
        <Feather name={name} size={18} color={colors.readerSubtleInk} />
    );

    return (
        <View style={styles.strip} pointerEvents="box-none">
            {expanded ? (
                <View
                    style={styles.card}
                    onLayout={(event) => onCardHeightChange?.(Math.ceil(event.nativeEvent.layout.height))}
                    accessibilityLiveRegion="polite"
                >
                    <View style={styles.cardHeader}>
                        <MaterialIcons name="translate" size={16} color={colors.readerSubtleInk} />
                        <Text style={styles.cardLabel} numberOfLines={1}>{t('read.pinnedTranslation')}</Text>
                        <TouchableOpacity
                            onPress={toggle}
                            style={styles.chevronButton}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('read.pinnedTranslationCollapse')}
                        >
                            {renderChevron('chevron-up')}
                        </TouchableOpacity>
                    </View>
                    <ScrollView
                        ref={scrollRef}
                        style={styles.cardScroll}
                        contentContainerStyle={styles.cardScrollContent}
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
                        {/* The sentence it translates, under the translation: it is
                            on the page too, so it comes second. */}
                        {cleanedSentence ? (
                            <Text style={styles.sourceText} selectable>{normalizeSentence(cleanedSentence)}</Text>
                        ) : null}
                    </ScrollView>
                </View>
            ) : (
                <TouchableOpacity
                    style={styles.pill}
                    onPress={toggle}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t('read.pinnedTranslationExpand')}
                >
                    <MaterialIcons name="translate" size={15} color={colors.readerSubtleInk} />
                    <Text
                        style={hasTranslation ? styles.pillText : styles.pillMutedText}
                        numberOfLines={1}
                    >
                        {hasTranslation ? state.text : statusText}
                    </Text>
                    {renderChevron('chevron-down')}
                </TouchableOpacity>
            )}
        </View>
    );
};

const createStyles = (colors, isDark) => StyleSheet.create({
    // The reserved strip: its height is fixed; the card overflows it.
    strip: {
        height: PINNED_TRANSLATION_BAR_HEIGHT,
        paddingHorizontal: 12,
        justifyContent: 'center',
        backgroundColor: colors.readerPaper,
        zIndex: 20,
        elevation: 20,
    },
    pill: {
        height: 32,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: 12,
        backgroundColor: colors.surfaceMuted,
    },
    pillText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: typeScale.bodySm,
        color: colors.readerBodyInk,
    },
    pillMutedText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: typeScale.bodySm,
        color: colors.readerMutedInk,
    },
    card: {
        position: 'absolute',
        top: 4,
        left: 12,
        right: 12,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.readerHairline,
        shadowColor: '#000',
        shadowOpacity: isDark ? 0.4 : 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: 6,
    },
    cardLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        color: colors.readerSubtleInk,
    },
    chevronButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardScroll: {
        maxHeight: CARD_MAX_TEXT_HEIGHT,
    },
    cardScrollContent: {
        gap: 6,
    },
    sourceText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: typeScale.bodySm,
        lineHeight: lineHeights.bodySm,
        color: colors.readerMutedInk,
    },
    translationText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 17,
        lineHeight: 25,
        color: colors.readerBodyInk,
    },
    mutedText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: typeScale.bodySm,
        lineHeight: lineHeights.bodySm,
        color: colors.readerMutedInk,
    },
    retryText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: typeScale.bodySm,
        color: colors.readerBodyInk,
        textDecorationLine: 'underline',
    },
});

export default memo(PinnedSentenceTranslation);
