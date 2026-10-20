import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from '../../../hooks/useTranslation';
import { useAppContext } from '../../../contexts/AppContext';
import {
    normalizeBookLanguage,
    normalizeInterfaceLanguageCode,
    getInterfaceLanguageLabel,
    getLanguageLabel,
} from '../../../constants/languages';
import { fontFamilies, useTheme } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

// The word panel hugs its content; these are only ceilings. Past them the
// panel body scrolls inside DictionaryContent while the action row stays put.
const DICTIONARY_MAX_HEIGHT = 380;
// Chinese packs several readings + numbered senses inline, so it gets more room.
const DICTIONARY_ZH_MAX_HEIGHT = 430;
const DICTIONARY_EXPLAIN_MAX_HEIGHT = 470;
const DICTIONARY_EXPANDED_MAX_HEIGHT = 548;
const TRANSLATION_MAX_SCROLL_HEIGHT = 150;
const DICTIONARY_BOTTOM_PADDING = 26;
const TOP_PLACEMENT_DICTIONARY_TOP_PADDING = 22;
const TOP_PLACEMENT_DICTIONARY_BOTTOM_PADDING = 4;

const TopSection = ({
    onExtendSelection,
    highlightedWord,
    sourceSentence = '',
    isNativeSelection,
    placement = 'bottom',
    isDarkMode,
    onClose,
    onWordSave,
    onWordUnsave,
    onSavedWordsChanged,
    currentBook,
    sourceBook,
    savedWords,
    translationVisualState = {},
    // The reader has no tab bar: a bottom panel pads its own way past the
    // system gesture bar.
    bottomInset = 0,
}) => {
    const { t } = useTranslation();
    const { colors: themeColors } = useTheme();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const { interfaceLanguage, targetLanguage: activeTargetLanguage } = useAppContext();
    const [visibleWord, setVisibleWord] = useState('');
    // The mode the panel was showing, kept through the fade-out so a closing
    // translation doesn't flip to (and mount) the dictionary for its last frames.
    const [visibleIsNativeSelection, setVisibleIsNativeSelection] = useState(false);
    const [translationTarget, setTranslationTarget] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [isLookupExpanded, setIsLookupExpanded] = useState(false);
    const [isExplainMode, setIsExplainMode] = useState(false);
    const [canExpandLookup, setCanExpandLookup] = useState(false);
    const [translationStatus, setTranslationStatus] = useState({
        isLoading: false,
        hasError: false,
        hasText: false,
        translatedText: '',
    });
    const copyTimeoutRef = useRef(null);
    const prevWordRef = useRef('');
    const canExpandLookupRef = useRef(false);
    const placementRef = useRef(placement);
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

            const shouldExpand = placementRef.current === 'top'
                ? gestureState.dy > 28
                : gestureState.dy < -28;
            const shouldCollapse = placementRef.current === 'top'
                ? gestureState.dy < -28
                : gestureState.dy > 28;

            if (shouldExpand) {
                setIsLookupExpanded(true);
                return;
            }

            if (shouldCollapse) {
                setIsLookupExpanded(false);
            }
        },
    })).current;

    useEffect(() => {
        placementRef.current = placement;
    }, [placement]);

    useEffect(() => {
        if (highlightedWord && highlightedWord !== prevWordRef.current) {
            prevWordRef.current = highlightedWord;
            setTranslationTarget('');
            setIsLookupExpanded(false);
            setIsExplainMode(false);
            setCanExpandLookup(false);
            setTranslationStatus({ isLoading: false, hasError: false, hasText: false, translatedText: '' });
            setIsCopied(false);
            setIsCopying(false);
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

    useEffect(() => {
        if (highlightedWord) {
            setVisibleIsNativeSelection(Boolean(isNativeSelection));
        }
    }, [highlightedWord, isNativeSelection]);

    // Tapping a hanja character (or the grabber) opens the roots section.
    const handleRequestExpand = useCallback(() => {
        if (canExpandLookupRef.current) {
            setIsLookupExpanded(true);
        }
    }, []);

    const toggleLookupExpanded = useCallback(() => {
        if (canExpandLookupRef.current) {
            setIsLookupExpanded((previous) => !previous);
        }
    }, []);

    const handleTranslationStatusChange = useCallback((nextStatus) => {
        setTranslationStatus((previousStatus) => {
            const normalizedStatus = {
                isLoading: Boolean(nextStatus?.isLoading),
                hasError: Boolean(nextStatus?.hasError),
                hasText: Boolean(nextStatus?.hasText),
                translatedText: typeof nextStatus?.translatedText === 'string' ? nextStatus.translatedText : '',
            };

            if (
                previousStatus.isLoading === normalizedStatus.isLoading &&
                previousStatus.hasError === normalizedStatus.hasError &&
                previousStatus.hasText === normalizedStatus.hasText &&
                previousStatus.translatedText === normalizedStatus.translatedText
            ) {
                return previousStatus;
            }

            return normalizedStatus;
        });
    }, []);

    if (!visibleWord) {
        return null;
    }

    const isTranslationMode = highlightedWord ? Boolean(isNativeSelection) : visibleIsNativeSelection;
    const isTopPlacement = placement === 'top';
    const panelColors = {
        background: themeColors.readerSurface,
        border: themeColors.readerBorder,
        text: themeColors.readerBodyInk,
        accent: themeColors.readerProgressFill,
        closeIcon: themeColors.readerSubtleInk,
    };

    const dictionaryBookLanguage = normalizeBookLanguage(
        sourceBook?.language ?? activeTargetLanguage ?? 'ko'
    );
    const isChineseDictionarySheet = dictionaryBookLanguage === 'zh';
    // The panel sizes itself to its content (no fixed heights, so a one-line
    // definition never leaves blank space); each mode only sets a ceiling.
    const dictionaryMaxHeight = isExplainMode
        ? DICTIONARY_EXPLAIN_MAX_HEIGHT
        : isLookupExpanded
        ? DICTIONARY_EXPANDED_MAX_HEIGHT
        : (isChineseDictionarySheet ? DICTIONARY_ZH_MAX_HEIGHT : DICTIONARY_MAX_HEIGHT);
    const translationText = translationTarget || visibleWord;
    const translationSourceLanguage = dictionaryBookLanguage;
    const translationTargetLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    // The source is the book/target language (ko, zh) — use the target-language
    // label map, not the interface-language one, which would fall back to
    // English for any code (like 'ko') that isn't a supported UI language.
    const translationSourceLabel = getLanguageLabel(translationSourceLanguage);
    const translationTargetLabel = getInterfaceLanguageLabel(translationTargetLanguage);
    const bottomPanelInset = !isTopPlacement && !isTranslationMode ? bottomInset : 0;
    const sheetSizeStyle = isTranslationMode ? null : { maxHeight: dictionaryMaxHeight + bottomPanelInset };
    const sheetBottomPadding = isTranslationMode
        ? 14
        : (isTopPlacement ? TOP_PLACEMENT_DICTIONARY_BOTTOM_PADDING : DICTIONARY_BOTTOM_PADDING + bottomPanelInset);
    const forceTranslationLoading = Boolean(translationVisualState.loading);
    const forceTranslationError = Boolean(translationVisualState.error);
    const forceTranslationCopied = Boolean(translationVisualState.copied);
    const isTranslationBusy = isTranslationMode && (forceTranslationLoading || translationStatus.isLoading);
    const hasTranslationError = isTranslationMode && (forceTranslationError || translationStatus.hasError);
    const copyableTranslationText = translationStatus.translatedText.trim();
    const canCopyTranslation = isTranslationMode && !isTranslationBusy && !hasTranslationError && Boolean(copyableTranslationText);
    const isCopyConfirmed = isCopied || forceTranslationCopied;

    const handleCopy = async () => {
        if (isCopied || isCopying || !canCopyTranslation) {
            return;
        }

        setIsCopying(true);
        try {
            await Clipboard.setStringAsync(copyableTranslationText);
            setIsCopied(true);
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
            copyTimeoutRef.current = setTimeout(() => {
                setIsCopied(false);
            }, 1800);
        } catch (error) {
            console.warn('[TopSection] Failed to copy translation', error);
        } finally {
            setIsCopying(false);
        }
    };

    const renderGrabber = (position) => {
        const wrapStyle = position === 'bottom' ? styles.grabberWrapBottom : styles.grabberWrap;
        if (!canExpandLookup) {
            return (
                <View style={wrapStyle}>
                    <View style={styles.grabber} />
                </View>
            );
        }

        const grabberLabel = isChineseDictionarySheet
            ? t(isLookupExpanded ? 'lookup.hideCharacters' : 'lookup.showCharacters')
            : t(isLookupExpanded ? 'lookup.hideRoots' : 'lookup.showRoots');

        return (
            <View {...panResponder.panHandlers}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={grabberLabel}
                    accessibilityState={{ expanded: isLookupExpanded }}
                    activeOpacity={0.6}
                    onPress={toggleLookupExpanded}
                    style={wrapStyle}
                >
                    <View style={styles.grabber} />
                </TouchableOpacity>
            </View>
        );
    };

    const renderIconButton = ({ icon, label, onPress, disabled = false, color }) => (
        <TouchableOpacity
            key={icon}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            activeOpacity={0.6}
            disabled={disabled}
            onPress={onPress}
            hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
            style={[styles.iconButton, disabled && styles.iconButtonDisabled]}
        >
            <MaterialIcons
                name={icon}
                size={icon === 'content-copy' || icon === 'check' ? 17 : 21}
                color={color || themeColors.text}
            />
        </TouchableOpacity>
    );

    return (
        <Animated.View
            style={[
                styles.sheet,
                isTopPlacement && styles.sheetTop,
                !isTranslationMode ? styles.sheetDictionary : styles.sheetTranslationBase,
                isTopPlacement && !isTranslationMode && styles.sheetDictionaryTop,
                isTopPlacement && isTranslationMode && styles.sheetTranslationTop,
                sheetSizeStyle,
                { paddingBottom: sheetBottomPadding },
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
                        <MaterialIcons name="translate" size={16} color={themeColors.textTertiary} />
                        <Text numberOfLines={1} style={[styles.translationLangText, { color: themeColors.textTertiary }]}>
                            {translationSourceLabel} → {translationTargetLabel}
                        </Text>
                    </View>
                    {isNativeSelection && onExtendSelection ? renderIconButton({
                        icon: 'chevron-left',
                        label: t('read.addPreviousSentence'),
                        onPress: () => onExtendSelection('previous'),
                    }) : null}
                    {isNativeSelection && onExtendSelection ? renderIconButton({
                        icon: 'chevron-right',
                        label: t('read.addNextSentence'),
                        onPress: () => onExtendSelection('next'),
                    }) : null}
                    {renderIconButton({
                        icon: isCopyConfirmed ? 'check' : 'content-copy',
                        label: isCopyConfirmed ? t('lookup.copied') : t('lookup.copy'),
                        onPress: handleCopy,
                        disabled: !canCopyTranslation && !isCopyConfirmed,
                    })}
                    {onClose ? renderIconButton({
                        icon: 'close',
                        label: t('common.close'),
                        onPress: onClose,
                        color: themeColors.textMuted,
                    }) : null}
                </View>
            ) : null}

            {!isTopPlacement && !isTranslationMode ? renderGrabber('top') : null}

            <View style={isTranslationMode ? styles.contentTranslation : styles.content}>
                {!isTranslationMode ? (
                    <DictionaryContent
                        highlightedWord={visibleWord}
                        sourceSentence={sourceSentence}
                        isDarkMode={isDarkMode}
                        onWordSave={onWordSave}
                        onWordUnsave={onWordUnsave}
                        onSavedWordsChanged={onSavedWordsChanged}
                        onTranslatePress={(text) => {
                            const target = typeof text === 'string' && text.trim() ? text.trim() : visibleWord;
                            setTranslationTarget(target);
                        }}
                        onExplainModeChange={setIsExplainMode}
                        onCanExpandChange={setCanExpandLookup}
                        onRequestExpand={handleRequestExpand}
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
                        bottomPadding={0}
                        nestedScrollEnabled
                        onStatusChange={handleTranslationStatusChange}
                    />
                )}
            </View>

            {isTopPlacement && !isTranslationMode ? renderGrabber('bottom') : null}
        </Animated.View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    sheet: {
        marginHorizontal: 0,
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: DICTIONARY_BOTTOM_PADDING,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        backgroundColor: colors.surfaceElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderBottomWidth: 0,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 10,
        overflow: 'hidden',
    },
    sheetTop: {
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        borderTopWidth: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        shadowOffset: { width: 0, height: 10 },
    },
    sheetDictionary: {
        paddingHorizontal: 0,
        paddingTop: 0,
    },
    sheetDictionaryTop: {
        paddingTop: TOP_PLACEMENT_DICTIONARY_TOP_PADDING,
    },
    // The sentence translation is a floating card, not a sheet.
    sheetTranslationBase: {
        marginHorizontal: 12,
        marginBottom: 16,
        paddingHorizontal: 14,
        paddingTop: 8,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 1,
        shadowRadius: 32,
    },
    sheetTranslationTop: {
        marginTop: 8,
        marginBottom: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    translationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        marginBottom: 2,
        marginRight: -6,
    },
    translationHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
    },
    translationLangText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        flexShrink: 1,
    },
    iconButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconButtonDisabled: {
        opacity: 0.35,
    },
    // No flex: 1 here. The sheet has no fixed height, so the body hugs its
    // content and only shrinks (and scrolls) once it reaches the sheet's ceiling.
    content: {
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
    },
    contentTranslation: {
        paddingHorizontal: 0,
        paddingTop: 0,
    },
    grabberWrap: {
        height: 22,
        paddingTop: 9,
        alignItems: 'center',
    },
    grabberWrapBottom: {
        height: 22,
        paddingTop: 9,
        alignItems: 'center',
    },
    grabber: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
    },
});

export default memo(TopSection);
