import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../../hooks/useTranslation';
import { useAppContext } from '../../../contexts/AppContext';
import {
    normalizeBookLanguage,
    normalizeInterfaceLanguageCode,
    getInterfaceLanguageLabel,
} from '../../../constants/languages';
import { fontFamilies, spacing, useTheme } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const DICTIONARY_COMPACT_HEIGHT = 252;
const DICTIONARY_NO_ROOT_HEIGHT = 215;
const DICTIONARY_TRANSLATION_HEIGHT = 332;
const DICTIONARY_EXPANDED_MAX_HEIGHT = 548;
const DICTIONARY_EXTRA_ROW_HEIGHT = 52;
const TRANSLATION_MAX_SCROLL_HEIGHT = 150;
const TRANSLATION_PANEL_BOTTOM_PADDING = 22;

const TopSection = ({
    highlightedWord,
    sourceSentence = '',
    isNativeSelection,
    isDarkMode,
    onClose,
    onWordSave,
    onWordUnsave,
    currentBook,
    sourceBook,
    savedWords,
    translationVisualState = {},
}) => {
    const { t } = useTranslation();
    const { colors: themeColors } = useTheme();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const { interfaceLanguage, targetLanguage: activeTargetLanguage } = useAppContext();
    const [dictionaryExpandedRows, setDictionaryExpandedRows] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const [visibleWord, setVisibleWord] = useState('');
    const [translationTarget, setTranslationTarget] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isLookupExpanded, setIsLookupExpanded] = useState(false);
    const [canExpandLookup, setCanExpandLookup] = useState(false);
    const [translationStatus, setTranslationStatus] = useState({
        isLoading: false,
        hasError: false,
        hasText: false,
    });
    const copyTimeoutRef = useRef(null);
    const prevWordRef = useRef('');
    const canExpandLookupRef = useRef(false);
    const translateY = useRef(new Animated.Value(24)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const panResponder = useRef(PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => (
            canExpandLookupRef.current
            &&
            Math.abs(gestureState.dy) > 12
            && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
        ),
        onPanResponderRelease: (_, gestureState) => {
            if (!canExpandLookupRef.current) {
                return;
            }

            if (gestureState.dy < -28) {
                setIsLookupExpanded(true);
                return;
            }

            if (gestureState.dy > 28) {
                setIsLookupExpanded(false);
            }
        },
    })).current;

    useEffect(() => {
        if (highlightedWord && highlightedWord !== prevWordRef.current) {
            prevWordRef.current = highlightedWord;
            setDictionaryExpandedRows(0);
            setDictionaryContentHeight(0);
            setTranslationTarget('');
            setIsLookupExpanded(false);
            setCanExpandLookup(false);
            setTranslationStatus({ isLoading: false, hasError: false, hasText: false });
            setIsCopied(false);
        }
    }, [highlightedWord]);

    useEffect(() => {
        canExpandLookupRef.current = canExpandLookup;
        if (!canExpandLookup) {
            setIsLookupExpanded(false);
        }
    }, [canExpandLookup]);

    useEffect(() => () => {
        if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
        }
    }, []);

    useEffect(() => {
        if (highlightedWord) {
            setVisibleWord(highlightedWord);
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: 0,
                    duration: 240,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 240,
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
                duration: 180,
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

    const handleTranslationStatusChange = useCallback((nextStatus) => {
        setTranslationStatus((previousStatus) => {
            const normalizedStatus = {
                isLoading: Boolean(nextStatus?.isLoading),
                hasError: Boolean(nextStatus?.hasError),
                hasText: Boolean(nextStatus?.hasText),
            };

            if (
                previousStatus.isLoading === normalizedStatus.isLoading &&
                previousStatus.hasError === normalizedStatus.hasError &&
                previousStatus.hasText === normalizedStatus.hasText
            ) {
                return previousStatus;
            }

            return normalizedStatus;
        });
    }, []);

    if (!visibleWord) {
        return null;
    }

    const isTranslationMode = isNativeSelection;
    const panelColors = {
        background: themeColors.readerSurface,
        border: themeColors.readerBorder,
        text: themeColors.readerBodyInk,
        accent: themeColors.readerProgressFill,
        closeIcon: themeColors.readerSubtleInk,
    };

    const isDictionaryTranslationSheet = dictionaryExpandedRows === -1;
    const expandedFallbackHeight = DICTIONARY_COMPACT_HEIGHT + (Math.max(dictionaryExpandedRows, 0) * DICTIONARY_EXTRA_ROW_HEIGHT);
    const expandedContentHeight = dictionaryContentHeight > 0
        ? Math.ceil(dictionaryContentHeight)
        : expandedFallbackHeight;
    const isDictionarySheetTall = isLookupExpanded || dictionaryExpandedRows > 0;
    const dictionaryHeight = isDictionaryTranslationSheet
        ? DICTIONARY_TRANSLATION_HEIGHT
        : isDictionarySheetTall
        ? Math.min(
            DICTIONARY_EXPANDED_MAX_HEIGHT,
            Math.max(DICTIONARY_EXPANDED_MAX_HEIGHT, expandedContentHeight)
        )
        : canExpandLookup
        ? DICTIONARY_COMPACT_HEIGHT
        : DICTIONARY_NO_ROOT_HEIGHT;
    const translationText = translationTarget || visibleWord;
    const translationSourceLanguage = normalizeBookLanguage(
        sourceBook?.language ?? activeTargetLanguage ?? 'ko'
    );
    const translationTargetLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    const translationSourceLabel = getInterfaceLanguageLabel(translationSourceLanguage);
    const translationTargetLabel = getInterfaceLanguageLabel(translationTargetLanguage);
    const sheetSizeStyle = isTranslationMode
        ? styles.sheetTranslation
        : { height: dictionaryHeight };
    const forceTranslationLoading = Boolean(translationVisualState.loading);
    const forceTranslationError = Boolean(translationVisualState.error);
    const forceTranslationCopied = Boolean(translationVisualState.copied);
    const isTranslationBusy = isTranslationMode && (forceTranslationLoading || translationStatus.isLoading);
    const hasTranslationError = isTranslationMode && (forceTranslationError || translationStatus.hasError);
    const canCopyTranslation = isTranslationMode && !isTranslationBusy && !hasTranslationError;
    const isCopyConfirmed = isCopied || forceTranslationCopied;

    const handleCopy = () => {
        if (isCopied || !canCopyTranslation) {
            return;
        }
        setIsCopied(true);
        if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => {
            setIsCopied(false);
        }, 1800);
    };

    return (
        <Animated.View
            style={[
                styles.sheet,
                !isTranslationMode ? styles.sheetDictionary : styles.sheetTranslationBase,
                sheetSizeStyle,
                { paddingBottom: isTranslationMode ? TRANSLATION_PANEL_BOTTOM_PADDING : 26 },
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
                        <MaterialIcons name="translate" size={16} color={themeColors.readerSubtleInk} />
                        <Text numberOfLines={1} style={[styles.translationLangText, { color: themeColors.readerMutedInk }]}>
                            {translationSourceLabel} → {translationTargetLabel}
                        </Text>
                    </View>
                    {canCopyTranslation ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={isCopyConfirmed ? t('lookup.copied') : t('lookup.copy')}
                            activeOpacity={0.75}
                            onPress={handleCopy}
                            style={styles.copyButton}
                        >
                            {isCopyConfirmed ? (
                                <MaterialIcons name="check" size={13} color={panelColors.closeIcon} style={styles.copyIcon} />
                            ) : null}
                            <Text style={[styles.copyLabel, { color: panelColors.closeIcon }]}>
                                {isCopyConfirmed ? t('lookup.copied') : t('lookup.copy')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}

            {!isTranslationMode && canExpandLookup ? (
                <View style={styles.sheetHandleWrap} {...panResponder.panHandlers}>
                    <View style={styles.sheetHandle} />
                    {!isLookupExpanded ? (
                        <Text style={styles.sheetGestureHint}>⌃ SLIDE UP FOR ROOTS</Text>
                    ) : null}
                </View>
            ) : !isTranslationMode ? (
                <View style={styles.sheetHandleStatic}>
                    <View style={styles.sheetHandle} />
                </View>
            ) : null}

            <View style={isTranslationMode ? styles.contentTranslation : styles.content}>
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
                        onCanExpandChange={setCanExpandLookup}
                        isPanelExpanded={isLookupExpanded}
                        currentBook={currentBook}
                        sourceBook={sourceBook}
                        savedWords={savedWords}
                    />
                ) : (
                    <TranslationContent
                        key={`${translationText}-${translationSourceLanguage}-${translationTargetLanguage}-translation`}
                        highlightedWord={translationText}
                        isDarkMode={isDarkMode}
                        sourceLanguage={translationSourceLanguage}
                        targetLanguage={translationTargetLanguage}
                        compact
                        forceLoading={forceTranslationLoading}
                        forceError={forceTranslationError}
                        forceErrorMessage={translationVisualState.errorMessage}
                        forceTranslatedText={translationVisualState.translatedText}
                        maxScrollHeight={TRANSLATION_MAX_SCROLL_HEIGHT}
                        bottomPadding={spacing.sm}
                        nestedScrollEnabled
                        onStatusChange={handleTranslationStatusChange}
                    />
                )}

            </View>
        </Animated.View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    sheet: {
        marginHorizontal: 0,
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 26,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        borderBottomWidth: 0,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
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
    sheetTranslation: {},
    sheetTranslationBase: {
        marginHorizontal: 16,
        marginBottom: 16,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 12,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        borderBottomWidth: 1,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 24,
    },
    translationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    translationHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        flex: 1,
        minWidth: 0,
    },
    translationLangText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 17,
        letterSpacing: 0.8,
    },
    copyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 4,
    },
    copyIcon: {
        marginRight: 3,
    },
    copyLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 10,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },
    content: {
        marginTop: 0,
        flex: 1,
        minHeight: 0,
    },
    contentTranslation: {
        paddingHorizontal: 0,
        paddingTop: 0,
    },
    sheetHandleWrap: {
        alignItems: 'center',
        paddingTop: 12,
        marginBottom: 16,
        gap: 6,
    },
    sheetHandleStatic: {
        alignItems: 'center',
        paddingTop: 12,
        marginBottom: 16,
    },
    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.borderStrong,
    },
    sheetGestureHint: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 8,
        lineHeight: 13,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: colors.frame,
    },
    contentFill: {
        flex: 1,
        minHeight: 0,
    },
});

export default TopSection;
