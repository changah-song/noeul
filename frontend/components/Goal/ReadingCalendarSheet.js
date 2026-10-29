import { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatDate } from '../../services/interfaceLanguage';
import { dayKey, GOAL_OPTIONS, goalStats, setGoalMinutes } from '../../services/readingGoal';
import { SheetFrame } from '../shared/WordCheckModal';

const MINUTE = 60 * 1000;
// Monday first; 2024-01-01 was a Monday.
const WEEKDAY_DATES = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index));

/**
 * ReadingCalendarSheet — the month: goal days filled, days with some reading
 * dotted, today ringed; the week streak, this week, best day and goal days;
 * and the daily goal (changeable).
 */
const ReadingCalendarSheet = ({ visible, onClose, days = {}, goalMinutes }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [monthOffset, setMonthOffset] = useState(0);
  const today = dayKey();
  const stats = goalStats(days, today);

  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const leading = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ];
  while (cells.length % 7) cells.push(null);

  const weekdayLabel = (date) => {
    try {
      return formatDate(date, { weekday: 'narrow' });
    } catch {
      return '';
    }
  };

  return (
    <SheetFrame visible={visible} onClose={onClose} title={t('goal.calendarTitle')}>
      <View style={styles.stats}>
        {[
          { label: t('goal.statWeekStreak'), value: t('goal.weeksCount', { count: stats.weekStreak }) },
          { label: t('goal.statThisWeek'), value: `${stats.daysThisWeek}/7` },
          { label: t('goal.statBest'), value: t('goal.minutesCount', { count: Math.floor(stats.bestDayMs / MINUTE) }) },
        ].map((item) => (
          <View key={item.label} style={styles.stat}>
            <Text style={styles.statValue}>{item.value}</Text>
            <Text style={styles.statLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.monthHeader}>
        <TouchableOpacity
          onPress={() => setMonthOffset((value) => value - 1)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('goal.previousMonth')}
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{formatDate(month, { year: 'numeric', month: 'long' })}</Text>
        <TouchableOpacity
          onPress={() => setMonthOffset((value) => Math.min(0, value + 1))}
          disabled={monthOffset >= 0}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('goal.nextMonth')}
        >
          <Feather name="chevron-right" size={20} color={monthOffset >= 0 ? colors.textSubtle : colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {WEEKDAY_DATES.map((date) => (
          <Text key={date.getDay()} style={styles.weekday}>{weekdayLabel(date)}</Text>
        ))}
        {cells.map((date, index) => {
          if (!date) {
            // eslint-disable-next-line react/no-array-index-key
            return <View key={`blank-${index}`} style={styles.cell} />;
          }
          const key = dayKey(date);
          const entry = days[key];
          const met = Boolean(entry?.metAt);
          const read = !met && (Number(entry?.ms) || 0) > 0;
          const isToday = key === today;
          return (
            <View key={key} style={styles.cell}>
              <View style={[styles.day, met && styles.dayMet, isToday && !met && styles.dayToday]}>
                <Text style={[styles.dayText, met && styles.dayTextMet]}>{date.getDate()}</Text>
              </View>
              {read ? <View style={styles.readDot} /> : null}
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        <View style={[styles.legendSwatch, styles.dayMet]} />
        <Text style={styles.legendText}>{t('goal.legendMet')}</Text>
        <View style={[styles.readDot, styles.legendDot]} />
        <Text style={styles.legendText}>{t('goal.legendRead')}</Text>
      </View>

      <Text style={styles.goalLabel}>{t('goal.dailyGoal')}</Text>
      <View style={styles.goalOptions}>
        {GOAL_OPTIONS.map((minutes) => {
          const selected = minutes === goalMinutes;
          return (
            <TouchableOpacity
              key={minutes}
              onPress={() => setGoalMinutes(minutes)}
              style={[styles.goalChip, selected && styles.goalChipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.goalChipText, selected && styles.goalChipTextSelected]}>
                {minutes === 30 ? t('goal.minutesPlus', { count: 30 }) : t('goal.minutesCount', { count: minutes })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SheetFrame>
  );
};

const createStyles = (colors) => ({
  stats: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 12,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 17,
    color: colors.text,
  },
  statLabel: {
    marginTop: 2,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    color: colors.textTertiary,
  },
  monthHeader: {
    marginHorizontal: 20,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.text,
  },
  grid: {
    marginHorizontal: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    paddingVertical: 6,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    color: colors.textTertiary,
  },
  cell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayMet: {
    backgroundColor: colors.text,
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  dayText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13.5,
    color: colors.text,
  },
  dayTextMet: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.surface,
  },
  readDot: {
    position: 'absolute',
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textTertiary,
  },
  legend: {
    marginTop: 6,
    marginHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendDot: {
    position: 'relative',
    bottom: 0,
    marginLeft: 10,
  },
  legendText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  goalLabel: {
    marginTop: 18,
    marginHorizontal: 20,
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  goalOptions: {
    marginTop: 8,
    marginHorizontal: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  goalChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalChipSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  goalChipText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.text,
  },
  goalChipTextSelected: {
    color: colors.surface,
  },
});

export default ReadingCalendarSheet;
