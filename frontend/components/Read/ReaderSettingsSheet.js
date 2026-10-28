import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Modal,
    PanResponder,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies } from '../../theme';
import { ANNOTATION_SCOPES } from '../../services/readerAnnotations';
import {
    DEFAULT_BOOK_READER_SETTINGS,
    READER_BRIGHTNESS_MAX,
    READER_BRIGHTNESS_MIN,
    READER_FOCUS_SPAN_MAX,
    READER_FOCUS_SPAN_MIN,
    READER_FONT_SIZE_MAX,
    READER_FONT_SIZE_MIN,
    READER_LEVEL_MARK_STYLES,
    READER_READING_MODES,
    buildLegendGradient,
    clampNumber,
    stepFocusSpan,
    stepFontSize,
} from '../../services/readerSettings';
import {
    ResetLink,
    SHEET_PADDING,
    SegmentedControl,
    SegmentedTabs,
    SettingRow,
    SheetHandle,
    SheetHeader,
    Stepper,
    ToggleSwitch,
    Checkbox,
    createReaderSettingsControlStyles,
    createSheetChromeStyles,
} from './ReaderSettingsControls';

// Share of the window the sheet occupies. Fixed (not content-sized) so every
// tab opens at the same height and long tabs scroll inside the sheet.
export const SHEET_HEIGHT_RATIO = 0.68;
// Drag past this share of the sheet (or flick faster than DISMISS_VELOCITY)
// dismisses it; anything less springs back.
const DISMISS_DRAG_RATIO = 0.22;
const DISMISS_VELOCITY = 0.6;

export const SETTINGS_TABS = ['text', 'words', 'focus'];

const TAB_LABEL_KEYS = {
    text: 'read.settingsTabText',
    words: 'read.settingsTabWords',
    focus: 'read.settingsTabFocus',
};

// Line spacing is offered as three named choices (values from
// READER_LINE_SPACING_STEPS; Relaxed is the book default, Normal the song
// default). A stored value between steps shows as the nearest choice.
export const LINE_SPACING_CHOICES = [
    { value: 1.65, labelKey: 'read.lineSpacingTight' },
    { value: 1.85, labelKey: 'read.lineSpacingNormal' },
    { value: 2.05, labelKey: 'read.lineSpacingRelaxed' },
];

const nearestLineSpacingChoice = (value) => {
    const numeric = Number(value);
    const target = Number.isFinite(numeric) ? numeric : DEFAULT_BOOK_READER_SETTINGS.lineSpacing;
    return LINE_SPACING_CHOICES.reduce((best, choice) => (
        Math.abs(choice.value - target) < Math.abs(best.value - target) ? choice : best
    ), LINE_SPACING_CHOICES[0]).value;
};

const scopeOrDefault = (value, fallback) => (ANNOTATION_SCOPES.includes(value) ? value : fallback);

/**
 * ReaderSettingsSheet — the reader's settings, as a bottom sheet (slides up
 * over a dimmed page; dismissed by the backdrop, the back button, the close
 * button or a swipe down on its header). Replaces the dropdown that used to
 * hang off the ☰ button.
 *
 * Layout, top to bottom:
 *   grabber · serif title + close X (the shared sheet chrome)
 *   `actions` (surface-specific rows such as Checkpoints or Edit lyrics)
 *   segmented tabs: Text | Words | Focus
 *   scrolling tab body, each ending in a small "Reset to default"
 *
 *   Text  — font size, line spacing, brightness, page turns
 *   Words — difficulty underlines (+ threshold legend), pinyin (+ scope,
 *           Chinese only), translation under words (+ scope)
 *   Focus — move between sentences (swipe / buttons), sentences at a time
 *
 * `settings` is the raw stored object; values are clamped here with the
 * shared helpers in services/readerSettings so the sheet never shows an
 * out-of-range value. Changes leave through onSettingChange(key, value) with
 * the same keys the reader already persists. `features` hides rows a surface
 * doesn't support (the song reader has no fade / translation rows).
 */
