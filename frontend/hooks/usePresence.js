import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * usePresence — keeps something on screen while it animates away. `progress`
 * runs 0 (gone) → 1 (shown) on the native driver, so it only drives opacity
 * and transforms; `mounted` stays true until the way out has finished.
 */
export default function usePresence(visible, {
    duration = 240,
    easing = Easing.bezier(0.22, 0.61, 0.36, 1),
    reduceMotion = false,
} = {}) {
    const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
    const [mounted, setMounted] = useState(visible);

    useEffect(() => {
        if (visible) setMounted(true);
        const animation = Animated.timing(progress, {
            toValue: visible ? 1 : 0,
            duration: reduceMotion ? 0 : duration,
            easing,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (finished && !visible) setMounted(false);
        });
        return () => animation.stop();
        // The timing settings are fixed per caller; only showing or hiding restarts it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, progress]);

    return { mounted: visible || mounted, progress };
}
