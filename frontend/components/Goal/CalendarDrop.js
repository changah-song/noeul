import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatDate } from '../../services/interfaceLanguage';
import { GOAL_OPTIONS, monthDays, setGoalMinutes } from '../../services/readingGoal';
import { CalendarSunsetGlyph } from './SunsetMark';

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
 * CalendarDrop — the month under Home's top bar: a goal day is a solid dot
 * that grows with the time read past the goal, then one to three stars (see
 * CalendarSunsetGlyph); faint for a day with some reading, a ghost for none,
 * a ring for today, nothing ahead. Below: goal days this month, and the daily goal
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
  const cells = monthDays(days, month.getFullYear(), month.getMonth(), undefined, goalMinutes * 60000);
  const isToday = (day) => monthOffset === 0 && day === now.getDate();
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
              style={styles.arrow}
              accessibilityRole="button"
              accessibilityLabel={t('goal.previousMonth')}
            >
              <Feather name="chevron-left" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMonthOffset((value) => Math.min(0, value + 1))}
              disabled={monthOffset >= 0}
              style={styles.arrow}
              accessibilityRole="button"
              accessibilityLabel={t('goal.nextMonth')}
            >
              <Feather name="chevron-right" size={22} color={monthOffset >= 0 ? colors.textSubtle : colors.text} />
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
                  cell.state === 'met' ? t('goal.minutesCount', { count: Math.floor(cell.ms / 60000) }) : null,
                ].filter(Boolean).join(', ')}
              >
                <View style={styles.glyph}>
                  {cell.state === 'met'
                    ? <CalendarSunsetGlyph stage={cell.stage} color={colors.text} />
                    : <View style={styles[cell.state]} />}
                </View>
                <Text
                  allowFontScaling={false}
                  style={[styles.date, isToday(cell.day) && styles.dateToday]}
                >
                  {cell.day}
                </Text>
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
              style={styles.goalButton}
            >
              <Text style={styles.goalText}>{goalText}</Text>
              <Feather name="chevron-right" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const DOT_CELL = 50;

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
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    marginBottom: 6,
  },
  month: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 23,
    lineHeight: 28,
    color: colors.text,
  },
  arrows: {
    flexDirection: 'row',
    marginRight: -11,
  },
  arrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    height: 22,
    lineHeight: 22,
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    color: colors.textTertiary,
  },
  cell: {
    width: `${100 / 7}%`,
    height: DOT_CELL,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  glyph: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  date: {
    marginTop: 3,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  dateToday: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.text,
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
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dotInactive,
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
    marginTop: 14,
    height: 44,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  goalButton: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  goalText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  goalOptions: {
    marginTop: 14,
    height: 44,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalOption: {
    minHeight: 44,
    justifyContent: 'center',
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
