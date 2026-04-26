import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, elevation, radii } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';

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
    borderColor: 'transparent',
  },
};

const Card = ({
  children,
  style,
  contentStyle,
  tone = 'elevated',
  padded = true,
  subtle = false,
}) => {
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
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  padded: {
    padding: spacing.lg,
  },
});

export default Card;
