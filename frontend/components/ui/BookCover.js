import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Gradients } from '../../theme';
import { elevation, useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';

// Noeul BookCover — the generated default cover: a warm sunset gradient field
// (150deg) with a soft top-right sun glow, a dark left spine edge, and the
// title set bottom-left in the KR reading serif. 2:3 aspect by default.
const BookCover = ({
  title,
  author,
  style,
  titleStyle,
  titleSize = 16,
  padding = 12,
  spineWidth = 5,
  radius = 13,
  gradientColors,   // per-book field override, e.g. from an extracted palette
  lift = false,     // add the --shadow-cover book lift
  aspect = 2 / 3,   // pass null to size the cover from `style` instead
  showTitle = true,
  children,
}) => {
  const { isDarkMode } = useTheme();
  const field = gradientColors ?? (isDarkMode ? Gradients.coverDusk : Gradients.cover);

  return (
    <View
      style={[
        styles.cover,
        aspect != null && { aspectRatio: aspect },
        { borderRadius: radius },
        lift && elevation.coverLift,
        style,
      ]}
    >
      <LinearGradient
        colors={field}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Top-right sun glow — radial(130% 90% at 82% 2%, rgba(255,255,255,0.30), transparent 56%) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="coverGlow" cx="0.82" cy="0.02" rx="1.3" ry="0.9">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.30" />
              <Stop offset="0.56" stopColor="#FFFFFF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#coverGlow)" />
        </Svg>
      </View>
      {/* Dark left spine edge */}
      <View style={[styles.spineEdge, { width: spineWidth }]} />
      {showTitle && title ? (
        <View style={[styles.titleContainer, { padding }]}>
          {author ? (
            <Text style={styles.author} numberOfLines={1}>{author}</Text>
          ) : null}
          <Text
            style={[
              styles.title,
              { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.3) },
              titleStyle,
            ]}
            numberOfLines={3}
          >
            {title}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  cover: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  spineEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  titleContainer: {
    justifyContent: 'flex-end',
  },
  author: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#FFFFFF',
    opacity: 0.82,
    marginBottom: 6,
  },
  title: {
    fontFamily: fontFamilies.krSerifSemiBold,
    color: '#FFFFFF',
  },
});

export default BookCover;
