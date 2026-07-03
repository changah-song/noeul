import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Gradients } from '../../theme';
import { elevation, radii, useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';
import { Motion } from '../../theme';

// Noeul Button — the sunset CTA.
// primary: coral→rose gradient, cream text, soft accent glow
// secondary: frosted-glass ghost with a hairline border
// text: bare coral link · danger: outlined destructive
// Pills by default; 'square' (14px) for in-card actions.
// Quiet press — slight fade + 1px drop, never a bounce.
const GradientButton = ({
  label,
  onPress,
  variant = 'primary',
  icon = null,
  iconRight = null,
  size = 'md',
  shape = 'pill',
  uppercase = false,
  style,
  disabled = false,
}) => {
  const { colors, isDarkMode } = useTheme();
  const gradientColors = isDarkMode ? Gradients.accentDusk : Gradients.accent;

  const sizeStyles = {
    sm: { height: 36, paddingHorizontal: 18, fontSize: 14 },
    md: { height: 44, paddingHorizontal: 26, fontSize: 15 },
    lg: { height: 52, paddingHorizontal: 32, fontSize: 16 },
  };
  const s = sizeStyles[size] ?? sizeStyles.md;

  const borderRadius =
    shape === 'square' ? radii.md
    : shape === 'round' ? radii.sm
    : radii.pill;

  const labelStyle = uppercase
    ? { fontFamily: fontFamilies.sansBold, fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase' }
    : { fontFamily: fontFamilies.sansSemiBold, fontSize: s.fontSize };

  const pressableStyle = ({ pressed }) => [
    style,
    disabled
      ? { opacity: Motion.disabledOpacity }
      : pressed
        ? { opacity: 0.9, transform: [{ translateY: 1 }] }
        : null,
  ];

  if (variant === 'primary') {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[
            styles.base,
            { height: s.height, paddingHorizontal: s.paddingHorizontal, borderRadius },
            elevation.fab,
          ]}
        >
          {icon ? <View style={styles.iconLeft}>{icon}</View> : null}
          <Text style={[labelStyle, { color: colors.glyphCream }]}>{label}</Text>
          {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
        </LinearGradient>
      </Pressable>
    );
  }

  if (variant === 'text') {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
        <View style={[styles.base, styles.textVariant]}>
          {icon ? <View style={styles.iconLeft}>{icon}</View> : null}
          <Text style={[labelStyle, { color: colors.accent }]}>{label}</Text>
          {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
        </View>
      </Pressable>
    );
  }

  if (variant === 'danger') {
    return (
      <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
        <View
          style={[
            styles.base,
            {
              height: s.height,
              paddingHorizontal: s.paddingHorizontal,
              borderRadius,
              borderWidth: 1,
              borderColor: colors.borderStrong,
            },
          ]}
        >
          {icon ? <View style={styles.iconLeft}>{icon}</View> : null}
          <Text style={[labelStyle, { color: colors.danger }]}>{label}</Text>
        </View>
      </Pressable>
    );
  }

  // secondary — frosted-glass ghost
  const ghostContent = (
    <View
      style={[
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.paddingHorizontal,
          borderRadius,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.surfaceGlass,
          borderColor: colors.surfaceGlassBorder,
          borderWidth: 1,
        },
      ]}
    >
      {icon ? <View style={styles.iconLeft}>{icon}</View> : null}
      <Text style={[labelStyle, { color: colors.text }]}>{label}</Text>
      {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
    </View>
  );

  return (
    <Pressable onPress={onPress} disabled={disabled} style={pressableStyle}>
      <View style={{ borderRadius, overflow: 'hidden' }}>
        {Platform.OS === 'ios' ? (
          <>
            <BlurView
              intensity={isDarkMode ? 20 : 40}
              tint={isDarkMode ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceGlass }]} />
          </>
        ) : null}
        {ghostContent}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textVariant: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  iconLeft: {
    marginRight: 7,
  },
  iconRight: {
    marginLeft: 7,
  },
});

export default GradientButton;
