import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, textStyles } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const DICTIONARY_COMPACT_HEIGHT = 124;
const DICTIONARY_EXPANDED_MAX_HEIGHT = 390;
const DICTIONARY_EXTRA_ROW_HEIGHT = 52;
const TRANSLATION_SOURCE_LANGUAGE = 'KO';
const TRANSLATION_TARGET_LANGUAGE = 'EN';

const TopSection = ({ highlightedWord, sourceSentence = '', isNativeSelection, isDarkMode, onClose, onWordSave, onWordUnsave, currentBook, sourceBook, savedWords }) => {
    const insets = useSafeAreaInsets();
    const [isLoading, setIsLoading] = useState(false);
    const [dictionaryExpandedRows, setDictionaryExpandedRows] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const [visibleWord, setVisibleWord] = useState('');
    const [translationTarget, setTranslationTarget] = useState('');
    const prevWordRef = useRef('');
    const translateY = useRef(new Animated.Value(24)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    const hasLookupCandidate = useMemo(
        () => /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(highlightedWord || ''),
        [highlightedWord]
    );

    useEffect(() => {
        if (highlightedWord && highlightedWord !== prevWordRef.current) {
            prevWordRef.current = highlightedWord;
            setDictionaryExpandedRows(0);
            setDictionaryContentHeight(0);
            setTranslationTarget('');

            if (!hasLookupCandidate) {
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            const timeout = setTimeout(() => {
                setIsLoading(false);
            }, 5000);

            return () => clearTimeout(timeout);
        }
    }, [hasLookupCandidate, highlightedWord]);

    useEffect(() => {
        if (highlightedWord) {
            setVisibleWord(highlightedWord);
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: 0,
                    duration: 220,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 180,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
            ]).start();
            return;
        }

        prevWordRef.current = '';
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: 24,
                duration: 180,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0,
                duration: 140,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
            }),
        ]).start(({ finished }) => {
            if (finished) {
                setVisibleWord('');
            }
        });
    }, [highlightedWord, opacity, translateY]);

    useEffect(() => {
        if (highlightedWord && hasLookupCandidate) {
            setIsLoading(true);
        }
    }, [hasLookupCandidate, highlightedWord, isNativeSelection]);

    const handleContentLoaded = useCallback(() => {
        setIsLoading(false);
    }, []);

    const handleDictionaryExpandedStateChange = useCallback((rowCount) => {
        const nextRowCount = Number.isFinite(rowCount) ? rowCount : 0;
        setDictionaryExpandedRows((previousRowCount) => {
            if (previousRowCount !== nextRowCount) {
                setDictionaryContentHeight(0);
            }

            return nextRowCount;
        });
    }, []);

    if (!visibleWord) {
        return null;
    }

    const panelColors = isDarkMode
        ? {
            background: '#171513',
            border: 'rgba(239, 230, 214, 0.18)',
            text: '#f3ede3',
            mutedText: '#b6aa99',
            accent: colors.accent,
            closeIcon: '#b6aa99',
            spinner: '#d2b793',
        }
        : {
            background: colors.surfaceElevated,
            border: colors.border,
            text: colors.text,
            mutedText: colors.textMuted,
            accent: colors.accentStrong,
            closeIcon: colors.textSubtle,
            spinner: colors.accentStrong,
        };

    const expandedFallbackHeight = DICTIONARY_COMPACT_HEIGHT + (dictionaryExpandedRows * DICTIONARY_EXTRA_ROW_HEIGHT);
    const expandedContentHeight = dictionaryContentHeight > 0
        ? Math.ceil(dictionaryContentHeight)
        : expandedFallbackHeight;
    const dictionaryHeight = dictionaryExpandedRows > 0
        ? Math.min(
            DICTIONARY_EXPANDED_MAX_HEIGHT,
            Math.max(DICTIONARY_COMPACT_HEIGHT, expandedContentHeight)
        )
        : DICTIONARY_COMPACT_HEIGHT;
    const isTranslationMode = isNativeSelection || !!translationTarget;
    const translationText = translationTarget || visibleWord;
    const sheetSizeStyle = isTranslationMode
        ? styles.sheetTranslation
        : { height: dictionaryHeight };
    const closeTranslation = () => {
        if (translationTarget) {
            setTranslationTarget('');
            setIsLoading(false);
            return;
        }

        onClose?.();
    };

    return (
        <Animated.View
            style={[
                styles.sheet,
                !isTranslationMode && styles.sheetDictionary,
                sheetSizeStyle,
                { marginBottom: Math.max(6, insets.bottom + 10) },
                { backgroundColor: panelColors.background, borderColor: panelColors.border },
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            {isTranslationMode ? (
                <View style={styles.translationHeader}>
                    <View style={styles.translationHeaderLeft}>
                        <MaterialIcons name="translate" size={18} color={panelColors.accent} />
                        <Text numberOfLines={1} style={[styles.translationHeaderText, { color: panelColors.accent }]}>
                            {`TRANSLATION · ${TRANSLATION_SOURCE_LANGUAGE} → ${TRANSLATION_TARGET_LANGUAGE}`}
                        </Text>
                    </View>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Close translation"
                        activeOpacity={0.75}
                        onPress={closeTranslation}
                        style={styles.translationCloseButton}
                    >
                        <MaterialIcons name="close" size={22} color={panelColors.closeIcon} />
                    </TouchableOpacity>
                </View>
            ) : null}

            {isNativeSelection && isLoading && hasLookupCandidate ? (
                <View style={styles.loadingState}>
                    <ActivityIndicator size="small" color={panelColors.spinner} />
                    <Text style={[styles.loadingText, { color: panelColors.mutedText }]}>
                        {isNativeSelection ? 'Translating…' : 'Looking up word…'}
                    </Text>
                </View>
            ) : null}

            <View style={[styles.content, isNativeSelection && isLoading && hasLookupCandidate && styles.contentDimmed]}>
                {!isTranslationMode ? (
                    <DictionaryContent
                        highlightedWord={visibleWord}
                        sourceSentence={sourceSentence}
                        isDarkMode={isDarkMode}
                        onContentLoaded={handleContentLoaded}
                        onWordSave={onWordSave}
                        onWordUnsave={onWordUnsave}
                        onTranslatePress={(text) => {
                            const target = typeof text === 'string' && text.trim() ? text.trim() : visibleWord;
                            setTranslationTarget(target);
                            setIsLoading(true);
                        }}
                        onExpandedStateChange={handleDictionaryExpandedStateChange}
                        onContentHeightChange={setDictionaryContentHeight}
                        currentBook={currentBook}
                        sourceBook={sourceBook}
                        savedWords={savedWords}
                    />
                ) : (
                    <View style={styles.contentFill}>
                        <TranslationContent
                            key={`${translationText}-translation`}
                            highlightedWord={translationText}
                            isDarkMode={isDarkMode}
                            onContentLoaded={handleContentLoaded}
                        />
                    </View>
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    sheet: {
        marginHorizontal: spacing.lg,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        borderRadius: 18,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: 'rgba(45, 37, 27, 0.20)',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 10,
        overflow: 'hidden',
    },
    sheetDictionary: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    sheetCompact: {
        height: DICTIONARY_COMPACT_HEIGHT,
    },
    sheetExpanded: {
        height: DICTIONARY_EXPANDED_MAX_HEIGHT,
    },
    sheetTranslation: {
        height: 180,
    },
    translationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        marginBottom: spacing.xs,
    },
    translationHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        flex: 1,
        minWidth: 0,
    },
    translationHeaderText: {
        ...textStyles.eyebrow,
        letterSpacing: 2.2,
    },
    translationCloseButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
    },
    loadingState: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.sm,
        marginBottom: spacing.xs,
    },
    loadingText: {
        ...textStyles.caption,
        color: colors.textMuted,
    },
    content: {
        marginTop: 0,
        flex: 1,
        minHeight: 0,
    },
    contentFill: {
        flex: 1,
        minHeight: 0,
    },
    contentDimmed: {
        opacity: 0.35,
    },
});

export default TopSection;
