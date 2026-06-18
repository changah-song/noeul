import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../../../theme';

const SHIMMER_DISTANCE = 200;
const SHIMMER_DURATION = 1400;

const LookupLoadingSkeleton = ({
    firstLineOffset = 14,
    secondLineOffset = 11,
    shortLineWidth = '68%',
    style,
}) => {
    const { colors, isDarkMode } = useTheme();
    const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);
    const shimmerProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        shimmerProgress.setValue(0);
        const loop = Animated.loop(
            Animated.timing(shimmerProgress, {
                toValue: 1,
                duration: SHIMMER_DURATION,
                easing: Easing.bezier(0.25, 0.1, 0.25, 1),
                useNativeDriver: true,
            })
        );

        loop.start();
        return () => loop.stop();
    }, [shimmerProgress]);

    const translateX = shimmerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [SHIMMER_DISTANCE, -SHIMMER_DISTANCE],
    });

    const renderLine = (lineStyle) => (
        <View style={[styles.line, lineStyle]}>
            <Animated.View style={[styles.sweep, { transform: [{ translateX }] }]}>
                <View style={styles.sweepEdge} />
                <View style={styles.sweepCore} />
                <View style={styles.sweepEdge} />
            </Animated.View>
        </View>
    );

    return (
        <View style={style}>
            {renderLine({ marginTop: firstLineOffset })}
            {renderLine({ marginTop: secondLineOffset, width: shortLineWidth })}
        </View>
    );
};

const createStyles = (colors, isDarkMode) => {
    const baseColor = isDarkMode ? colors.surfaceMuted : '#f0eded';
    const edgeColor = isDarkMode ? colors.border : '#ebe8e8';
    const coreColor = isDarkMode ? colors.frame : '#e6e3e3';

    return StyleSheet.create({
        line: {
            width: '100%',
            height: 13,
            borderRadius: 2,
            backgroundColor: baseColor,
            overflow: 'hidden',
        },
        sweep: {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: 160,
            flexDirection: 'row',
        },
        sweepEdge: {
            flex: 1,
            backgroundColor: edgeColor,
        },
        sweepCore: {
            width: 48,
            backgroundColor: coreColor,
        },
    });
};

export default LookupLoadingSkeleton;
