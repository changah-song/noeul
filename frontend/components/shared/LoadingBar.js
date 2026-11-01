import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import useReduceMotion from '../../hooks/useReduceMotion';

const CYCLE_MS = 1600;
const CYCLE_REDUCED_MS = 3200;
// The track under the pulse, as a share of the bar's own ink.
const TRACK_OPACITY = 0.12;

/**
 * LoadingBar — a thin bar whose fill breathes out from its middle and back,
 * for "working on it" under a picture (the book-opening screen). With reduced
 * motion it only brightens and dims, slower, without stretching.
 */
export default function LoadingBar({ color, width = 140, height = 3, style, accessibilityLabel }) {
    const clock = useRef(new Animated.Value(0)).current;
    const reduceMotion = useReduceMotion();

    useEffect(() => {
        clock.setValue(0);
        const loop = Animated.loop(Animated.timing(clock, {
            toValue: 1,
            duration: reduceMotion ? CYCLE_REDUCED_MS : CYCLE_MS,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
        }));
        loop.start();
        return () => loop.stop();
    }, [clock, reduceMotion]);

    const opacity = clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 1, 0.35] });
    const scaleX = reduceMotion
        ? 1
        : clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.2, 1, 0.2] });

    return (
        <View
            accessible={Boolean(accessibilityLabel)}
            accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
            accessibilityLabel={accessibilityLabel}
            style={[{ width, height, borderRadius: height / 2 }, styles.bar, style]}
        >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: TRACK_OPACITY }]} />
            <Animated.View
                style={[
                    StyleSheet.absoluteFill,
                    {
                        borderRadius: height / 2,
                        backgroundColor: color,
                        opacity,
                        transform: [{ scaleX }],
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        overflow: 'hidden',
    },
});
