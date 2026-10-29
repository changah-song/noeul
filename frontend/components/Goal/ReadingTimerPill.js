import { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { getReadingSnapshot, subscribeReading } from '../../services/readingGoal';

const formatClock = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * ReadingTimerPill — the reader's countdown to today's goal ("6:12 left"),
 * "Paused" while the reader is idle. Gone once the goal is reached; tapping
 * it hides it for this visit.
 */
const ReadingTimerPill = ({ style }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [snapshot, setSnapshot] = useState(getReadingSnapshot);
  const [hidden, setHidden] = useState(false);
  useEffect(() => subscribeReading(setSnapshot), []);

  if (hidden || snapshot.met || !snapshot.running) return null;
  const left = snapshot.goalMs - snapshot.todayMs;

  return (
    <TouchableOpacity
      onPress={() => setHidden(true)}
      style={[styles.pill, style]}
      accessibilityRole="button"
      accessibilityLabel={snapshot.idle ? t('goal.paused') : t('goal.left', { time: formatClock(left) })}
      accessibilityHint={t('common.close')}
    >
      <Feather name={snapshot.idle ? 'pause' : 'clock'} size={12} color={colors.textSecondary} />
      <Text style={styles.text}>
        {snapshot.idle ? t('goal.paused') : t('goal.left', { time: formatClock(left) })}
      </Text>
    </TouchableOpacity>
  );
};

const createStyles = (colors) => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    opacity: 0.94,
  },
  text: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});

export default ReadingTimerPill;
