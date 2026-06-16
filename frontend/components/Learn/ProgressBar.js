import React, { useMemo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { colors, radii, textStyles, useTheme } from '../../theme';

const ProgressBar = ({ data }) => { 
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Initialize counters for each level
  let unorganizedCount = 0;
  let badCount = 0;
  let midCount = 0;
  let goodCount = 0;

  // Total count of items
  const totalCount = data.length;

  // Calculate counts for each level
  data.forEach(item => {
    switch (item.level) {
      case 'unorganized':
        unorganizedCount++;
        break;
      case 'bad':
        badCount++;
        break;
      case 'mid':
        midCount++;
        break;
      case 'good':
        goodCount++;
        break;
      default:
        break;
    }
  });

  // Calculate percentages
  const unorganizedPercent = (unorganizedCount / totalCount) * 100;
  const badPercent = (badCount / totalCount) * 100;
  const midPercent = (midCount / totalCount) * 100;
  const goodPercent = (goodCount / totalCount) * 100;

  return (
    <View>
      <View style={styles.container}>
        <View style={[styles.bar, { width: `${unorganizedPercent}%`, backgroundColor: colors.surfaceMuted }]}>
          <Text style={styles.text}>{`${unorganizedCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${badPercent}%`, backgroundColor: colors.textSubtle }]}>
          <Text style={styles.text}>{`${badCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${midPercent}%`, backgroundColor: colors.textTertiary }]}>
            <Text style={styles.text}>{`${midCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${goodPercent}%`, backgroundColor: colors.accent }]}>
            <Text style={styles.text}>{`${goodCount}`}</Text>
        </View>
      </View>
    </View>
  );
};

const createStyles = (colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: 20,
    marginTop: 100,
    marginBottom: 10,
    marginRight: 10,
    marginLeft: 10,
    borderRadius: radii.sm,
    overflow: 'hidden', // makes sure parent is on top for border radius
    backgroundColor: colors.divider
  },
  bar: {
    alignItems: 'center'
  },
  text: {
    ...textStyles.caption,
    color: colors.surface,
  }
});

const styles = createStyles(colors);

export default ProgressBar;
