import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import {
  getReadingSnapshot,
  loadReadingDays,
  loadReadingGoal,
  subscribeReading,
} from '../../services/readingGoal';
import ReadingCalendarSheet from './ReadingCalendarSheet';

const MINUTE = 60 * 1000;

/**
 * TodayGoalCard — Home's daily reading goal: "6 of 10 min" with a thin bar
 * (or "Done today"), the week streak, and Start (opens the book being read).
 * Tapping the card opens the calendar.
 */
const TodayGoalCard = ({ ownerId, onStart, refreshKey }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [snapshot, setSnapshot] = useState(getReadingSnapshot);
  const [days, setDays] = useState({});
  const [showCalendar, setShowCalendar] = useState(false);

  const refresh = useCallback(async () => {
    await loadReadingGoal(ownerId);
    setDays(await loadReadingDays(ownerId));
  }, [ownerId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);
  useEffect(() => subscribeReading(setSnapshot), []);

  const goalMinutes = Math.round(snapshot.goalMs / MINUTE);
  const doneMinutes = Math.min(goalMinutes, Math.floor(snapshot.todayMs / MINUTE));
  const progress = Math.min(1, snapshot.todayMs / Math.max(1, snapshot.goalMs));
  const weeks = snapshot.stats.weekStreak;

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={async () => {
          setDays(await loadReadingDays(ownerId));
          setShowCalendar(true);
        }}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${t('goal.todayTitle')}, ${snapshot.met
          ? t('goal.doneToday', { count: Math.floor(snapshot.todayMs / MINUTE) })
          : t('goal.progress', { done: doneMinutes, goal: goalMinutes })}`}
      >
        <View style={styles.top}>
          <View style={styles.copy}>
            <Text style={styles.label}>{t('goal.todayTitle')}</Text>
            <Text style={styles.value}>
              {snapshot.met
                ? t('goal.doneToday', { count: Math.floor(snapshot.todayMs / MINUTE) })
                : t('goal.progress', { done: doneMinutes, goal: goalMinutes })}
            </Text>
          </View>
          {snapshot.met ? (
            <View style={styles.doneBadge}>
              <Feather name="check" size={16} color={colors.surface} />
            </View>
          ) : (
            <TouchableOpacity onPress={onStart} style={styles.start} accessibilityRole="button">
              <Feather name="play" size={14} color={colors.surface} />
              <Text style={styles.startText}>{t('goal.start')}</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(progress > 0 ? 3 : 0, progress * 100)}%` }]} />
        </View>
        <View style={styles.bottom}>
          <Feather name="calendar" size={13} color={colors.textTertiary} />
          <Text style={styles.streak}>
            {weeks > 0 ? t('goal.weekStreak', { count: weeks }) : t('goal.streakStart')}
          </Text>
          <Text style={styles.week}>{t('goal.thisWeekShort', { count: snapshot.stats.daysThisWeek })}</Text>
        </View>
      </TouchableOpacity>
      <ReadingCalendarSheet
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
        days={days}
        goalMinutes={goalMinutes}
      />
    </>
  );
};

const createStyles = (colors) => ({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12.5,
    color: colors.textTertiary,
  },
  value: {
    marginTop: 1,
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 17,
    color: colors.text,
  },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.text,
  },
  startText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13.5,
    color: colors.surface,
  },
  doneBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  track: {
    marginTop: 12,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  bottom: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  streak: {
    flex: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  week: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    color: colors.textTertiary,
  },
});

export default TodayGoalCard;
