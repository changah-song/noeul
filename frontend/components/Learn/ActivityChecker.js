import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radii, spacing, useTheme } from '../../theme';

const ActivityChecker = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const activityColors = useMemo(() => [
    colors.surfaceMuted,
    colors.divider,
    colors.textSubtle,
    colors.textTertiary,
    colors.accent,
  ], [colors]);
  // Dummy data for activity level (0-4, where 0 is least active and 4 is most active)
  const activityData = [
    [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2],
    [1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3],
    [2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4],
    [3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]
  ];

  return (
    <View style={styles.container}>
      {activityData.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((activityLevel, columnIndex) => (
            <View
              key={columnIndex}
              style={[
                styles.square,
                { backgroundColor: activityColors[activityLevel] ?? colors.surfaceMuted }
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: spacing.sm,
  },
  row: {
    flexDirection: 'row',
  },
  square: {
    width: 18,
    height: 18,
    margin: 2,
    borderRadius: radii.xs,
    borderColor: colors.border,
    borderWidth: 1
  },
});

const styles = createStyles(colors);

export default ActivityChecker;
