import React, { useCallback, useRef, useState } from 'react';
import { Animated, Pressable } from 'react-native';
import { PRESS_IN_MS, PRESS_SCALE, springs, springTo, useReducedMotion } from '../../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * PressableScale — a Pressable that answers the instant a finger lands: it
 * dips to PRESS_SCALE on press-in and springs back on release (or when the
 * finger slides away, which cancels the press). Feedback never waits for the
 * tap to finish. With reduced motion it dims instead of scaling.
 *
 * Takes Pressable's props; `style` may be an object, an array or a function
 * of `{ pressed }`. (An animated component cannot take a style function, so
 * the pressed state is tracked here and the style resolved before render.)
 */
const PressableScale = ({
    children,
    style,
    scaleTo = PRESS_SCALE,
    disabled,
    onPressIn,
    onPressOut,
    hitSlop = 8,
    ...rest
}) => {
    const scale = useRef(new Animated.Value(1)).current;
    const reduced = useReducedMotion();
    const [pressed, setPressed] = useState(false);

    const handlePressIn = useCallback((event) => {
        setPressed(true);
        Animated.timing(scale, {
            toValue: reduced ? 1 : scaleTo,
            duration: PRESS_IN_MS,
            useNativeDriver: true,
        }).start();
        onPressIn?.(event);
    }, [onPressIn, reduced, scale, scaleTo]);

    const handlePressOut = useCallback((event) => {
        setPressed(false);
        springTo(scale, 1, { spring: springs.snappy }).start();
        onPressOut?.(event);
    }, [onPressOut, scale]);

    const resolved = typeof style === 'function' ? style({ pressed }) : style;

    return (
        <AnimatedPressable
            {...rest}
            disabled={disabled}
            hitSlop={hitSlop}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={[
                resolved,
                { transform: [{ scale }] },
                reduced && pressed ? { opacity: 0.7 } : null,
                disabled ? { opacity: 0.45 } : null,
            ]}
        >
            {typeof children === 'function' ? children({ pressed }) : children}
        </AnimatedPressable>
    );
};

export default PressableScale;
