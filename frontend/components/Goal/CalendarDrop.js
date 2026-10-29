import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatDate } from '../../services/interfaceLanguage';
import { GOAL_OPTIONS, monthDays, setGoalMinutes } from '../../services/readingGoal';

// Monday first; 2024-01-01 was a Monday.
const WEEKDAY_DATES = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index));

const formatSafe = (date, options) => {
  try {
    return formatDate(date, options);
  } catch {
    return '';
  }
};

/**
 * CalendarDrop — the month under Home's top bar, dots only: solid for a
 * goal day, faint for a day with some reading, a ghost for none, a ring for
 * today, nothing ahead. Below: goal days this month, and the daily goal
 * (tap to change).
 */
const CalendarDrop = ({ open, days = {}, goalMinutes, onClose }) => {
  const { colors, isDarkMode } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors, isDarkMode), [colors, isDarkMode]);
  const [monthOffset, setMonthOffset] = useState(0);
  const [editingGoal, setEditingGoal] = useState(false);
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setMonthOffset(0);
      setEditingGoal(false);
    }
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 300 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, progress]);

  if (!mounted) return null;

  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const cells = monthDays(days, month.getFullYear(), month.getMonth());
  const goalDays = cells.filter((cell) => cell?.state === 'met').length;
  const goalText = goalMinutes >= 30
    ? t('goal.perDayPlus', { count: goalMinutes })
    : t('goal.perDay', { count: goalMinutes });
  const stateLabel = {
    met: t('goal.legendMet'),
    read: t('goal.legendRead'),
    today: t('goal.legendToday'),
  };

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={onClose}
          style={styles.fill}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
      </Animated.View>
      <Animated.View
        style={[styles.panel, {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
        }]}
      >
        <View style={styles.header}>
          <Text style={styles.month}>{formatSafe(month, { month: 'long', ...(monthOffset < -now.getMonth() ? { year: 'numeric' } : {}) })}</Text>
          <View style={styles.arrows}>
            <TouchableOpacity
              onPress={() => setMonthOffset((value) => value - 1)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('goal.previousMonth')}
            >
              <Feather name="chevron-left" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMonthOffset((value) => Math.min(0, value + 1))}
              disabled={monthOffset >= 0}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('goal.nextMonth')}
            >
              <Feather name="chevron-right" size={18} color={monthOffset >= 0 ? colors.textSubtle : colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.grid}>
          {WEEKDAY_DATES.map((date) => (
            <Text key={date.getDay()} style={styles.weekday}>{formatSafe(date, { weekday: 'narrow' })}</Text>
          ))}
          {cells.map((cell, index) => (
            cell ? (
              <View
                key={cell.key}
                style={styles.cell}
                accessible
                accessibilityLabel={[
                  formatSafe(new Date(month.getFullYear(), month.getMonth(), cell.day), { month: 'long', day: 'numeric' }),
                  stateLabel[cell.state],
                ].filter(Boolean).join(', ')}
              >
                <View style={styles[cell.state]} />
              </View>
            ) : (
              // eslint-disable-next-line react/no-array-index-key
              <View key={`blank-${index}`} style={styles.cell} />
            )
          ))}
        </View>

        {editingGoal ? (
          <View style={styles.goalOptions}>
            {GOAL_OPTIONS.map((minutes) => {
              const selected = minutes === goalMinutes;
              return (
                <TouchableOpacity
                  key={minutes}
                  onPress={() => {
                    setGoalMinutes(minutes);
                    setEditingGoal(false);
                  }}
                  style={styles.goalOption}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.goalOptionText, selected && styles.goalOptionSelected]}>
                    {minutes === 30 ? t('goal.minutesPlus', { count: 30 }) : t('goal.minutesCount', { count: minutes })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.footer}>
            <Text style={styles.footerText}>{goalDays === 1 ? t('goal.daysThisMonthOne') : t('goal.daysThisMonth', { count: goalDays })}</Text>
            <TouchableOpacity
              onPress={() => setEditingGoal(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`${t('goal.dailyGoal')}, ${goalText}`}
            >
              <Text style={styles.footerText}>{goalText}</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const DOT_CELL = 36;

const createStyles = (colors, isDarkMode) => ({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
    elevation: 30,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.35)' : 'rgba(27, 28, 28, 0.08)',
  },
  fill: {
    flex: 1,
  },
  panel: {
    backgroundColor: colors.bgPage,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 28,
    paddingTop: 10,
    paddingBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  month: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 19,
    color: colors.text,
  },
  arrows: {
    flexDirection: 'row',
    gap: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    paddingBottom: 4,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11.5,
    color: colors.textTertiary,
  },
  cell: {
    width: `${100 / 7}%`,
    height: DOT_CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  met: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text,
  },
  read: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.borderStrong,
  },
  none: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.border,
  },
  today: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  future: {
    width: 0,
    height: 0,
  },
  footer: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    color: colors.textTertiary,
  },
  goalOptions: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalOption: {
    paddingVertical: 4,
  },
  goalOptionText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    color: colors.textTertiary,
  },
  goalOptionSelected: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.text,
  },
});

export default CalendarDrop;
