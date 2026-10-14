import { useEffect, useMemo, useRef } from 'react';
import {
    Animated,
    Easing,
    Pressable,
    ScrollView,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';
import { useTranslation } from '../../hooks/useTranslation';
import {
    READER_BRIGHTNESS_MAX,
    READER_BRIGHTNESS_MIN,
    READER_FOCUS_SPAN_MAX,
    READER_FOCUS_SPAN_MIN,
    READER_LEVEL_MARK_OPTIONS,
    READER_LINE_SPACING_STEPS,
    buildLegendGradient,
    clampNumber,
    nearestLineSpacingIndex,
    stepFocusSpan,
    stepFontSize,
    stepLineSpacing,
} from '../../services/readerSettings';

const RESET_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

/**
 * ReaderOptionsMenu — the reader's options dropdown (drops in from the menu
 * icon, top-right). Same layout and controls as the book reader's dropdown in
 * screens/Read.js: reading settings (font size, line spacing, brightness,
 * reading direction, word highlighting + legend, pinyin for Chinese) and focus
 * mode settings. `children` render above the settings section for
 * surface-specific actions (e.g. edit/delete a song).
 *
 * `settings` must already be normalized (services/readerSettings
 * normalizeReaderSettings). Changes go out through onSettingChange(key, value).
 */
const ReaderOptionsMenu = ({
    visible,
    onClose,
    top,
    bottom,
    styles,
    themeColors,
    sectionTitle,
    settings,
    language,
    onSettingChange,
    onResetSettings,
    onResetFocusSettings,
    children,
}) => {
    const { t } = useTranslation();
    const menuAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            menuAnim.setValue(0);
            Animated.timing(menuAnim, {
                toValue: 1,
                duration: 150,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        }
    }, [visible, menuAnim]);

    const underlineLegendColors = useMemo(
        () => buildLegendGradient(
            themeColors.readerLevelUnderlineEasy,
            themeColors.readerLevelUnderlineMid,
            themeColors.readerLevelUnderlineHard,
        ),
        [
            themeColors.readerLevelUnderlineEasy,
            themeColors.readerLevelUnderlineMid,
            themeColors.readerLevelUnderlineHard,
        ]
    );

    if (!visible) {
        return null;
    }

    const isScrollMode = settings.readingMode === 'scroll';
    const levelMarksEnabled = settings.levelMarkStyle !== 'off';
    const lineSpacingStep = READER_LINE_SPACING_STEPS[nearestLineSpacingIndex(settings.lineSpacing)];
    const focusSwipe = !!settings.focusSwipe;
    const focusSpan = settings.focusSpan;

    const renderStepper = ({ value, valueStyle, onStep, decreaseLabel, increaseLabel, atMin, atMax }) => (
        <View style={styles.fontSettingsStepperGroup}>
            <TouchableOpacity
                style={[styles.fontSettingsStepperButton, atMin && styles.focusStepperDisabled]}
                onPress={() => onStep(-1)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={decreaseLabel}
            >
                <Feather name="minus" size={18} color={themeColors.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.fontSettingsValue, valueStyle]}>{value}</Text>
            <TouchableOpacity
                style={[styles.fontSettingsStepperButton, atMax && styles.focusStepperDisabled]}
                onPress={() => onStep(1)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={increaseLabel}
            >
                <Feather name="plus" size={18} color={themeColors.textSecondary} />
            </TouchableOpacity>
        </View>
    );

    const renderSegment = ({ key, selected, icon, label, onPress }) => (
        <TouchableOpacity
            key={key}
            style={[styles.segmentButton, selected && styles.segmentButtonActive]}
            onPress={onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected }}
        >
            {icon ? (
                <MaterialIcons
                    name={icon}
                    size={16}
                    color={selected ? themeColors.readerPaper : themeColors.textSecondary}
                />
            ) : null}
            <Text style={[styles.segmentButtonText, selected && styles.segmentButtonTextActive]} numberOfLines={1}>
                {label}
            </Text>
        </TouchableOpacity>
    );

    return (
        <View pointerEvents="box-none" style={styles.settingsOverlay}>
            <Pressable style={styles.settingsBackdrop} onPress={onClose} />
            <Animated.View
                pointerEvents="box-none"
                style={[
                    styles.menuDropdownFrame,
                    {
                        top,
                        bottom,
                        opacity: menuAnim,
                        transform: [
                            {
                                translateY: menuAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [-10, 0],
                                }),
                            },
                            {
                                scale: menuAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.96, 1],
                                }),
                            },
                        ],
                    },
                ]}
            >
                <View style={styles.optionsSheet}>
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                        contentContainerStyle={styles.optionsScrollContent}
                    >
                        {children}

                        <View style={styles.optionsSectionHeader}>
                            <Text style={styles.optionsSectionTitle}>{sectionTitle}</Text>
                            <TouchableOpacity
                                onPress={onResetSettings}
                                hitSlop={RESET_HIT_SLOP}
                                accessibilityRole="button"
                                accessibilityLabel={t('read.resetSection')}
                            >
                                <Feather name="rotate-ccw" size={15} color={themeColors.readerSubtleInk} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.fontSettingsRows}>
                            <View style={styles.fontSettingsRow}>
                                <Text style={styles.fontSettingsLabel}>{t('read.fontSize')}</Text>
                                {renderStepper({
                                    value: settings.fontSize,
                                    onStep: (direction) => onSettingChange('fontSize', stepFontSize(settings.fontSize, direction)),
                                    decreaseLabel: t('read.decreaseFontSize'),
                                    increaseLabel: t('read.increaseFontSize'),
                                })}
                            </View>

                            <View style={styles.fontSettingsRow}>
                                <Text style={styles.fontSettingsLabel}>{t('read.lineSpacing')}</Text>
                                {renderStepper({
                                    value: t(lineSpacingStep.labelKey),
                                    valueStyle: styles.fontSettingsLineSpacingValue,
                                    onStep: (direction) => onSettingChange('lineSpacing', stepLineSpacing(settings.lineSpacing, direction)),
                                    decreaseLabel: t('read.decreaseLineSpacing'),
                                    increaseLabel: t('read.increaseLineSpacing'),
                                })}
                            </View>

                            <View style={styles.fontSettingsRow}>
                                <Text style={styles.fontSettingsLabel}>{t('read.brightness')}</Text>
                                <View style={styles.fontSettingsBrightnessGroup}>
                                    <MaterialIcons name="light-mode" size={18} color={themeColors.readerSubtleInk} />
                                    <Slider
                                        style={styles.fontSettingsBrightnessSlider}
                                        value={settings.brightness}
                                        onValueChange={(value) => onSettingChange(
                                            'brightness',
                                            Number(clampNumber(value, READER_BRIGHTNESS_MIN, READER_BRIGHTNESS_MAX).toFixed(2))
                                        )}
                                        minimumValue={READER_BRIGHTNESS_MIN}
                                        maximumValue={READER_BRIGHTNESS_MAX}
                                        step={0.01}
                                        allowTouchTrack
                                        thumbTintColor={themeColors.readerProgressFill}
                                        minimumTrackTintColor={themeColors.readerProgressFill}
                                        maximumTrackTintColor={themeColors.readerHairline}
                                        trackStyle={styles.fontSettingsSliderTrack}
                                        thumbStyle={styles.fontSettingsSliderThumb}
                                        accessibilityLabel={t('read.readerBrightness')}
                                    />
                                </View>
                            </View>

                            <View style={styles.fontSettingsRow}>
                                <Text style={styles.fontSettingsLabel}>{t('read.readingDirection')}</Text>
                                <View style={styles.segmentGroup}>
                                    {renderSegment({
                                        key: 'paged',
                                        selected: !isScrollMode,
                                        icon: 'swap-horiz',
                                        label: t('read.readingHorizontal'),
                                        onPress: () => onSettingChange('readingMode', 'paged'),
                                    })}
                                    {renderSegment({
                                        key: 'scroll',
                                        selected: isScrollMode,
                                        icon: 'swap-vert',
                                        label: t('read.readingVertical'),
                                        onPress: () => onSettingChange('readingMode', 'scroll'),
                                    })}
                                </View>
                            </View>

                            <View style={[styles.markStyleBlock, styles.fontSettingsLastRow]}>
                                <Text style={styles.fontSettingsLabel}>{t('read.wordHighlighting')}</Text>
                                <View style={styles.segmentGroup}>
                                    {READER_LEVEL_MARK_OPTIONS.map(({ value, icon, labelKey }) => renderSegment({
                                        key: value,
                                        selected: settings.levelMarkStyle === value,
                                        icon,
                                        label: t(labelKey),
                                        onPress: () => onSettingChange('levelMarkStyle', value),
                                    }))}
                                </View>

                                {levelMarksEnabled ? (
                                    <View style={styles.underlineLegend}>
                                        <View style={styles.underlineLegendSwatches}>
                                            {underlineLegendColors.map((color, index) => (
                                                <View
                                                    key={index}
                                                    style={[styles.underlineLegendSwatch, { backgroundColor: color }]}
                                                />
                                            ))}
                                        </View>
                                        <View style={styles.underlineLegendLabels}>
                                            <Text style={styles.underlineLegendLabel}>{t('read.underlineNearly')}</Text>
                                            <Text style={[styles.underlineLegendLabel, styles.underlineLegendLabelEnd]}>
                                                {t('read.underlineHard')}
                                            </Text>
                                        </View>
                                        <Text style={styles.underlineLegendHint}>{t('read.wordHighlightingHint')}</Text>
                                    </View>
                                ) : null}
                            </View>

                            {language === 'zh' && levelMarksEnabled ? (
                                <View style={styles.markStyleBlock}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.pinyinAnnotations')}</Text>
                                    <View style={styles.segmentGroup}>
                                        {[false, true].map((value) => renderSegment({
                                            key: String(value),
                                            selected: Boolean(settings.pinyinAnnotations) === value,
                                            label: value ? t('read.pinyinOn') : t('read.pinyinOff'),
                                            onPress: () => onSettingChange('pinyinAnnotations', value),
                                        }))}
                                    </View>
                                </View>
                            ) : null}
                        </View>

                        <View style={styles.optionsSectionHeader}>
                            <Text style={styles.optionsSectionTitle}>{t('read.focusModeSettings')}</Text>
                            <TouchableOpacity
                                onPress={onResetFocusSettings}
                                hitSlop={RESET_HIT_SLOP}
                                accessibilityRole="button"
                                accessibilityLabel={t('read.resetSection')}
                            >
                                <Feather name="rotate-ccw" size={15} color={themeColors.readerSubtleInk} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.fontSettingsRows}>
                            <View style={styles.fontSettingsRow}>
                                <Text style={styles.fontSettingsLabel}>{t('read.focusNavigate')}</Text>
                                <View style={styles.segmentGroup}>
                                    {renderSegment({
                                        key: 'swipe',
                                        selected: focusSwipe,
                                        icon: 'gesture',
                                        label: t('read.focusNavSwipe'),
                                        onPress: () => onSettingChange('focusSwipe', true),
                                    })}
                                    {renderSegment({
                                        key: 'buttons',
                                        selected: !focusSwipe,
                                        icon: 'touch-app',
                                        label: t('read.focusNavButtons'),
                                        onPress: () => onSettingChange('focusSwipe', false),
                                    })}
                                </View>
                            </View>

                            <View style={[styles.fontSettingsRow, styles.fontSettingsLastRow]}>
                                <Text style={styles.fontSettingsLabel}>{t('read.focusSpan')}</Text>
                                {renderStepper({
                                    value: focusSpan,
                                    onStep: (direction) => onSettingChange('focusSpan', stepFocusSpan(focusSpan, direction)),
                                    atMin: focusSpan <= READER_FOCUS_SPAN_MIN,
                                    atMax: focusSpan >= READER_FOCUS_SPAN_MAX,
                                })}
                            </View>
                        </View>
                    </ScrollView>
                </View>
            </Animated.View>
        </View>
    );
};

export default ReaderOptionsMenu;
