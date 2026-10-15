import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { fontFamilies, radii } from '../../theme';

// Building blocks of the reader settings sheet: one compact row per setting
// (label left, control right) and the three control kinds the reader uses —
// a −/value/+ stepper, a segmented control, and an on/off switch. Styles come
// from createReaderSettingsControlStyles(colors) so the sheet and the song
// reader share one look.

const STEPPER_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

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
            style={[styles.stepperButton, atMin && styles.stepperButtonDisabled]}
            onPress={() => onStep(-1)}
            disabled={atMin}
            activeOpacity={0.7}
            hitSlop={STEPPER_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={decreaseLabel}
            accessibilityState={{ disabled: atMin }}
        >
            <Feather name="minus" size={16} color={colors.readerBodyInk} />
        </TouchableOpacity>
        <Text style={[styles.stepperValue, valueStyle]} numberOfLines={1}>{value}</Text>
        <TouchableOpacity
            style={[styles.stepperButton, atMax && styles.stepperButtonDisabled]}
            onPress={() => onStep(1)}
            disabled={atMax}
            activeOpacity={0.7}
            hitSlop={STEPPER_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={increaseLabel}
            accessibilityState={{ disabled: atMax }}
        >
            <Feather name="plus" size={16} color={colors.readerBodyInk} />
        </TouchableOpacity>
    </View>
);

/**
 * SegmentedControl — `options` is [{ value, label, icon? }] where `icon` is a
 * MaterialIcons name. The selected segment is filled with ink.
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
                            color={selected ? colors.readerPaper : colors.textSecondary}
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
        outputRange: [colors.readerBorder, colors.inkSlate],
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
 * ResetLink — the small "Reset to default" action that closes each tab.
 */
export const ResetLink = ({ styles, colors, label, onPress }) => (
    <TouchableOpacity
        style={styles.resetLink}
        onPress={onPress}
        activeOpacity={0.6}
        hitSlop={STEPPER_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={label}
    >
        <Feather name="rotate-ccw" size={12} color={colors.readerMutedInk} />
        <Text style={styles.resetLinkText}>{label}</Text>
    </TouchableOpacity>
);

export const createReaderSettingsControlStyles = (colors) => StyleSheet.create({
    rowWrap: {
        borderBottomWidth: 1,
        borderBottomColor: colors.readerHairline,
    },
    rowWrapLast: {
        borderBottomWidth: 0,
    },
    row: {
        minHeight: 52,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    rowIndent: {
        minHeight: 46,
        paddingLeft: 18,
    },
    rowLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.readerBodyInk,
    },
    rowLabelIndent: {
        fontSize: 13,
        lineHeight: 17,
        color: colors.readerMutedInk,
    },
    rowControl: {
        flexShrink: 0,
        maxWidth: '64%',
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    stepperButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.readerHairline,
        borderWidth: 1,
        borderColor: colors.readerBorder,
    },
    stepperButtonDisabled: {
        opacity: 0.35,
    },
    stepperValue: {
        minWidth: 44,
        textAlign: 'center',
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.readerBodyInk,
    },
    stepperValueSmall: {
        fontSize: 13,
        minWidth: 64,
    },
    segmentTrack: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 3,
        borderRadius: radii.sm + 3,
        backgroundColor: colors.readerHairline,
        borderWidth: 1,
        borderColor: colors.readerBorder,
    },
    segment: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        minWidth: 64,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: radii.sm,
    },
    segmentActive: {
        backgroundColor: colors.inkSlate,
    },
    segmentText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textSecondary,
    },
    segmentTextActive: {
        fontFamily: fontFamilies.sansSemiBold,
        color: colors.readerPaper,
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
        backgroundColor: colors.readerSurface,
        shadowColor: 'rgba(27, 28, 28, 0.3)',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 1,
        shadowRadius: 2,
        elevation: 2,
    },
    resetLink: {
        alignSelf: 'flex-end',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 14,
        paddingVertical: 4,
        paddingHorizontal: 2,
    },
    resetLinkText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 12,
        lineHeight: 16,
        color: colors.readerMutedInk,
    },
});
