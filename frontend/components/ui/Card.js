import React from 'react';
import { StyleSheet, View } from 'react-native';
import { elevation, radii, useTheme } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';

const Card = ({
  children,
  style,
  contentStyle,
  tone = 'elevated',
  padded = true,
  subtle = false,
}) => {
  const { colors } = useTheme();
  const toneStyles = {
    elevated: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
    },
    muted: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.transparent,
    },
    strong: {
      backgroundColor: colors.surfaceStrong,
      borderColor: colors.border,
    },
  };

  return (
    <View
      style={[
        styles.base,
        toneStyles[tone],
        subtle ? elevation.subtle : elevation.card,
        style,
      ]}
    >
      <View style={[padded && styles.padded, contentStyle]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  padded: {
    padding: spacing.md,
  },
});

export default Card;
