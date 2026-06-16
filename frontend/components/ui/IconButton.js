import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, useTheme } from '../../theme/tokens';
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
  const { colors } = useTheme();
  const isAccent = tone === 'accent';
  const toneStyle = isAccent
    ? {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    }
    : {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    };

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
      {label ? (
        <Text style={[
          styles.label,
          { color: isAccent ? colors.readerTappedWordText : colors.text },
        ]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...textStyles.label,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.5,
  },
});

export default IconButton;
