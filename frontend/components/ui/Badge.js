import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gradients } from '../../theme';
import { radii, useTheme, withAlpha } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';

// Noeul Badge — a tiny uppercase tag for levels, formats (EPUB), and status.
// Soft sunset tints (coral / rose / amber), a neutral glass chip, a hairline
// outline, or a filled gradient. Soft-square radius, wide tracking.
const Badge = ({ label, tone = 'neutral', style }) => {
  const { colors, isDarkMode } = useTheme();

  if (tone === 'solid') {
    return (
      <View style={[styles.badge, styles.noBorder, { overflow: 'hidden' }, style]}>
        <LinearGradient
          colors={isDarkMode ? Gradients.accentDusk : Gradients.accent}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={[styles.label, { color: colors.glyphCream }]}>{label}</Text>
      </View>
    );
  }

  const toneMap = {
    neutral: {
      backgroundColor: colors.surfaceMuted,
      borderColor: 'transparent',
      color: colors.textMuted,
    },
    outline: {
      backgroundColor: 'transparent',
      borderColor: colors.borderStrong,
      color: colors.textSecondary,
    },
    coral: {
      backgroundColor: colors.accentSoft,
      borderColor: 'transparent',
      color: colors.accent,
    },
    rose: {
      backgroundColor: withAlpha(colors.accent2, isDarkMode ? 0.16 : 0.14),
      borderColor: 'transparent',
      color: colors.accent2,
    },
    amber: {
      backgroundColor: withAlpha(colors.accent3, isDarkMode ? 0.18 : 0.16),
      borderColor: 'transparent',
      color: colors.accent3,
    },
  };

  const resolved = toneMap[tone] ?? toneMap.neutral;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: resolved.backgroundColor, borderColor: resolved.borderColor },
        style,
      ]}
    >
      <Text style={[styles.label, { color: resolved.color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.xs,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  noBorder: {
    borderWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  label: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
});

export default Badge;
