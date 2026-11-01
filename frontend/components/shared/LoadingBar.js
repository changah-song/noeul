import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import useReduceMotion from '../../hooks/useReduceMotion';

const SWEEP_MS = 1300;
const PULSE_REDUCED_MS = 3200;
// The moving segment, as a share of the bar's width.
const SEGMENT_SHARE = 0.38;
// The track under the segment, as a share of the bar's own ink.
const TRACK_OPACITY = 0.16;

/**
 * LoadingBar — a thin bar with a segment sweeping across it, left to right,
 * over and over: "working on it" under a picture (the book-opening screen).
 * With reduced motion the bar stays put and only brightens and dims, slower.
 */
export default function LoadingBar({ color, width = 140, height = 3, style, accessibilityLabel }) {
    const clock = useRef(new Animated.Value(0)).current;
    const reduceMotion = useReduceMotion();

    useEffect(() => {
        clock.setValue(0);
        const loop = Animated.loop(Animated.timing(clock, {
            toValue: 1,
            duration: reduceMotion ? PULSE_REDUCED_MS : SWEEP_MS,
            easing: reduceMotion ? Easing.inOut(Easing.sin) : Easing.inOut(Easing.quad),
            useNativeDriver: true,
        }));
        loop.start();
        return () => loop.stop();
    }, [clock, reduceMotion]);

    const segmentWidth = Math.round(width * SEGMENT_SHARE);
    const fill = reduceMotion
        ? {
            width,
            opacity: clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 1, 0.35] }),
        }
        : {
            width: segmentWidth,
            // From just off the left edge to just off the right one.
            transform: [{
                translateX: clock.interpolate({ inputRange: [0, 1], outputRange: [-segmentWidth, width] }),
            }],
        };

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
                    styles.fill,
                    { height, borderRadius: height / 2, backgroundColor: color },
                    fill,
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        overflow: 'hidden',
    },
    fill: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
});
