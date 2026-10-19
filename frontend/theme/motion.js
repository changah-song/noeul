import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

// ─── Motion (Paper redesign) ──────────────────────────────────────────────────
//
// Apple's approach to motion, translated to React Native's Animated:
//
// - Respond on press-in, not on release (PressableScale).
// - Springs, not fixed-duration tweens, for anything a finger can touch: a
//   spring starts from wherever the value is now and can be re-targeted at
//   any moment, so nothing ever has to finish before the next touch.
// - Springs are specified the way Apple does: a damping ratio (1 = no
//   overshoot) and a response in seconds (how quickly it gets there), not
//   raw stiffness / damping.
// - Bounce only when the gesture itself carried momentum (a flick); a sheet
//   that just opens settles without overshoot.
// - When a drag ends, the animation continues at the finger's velocity, and
//   where it lands is chosen from where that velocity is heading (projection).
// - Edges resist progressively (rubber-banding) instead of stopping dead.
// - Reduced motion swaps slides and springs for short cross-fades.

/**
 * springFrom — Animated.spring config from Apple's two parameters.
 * stiffness = (2π / response)², damping = 4π · ratio / response (mass 1).
 */
export const springFrom = ({ response = 0.35, dampingRatio = 1 } = {}) => {
  const omega = (2 * Math.PI) / response;
  return {
    stiffness: omega * omega,
    damping: 4 * Math.PI * dampingRatio / response,
    mass: 1,
    overshootClamping: false,
    // Fine enough for unit-range values (scale, opacity). Android's native
    // spring checks "at rest" before its first step, so a coarse threshold
    // would leave a 0.97 → 1 press release frozen where it started.
    restDisplacementThreshold: 0.001,
    restSpeedThreshold: 0.001,
  };
};

// Named springs, from the values Apple ships.
export const springs = {
  // Default UI motion: critically damped, quick.
  standard: springFrom({ response: 0.35, dampingRatio: 1 }),
  // Small state changes (a tab indicator, a toggle).
  snappy: springFrom({ response: 0.25, dampingRatio: 1 }),
  // A sheet or drawer released after a flick: a little bounce, earned by
  // the momentum.
  flick: springFrom({ response: 0.3, dampingRatio: 0.82 }),
  // Moving something to a new place on screen.
  move: springFrom({ response: 0.4, dampingRatio: 1 }),
};

/**
 * springTo — animate `value` to `toValue` with a spring. `gestureVelocity`
 * is a PanResponder velocity (vx / vy, px per ms); the spring starts at that
 * speed (it integrates in seconds, so ×1000), leaving no seam between the
 * drag and the animation. `precision` sets when it counts as settled: the
 * default suits unit-range values; pass PX_PRECISION for a pixel offset
 * whose completion unmounts something, so the invisible tail is skipped.
 */
export const PX_PRECISION = 0.5;
export const springTo = (value, toValue, {
  spring = springs.standard,
  gestureVelocity = 0,
  useNativeDriver = true,
  precision,
} = {}) => (
  Animated.spring(value, {
    toValue,
    velocity: (Number(gestureVelocity) || 0) * 1000,
    useNativeDriver,
    ...spring,
    ...(precision ? { restDisplacementThreshold: precision, restSpeedThreshold: precision } : null),
  })
);

/** Reduced-motion fallback: a short opacity-friendly timing. */
export const fadeTo = (value, toValue, { duration = 180, useNativeDriver = true } = {}) => (
  Animated.timing(value, {
    toValue,
    duration,
    easing: Easing.out(Easing.quad),
    useNativeDriver,
  })
);

/**
 * project — where a flick is heading: Apple's exponential-decay projection.
 * `velocity` in px/ms (PanResponder's vx / vy); returns a distance in px.
 */
export const project = (velocity, decelerationRate = 0.998) => {
  const pxPerSecond = velocity * 1000;
  return (pxPerSecond / 1000) * decelerationRate / (1 - decelerationRate);
};

/**
 * rubberband — how far an element follows a drag that has gone `overshoot`
 * px past its bound, for a dimension of `dimension` px. Real things slow
 * before they stop.
 */
export const rubberband = (overshoot, dimension, constant = 0.55) => {
  const sign = overshoot < 0 ? -1 : 1;
  const x = Math.abs(overshoot);
  return sign * ((x * dimension * constant) / (dimension + constant * x));
};

/** useReducedMotion — follows the system "remove animations" setting. */
export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (active) setReduced(!!value); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => setReduced(!!value));
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);
  return reduced;
};

// Press feedback: scale applied the instant a finger lands, released with a
// spring so a quick tap still reads.
export const PRESS_SCALE = 0.97;
export const PRESS_IN_MS = 90;
