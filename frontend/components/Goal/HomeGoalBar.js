import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, TouchableOpacity, View } from 'react-native';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import CalendarDrop from './CalendarDrop';
import {
  dayKey,
  getReadingDays,
  goalStats,
  getReadingSnapshot,
  loadReadingGoal,
  recentDaySlots,
  subscribeReading,
  takeDailyPeek,
} from '../../services/readingGoal';

const FADE_MS = 420;
const PEEK_HOLD_MS = 1200;

export const formatGoalClock = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * useReadingGoal — today's snapshot and the day log for Home, re-read each
 * time `refreshKey` changes (Home coming into view).
 */
export const useReadingGoal = (ownerId, refreshKey) => {
  const [snapshot, setSnapshot] = useState(getReadingSnapshot);
  const [days, setDays] = useState(getReadingDays);
  useEffect(() => subscribeReading((next) => {
    setSnapshot(next);
    setDays(getReadingDays());
  }), []);
  useEffect(() => {
    let alive = true;
    loadReadingGoal(ownerId).then(() => {
      if (alive) setDays(getReadingDays());
    });
    return () => {
      alive = false;
    };
  }, [ownerId, refreshKey]);
  return { snapshot, days };
};

// The countdown stays in the title for the rest of the day once tapped
// (Home can remount; this outlives it).
let timerShownDay = null;

/**
 * GoalTitle — "Noeul", which turns into today's countdown when tapped (and
 * back on a second tap). It peeks at the countdown once a day so the link
 * is visible. Once today's goal is reached it's just the title again.
 */
export const GoalTitle = ({ snapshot, focusKey, textStyle }) => {
  const { t } = useTranslation();
  const met = snapshot.met;
  const [showTimer, setShowTimer] = useState(() => timerShownDay === dayKey());
  const [peeking, setPeeking] = useState(false);
  const shown = !met && (showTimer || peeking);
  const progress = useRef(new Animated.Value(shown ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: shown ? 1 : 0,
      duration: FADE_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [progress, shown]);

  // A new day starts with the title.
  useEffect(() => {
    if (timerShownDay !== dayKey()) setShowTimer(false);
  }, [focusKey]);

  useEffect(() => {
    if (met || showTimer) return undefined;
    let alive = true;
    let timer = null;
    takeDailyPeek().then((first) => {
      if (!alive || !first) return;
      setPeeking(true);
      timer = setTimeout(() => setPeeking(false), FADE_MS + PEEK_HOLD_MS);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      setPeeking(false);
    };
    // Once per Home visit; takeDailyPeek keeps it to the first of the day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, met]);

  const onPress = useCallback(() => {
    setPeeking(false);
    setShowTimer((value) => {
      timerShownDay = value ? null : dayKey();
      return !value;
    });
  }, []);

  const clock = formatGoalClock(snapshot.goalMs - snapshot.todayMs);
  const titleStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
  };
  const timerStyle = {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
  };

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={met}
      onPress={onPress}
      accessibilityRole={met ? 'header' : 'button'}
      accessibilityLabel={met
        ? 'Noeul'
        : (showTimer ? t('goal.timerShown', { time: clock }) : t('goal.showTimer'))}
      style={titleBox}
    >
      <Animated.Text style={[textStyle, titleStyle]} numberOfLines={1}>Noeul</Animated.Text>
      <Animated.View pointerEvents="none" style={[timerBox, timerStyle]}>
        <Text style={[textStyle, timerText]} numberOfLines={1}>{clock}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const titleBox = {
  width: 104,
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
};
const timerBox = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
};
const timerText = {
  fontVariant: ['tabular-nums'],
};

/**
 * StreakDots — three of the last six days (oldest first; today is the last
 * of the right-hand group): solid for a goal day, faint for a missed one,
 * a ring for today until it's done. Pressing opens the calendar.
 */
export const StreakDots = ({ slots, onPress, open, accessibilityLabel }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createDotStyles(colors), [colors]);
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: Boolean(open) }}
      accessibilityLabel={accessibilityLabel}
      style={styles.group}
    >
      {slots.map((state, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <View key={index} style={styles[state] ?? styles.empty} />
      ))}
    </TouchableOpacity>
  );
};

const createDotStyles = (colors) => ({
  group: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  met: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text,
  },
  today: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.text,
    opacity: 0.55,
  },
  missed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
  },
  empty: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.surfaceMuted,
  },
});

