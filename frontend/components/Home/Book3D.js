import { Animated, StyleSheet, View } from 'react-native';

// Wraps a book cover (any children sized to width/height) as a flat, sleek
// book: crisp corners (a touch rounder on the opening edge than the spine)
// and one soft shadow, no faked lighting. shadowOpacity accepts a plain number
// or an Animated value so a carousel can fade the lift in and out;
// glossOpacity is accepted for older callers and ignored.
const Book3D = ({
    width,
    height,
    radius = 2,
    shadowOpacity = 1,
    style,
    children,
}) => {
    const spineRadius = Math.max(2, Math.round(radius * 0.6));
    const edgeRadius = Math.max(spineRadius + 2, Math.round(Math.min(width, height) * 0.05));
    const corners = {
        borderTopLeftRadius: spineRadius,
        borderBottomLeftRadius: spineRadius,
        borderTopRightRadius: edgeRadius,
        borderBottomRightRadius: edgeRadius,
    };
    return (
        <View style={[{ width, height }, style]}>
            <Animated.View
                pointerEvents="none"
                style={[styles.shadow, corners, { opacity: shadowOpacity }]}
            />
            <View style={[styles.clip, corners]}>
                {children}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    shadow: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#0b0d12',
        shadowColor: '#000000',
        shadowOpacity: 0.14,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 5,
    },
    clip: {
        flex: 1,
        overflow: 'hidden',
    },
});

export default Book3D;
