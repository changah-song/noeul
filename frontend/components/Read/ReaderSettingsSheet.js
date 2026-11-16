import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import skipWhileHidden from './skipWhileHidden';
import {
    Animated,
    Easing,
    Modal,
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
import { THEME_MODES, elevation, fontFamilies, layout } from '../../theme';
import { useAppContext } from '../../contexts/AppContext';
import { ANNOTATION_SCOPES } from '../../services/readerAnnotations';
import {
    DEFAULT_BOOK_READER_SETTINGS,
    READER_FONT_SIZE_MAX,
    READER_FONT_SIZE_MIN,
    READER_LEVEL_MARK_STYLES,
    READER_LINE_SPACING_STEPS,
    READER_READING_MODES,
    buildLegendGradient,
    clampNumber,
    nearestLineSpacingIndex,
    stepFontSize,
    stepLineSpacing,
} from '../../services/readerSettings';
import {
    ResetLink,
    SegmentedControl,
    SegmentedTabs,
    SettingRow,
    Stepper,
    ToggleSwitch,
    Checkbox,
    createReaderSettingsControlStyles,
} from './ReaderSettingsControls';

// The most of the window the popup may take; a longer tab scrolls inside it.
export const POPUP_MAX_HEIGHT_RATIO = 0.7;
const POPUP_WIDTH = 316;
// On a narrow phone, the most of the window's width it may take.
const POPUP_MAX_WIDTH_RATIO = 0.92;
const POPUP_PADDING = 16;

export const SETTINGS_TABS = ['text', 'words'];

const TAB_LABEL_KEYS = {
    text: 'read.settingsTabText',
    words: 'read.settingsTabWords',
};

// Line spacing steps through READER_LINE_SPACING_STEPS with − / +, shown as
// the multiple ("1.65×"). A stored value between steps shows as the nearest.
const LINE_SPACING_MIN = READER_LINE_SPACING_STEPS[0].value;
const LINE_SPACING_MAX = READER_LINE_SPACING_STEPS[READER_LINE_SPACING_STEPS.length - 1].value;
const nearestLineSpacing = (value) => READER_LINE_SPACING_STEPS[nearestLineSpacingIndex(value)].value;

const scopeOrDefault = (value, fallback) => (ANNOTATION_SCOPES.includes(value) ? value : fallback);

/**
 * ReaderSettingsSheet — the reader's settings, as a popup that drops from
 * the ☰ button at the top right (the same kind of popup as the contents under
 * the title). The page stays in view behind it; a tap outside it or the back
 * button closes it. It is as tall as its tab, up to a share of the screen.
 *
 * Layout, top to bottom:
 *   `actions` (surface-specific rows such as Checkpoints or Edit lyrics)
 *   segmented tabs: Text | Words
 *   scrolling tab body, each ending in a small reset-to-default icon
 *
 *   Text  — font size, line spacing, appearance (light / sepia / dark),
 *           page turns (horizontal / vertical icons)
 *   Words — difficulty underlines (+ threshold legend), pinyin (+ scope,
 *           Chinese only), translation under words (+ scope)
 *
 * Focus mode has nothing to set (one sentence, swiped), and the sentence
 * translation bar is always on.
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
    actions = [],
    features = {},
    initialTab = 'text',
}) => {
    const { t } = useTranslation();
    // The theme belongs to the whole app, so it is read from the app here
    // rather than from this surface's own settings.
    const { themeMode: appThemeMode } = useAppContext();
    const themeMode = THEME_MODES.includes(appThemeMode) ? appThemeMode : 'light';
    const setThemeMode = (mode) => onSettingChange('themeMode', mode);
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const popupMaxHeight = Math.round(windowHeight * POPUP_MAX_HEIGHT_RATIO);
    // In points, from the window: a percentage of the modal can come out as
    // zero on Android when the modal opens again, and the popup is not there.
    const popupWidth = Math.min(POPUP_WIDTH, Math.round(windowWidth * POPUP_MAX_WIDTH_RATIO));
    const styles = useMemo(
        () => createStyles(colors, popupMaxHeight, popupWidth),
        [colors, popupMaxHeight, popupWidth]
    );
    const controlStyles = useMemo(() => createReaderSettingsControlStyles(colors), [colors]);
    const [activeTab, setActiveTab] = useState(SETTINGS_TABS.includes(initialTab) ? initialTab : 'text');
    // Opened for a particular tab (Profile's "Underlines feel off?"): show it.
    useEffect(() => {
        if (visible && SETTINGS_TABS.includes(initialTab)) setActiveTab(initialTab);
    }, [initialTab, visible]);

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

    // Keep the popup mounted through its exit animation, then unmount.
    const [mounted, setMounted] = useState(visible);
    const slideAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(slideAnim, {
                toValue: 1,
                duration: 180,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 130,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) {
                    setMounted(false);
                }
            });
        }
    }, [visible, slideAnim]);

    const underlineLegendColors = useMemo(
        () => buildLegendGradient(
            colors.readerLevelUnderlineEasy,
            colors.readerLevelUnderlineMid,
            colors.readerLevelUnderlineHard,
        ),
        [colors.readerLevelUnderlineEasy, colors.readerLevelUnderlineMid, colors.readerLevelUnderlineHard]
    );

    if (!mounted) {
        return null;
    }

    const source = settings && typeof settings === 'object' ? settings : {};
    const fontSize = Math.round(clampNumber(
        source.fontSize, READER_FONT_SIZE_MIN, READER_FONT_SIZE_MAX, DEFAULT_BOOK_READER_SETTINGS.fontSize
    ));
    const lineSpacing = nearestLineSpacing(source.lineSpacing);
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
    // Settings saved before the scopes were split carried one `annotationScope`.
    const legacyScope = scopeOrDefault(source.annotationScope, null);
    const pinyinScope = scopeOrDefault(source.pinyinScope, legacyScope || 'underlined');
    const glossScope = scopeOrDefault(source.glossScope, legacyScope || 'underlined');

    const showGloss = features.glossAnnotations !== false;
    const showScopes = features.annotationScope !== false;
    const showPinyin = language === 'zh' && features.pinyinAnnotations !== false;
    const showHideSaved = features.hideSavedAnnotations !== false
        && ((showPinyin && pinyinOn) || (showGloss && glossOn));

    const scopeOptions = ANNOTATION_SCOPES.map((value) => ({
        value,
        label: value === 'all' ? t('read.annotationScopeAll') : t('read.annotationScopeUnderlined'),
    }));

    // Drops a few points out of the header as it fades in.
    const popupTranslateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });

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
                    value={`${lineSpacing}×`}
                    onStep={(direction) => onSettingChange('lineSpacing', stepLineSpacing(lineSpacing, direction))}
                    atMin={lineSpacing <= LINE_SPACING_MIN}
                    atMax={lineSpacing >= LINE_SPACING_MAX}
                    decreaseLabel={t('read.decreaseLineSpacing')}
                    increaseLabel={t('read.increaseLineSpacing')}
                />
            </SettingRow>
            <SettingRow styles={controlStyles} label={t('profile.appearance')}>
                <SegmentedControl
                    styles={controlStyles}
                    colors={colors}
                    value={themeMode}
                    onChange={setThemeMode}
                    accessibilityLabel={t('profile.appearance')}
                    options={THEME_MODES.map((mode) => ({ value: mode, label: t(`profile.${mode}`) }))}
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
                        { value: 'paged', label: t('read.readingHorizontal'), icon: 'swap-horiz', iconOnly: true },
                        { value: 'scroll', label: t('read.readingVertical'), icon: 'swap-vert', iconOnly: true },
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
                <Animated.View
                    accessibilityViewIsModal
                    accessibilityLabel={title}
                    style={[
                        styles.popup,
                        {
                            top: (insets?.top ?? 0) + layout.readerHeaderHeight + 2,
                            opacity: slideAnim,
                            transform: [{ translateY: popupTranslateY }],
                        },
                    ]}
                >
                    <View>
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
                    </Animated.ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors, popupMaxHeight = 520, popupWidth = POPUP_WIDTH) => StyleSheet.create({
    overlay: {
        flex: 1,
    },
    // Barely there: the page stays readable behind the popup.
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.readerTocScrim,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    popup: {
        position: 'absolute',
        right: 12,
        width: popupWidth,
        maxHeight: popupMaxHeight,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.readerBorder,
        backgroundColor: colors.readerSurface,
        overflow: 'hidden',
        ...elevation.readerToc,
    },
    actions: {
        paddingTop: 2,
        paddingHorizontal: POPUP_PADDING,
    },
    actionRow: {
        minHeight: 46,
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
        marginHorizontal: POPUP_PADDING,
    },
    // As tall as the tab's rows; it only scrolls once the popup is at its ceiling.
    body: {
        flexGrow: 0,
        flexShrink: 1,
    },
    bodyContent: {
        paddingHorizontal: POPUP_PADDING,
        paddingTop: 4,
        paddingBottom: 10,
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

export default memo(ReaderSettingsSheet, skipWhileHidden);
