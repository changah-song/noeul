import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * useReduceMotion — whether the phone asks for reduced motion, kept current
 * while the setting changes.
 */
export default function useReduceMotion() {
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

    return reduceMotion;
}
