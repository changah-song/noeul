import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Gradients } from '../../theme';
import { elevation, useTheme } from '../../theme/tokens';

// Noeul IconButton — the circular icon buttons used across the app:
//   gradient: coral→rose fill + accent glow (avatar, practice-card actions)
//   glass:    frosted circle with a light hairline (scan-a-page)
//   muted:    faint tint fill + strong hairline (draft, refresh-prompt)
//   outline:  bare hairline circle (lookup hop arrows)
//   ghost:    transparent (back chevrons, header actions)
// Press = scale 0.97 + fade, per the universal .press treatment.
const IconButton = ({
  icon,
  onPress,
  tone = 'ghost',
  size = 38,
  style,
  disabled = false,
}) => {
  const { colors, isDarkMode } = useTheme();
  const round = { width: size, height: size, borderRadius: size / 2 };

  const pressableStyle = ({ pressed }) => [
    disabled
      ? { opacity: 0.5 }
      : pressed
        ? { opacity: 0.9, transform: [{ scale: 0.97 }] }
        : null,
    style,
  ];

  if (tone === 'gradient') {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
        <LinearGradient
          colors={isDarkMode ? Gradients.accentDusk : Gradients.accent}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.center, round, elevation.fab]}
        >
          {icon}
        </LinearGradient>
      </Pressable>
    );
  }

  if (tone === 'glass') {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
        <View style={[styles.center, round, { borderWidth: 1, borderColor: colors.surfaceGlassBorder, overflow: 'hidden' }]}>
          {Platform.OS === 'ios' ? (
            <BlurView
              intensity={isDarkMode ? 20 : 40}
              tint={isDarkMode ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceGlass }]} />
          {icon}
        </View>
      </Pressable>
    );
  }

  const tones = {
    muted: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    outline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    ghost: {
      backgroundColor: 'transparent',
    },
  };

  return (
    <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
      <View style={[styles.center, round, tones[tone] ?? tones.ghost]}>
        {icon}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default IconButton;
