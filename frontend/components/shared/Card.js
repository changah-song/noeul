import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { elevation, radii, useTheme } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';

// Noeul Card — frosted-glass surface over the sunset sky.
// tone="glass" (default) uses BlurView + semi-transparent fill.
// tone="elevated" / "muted" / "strong" are opaque alternatives for cases
// where the gradient background isn't visible behind the card.

const Card = ({
  children,
  style,
  contentStyle,
  tone = 'glass',
  padded = true,
  subtle = false,
  glow = false,
  radius = 'lg',
}) => {
  const { colors, isDarkMode } = useTheme();

  const resolvedRadius = typeof radius === 'number'
    ? radius
    : radii[radius] ?? radii.lg;

  const shadowStyle = glow
    ? elevation.glass
    : subtle
      ? elevation.subtle
      : elevation.card;

  // Glass tone: BlurView with semi-transparent overlay — the signature frosted look.
  if (tone === 'glass') {
    return (
      <BlurView
        intensity={isDarkMode ? 28 : 40}
        tint={isDarkMode ? 'dark' : 'light'}
        style={[
          styles.glassBase,
          {
            borderRadius: resolvedRadius,
            borderColor: colors.surfaceGlassBorder,
            backgroundColor: colors.surfaceGlass,
          },
          shadowStyle,
          style,
        ]}
      >
        <View style={[padded && styles.padded, contentStyle]}>{children}</View>
      </BlurView>
    );
  }

  const toneStyles = {
    elevated: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
    },
    muted: {
      backgroundColor: colors.surfaceMuted,
      borderColor: 'transparent',
    },
    strong: {
      backgroundColor: colors.surfaceStrong,
      borderColor: colors.border,
    },
    reader: {
      backgroundColor: colors.readerPaper,
      borderColor: colors.readerBorder,
    },
  };

  return (
    <View
      style={[
        styles.base,
        toneStyles[tone] ?? toneStyles.elevated,
        { borderRadius: resolvedRadius },
        shadowStyle,
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
  glassBase: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,  // 19px — matches --space-lg
  },
});

export default Card;