export const homeDaySlots = (days) => recentDaySlots(days, dayKey(), 6);

/**
 * HomeGoalCluster — the middle of Home's top bar: three day dots, the title
 * (today's countdown when tapped) and three more dots. It subscribes to the
 * reading clock itself, which ticks every second while a book is read, so
 * only this cluster re-renders on a tick and not the whole Home screen.
 */
export const HomeGoalCluster = memo(({ ownerId, focusKey, calendarOpen, onToggleCalendar, textStyle }) => {
  const { t } = useTranslation();
  const { snapshot, days } = useReadingGoal(ownerId, focusKey);
  const slots = useMemo(() => homeDaySlots(days), [days]);
  const label = t('goal.dotsLabel', { count: slots.filter((state) => state === 'met').length });
  return (
    <>
      <StreakDots slots={slots.slice(0, 3)} open={calendarOpen} onPress={onToggleCalendar} accessibilityLabel={label} />
      <GoalTitle snapshot={snapshot} focusKey={focusKey} textStyle={textStyle} />
      <StreakDots slots={slots.slice(3)} open={calendarOpen} onPress={onToggleCalendar} accessibilityLabel={label} />
    </>
  );
});

/**
 * HomeGoalCalendar — the month calendar that drops from the dots, with its
 * own subscription for the same reason as HomeGoalCluster.
 */
export const HomeGoalCalendar = memo(({ ownerId, focusKey, open, onClose }) => {
  const { snapshot, days } = useReadingGoal(ownerId, focusKey);
  return (
    <CalendarDrop
      open={open}
      days={days}
      goalMinutes={Math.round(snapshot.goalMs / 60000)}
      onClose={onClose}
    />
  );
});

// The sunset (노을) mark, drawn in views: a sun half-set on the horizon. With
// today's goal reached it is filled, with two lines of glow under the
// horizon; until then only its outline, in a muted ink.
const SunsetMark = ({ met, color }) => {
  const bar = { height: 2.6, borderRadius: 1.3, backgroundColor: color };
  return (
    <View style={{ width: 28, height: 19, alignItems: 'center' }}>
      <View
        style={met
          ? { width: 15, height: 7.5, borderTopLeftRadius: 7.5, borderTopRightRadius: 7.5, backgroundColor: color }
          : {
            width: 15,
            height: 7.5,
            borderTopLeftRadius: 7.5,
            borderTopRightRadius: 7.5,
            borderWidth: 2.2,
            borderBottomWidth: 0,
            borderColor: color,
          }}
      />
      <View style={[bar, { width: 28 }]} />
      {met ? (
        <>
          <View style={[bar, { width: 14, marginTop: 2.2 }]} />
          <View style={[bar, { width: 8, marginTop: 2.2 }]} />
        </>
      ) : null}
    </View>
  );
};

/**
 * HomeGoalSun — the top-left of Home: the sunset mark (filled once today's
 * reading goal is reached, an outline until then) with the day streak beside it.
 * Tapping it opens the calendar. Subscribes to the reading clock itself, like
 * HomeGoalCluster, so Home doesn't re-render as the clock ticks.
 */
export const HomeGoalSun = memo(({ ownerId, focusKey, open, onPress, style }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { snapshot, days } = useReadingGoal(ownerId, focusKey);
  const streak = useMemo(() => goalStats(days).dayStreak, [days]);
  const met = Boolean(snapshot.met);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[style, { width: undefined, minWidth: 44, flexDirection: 'row', gap: 5, paddingHorizontal: 2 }]}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!open }}
      accessibilityLabel={`${t(met ? 'goal.legendMet' : 'goal.keepReading')}, ${t('goal.hlDays', { count: streak })}`}
    >
      {/* The horizon sits at the same height filled or not, level with the
          streak's digits. */}
      <View style={{ height: 19, justifyContent: 'flex-start', marginTop: 6 }}>
        <SunsetMark met={met} color={met ? colors.inkSlate : colors.textSubtle} />
      </View>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: fontFamilies.sansSemiBold,
          fontSize: 15,
          lineHeight: 18,
          color: met ? colors.inkSlate : colors.textMuted,
          fontVariant: ['tabular-nums'],
        }}
      >
        {streak}
      </Text>
    </TouchableOpacity>
  );
});
