import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gradients } from '../../theme';
import { radii, useTheme } from '../../theme/tokens';
import { spacing } from '../../theme/spacing';
import { textStyles } from '../../theme/typography';

const clamp = (value) => Math.min(1, Math.max(0, value));

const ProgressBar = ({
  progress,
  value,
  max = 100,
  label,
  detail,
  height = 3,
  fillColor,
  trackColor,
  gradient = true,
  style,
}) => {
  const { colors, isDarkMode } = useTheme();
  const normalized = progress != null ? clamp(progress) : clamp((value ?? 0) / max);
  // --reader-progress-track: rgba(154,139,143,0.24) light / rgba(255,255,255,0.14) dusk
  const resolvedTrackColor = trackColor ?? colors.readerProgressTrack;
  const gradientColors = isDarkMode ? Gradients.progressDusk : Gradients.progress;

  return (
    <View style={style}>
      {(label || detail) ? (
        <View style={styles.metaRow}>
          {label ? <Text style={textStyles.label}>{label}</Text> : <View />}
          {detail ? <Text style={textStyles.caption}>{detail}</Text> : null}
        </View>
      ) : null}
      <View style={[styles.track, { height, backgroundColor: resolvedTrackColor }]}>
        {gradient && !fillColor ? (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fill, { width: `${normalized * 100}%` }]}
          />
        ) : (
          <View
            style={[
              styles.fill,
              { width: `${normalized * 100}%`, backgroundColor: fillColor ?? colors.accent },
            ]}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  track: {
    width: '100%',
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});

export default ProgressBar;
