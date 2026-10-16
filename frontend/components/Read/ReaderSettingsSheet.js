import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Modal,
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing } from '../../theme';
import { ANNOTATION_SCOPES } from '../../services/readerAnnotations';
import {
    DEFAULT_BOOK_READER_SETTINGS,
    READER_BRIGHTNESS_MAX,
    READER_BRIGHTNESS_MIN,
    READER_FOCUS_SPAN_MAX,
    READER_FOCUS_SPAN_MIN,
    READER_FONT_SIZE_MAX,
    READER_FONT_SIZE_MIN,
    READER_LEVEL_MARK_OPTIONS,
    READER_LEVEL_MARK_STYLES,
    READER_LINE_SPACING_STEPS,
    READER_READING_MODES,
    buildLegendGradient,
    clampNumber,
    nearestLineSpacingIndex,
    stepFocusSpan,
    stepFontSize,
    stepLineSpacing,
} from '../../services/readerSettings';
import {
    ResetLink,
    SegmentedControl,
    SettingRow,
    Stepper,
    ToggleSwitch,
    createReaderSettingsControlStyles,
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

const scopeOrDefault = (value, fallback) => (ANNOTATION_SCOPES.includes(value) ? value : fallback);

/**
 * ReaderSettingsSheet — the reader's settings, as a bottom sheet (slides up
 * over a dimmed page; dismissed by the backdrop, the back button, the close
 * button or a swipe down on its header). Replaces the dropdown that used to
 * hang off the ☰ button.
 *
 * Layout, top to bottom:
 *   drag handle · title + close
 *   `actions` (surface-specific rows such as Checkpoints or Edit lyrics)
 *   tab strip: Text | Words | Focus
 *   scrolling tab body, each ending in a small "Reset to default"
 *
 *   Text  — font size, line spacing, brightness, reading direction
 *   Words — vocabulary marks (+ legend), fade read marks, pinyin (+ scope,
 *           Chinese only), translation under words (+ scope)
 *   Focus — navigate (swipe / buttons), focus span
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
    const styles = useMemo(() => createStyles(colors, insets, sheetHeight), [colors, insets, sheetHeight]);
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), [colors]);
    const [activeTab, setActiveTab] = useState(SETTINGS_TABS.includes(initialTab) ? initialTab : 'text');

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
    const lineSpacingStep = READER_LINE_SPACING_STEPS[nearestLineSpacingIndex(source.lineSpacing)];
    const lineSpacingIndex = nearestLineSpacingIndex(source.lineSpacing);
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
    const fadeReadMarks = source.fadeReadMarks !== false;
    const levelMarkThreshold = Number.isFinite(Number(source.levelMarkThreshold))
        ? Math.min(1, Math.max(0, Number(source.levelMarkThreshold)))
        : 0;
    const pinyinOn = Boolean(source.pinyinAnnotations);
    const glossOn = Boolean(source.glossAnnotations);
    // Settings saved before the scopes were split carried one `annotationScope`.
    const legacyScope = scopeOrDefault(source.annotationScope, null);
    const pinyinScope = scopeOrDefault(source.pinyinScope, legacyScope || 'underlined');
    const glossScope = scopeOrDefault(source.glossScope, legacyScope || 'underlined');
    const focusSpan = Math.round(clampNumber(
        source.focusSpan, READER_FOCUS_SPAN_MIN, READER_FOCUS_SPAN_MAX, DEFAULT_BOOK_READER_SETTINGS.focusSpan
    ));
    const focusSwipe = !!source.focusSwipe;

    const showFade = features.fadeReadMarks !== false;
    const showGloss = features.glossAnnotations !== false;
    const showScopes = features.annotationScope !== false;
    const showPinyin = language === 'zh' && features.pinyinAnnotations !== false;

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
                <Stepper
                    styles={controlStyles}
                    colors={colors}
                    value={t(lineSpacingStep.labelKey)}
                    valueStyle={controlStyles.stepperValueSmall}
                    onStep={(direction) => onSettingChange('lineSpacing', stepLineSpacing(source.lineSpacing, direction))}
                    atMin={lineSpacingIndex <= 0}
                    atMax={lineSpacingIndex >= READER_LINE_SPACING_STEPS.length - 1}
                    decreaseLabel={t('read.decreaseLineSpacing')}
                    increaseLabel={t('read.increaseLineSpacing')}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.brightness')}>
                <View style={styles.brightnessGroup}>
                    <MaterialIcons name="light-mode" size={17} color={colors.readerSubtleInk} />
                    <Slider
                        style={styles.brightnessSlider}
                        value={brightness}
                        onValueChange={handleBrightness}
                        minimumValue={READER_BRIGHTNESS_MIN}
                        maximumValue={READER_BRIGHTNESS_MAX}
                        step={0.01}
                        allowTouchTrack
                        thumbTintColor={colors.readerProgressFill}
                        minimumTrackTintColor={colors.readerProgressFill}
                        maximumTrackTintColor={colors.readerHairline}
                        trackStyle={styles.sliderTrack}
                        thumbStyle={styles.sliderThumb}
                        accessibilityLabel={t('read.readerBrightness')}
                    />
                </View>
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.readingDirection')} last>
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={readingMode}
                    onChange={(value) => onSettingChange('readingMode', value)}
                    accessibilityLabel={t('read.readingDirection')}
                    options={[
                        { value: 'paged', icon: 'swap-horiz', label: t('read.readingHorizontal') },
                        { value: 'scroll', icon: 'swap-vert', label: t('read.readingVertical') },
                    ]}
                />
            </SettingRow>
            <ResetLink styles={controlStyles} colors={colors} label={t('read.resetSection')} onPress={onResetTextSettings} />
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
                    thumbTintColor={colors.readerPaper}
                    minimumTrackTintColor="transparent"
                    maximumTrackTintColor="transparent"
                    trackStyle={styles.legendSliderTrack}
                    thumbStyle={styles.legendSliderThumb}
                    accessibilityLabel={t('read.wordHighlighting')}
                />
            </View>
            <View style={styles.legendLabels}>
                <Text style={styles.legendLabel}>{t('read.underlineNearly')}</Text>
                <Text style={[styles.legendLabel, styles.legendLabelEnd]}>{t('read.underlineHard')}</Text>
            </View>
            <Text style={styles.legendHint}>{t('read.wordHighlightingHint')} {t('read.underlineThresholdHint')}</Text>
        </View>
    ) : null;

    const renderWordsTab = () => {
        // Row descriptors first, so the last one can drop its hairline and the
        // reset link sits clean underneath.
        const rows = [{
            key: 'marks',
            label: t('read.wordHighlighting'),
            below: legend,
            control: (
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={levelMarkStyle}
                    onChange={(value) => onSettingChange('levelMarkStyle', value)}
                    accessibilityLabel={t('read.wordHighlighting')}
                    options={READER_LEVEL_MARK_OPTIONS.map(({ value, icon, labelKey }) => ({
                        value,
                        icon,
                        label: t(labelKey),
                    }))}
                />
            ),
        }];
        if (showFade && levelMarksEnabled) {
            rows.push({
                key: 'fade',
                label: t('read.fadeReadMarks'),
                control: (
                    <ToggleSwitch
                        styles={controlStyles}
                        colors={colors}
                        value={fadeReadMarks}
                        onChange={(value) => onSettingChange('fadeReadMarks', value)}
                        accessibilityLabel={t('read.fadeReadMarks')}
                    />
                ),
            });
        }
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
                <ResetLink styles={controlStyles} colors={colors} label={t('read.resetSection')} onPress={onResetWordSettings} />
            </>
        );
    };

    const renderFocusTab = () => (
        <>
            <SettingRow styles={controlStyles} label={t('read.focusNavigate')}>
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={focusSwipe ? 'swipe' : 'buttons'}
                    onChange={(value) => onSettingChange('focusSwipe', value === 'swipe')}
                    accessibilityLabel={t('read.focusNavigate')}
                    options={[
                        { value: 'swipe', icon: 'gesture', label: t('read.focusNavSwipe') },
                        { value: 'buttons', icon: 'touch-app', label: t('read.focusNavButtons') },
                    ]}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('read.focusSpan')} last>
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
            <ResetLink styles={controlStyles} colors={colors} label={t('read.resetSection')} onPress={onResetFocusSettings} />
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
                <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
                    <View {...panResponder.panHandlers}>
                        <View style={styles.handleWrap}>
                            <View style={styles.handle} />
                        </View>
                        <View style={styles.header}>
                            <Text style={styles.title} numberOfLines={1}>{title}</Text>
                            <TouchableOpacity
                                onPress={onClose}
                                style={styles.closeButton}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityRole="button"
                                accessibilityLabel={t('common.close')}
                            >
                                <Feather name="x" size={20} color={colors.readerMutedInk} />
                            </TouchableOpacity>
                        </View>

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
                                            <Feather name="chevron-right" size={18} color={colors.readerSubtleInk} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        ) : null}

                        <View style={styles.tabStrip} accessibilityRole="tablist">
                            {SETTINGS_TABS.map((tab) => {
                                const selected = tab === activeTab;
                                return (
                                    <Pressable
                                        key={tab}
                                        style={styles.tab}
                                        onPress={() => setActiveTab(tab)}
                                        accessibilityRole="tab"
                                        accessibilityLabel={t(TAB_LABEL_KEYS[tab])}
                                        accessibilityState={{ selected }}
                                        testID={`reader-settings-tab-${tab}`}
                                    >
                                        <Text style={[styles.tabLabel, selected && styles.tabLabelActive]} numberOfLines={1}>
                                            {t(TAB_LABEL_KEYS[tab])}
                                        </Text>
                                        <View style={[styles.tabUnderline, selected && styles.tabUnderlineActive]} />
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>

                    <ScrollView
                        style={styles.body}
                        contentContainerStyle={styles.bodyContent}
                        showsVerticalScrollIndicator
                        bounces={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {activeTab === 'text' ? renderTextTab() : null}
                        {activeTab === 'words' ? renderWordsTab() : null}
                        {activeTab === 'focus' ? renderFocusTab() : null}
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors, insets = { bottom: 0 }, sheetHeight = 520) => StyleSheet.create({
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
        backgroundColor: colors.readerSurface,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: colors.readerBorder,
        paddingBottom: (insets?.bottom ?? 0),
        shadowColor: 'rgba(27, 28, 28, 0.18)',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 1,
        shadowRadius: 24,
        elevation: 16,
    },
    handleWrap: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 4,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.readerBorder,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: spacing.lg,
        paddingRight: spacing.sm,
        paddingTop: 2,
        paddingBottom: 6,
    },
    title: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: colors.readerBodyInk,
    },
    closeButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actions: {
        paddingHorizontal: spacing.lg,
    },
    actionRow: {
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: colors.readerHairline,
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
        color: colors.readerBodyInk,
    },
    actionLabelDanger: {
        color: colors.danger,
    },
    tabStrip: {
        flexDirection: 'row',
        marginTop: 4,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.readerHairline,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingTop: 10,
    },
    tabLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 0.4,
        color: colors.readerMutedInk,
        paddingBottom: 9,
    },
    tabLabelActive: {
        color: colors.readerBodyInk,
    },
    tabUnderline: {
        alignSelf: 'stretch',
        height: 2,
        borderRadius: 1,
        backgroundColor: 'transparent',
    },
    tabUnderlineActive: {
        backgroundColor: colors.inkSlate,
    },
    body: {
        flex: 1,
    },
    bodyContent: {
        paddingHorizontal: spacing.lg,
        paddingTop: 4,
        paddingBottom: spacing.lg,
    },
    brightnessGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    brightnessSlider: {
        width: 148,
        height: 32,
    },
    sliderTrack: {
        height: 4,
        borderRadius: 2,
    },
    sliderThumb: {
        width: 18,
        height: 18,
        borderRadius: 9,
    },
    legend: {
        paddingBottom: 12,
        gap: 5,
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
        height: 4,
        borderRadius: 2,
    },
    legendSliderThumb: {
        width: 20,
        height: 20,
        borderRadius: 10,
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
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    legendSwatch: {
        flex: 1,
        height: '100%',
    },
    legendLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    legendLabel: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15,
        color: colors.readerSubtleInk,
    },
    legendLabelEnd: {
        textAlign: 'right',
    },
    legendHint: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15,
        color: colors.readerMutedInk,
    },
});

export default ReaderSettingsSheet;
