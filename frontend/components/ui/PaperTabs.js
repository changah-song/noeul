import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';
import { springs, springTo, useReducedMotion } from '../../theme/motion';

/**
 * PaperTabs — text tabs on a hairline, with an ink underline that slides to
 * the selected tab on a critically damped spring (it starts from wherever it
 * is, so tapping tabs quickly re-targets it mid-flight instead of queueing).
 *
 * `tabs`: [{ key, label }]. `value`: the selected key. `onChange(key)`.
 */
const PaperTabs = ({ tabs, value, onChange, style, accessibilityLabel }) => {
    const { colors } = useTheme();
    const reduced = useReducedMotion();
    const [layouts, setLayouts] = useState({});
    const x = useRef(new Animated.Value(0)).current;
    const width = useRef(new Animated.Value(0)).current;
    const placed = useRef(false);

    useEffect(() => {
        const box = layouts[value];
        if (!box) return;
        if (!placed.current || reduced) {
            x.setValue(box.x);
            width.setValue(box.width);
            placed.current = true;
            return;
        }
        Animated.parallel([
            springTo(x, box.x, { spring: springs.snappy, useNativeDriver: false }),
            springTo(width, box.width, { spring: springs.snappy, useNativeDriver: false }),
        ]).start();
    }, [layouts, reduced, value, width, x]);

    return (
        <View
            accessibilityRole="tablist"
            accessibilityLabel={accessibilityLabel}
            style={[styles.row, { borderBottomColor: colors.border }, style]}
        >
            {tabs.map((tab) => {
                const selected = tab.key === value;
                return (
                    <Pressable
                        key={tab.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        onPress={() => onChange?.(tab.key)}
                        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                        onLayout={(event) => {
                            const { x: left, width: w } = event.nativeEvent.layout;
                            setLayouts((previous) => (
                                previous[tab.key]?.x === left && previous[tab.key]?.width === w
                                    ? previous
                                    : { ...previous, [tab.key]: { x: left, width: w } }
                            ));
                        }}
                        style={styles.tab}
                    >
                        {({ pressed }) => (
                            <Text
                                style={[
                                    styles.label,
                                    {
                                        color: selected ? colors.text : colors.textMuted,
                                        fontFamily: selected ? fontFamilies.sansSemiBold : fontFamilies.sansRegular,
                                        opacity: pressed && !selected ? 0.6 : 1,
                                    },
                                ]}
                            >
                                {tab.label}
                            </Text>
                        )}
                    </Pressable>
                );
            })}
            <Animated.View
                pointerEvents="none"
                style={[styles.indicator, { backgroundColor: colors.text, left: x, width }]}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 22,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tab: {
        height: 44,
        justifyContent: 'center',
    },
    label: {
        fontSize: 15,
        lineHeight: 20,
    },
    indicator: {
        position: 'absolute',
        bottom: -1,
        height: 2,
        borderRadius: 1,
    },
});

export default PaperTabs;
