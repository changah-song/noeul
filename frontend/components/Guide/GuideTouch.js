import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

// The touch marks the reader guide draws over its sample page, the way a
// screen recording shows taps: a ring that pops and fades (tap), one that
// stays (a finger held down), one that slides left (a swipe), and the pulsing
// outline around the spot the viewer is asked to tap.

const SIZE = 34;

const ringStyle = (ink) => ({
    backgroundColor: `${ink}38`,
    borderColor: `${ink}99`,
});

export function TouchTap({ ink }) {
    const progress = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(progress, {
            toValue: 1,
            duration: 450,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [progress]);
    const scale = progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1, 1.3] });
    const opacity = progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] });
    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.touch, ringStyle(ink), { opacity, transform: [{ scale }] }]}
        />
    );
}

export function TouchHold({ ink }) {
    const progress = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(progress, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [progress]);
    const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.touch, ringStyle(ink), { opacity: progress, transform: [{ scale }] }]}
        />
    );
}

export function TouchSwipe({ ink, top }) {
    const progress = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(progress, {
            toValue: 1,
            duration: 500,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [progress]);
    const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [70, -70] });
    const opacity = progress.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });
    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.touch, styles.swipe, ringStyle(ink), { top, opacity, transform: [{ translateX }] }]}
        />
    );
}

export function PulseRing({ color, radius = 10 }) {
    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.timing(pulse, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }));
        loop.start();
        return () => loop.stop();
    }, [pulse]);
    const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
    const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
    return (
        <>
            <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color, borderRadius: radius }]} />
            <Animated.View
                pointerEvents="none"
                style={[styles.ring, { borderColor: color, borderRadius: radius, opacity, transform: [{ scale }] }]}
            />
        </>
    );
}

const styles = StyleSheet.create({
    touch: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: SIZE,
        height: SIZE,
        marginLeft: -SIZE / 2,
        marginTop: -SIZE / 2,
        borderRadius: SIZE / 2,
        borderWidth: 2,
        zIndex: 2,
    },
    swipe: {
        marginTop: 0,
    },
    ring: {
        position: 'absolute',
        left: -5,
        right: -5,
        top: -5,
        bottom: -5,
        borderWidth: 2,
        zIndex: 2,
    },
});
