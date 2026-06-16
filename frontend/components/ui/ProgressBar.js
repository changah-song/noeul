import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  height = 10,
  fillColor,
  trackColor,
  style,
}) => {
  const { colors } = useTheme();
  const normalized = progress != null ? clamp(progress) : clamp((value ?? 0) / max);
  const resolvedFillColor = fillColor ?? colors.accent;
  const resolvedTrackColor = trackColor ?? colors.surfaceStrong;

  return (
    <View style={style}>
      {(label || detail) ? (
        <View style={styles.metaRow}>
          {label ? <Text style={textStyles.label}>{label}</Text> : <View />}
          {detail ? <Text style={textStyles.caption}>{detail}</Text> : null}
        </View>
      ) : null}
      <View style={[styles.track, { height, backgroundColor: resolvedTrackColor }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${normalized * 100}%`,
              backgroundColor: resolvedFillColor,
            },
          ]}
        />
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
