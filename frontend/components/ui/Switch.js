import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gradients } from '../../theme';
import { elevation, radii, useTheme } from '../../theme/tokens';

// Noeul Switch — the pill toggle from the settings and reader-settings rows.
// 50×30 track; on = coral→rose gradient with the accent glow, off = frosted
// strong fill. The cream 24px knob slides 20px over 200ms.
const TRACK_WIDTH = 50;
const TRACK_HEIGHT = 30;
const KNOB_SIZE = 24;
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - 6; // 3px padding each side

const Switch = ({ value = false, onValueChange, disabled = false, style }) => {
  const { colors, isDarkMode } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [anim, value]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, KNOB_TRAVEL],
  });

  return (
    <Pressable
      onPress={() => !disabled && onValueChange?.(!value)}
      disabled={disabled}
      style={[
        styles.track,
        { backgroundColor: colors.surfaceStrong },
        value && elevation.fab,
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {value ? (
        <LinearGradient
          colors={isDarkMode ? Gradients.accentDusk : Gradients.accent}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radii.pill }]}
        />
      ) : null}
      <Animated.View style={[styles.knob, { transform: [{ translateX }] }]} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
    padding: 3,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: 'rgba(0,0,0,0.25)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 5,
    elevation: 2,
  },
});

export default Switch;
