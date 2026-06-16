import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';
import { textStyles } from '../../theme/typography';

const SectionHeader = ({ eyebrow, title, subtitle, action, style }) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.row, style]}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={[textStyles.eyebrow, { color: colors.textTertiary }]}>{eyebrow}</Text> : null}
        {title ? <Text style={[textStyles.sectionTitle, { color: colors.text }]}>{title}</Text> : null}
        {subtitle ? <Text style={[textStyles.bodyMuted, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  action: {
    alignSelf: 'center',
  },
});

export default SectionHeader;
