import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';
import { textStyles } from '../../theme/typography';

const IconButton = ({
  icon,
  label,
  onPress,
  tone = 'neutral',
  style,
  disabled = false,
}) => {
  const toneStyle = tone === 'accent' ? styles.accent : styles.neutral;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        toneStyle,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
  },
  neutral: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  accent: {
    backgroundColor: colors.accentSoft,
    borderColor: 'transparent',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...textStyles.label,
    color: colors.text,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.5,
  },
});

export default IconButton;
