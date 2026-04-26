import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useAppContext } from '../../../contexts/AppContext';
import { colors, radii, spacing, textStyles } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const TopSection = ({ highlightedWord, onWordSave, onWordUnsave, currentBook, sourceBook, savedWords }) => {
    const { dictMode, setDictMode } = useAppContext();
    const [isLoading, setIsLoading] = useState(false);
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
    }, [dictMode, hasLookupCandidate, highlightedWord]);

    const handleContentLoaded = useCallback(() => {
        console.log('[TopSection] content loaded');
        setIsLoading(false);
    }, []);

    if (!visibleWord) {
        return (
            <View style={styles.hintCard}>
                <Feather name="corner-down-left" size={16} color={colors.textSubtle} />
                <Text style={styles.hintText}>Tap a word to open the lookup panel.</Text>
            </View>
        );
    }

    return (
        <Animated.View
            style={[
                styles.sheet,
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            <View style={styles.grabber} />

            <View style={styles.header}>
                <View style={styles.wordBlock}>
                    <Text numberOfLines={1} style={styles.wordLabel}>Selected Word</Text>
                    <Text numberOfLines={1} style={styles.wordValue}>{visibleWord}</Text>
                </View>

                <TouchableOpacity onPress={() => setDictMode(!dictMode)} style={styles.toggleButton}>
                    {dictMode ? (
                        <MaterialIcons name="translate" size={19} color={colors.text} />
                    ) : (
                        <Feather name="book-open" size={18} color={colors.text} />
                    )}
                </TouchableOpacity>
            </View>

            {isLoading && hasLookupCandidate ? (
                <View style={styles.loadingState}>
                    <ActivityIndicator size="small" color={colors.accentStrong} />
                    <Text style={styles.loadingText}>Looking up word…</Text>
                </View>
            ) : null}

            <View style={[styles.content, isLoading && hasLookupCandidate && styles.contentDimmed]}>
                {dictMode ? (
                    <DictionaryContent
                        highlightedWord={visibleWord}
                        onContentLoaded={handleContentLoaded}
                        onWordSave={onWordSave}
                        onWordUnsave={onWordUnsave}
                        currentBook={currentBook}
                        sourceBook={sourceBook}
                        savedWords={savedWords}
                    />
                ) : (
                    <TranslationContent
                        highlightedWord={visibleWord}
                        onContentLoaded={handleContentLoaded}
                    />
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    hintCard: {
        marginHorizontal: spacing.md,
        marginBottom: spacing.md,
        borderRadius: radii.pill,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    hintText: {
        ...textStyles.caption,
        color: colors.textSubtle,
    },
    sheet: {
        marginHorizontal: spacing.md,
        marginBottom: spacing.md,
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
        maxHeight: 220,
    },
    grabber: {
        width: 42,
        height: 4,
        borderRadius: radii.pill,
        backgroundColor: colors.surfaceStrong,
        alignSelf: 'center',
        marginBottom: spacing.sm,
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
        flexShrink: 1,
    },
    contentDimmed: {
        opacity: 0.05,
    },
});

export default TopSection;
