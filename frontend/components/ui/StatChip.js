import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radii, useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';

// Noeul StatChip — a compact stat block: a bold colored value over a small
// caption. Quiet context (words met, books, minutes), never a streak counter.
const StatChip = ({ label, value, tone = 'glass', accent, style }) => {
  const { colors } = useTheme();
  const toneMap = {
    glass: {
      backgroundColor: colors.surfaceGlass,
      borderColor: colors.surfaceGlassBorder,
    },
    accent: {
      backgroundColor: colors.accentSoft,
      borderColor: 'transparent',
    },
    muted: {
      backgroundColor: colors.surfaceMuted,
      borderColor: 'transparent',
    },
  };

  return (
    <View style={[styles.container, toneMap[tone] ?? toneMap.glass, style]}>
      <Text style={[styles.value, { color: accent ?? colors.accent }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.textSubtle }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    minWidth: 86,
    alignSelf: 'flex-start',
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 15,
    gap: 4,
  },
  value: {
    fontFamily: fontFamilies.sansExtraBold,
    fontSize: 20,
    lineHeight: 21,
    letterSpacing: -0.5,
  },
  label: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

export default StatChip;
