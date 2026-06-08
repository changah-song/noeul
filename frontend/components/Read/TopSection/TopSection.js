import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, textStyles } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const DICTIONARY_COMPACT_HEIGHT = 124;
const DICTIONARY_EXPANDED_MAX_HEIGHT = 390;
const DICTIONARY_EXTRA_ROW_HEIGHT = 52;
const TRANSLATION_SOURCE_LANGUAGE = 'KO';
const TRANSLATION_TARGET_LANGUAGE = 'EN';

const TopSection = ({ highlightedWord, sourceSentence = '', isNativeSelection, isDarkMode, onClose, onWordSave, onWordUnsave, currentBook, sourceBook, savedWords }) => {
    const insets = useSafeAreaInsets();
    const [dictionaryExpandedRows, setDictionaryExpandedRows] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const [visibleWord, setVisibleWord] = useState('');
    const [translationTarget, setTranslationTarget] = useState('');
    const prevWordRef = useRef('');
    const translateY = useRef(new Animated.Value(24)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (highlightedWord && highlightedWord !== prevWordRef.current) {
            prevWordRef.current = highlightedWord;
            setDictionaryExpandedRows(0);
            setDictionaryContentHeight(0);
            setTranslationTarget('');
        }
    }, [highlightedWord]);

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
            accent: colors.accent,
            closeIcon: '#b6aa99',
        }
        : {
            background: colors.surfaceElevated,
            border: colors.border,
            text: colors.text,
            accent: colors.accentStrong,
            closeIcon: colors.textSubtle,
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

            <View style={styles.content}>
                {!isTranslationMode ? (
                    <DictionaryContent
                        highlightedWord={visibleWord}
                        sourceSentence={sourceSentence}
                        isDarkMode={isDarkMode}
                        onWordSave={onWordSave}
                        onWordUnsave={onWordUnsave}
                        onTranslatePress={(text) => {
                            const target = typeof text === 'string' && text.trim() ? text.trim() : visibleWord;
                            setTranslationTarget(target);
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
    content: {
        marginTop: 0,
        flex: 1,
        minHeight: 0,
    },
    contentFill: {
        flex: 1,
        minHeight: 0,
    },
});

export default TopSection;
