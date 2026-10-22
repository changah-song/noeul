import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { fontFamilies } from '../../theme';

// Building blocks shared by the reader's bottom sheets (settings, checkpoints,
// saved words, voice, note): the sheet chrome (grabber, serif title + close X,
// empty state) and one compact row per setting (label left, control right)
// with the control kinds the reader uses — a −/value/+ stepper, a segmented
// control, full-width segmented tabs, an on/off switch and a checkbox. Styles come from
// createReaderSettingsControlStyles(colors) and createSheetChromeStyles(colors)
// so every sheet shares one look.

const STEPPER_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// One sheet style for every reader sheet.
export const SHEET_RADIUS = 24;
export const SHEET_PADDING = 20;

/**
 * SheetHandle — the small grabber bar at the top of a sheet.
 */
export const SheetHandle = ({ styles }) => (
    <View style={styles.handleWrap}>
        <View style={styles.handle} />
    </View>
);

/**
 * SheetHeader — display-serif title on the left, close X on the right.
 */
export const SheetHeader = ({ styles, colors, title, onClose, closeLabel }) => (
    <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{title}</Text>
        {onClose ? (
            <TouchableOpacity
                onPress={onClose}
                style={styles.closeButton}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
            >
                <Feather name="x" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
        ) : null}
    </View>
);

/**
 * SheetEmptyState — centred icon, title and helper text for an empty list.
 * `icon` is a Feather name.
 */
