import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../../contexts/AppContext';
import { colors, radii, spacing, textStyles } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const TopSection = ({ highlightedWord, isNativeSelection, isDarkMode, onWordSave, onWordUnsave, currentBook, sourceBook, savedWords }) => {
    const { dictMode, setDictMode } = useAppContext();
    const insets = useSafeAreaInsets();
    const effectiveDictMode = isNativeSelection ? false : dictMode;
    const [isLoading, setIsLoading] = useState(false);
    const [isDictionaryExpanded, setIsDictionaryExpanded] = useState(false);
    const [visibleWord, setVisibleWord] = useState('');
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
            setIsDictionaryExpanded(false);

            if (!hasLookupCandidate) {
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            const timeout = setTimeout(() => {
                console.log('[TopSection] safety timeout -> forcing loading false');
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
    }, [effectiveDictMode, hasLookupCandidate, highlightedWord]);

    const handleContentLoaded = useCallback(() => {
        console.log('[TopSection] content loaded');
        setIsLoading(false);
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
            pill: '#24201c',
            spinner: '#d2b793',
        }
        : {
            background: colors.surfaceElevated,
            border: colors.border,
            text: colors.text,
            mutedText: colors.textMuted,
            pill: colors.surfaceMuted,
            spinner: colors.accentStrong,
        };

    return (
        <Animated.View
            style={[
                styles.sheet,
                isNativeSelection
                    ? styles.sheetTranslation
                    : (isDictionaryExpanded ? styles.sheetExpanded : styles.sheetCompact),
                { marginBottom: Math.max(6, insets.bottom + 10) },
                { backgroundColor: panelColors.background, borderColor: panelColors.border },
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            <View style={styles.header}>
                <View style={styles.wordBlock}>
                    <Text numberOfLines={1} style={[styles.wordLabel, { color: panelColors.mutedText }]}>
                        {isNativeSelection ? 'Translation' : 'Selected Word'}
                    </Text>
                    {!isNativeSelection ? (
                        <Text numberOfLines={1} style={[styles.wordValue, { color: panelColors.text }]}>{visibleWord}</Text>
                    ) : null}
                </View>

                {!isNativeSelection && (
                    <TouchableOpacity
                        onPress={() => setDictMode(!dictMode)}
                        style={[styles.toggleButton, { backgroundColor: panelColors.pill }]}
                    >
                        {dictMode ? (
                            <MaterialIcons name="translate" size={19} color={panelColors.text} />
                        ) : (
                            <Feather name="book-open" size={18} color={panelColors.text} />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {isLoading && hasLookupCandidate ? (
                <View style={styles.loadingState}>
                    <ActivityIndicator size="small" color={panelColors.spinner} />
                    <Text style={[styles.loadingText, { color: panelColors.mutedText }]}>
                        {isNativeSelection ? 'Translating…' : 'Looking up word…'}
                    </Text>
                </View>
            ) : null}

            <View style={[styles.content, isLoading && hasLookupCandidate && styles.contentDimmed]}>
                {effectiveDictMode ? (
                    <DictionaryContent
                        highlightedWord={visibleWord}
                        isDarkMode={isDarkMode}
                        onContentLoaded={handleContentLoaded}
                        onWordSave={onWordSave}
                        onWordUnsave={onWordUnsave}
                        onExpandedStateChange={setIsDictionaryExpanded}
                        currentBook={currentBook}
                        sourceBook={sourceBook}
                        savedWords={savedWords}
                    />
                ) : (
                    <View style={styles.contentFill}>
                        <TranslationContent
                            key={visibleWord}
                            highlightedWord={visibleWord}
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
        marginHorizontal: spacing.md,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        borderRadius: radii.xl,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 20,
        elevation: 8,
        overflow: 'hidden',
    },
    sheetCompact: {
        height: 130,
    },
    sheetExpanded: {
        height: 230,
    },
    sheetTranslation: {
        height: 180,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    wordBlock: {
        flex: 1,
        minWidth: 0,
    },
    wordLabel: {
        ...textStyles.eyebrow,
        marginBottom: 2,
    },
    wordValue: {
        ...textStyles.title,
        fontSize: 22,
    },
    toggleButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
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
        marginTop: spacing.sm,
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
