import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radii, useTheme } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';
import { textStyles } from '../../theme/typography';

const StatChip = ({ label, value, tone = 'accent', style }) => {
  const { colors } = useTheme();
  const toneMap = {
    accent: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.transparent,
    },
    neutral: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    muted: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.transparent,
    },
  };

  return (
    <View style={[styles.container, toneMap[tone], style]}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minWidth: 86,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
  },
  value: {
    ...textStyles.sectionTitle,
  },
  label: {
    ...textStyles.caption,
  },
});

export default StatChip;