export const SheetEmptyState = ({ styles, colors, icon, title, body }) => (
    <View style={styles.emptyWrap}>
        {icon ? <Feather name={icon} size={24} color={colors.textSubtle} /> : null}
        {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
        {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
);

/**
 * SettingRow — label on the left, control on the right. `indent` marks a
 * dependent row (e.g. "Show on" under a toggle) with a left inset and a quieter
 * label. `below` renders full-width content under the row (the marks legend).
 */
export const SettingRow = ({ styles, label, indent = false, last = false, below = null, children }) => (
    <View style={[styles.rowWrap, last && styles.rowWrapLast]}>
        <View style={[styles.row, indent && styles.rowIndent]}>
            <Text style={[styles.rowLabel, indent && styles.rowLabelIndent]} numberOfLines={2}>
                {label}
            </Text>
            <View style={styles.rowControl}>{children}</View>
        </View>
        {below}
    </View>
);

export const Stepper = ({
    styles,
    colors,
    value,
    valueStyle,
    onStep,
    decreaseLabel,
    increaseLabel,
    atMin = false,
    atMax = false,
}) => (
    <View style={styles.stepper}>
        <TouchableOpacity
            style={styles.stepperButton}
            onPress={() => onStep(-1)}
            disabled={atMin}
            activeOpacity={0.6}
            hitSlop={STEPPER_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={decreaseLabel}
            accessibilityState={{ disabled: atMin }}
        >
            <Feather name="minus" size={17} color={atMin ? colors.borderStrong : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.stepperValue, valueStyle]} numberOfLines={1}>{value}</Text>
        <TouchableOpacity
            style={styles.stepperButton}
            onPress={() => onStep(1)}
            disabled={atMax}
            activeOpacity={0.6}
            hitSlop={STEPPER_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={increaseLabel}
            accessibilityState={{ disabled: atMax }}
        >
            <Feather name="plus" size={17} color={atMax ? colors.borderStrong : colors.text} />
        </TouchableOpacity>
    </View>
);

/**
 * SegmentedControl — `options` is [{ value, label, icon? }] where `icon` is a
 * MaterialIcons name. A muted track; the selected segment is a raised white
 * chip with semibold text.
 */
export const SegmentedControl = ({ styles, colors, options, value, onChange, accessibilityLabel }) => (
    <View style={styles.segmentTrack} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
        {options.map((option) => {
            const selected = option.value === value;
            return (
                <TouchableOpacity
                    key={String(option.value)}
                    style={[styles.segment, selected && styles.segmentActive]}
                    onPress={() => onChange(option.value)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected }}
                >
                    {option.icon ? (
                        <MaterialIcons
                            name={option.icon}
                            size={15}
                            color={selected ? colors.text : colors.textMuted}
                        />
                    ) : null}
                    <Text style={[styles.segmentText, selected && styles.segmentTextActive]} numberOfLines={1}>
                        {option.label}
                    </Text>
                </TouchableOpacity>
            );
        })}
    </View>
);

/**
 * SegmentedTabs — full-width segmented tabs (equal-width segments) whose
 * raised selection chip slides between tabs. `options` is
 * [{ value, label, testID? }]; each segment has the tab role.
 */
export const SegmentedTabs = ({ styles, options, value, onChange, style }) => {
    const [trackWidth, setTrackWidth] = useState(0);
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    const position = useRef(new Animated.Value(selectedIndex)).current;

    useEffect(() => {
        Animated.timing(position, {
            toValue: selectedIndex,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [position, selectedIndex]);

    const segmentWidth = trackWidth > 0 ? (trackWidth - TAB_TRACK_PADDING * 2) / options.length : 0;

    return (
        <View
            style={[styles.tabsTrack, style]}
            accessibilityRole="tablist"
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        >
            {segmentWidth > 0 ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.tabsChip,
                        {
                            width: segmentWidth,
                            transform: [{
                                translateX: Animated.multiply(position, segmentWidth),
                            }],
                        },
                    ]}
                />
            ) : null}
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <Pressable
                        key={String(option.value)}
                        style={[styles.tabsSegment, segmentWidth === 0 && selected && styles.tabsSegmentFallback]}
                        onPress={() => onChange(option.value)}
                        accessibilityRole="tab"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected }}
                        testID={option.testID}
                    >
                        <Text style={[styles.tabsText, selected && styles.tabsTextActive]} numberOfLines={1}>
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
};

const TAB_TRACK_PADDING = 3;
const KNOB_TRAVEL = 20;

/**
 * ToggleSwitch — a track-and-knob switch for on/off settings. Exposes the
 * switch role with its checked state so screen readers announce it as one.
 */
export const ToggleSwitch = ({ styles, colors, value, onChange, accessibilityLabel }) => {
    const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(anim, {
            toValue: value ? 1 : 0,
            duration: 180,
            useNativeDriver: false,
        }).start();
    }, [anim, value]);

    const trackColor = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.borderStrong, colors.inkSlate],
    });
    const knobLeft = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [2, 2 + KNOB_TRAVEL],
    });

    return (
        <Pressable
            onPress={() => onChange(!value)}
            hitSlop={STEPPER_HIT_SLOP}
            accessibilityRole="switch"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: !!value }}
        >
            <Animated.View style={[styles.switchTrack, { backgroundColor: trackColor }]}>
                <Animated.View style={[styles.switchKnob, { left: knobLeft }]} />
            </Animated.View>
        </Pressable>
    );
};

/**
 * Checkbox — a small square that fills in with a check when on. For options
 * that refine the setting above them, where a full switch would read as a
 * setting of its own.
 */
export const Checkbox = ({ styles, colors, value, onChange, accessibilityLabel }) => (
    <Pressable
        onPress={() => onChange(!value)}
        hitSlop={STEPPER_HIT_SLOP}
        accessibilityRole="checkbox"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ checked: !!value }}
        style={[
            styles.checkbox,
            value
                ? { backgroundColor: colors.inkSlate, borderColor: colors.inkSlate }
                : { backgroundColor: 'transparent', borderColor: colors.borderStrong },
        ]}
    >
        {value ? <Feather name="check" size={15} color={colors.white} /> : null}
    </Pressable>
);

/**
 * ResetLink — the small "Reset to default" text button that closes each tab.
 */
