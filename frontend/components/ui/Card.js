import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { elevation, radii, useTheme } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';

// Noeul Card — a frosted-glass surface over the sunset sky.
// tone: 'glass' (default) | 'reader' | 'solid' | 'muted' | 'accent' | 'strong'
// Glass/reader tones get a backdrop blur (iOS) over the translucent fill.
// No shadow by default; `glow` adds the soft --shadow-glass lift.
const Card = ({
  children,
  style,
  contentStyle,
  tone = 'glass',
  padded = true,
  radius = 'lg',
  glow = false,
}) => {
  const { colors, isDarkMode } = useTheme();
  const borderRadius = radii[radius] ?? radii.lg;
  const shadow = glow ? elevation.glass : null;

  const blurTones = {
    glass: {
      backgroundColor: colors.surfaceGlass,
      borderColor: colors.surfaceGlassBorder,
    },
    reader: {
      backgroundColor: colors.readerPaper,
      borderColor: colors.readerPaperBorder,
    },
  };

  if (blurTones[tone]) {
    const t = blurTones[tone];
    if (Platform.OS === 'ios') {
      return (
        <BlurView
          intensity={isDarkMode ? 20 : 40}
          tint={isDarkMode ? 'dark' : 'light'}
          style={[styles.base, { borderRadius, borderColor: t.borderColor }, shadow, style]}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.backgroundColor }]} />
          <View style={[padded && styles.padded, contentStyle]}>{children}</View>
        </BlurView>
      );
    }
    return (
      <View
        style={[
          styles.base,
          { borderRadius, backgroundColor: t.backgroundColor, borderColor: t.borderColor },
          shadow,
          style,
        ]}
      >
        <View style={[padded && styles.padded, contentStyle]}>{children}</View>
      </View>
    );
  }

  const flatTones = {
    solid: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    elevated: {
      backgroundColor: colors.surfaceElevated ?? colors.surface,
      borderColor: colors.border,
    },
    muted: {
      backgroundColor: colors.surfaceMuted,
      borderColor: 'transparent',
    },
    accent: {
      backgroundColor: colors.accentSoft,
      borderColor: 'transparent',
    },
    strong: {
      backgroundColor: colors.surfaceStrong,
      borderColor: 'transparent',
    },
  };

  return (
    <View
      style={[
        styles.base,
        { borderRadius },
        flatTones[tone] ?? flatTones.solid,
        shadow,
        style,
      ]}
    >
      <View style={[padded && styles.padded, contentStyle]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,
  },
});

export default Card;
