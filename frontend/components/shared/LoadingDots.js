import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

const CYCLE_MS = 1400;
const CYCLE_REDUCED_MS = 3000;
const STAGGER_MS = 180;

// A dot's pulse (opacity .2 → 1 at 40% of the cycle → .2), shifted by its
// stagger, on a clock that runs 0 → 1 once per cycle.
const dotOpacityRange = (offset) => {
    const fallingAt = (phase) => 1 - (0.8 * (phase - 0.4)) / 0.6;
    const start = fallingAt(1 - offset);
    return {
        inputRange: [0, offset, offset + 0.4, 1],
        outputRange: [start, 0.2, 1, start],
    };
};

/**
 * LoadingDots — Noeul's "working on it": three dots pulsing one after
 * another (the book-opening screen, the chapter being prepared). Slower when
 * the phone asks for reduced motion.
 */
export default function LoadingDots({ color, size = 9, gap = 12, style, accessibilityLabel }) {
    const clock = useRef(new Animated.Value(0)).current;
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect(() => {
        let active = true;
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => {
                if (active) setReduceMotion(Boolean(value));
            })
            .catch(() => {});
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
            setReduceMotion(Boolean(value));
        });
        return () => {
            active = false;
            subscription?.remove?.();
        };
    }, []);

    useEffect(() => {
        clock.setValue(0);
        const loop = Animated.loop(Animated.timing(clock, {
            toValue: 1,
            duration: reduceMotion ? CYCLE_REDUCED_MS : CYCLE_MS,
            easing: Easing.linear,
            useNativeDriver: true,
        }));
        loop.start();
        return () => loop.stop();
    }, [clock, reduceMotion]);

    const dots = useMemo(() => [0, 1, 2].map((index) => {
        const opacity = clock.interpolate(dotOpacityRange((index * STAGGER_MS) / CYCLE_MS));
        return {
            opacity,
            scale: opacity.interpolate({ inputRange: [0.2, 1], outputRange: [0.85, 1] }),
        };
    }), [clock]);

    return (
        <View
            accessible={Boolean(accessibilityLabel)}
            accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
            accessibilityLabel={accessibilityLabel}
            style={[styles.row, { gap }, style]}
        >
            {dots.map((dot, index) => (
                <Animated.View
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    style={{
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: color,
                        opacity: dot.opacity,
                        transform: [{ scale: dot.scale }],
                    }}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});