export const ResetLink = ({ styles, label, onPress }) => (
    <TouchableOpacity
        style={styles.resetLink}
        onPress={onPress}
        activeOpacity={0.6}
        hitSlop={STEPPER_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={label}
    >
        <Text style={styles.resetLinkText}>{label}</Text>
    </TouchableOpacity>
);

const chipShadow = {
    shadowColor: 'rgba(27, 28, 28, 0.12)',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
};

/**
 * createSheetChromeStyles — the shared sheet look: rounded top 24, grabber,
 * 21px display-serif title, close X, 20px side padding, empty state.
 */
export const createSheetChromeStyles = (colors, insets = { bottom: 0 }) => StyleSheet.create({
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: SHEET_RADIUS,
        borderTopRightRadius: SHEET_RADIUS,
        paddingBottom: (insets?.bottom ?? 0) + SHEET_PADDING,
        shadowColor: 'rgba(27, 28, 28, 0.12)',
        shadowOffset: { width: 0, height: -12 },
        shadowOpacity: 1,
        shadowRadius: 40,
        elevation: 16,
    },
    handleWrap: {
        alignItems: 'center',
        paddingTop: 10,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 8,
        paddingLeft: SHEET_PADDING,
        paddingRight: SHEET_PADDING - 12,
    },
    title: {
        flex: 1,
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 21,
        lineHeight: 28,
        color: colors.text,
    },
    closeButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    emptyWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingTop: 30,
        paddingBottom: 14,
        paddingHorizontal: 40,
    },
    emptyTitle: {
        marginTop: 2,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
        textAlign: 'center',
    },
    emptyBody: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
        textAlign: 'center',
    },
});

export const createReaderSettingsControlStyles = (colors) => StyleSheet.create({
    rowWrap: {
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    rowWrapLast: {
        borderBottomWidth: 0,
    },
    row: {
        minHeight: 56,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    rowIndent: {
        minHeight: 48,
        paddingLeft: 16,
    },
    rowLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    rowLabelIndent: {
        fontSize: 14,
        lineHeight: 18,
        color: colors.textMuted,
    },
    rowControl: {
        flexShrink: 0,
        maxWidth: '68%',
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stepperButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    stepperValue: {
        minWidth: 44,
        textAlign: 'center',
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    stepperValueSmall: {
        fontSize: 13,
        minWidth: 64,
    },
    segmentTrack: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 3,
        borderRadius: 10,
        backgroundColor: colors.surfaceMuted,
    },
    segment: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    segmentActive: {
        backgroundColor: colors.surface,
        ...chipShadow,
    },
    segmentText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textMuted,
    },
    segmentTextActive: {
        fontFamily: fontFamilies.sansSemiBold,
        color: colors.text,
    },
    tabsTrack: {
        flexDirection: 'row',
        padding: TAB_TRACK_PADDING,
        borderRadius: 12,
        backgroundColor: colors.surfaceMuted,
    },
    tabsChip: {
        position: 'absolute',
        top: TAB_TRACK_PADDING,
        bottom: TAB_TRACK_PADDING,
        left: TAB_TRACK_PADDING,
        borderRadius: 9,
        backgroundColor: colors.surface,
        ...chipShadow,
    },
    tabsSegment: {
        flex: 1,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9,
    },
    // Before the track is measured there is no sliding chip yet.
    tabsSegmentFallback: {
        backgroundColor: colors.surface,
    },
    tabsText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textMuted,
    },
    tabsTextActive: {
        fontFamily: fontFamilies.sansSemiBold,
        color: colors.text,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    switchTrack: {
        width: 46,
        height: 26,
        borderRadius: 13,
        justifyContent: 'center',
    },
    switchKnob: {
        position: 'absolute',
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.surface,
        shadowColor: 'rgba(27, 28, 28, 0.3)',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 1,
        shadowRadius: 2,
        elevation: 2,
    },
    resetLink: {
        alignSelf: 'flex-end',
        marginTop: 10,
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 2,
    },
    resetLinkText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textTertiary,
    },
});
