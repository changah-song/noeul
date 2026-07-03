import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/tokens';
import { insets } from '../../theme/spacing';

// SunsetSky — the "Sunset & Paper" page gradient (--gradient-page), rendered
// exactly as the CSS defines it: a vertical base wash under two radial glows.
//   light: radial(120% 70% at 0% 0%, #FFE6D2 → 50%),
//          radial(120% 80% at 100% 8%, #FAD3D9 → 45%),
//          linear(#FFF3EA 0%, #FBE3D2 55%, #F6CDB6 100%)
//   dusk:  radial(120% 70% at 8% -5%, rgba(255,138,92,.55) → 48%),
//          radial(110% 75% at 100% 10%, rgba(217,106,130,.42) → 46%),
//          linear(#241318 0%, #2C151B 45%, #1A1014 100%)
const SunsetSky = ({ isDarkMode }) => {
  if (isDarkMode) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="skyBaseDusk" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#241318" />
              <Stop offset="0.45" stopColor="#2C151B" />
              <Stop offset="1" stopColor="#1A1014" />
            </LinearGradient>
            <RadialGradient id="skyGlowRoseDusk" cx="1" cy="0.1" rx="1.1" ry="0.75">
              <Stop offset="0" stopColor="#D96A82" stopOpacity="0.42" />
              <Stop offset="0.46" stopColor="#D96A82" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="skyGlowCoralDusk" cx="0.08" cy="-0.05" rx="1.2" ry="0.7">
              <Stop offset="0" stopColor="#FF8A5C" stopOpacity="0.55" />
              <Stop offset="0.48" stopColor="#FF8A5C" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#skyBaseDusk)" />
          <Rect width="100%" height="100%" fill="url(#skyGlowRoseDusk)" />
          <Rect width="100%" height="100%" fill="url(#skyGlowCoralDusk)" />
        </Svg>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="skyBase" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF3EA" />
            <Stop offset="0.55" stopColor="#FBE3D2" />
            <Stop offset="1" stopColor="#F6CDB6" />
          </LinearGradient>
          <RadialGradient id="skyGlowRose" cx="1" cy="0.08" rx="1.2" ry="0.8">
            <Stop offset="0" stopColor="#FAD3D9" stopOpacity="1" />
            <Stop offset="0.45" stopColor="#FAD3D9" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="skyGlowCream" cx="0" cy="0" rx="1.2" ry="0.7">
            <Stop offset="0" stopColor="#FFE6D2" stopOpacity="1" />
            <Stop offset="0.5" stopColor="#FFE6D2" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#skyBase)" />
        <Rect width="100%" height="100%" fill="url(#skyGlowRose)" />
        <Rect width="100%" height="100%" fill="url(#skyGlowCream)" />
      </Svg>
    </View>
  );
};

const Screen = ({
  children,
  scroll = false,
  backgroundColor,
  style,
  contentContainerStyle,
  scrollViewProps,
  edges = ['top', 'left', 'right'],
  gradient = false,   // set true to render the Sunset & Paper sky gradient
}) => {
  const { colors, isDarkMode } = useTheme();
  const resolvedBackground = backgroundColor ?? colors.bgPage;

  const baseStyle = [
    styles.safeArea,
    { backgroundColor: gradient ? 'transparent' : resolvedBackground },
    style,
  ];

  const wrapper = (content) => gradient ? (
    <View style={[styles.fill, { backgroundColor: resolvedBackground }]}>
      <SunsetSky isDarkMode={isDarkMode} />
      <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor: 'transparent' }]}>
        {content}
      </SafeAreaView>
    </View>
  ) : (
    <SafeAreaView edges={edges} style={baseStyle}>
      {content}
    </SafeAreaView>
  );

  if (scroll) {
    return wrapper(
      <ScrollView
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
        {...scrollViewProps}
      >
        {children}
      </ScrollView>
    );
  }

  return wrapper(
    <View style={[styles.content, contentContainerStyle]}>{children}</View>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: insets.screenTop,
    paddingBottom: insets.screenBottom,
  },
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: insets.screenTop,
    paddingBottom: insets.screenBottom,
  },
});

export default Screen;
