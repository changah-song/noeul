import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fontFamilies } from '../../theme';

// A saved word that is due, as a row in the Learn list. Touching it shows the
// meaning; the same touch can carry on into a swipe that grades it: right =
// known (green), left = not known (red). The row then slides off and closes
// up, and only after that tells the list, which moves the word to its queue.

const KNOWN_GREEN = '#2e8b57';
// A drag has to be clearly sideways before the row takes it from the list.
const SWIPE_START_DISTANCE = 8;
const FLING_VELOCITY = 0.5;
const FLING_MIN_DISTANCE = 36;
const FLY_OUT_MS = 170;
const COLLAPSE_MS = 150;
// The row itself only washes with the colour, so the word stays readable.
const ROW_TINT_OPACITY = 0.3;

const SwipeWordRow = ({
  word,
  screenWidth,
  styles,
  colors,
  knownLabel,
  unknownLabel,
  // When the word comes back for each answer, shown behind the row as it is
  // dragged so the outcome is visible before letting go.
  knownHint = '',
  unknownHint = '',
  // Rock the row once to show it can be swiped (first visit only).
  nudge = false,
  renderContent,
  onGrade,
  onOpen,
  onSwipeActive,
}) => {
  // Sideways offset of the row. Driven natively for the fly-out and the
  // spring back; set directly while the finger is down.
  const pan = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const collapse = useRef(new Animated.Value(1)).current;
  const heightRef = useRef(0);
  const gradedRef = useRef(false);
  const pastThresholdRef = useRef(false);
  const revealedRef = useRef(false);
  // Whether the meaning was already showing when the current touch began.
  const openOnPressRef = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const [collapseHeight, setCollapseHeight] = useState(null);

  const threshold = Math.min(120, screenWidth * 0.28);

  const showMeaning = useCallback(() => {
    if (gradedRef.current || revealedRef.current) {
      return;
    }
    revealedRef.current = true;
    setRevealed(true);
    Animated.timing(reveal, {
      toValue: 1,
      // Slow enough to read as the meaning surfacing, short enough that a
      // quick swipe is never left waiting on it.
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reveal]);

  const grade = useCallback((status, velocity = 0) => {
    if (gradedRef.current) {
      return;
    }
    gradedRef.current = true;
    onSwipeActive(false);
    setCollapseHeight(heightRef.current);
    const direction = status === 'good' ? 1 : -1;
    Animated.timing(pan, {
      toValue: direction * screenWidth,
      // A hard flick leaves faster than a slow drag past the line.
      duration: Math.abs(velocity) > 1.2 ? FLY_OUT_MS * 0.7 : FLY_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(collapse, {
        toValue: 0,
        duration: COLLAPSE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start(() => onGrade(word, status));
    });
  }, [collapse, onGrade, onSwipeActive, pan, screenWidth, word]);

  const springBack = useCallback(() => {
    onSwipeActive(false);
    pastThresholdRef.current = false;
    Animated.spring(pan, {
      toValue: 0,
      bounciness: 4,
      speed: 20,
      useNativeDriver: true,
    }).start();
  }, [onSwipeActive, pan]);

  useEffect(() => {
    if (!nudge) {
      return undefined;
    }
    const step = (toValue) => Animated.timing(pan, {
      toValue,
      duration: 260,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    const timer = setTimeout(() => {
      if (!gradedRef.current) {
        Animated.sequence([step(56), step(0), step(-56), step(0)]).start();
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [nudge, pan]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      !gradedRef.current
      && Math.abs(gesture.dx) > SWIPE_START_DISTANCE
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5
    ),
    onPanResponderGrant: () => {
      pastThresholdRef.current = false;
      showMeaning();
      onSwipeActive(true);
    },
    onPanResponderMove: (_, gesture) => {
      pan.setValue(gesture.dx);
      const past = Math.abs(gesture.dx) >= threshold;
      if (past !== pastThresholdRef.current) {
        pastThresholdRef.current = past;
        if (past) {
          Haptics.selectionAsync().catch(() => {});
        }
      }
    },
    onPanResponderRelease: (_, gesture) => {
      const flung = Math.abs(gesture.vx) > FLING_VELOCITY
        && Math.abs(gesture.dx) > FLING_MIN_DISTANCE
        && Math.sign(gesture.vx) === Math.sign(gesture.dx);
      if (Math.abs(gesture.dx) >= threshold || flung) {
        grade(gesture.dx > 0 ? 'good' : 'bad', gesture.vx);
        return;
      }
      springBack();
    },
    onPanResponderTerminate: springBack,
    onPanResponderTerminationRequest: () => false,
  }), [grade, onSwipeActive, pan, showMeaning, springBack, threshold]);

  // The row tints as it moves, and the strip it uncovers behind it is the
  // full colour: red to the left (not known), green to the right (known).
  const unknownTint = pan.interpolate({
    inputRange: [-threshold, 0],
    outputRange: [ROW_TINT_OPACITY, 0],
    extrapolate: 'clamp',
  });
  const knownTint = pan.interpolate({
    inputRange: [0, threshold],
    outputRange: [0, ROW_TINT_OPACITY],
    extrapolate: 'clamp',
  });
  const unknownBackdrop = pan.interpolate({
    inputRange: [-1, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const knownBackdrop = pan.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.rowOuter,
        collapseHeight != null && {
          height: collapse.interpolate({ inputRange: [0, 1], outputRange: [0, collapseHeight] }),
        },
      ]}
      onLayout={(event) => {
        if (collapseHeight == null) {
          heightRef.current = event.nativeEvent.layout.height;
        }
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, styles.backdropUnknown, { backgroundColor: colors.danger, opacity: unknownBackdrop }]}
      >
        <View style={styles.backdropContent}>
          {unknownHint ? <Text style={styles.backdropText}>{unknownHint}</Text> : null}
          <Feather name="x" size={20} color="#ffffff" />
        </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, styles.backdropKnown, { opacity: knownBackdrop }]}
      >
        <View style={styles.backdropContent}>
          <Feather name="check" size={20} color="#ffffff" />
          {knownHint ? <Text style={styles.backdropText}>{knownHint}</Text> : null}
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.row, { backgroundColor: colors.bgPage, transform: [{ translateX: pan }] }]}
        {...panResponder.panHandlers}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, { backgroundColor: colors.danger, opacity: unknownTint }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, styles.tintKnown, { opacity: knownTint }]}
        />
        {/* The row's look belongs to the list. It gets the press handlers
            and the meaning's opacity: the meaning shows the moment the finger
            lands, so the same touch can carry straight on into the swipe. A
            tap on a row whose meaning is already showing opens the word. */}
        {renderContent(word, {
          reveal,
          revealed,
          pressableProps: {
            onPressIn: () => {
              openOnPressRef.current = revealedRef.current;
              showMeaning();
            },
            onPress: () => {
              if (openOnPressRef.current && !gradedRef.current) {
                onOpen?.(word);
              }
            },
            accessibilityRole: 'button',
            accessibilityActions: [
              { name: 'known', label: knownLabel },
              { name: 'unknown', label: unknownLabel },
            ],
            onAccessibilityAction: (event) => {
              grade(event.nativeEvent.actionName === 'known' ? 'good' : 'bad');
            },
          },
        })}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  rowOuter: {
    overflow: 'hidden',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  // A row dragged left uncovers its right edge, and the other way round.
  backdropUnknown: {
    alignItems: 'flex-end',
  },
  backdropKnown: {
    alignItems: 'flex-start',
    backgroundColor: KNOWN_GREEN,
  },
  backdropContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backdropText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
  },
  row: {},
  tint: {
    ...StyleSheet.absoluteFillObject,
  },
  tintKnown: {
    backgroundColor: KNOWN_GREEN,
  },
});

const MemoRow = React.memo((props) => <SwipeWordRow {...props} styles={styles} />);

export default MemoRow;