const ReaderSettingsSheet = ({
    visible,
    onClose,
    colors,
    insets,
    title,
    language,
    settings,
    onSettingChange,
    onResetTextSettings,
    onResetWordSettings,
    onResetFocusSettings,
    actions = [],
    features = {},
    initialTab = 'text',
}) => {
    const { t } = useTranslation();
    const { height: windowHeight } = useWindowDimensions();
    const sheetHeight = Math.round(windowHeight * SHEET_HEIGHT_RATIO);
    const styles = useMemo(() => createStyles(colors, sheetHeight), [colors, sheetHeight]);
    const chrome = useMemo(() => createSheetChromeStyles(colors, insets), [colors, insets]);
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), [colors]);
    const [activeTab, setActiveTab] = useState(SETTINGS_TABS.includes(initialTab) ? initialTab : 'text');

    // A short fade as the tab body swaps, so switching tabs doesn't jump.
    const tabFade = useRef(new Animated.Value(1)).current;
    const selectTab = useCallback((tab) => {
        setActiveTab(tab);
        tabFade.setValue(0.35);
        Animated.timing(tabFade, {
            toValue: 1,
            duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [tabFade]);

    // Keep the sheet mounted through its exit animation, then unmount.
    const [mounted, setMounted] = useState(visible);
    const slideAnim = useRef(new Animated.Value(0)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const sheetHeightRef = useRef(sheetHeight);
    sheetHeightRef.current = sheetHeight;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            dragY.setValue(0);
            Animated.timing(slideAnim, {
                toValue: 1,
                duration: 280,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 200,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) {
                    setMounted(false);
                    dragY.setValue(0);
                }
            });
        }
    }, [visible, slideAnim, dragY]);

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Swipe down on the sheet's header (handle, title, actions, tabs) drags it
    // along and dismisses it past the threshold. The tab body is a ScrollView,
    // which keeps its own vertical gesture, so the two never fight.
    const panResponder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => (
            gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx) * 1.5
        ),
        onPanResponderMove: (_evt, gesture) => {
            dragY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_evt, gesture) => {
            const shouldDismiss = gesture.dy > sheetHeightRef.current * DISMISS_DRAG_RATIO
                || gesture.vy > DISMISS_VELOCITY;
            if (shouldDismiss) {
                onCloseRef.current?.();
                return;
            }
            Animated.spring(dragY, {
                toValue: 0,
                bounciness: 4,
                useNativeDriver: true,
            }).start();
        },
        onPanResponderTerminate: () => {
            Animated.spring(dragY, { toValue: 0, bounciness: 4, useNativeDriver: true }).start();
        },
    }), [dragY]);

    const underlineLegendColors = useMemo(
        () => buildLegendGradient(
            colors.readerLevelUnderlineEasy,
            colors.readerLevelUnderlineMid,
            colors.readerLevelUnderlineHard,
        ),
        [colors.readerLevelUnderlineEasy, colors.readerLevelUnderlineMid, colors.readerLevelUnderlineHard]
    );

    const handleBrightness = useCallback((value) => {
        onSettingChange(
            'brightness',
            Number(clampNumber(value, READER_BRIGHTNESS_MIN, READER_BRIGHTNESS_MAX, DEFAULT_BOOK_READER_SETTINGS.brightness).toFixed(2))
        );
    }, [onSettingChange]);

    if (!mounted) {
        return null;
    }

    const source = settings && typeof settings === 'object' ? settings : {};
    const fontSize = Math.round(clampNumber(
        source.fontSize, READER_FONT_SIZE_MIN, READER_FONT_SIZE_MAX, DEFAULT_BOOK_READER_SETTINGS.fontSize
    ));
    const lineSpacingChoice = nearestLineSpacingChoice(source.lineSpacing);
    const brightness = clampNumber(
        source.brightness, READER_BRIGHTNESS_MIN, READER_BRIGHTNESS_MAX, DEFAULT_BOOK_READER_SETTINGS.brightness
    );
    const readingMode = READER_READING_MODES.includes(source.readingMode)
        ? source.readingMode
        : DEFAULT_BOOK_READER_SETTINGS.readingMode;
    const levelMarkStyle = READER_LEVEL_MARK_STYLES.includes(source.levelMarkStyle)
        ? source.levelMarkStyle
        : DEFAULT_BOOK_READER_SETTINGS.levelMarkStyle;
    const levelMarksEnabled = levelMarkStyle !== 'off';
    const levelMarkThreshold = Number.isFinite(Number(source.levelMarkThreshold))
        ? Math.min(1, Math.max(0, Number(source.levelMarkThreshold)))
        : 0;
    const pinyinOn = Boolean(source.pinyinAnnotations);
    const glossOn = Boolean(source.glossAnnotations);
    const hideSavedOn = source.hideSavedAnnotations !== false;
    const pinnedTranslationOn = source.pinnedSentenceTranslation !== false;
    // Settings saved before the scopes were split carried one `annotationScope`.
    const legacyScope = scopeOrDefault(source.annotationScope, null);
    const pinyinScope = scopeOrDefault(source.pinyinScope, legacyScope || 'underlined');
    const glossScope = scopeOrDefault(source.glossScope, legacyScope || 'underlined');
    const focusSpan = Math.round(clampNumber(
        source.focusSpan, READER_FOCUS_SPAN_MIN, READER_FOCUS_SPAN_MAX, DEFAULT_BOOK_READER_SETTINGS.focusSpan
    ));
    const focusSwipe = !!source.focusSwipe;

    const showGloss = features.glossAnnotations !== false;
    const showScopes = features.annotationScope !== false;
    const showPinyin = language === 'zh' && features.pinyinAnnotations !== false;
    const showPinnedTranslation = features.pinnedSentenceTranslation !== false;
    const showHideSaved = features.hideSavedAnnotations !== false
        && ((showPinyin && pinyinOn) || (showGloss && glossOn));

    const scopeOptions = ANNOTATION_SCOPES.map((value) => ({
        value,
        label: value === 'all' ? t('read.annotationScopeAll') : t('read.annotationScopeUnderlined'),
    }));

    const sheetTranslateY = Animated.add(
        slideAnim.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }),
        dragY,
    );

    const renderTextTab = () => (
        <>
            <SettingRow styles={controlStyles} label={t('read.fontSize')}>
                <Stepper
                    styles={controlStyles}
                    colors={colors}
                    value={fontSize}
                    onStep={(direction) => onSettingChange('fontSize', stepFontSize(fontSize, direction))}
                    atMin={fontSize <= READER_FONT_SIZE_MIN}
                    atMax={fontSize >= READER_FONT_SIZE_MAX}
                    decreaseLabel={t('read.decreaseFontSize')}
                    increaseLabel={t('read.increaseFontSize')}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.lineSpacing')}>
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={lineSpacingChoice}
                    onChange={(value) => onSettingChange('lineSpacing', value)}
                    accessibilityLabel={t('read.lineSpacing')}
                    options={LINE_SPACING_CHOICES.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.brightness')}>
                <Slider
                    style={styles.brightnessSlider}
                    value={brightness}
                    onValueChange={handleBrightness}
                    minimumValue={READER_BRIGHTNESS_MIN}
                    maximumValue={READER_BRIGHTNESS_MAX}
                    step={0.01}
                    allowTouchTrack
                    thumbTintColor={colors.inkSlate}
                    minimumTrackTintColor={colors.inkSlate}
                    maximumTrackTintColor={colors.border}
                    trackStyle={styles.sliderTrack}
                    thumbStyle={styles.sliderThumb}
                    accessibilityLabel={t('read.readerBrightness')}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.settingsPageTurns')} last>
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={readingMode}
                    onChange={(value) => onSettingChange('readingMode', value)}
                    accessibilityLabel={t('read.settingsPageTurns')}
                    options={[
                        { value: 'paged', label: t('read.readingHorizontal') },
                        { value: 'scroll', label: t('read.readingVertical') },
                    ]}
                />
            </SettingRow>
            <ResetLink styles={controlStyles} label={t('read.resetSection')} onPress={onResetTextSettings} />
        </>
    );

    // The gradient doubles as a slider: the thumb's position is the easiest
    // shade still marked, so pushing it towards red keeps only harder words.
    const legend = levelMarksEnabled ? (
        <View style={styles.legend}>
            <View style={styles.legendTrack}>
                <View style={styles.legendSwatches}>
                    {underlineLegendColors.map((color, index) => (
                        <View key={index} style={[styles.legendSwatch, { backgroundColor: color }]} />
                    ))}
                </View>
                <Slider
                    style={styles.legendSlider}
                    value={levelMarkThreshold}
                    onSlidingComplete={(value) => onSettingChange('levelMarkThreshold', Math.round(value * 20) / 20)}
                    minimumValue={0}
                    maximumValue={1}
                    step={0.05}
                    allowTouchTrack
                    thumbTintColor={colors.surface}
                    minimumTrackTintColor="transparent"
                    maximumTrackTintColor="transparent"
                    trackStyle={styles.legendSliderTrack}
                    thumbStyle={styles.legendSliderThumb}
                    accessibilityLabel={t('read.settingsDifficultyUnderlines')}
                />
            </View>
            <View style={styles.legendLabels}>
                <Text style={styles.legendLabel}>{t('read.settingsUnderlineNearly')}</Text>
                <Text style={[styles.legendLabel, styles.legendLabelEnd]}>{t('read.settingsUnderlineHard')}</Text>
            </View>
            <Text style={styles.legendHint}>{t('read.wordHighlightingHint')} {t('read.underlineThresholdHint')}</Text>
        </View>
    ) : null;

    const renderWordsTab = () => {
        // Row descriptors first, so the last one can drop its hairline and the
        // reset link sits clean underneath.
        const rows = [{
            key: 'marks',
            label: t('read.settingsDifficultyUnderlines'),
            below: legend,
            control: (
                <ToggleSwitch
                    styles={controlStyles}
                    colors={colors}
                    value={levelMarksEnabled}
                    onChange={(value) => onSettingChange('levelMarkStyle', value ? 'underline' : 'off')}
                    accessibilityLabel={t('read.settingsDifficultyUnderlines')}
                />
            ),
        }];
        if (showPinyin) {
            rows.push({
                key: 'pinyin',
                label: t('read.pinyinAnnotations'),
                control: (
                    <ToggleSwitch
                        styles={controlStyles}
                        colors={colors}
                        value={pinyinOn}
                        onChange={(value) => onSettingChange('pinyinAnnotations', value)}
                        accessibilityLabel={t('read.pinyinAnnotations')}
                    />
                ),
            });
            if (showScopes && pinyinOn) {
                rows.push({
                    key: 'pinyinScope',
                    label: t('read.annotationScope'),
                    indent: true,
                    control: (
                        <SegmentedControl
                            styles={controlStyles}
                            colors={colors}
                            value={pinyinScope}
                            onChange={(value) => onSettingChange('pinyinScope', value)}
                            accessibilityLabel={`${t('read.pinyinAnnotations')} · ${t('read.annotationScope')}`}
                            options={scopeOptions}
                        />
                    ),
                });
            }
        }
        if (showGloss) {
            rows.push({
                key: 'gloss',
                label: t('read.glossAnnotations'),
                control: (
                    <ToggleSwitch
                        styles={controlStyles}
                        colors={colors}
                        value={glossOn}
                        onChange={(value) => onSettingChange('glossAnnotations', value)}
                        accessibilityLabel={t('read.glossAnnotations')}
                    />
                ),
            });
            if (showScopes && glossOn) {
                rows.push({
                    key: 'glossScope',
                    label: t('read.annotationScope'),
                    indent: true,
                    control: (
                        <SegmentedControl
                            styles={controlStyles}
                            colors={colors}
                            value={glossScope}
                            onChange={(value) => onSettingChange('glossScope', value)}
                            accessibilityLabel={`${t('read.glossAnnotations')} · ${t('read.annotationScope')}`}
                            options={scopeOptions}
                        />
                    ),
                });
            }
        }
        if (showHideSaved) {
            rows.push({
                key: 'hideSaved',
                label: t('read.hideSavedAnnotations'),
                below: <Text style={styles.legendHint}>{t('read.hideSavedAnnotationsHint')}</Text>,
                control: (
                    <Checkbox
                        styles={controlStyles}
                        colors={colors}
                        value={hideSavedOn}
                        onChange={(value) => onSettingChange('hideSavedAnnotations', value)}
                        accessibilityLabel={t('read.hideSavedAnnotations')}
                    />
                ),
            });
        }
        if (showPinnedTranslation) {
            rows.push({
                key: 'pinnedTranslation',
                label: t('read.pinnedTranslation'),
                below: <Text style={styles.legendHint}>{t('read.pinnedTranslationHint')}</Text>,
                control: (
                    <ToggleSwitch
                        styles={controlStyles}
                        colors={colors}
                        value={pinnedTranslationOn}
                        onChange={(value) => onSettingChange('pinnedSentenceTranslation', value)}
                        accessibilityLabel={t('read.pinnedTranslation')}
                    />
                ),
            });
        }
        return (
            <>
                {rows.map((row, index) => (
                    <SettingRow
                        key={row.key}
                        styles={controlStyles}
                        label={row.label}
                        indent={row.indent}
                        below={row.below}
                        last={index === rows.length - 1}
                    >
                        {row.control}
                    </SettingRow>
                ))}
                <ResetLink styles={controlStyles} label={t('read.resetSection')} onPress={onResetWordSettings} />
            </>
        );
    };

    const renderFocusTab = () => (
        <>
            <SettingRow styles={controlStyles} label={t('read.settingsMoveBetweenSentences')}>
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={focusSwipe ? 'swipe' : 'buttons'}
                    onChange={(value) => onSettingChange('focusSwipe', value === 'swipe')}
                    accessibilityLabel={t('read.settingsMoveBetweenSentences')}
                    options={[
                        { value: 'swipe', label: t('read.focusNavSwipe') },
                        { value: 'buttons', label: t('read.focusNavButtons') },
                    ]}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.settingsSentencesAtATime')} last>
                <Stepper
                    styles={controlStyles}
                    colors={colors}
                    value={focusSpan}
                    onStep={(direction) => onSettingChange('focusSpan', stepFocusSpan(focusSpan, direction))}
                    atMin={focusSpan <= READER_FOCUS_SPAN_MIN}
                    atMax={focusSpan >= READER_FOCUS_SPAN_MAX}
                    decreaseLabel={t('read.decreaseFocusSpan')}
                    increaseLabel={t('read.increaseFocusSpan')}
                />
            </SettingRow>
            <ResetLink styles={controlStyles} label={t('read.resetSection')} onPress={onResetFocusSettings} />
        </>
    );

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.overlay}>
                <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: slideAnim }]} />
                <Pressable
                    style={styles.backdrop}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                />
                <Animated.View style={[chrome.sheet, styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
                    <View {...panResponder.panHandlers}>
                        <SheetHandle styles={chrome} />
                        <SheetHeader
                            styles={chrome}
                            colors={colors}
                            title={title}
                            onClose={onClose}
                            closeLabel={t('common.close')}
                        />

                        {actions.length > 0 ? (
                            <View style={styles.actions}>
                                {actions.map((action) => (
                                    <TouchableOpacity
                                        key={action.key}
                                        style={styles.actionRow}
                                        onPress={action.onPress}
                                        activeOpacity={0.7}
                                        accessibilityRole="button"
                                        accessibilityLabel={action.accessibilityLabel ?? action.label}
                                    >
                                        <View style={styles.actionLeft}>
                                            {action.icon}
                                            <Text
                                                style={[styles.actionLabel, action.destructive && styles.actionLabelDanger]}
                                                numberOfLines={1}
                                            >
                                                {action.label}
                                            </Text>
                                        </View>
                                        {action.destructive ? null : (
                                            <Feather name="chevron-right" size={18} color={colors.textSubtle} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        ) : null}

                        <SegmentedTabs
                            styles={controlStyles}
                            style={styles.tabs}
                            value={activeTab}
                            onChange={selectTab}
                            options={SETTINGS_TABS.map((tab) => ({
                                value: tab,
                                label: t(TAB_LABEL_KEYS[tab]),
                                testID: `reader-settings-tab-${tab}`,
                            }))}
                        />
                    </View>

                    <Animated.ScrollView
                        style={[styles.body, { opacity: tabFade }]}
                        contentContainerStyle={styles.bodyContent}
                        showsVerticalScrollIndicator
                        bounces={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {activeTab === 'text' ? renderTextTab() : null}
                        {activeTab === 'words' ? renderWordsTab() : null}
                        {activeTab === 'focus' ? renderFocusTab() : null}
                    </Animated.ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors, sheetHeight = 520) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    sheet: {
        height: sheetHeight,
    },
    actions: {
        marginTop: 4,
        paddingHorizontal: SHEET_PADDING,
    },
    actionRow: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    actionLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    actionLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    actionLabelDanger: {
        color: colors.danger,
    },
    tabs: {
        marginTop: 12,
        marginHorizontal: SHEET_PADDING,
    },
    body: {
        flex: 1,
    },
    bodyContent: {
        paddingHorizontal: SHEET_PADDING,
        paddingTop: 6,
        paddingBottom: SHEET_PADDING,
    },
    brightnessSlider: {
        width: 150,
        height: 36,
    },
    sliderTrack: {
        height: 4,
        borderRadius: 2,
    },
    sliderThumb: {
        width: 20,
        height: 20,
        borderRadius: 10,
    },
    legend: {
        paddingBottom: 14,
        gap: 6,
    },
    legendTrack: {
        justifyContent: 'center',
        height: 32,
    },
    legendSlider: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 32,
    },
    legendSliderTrack: {
        height: 6,
        borderRadius: 3,
    },
    legendSliderThumb: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: colors.inkSlate,
        shadowColor: 'rgba(27, 28, 28, 0.25)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 4,
        elevation: 3,
    },
    legendSwatches: {
        flexDirection: 'row',
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
    },
    legendSwatch: {
        flex: 1,
        height: '100%',
    },
    legendLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    legendLabel: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textTertiary,
    },
    legendLabelEnd: {
        textAlign: 'right',
    },
    legendHint: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 17,
        color: colors.textTertiary,
    },
});

export default ReaderSettingsSheet;
