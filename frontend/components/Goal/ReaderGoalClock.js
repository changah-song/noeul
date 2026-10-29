import { memo, useEffect, useState } from 'react';
import { ToastAndroid, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { getReadingSnapshot, subscribeReading } from '../../services/readingGoal';
import { formatGoalClock } from './HomeGoalBar';

// The pie inside the dial (time left, from twelve o'clock clockwise).
const PIE = 12;
const HALF = PIE / 2;

/**
 * ReaderGoalClock — the reader header's small clock: the shaded wedge and
 * the hand show the time left today and sweep down while reading. Once the
 * goal is reached it settles into a plain dot (like today's dot on Home).
 * Tapping says the time left.
 */
const ReaderGoalClock = ({ styles, themeColors }) => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(getReadingSnapshot);
  useEffect(() => subscribeReading(setSnapshot), []);

  const ink = themeColors.inkSlate;
  const leftMs = Math.max(0, snapshot.goalMs - snapshot.todayMs);
  const remaining = snapshot.met ? 0 : Math.min(1, leftMs / Math.max(1, snapshot.goalMs));
  const label = snapshot.met
    ? t('goal.doneToday', { count: Math.floor(snapshot.todayMs / 60000) })
    : (snapshot.idle ? t('goal.paused') : t('goal.left', { time: formatGoalClock(leftMs) }));
  const angle = remaining * 360;
  const wedge = { position: 'absolute', backgroundColor: ink, opacity: 0.16 };

  return (
    <TouchableOpacity
      style={styles.headerIconButton}
      onPress={() => ToastAndroid.show(label, ToastAndroid.SHORT)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {snapshot.met ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ink }} />
      ) : (
        <View style={{ width: 22, height: 22, opacity: snapshot.idle ? 0.55 : 1 }}>
          <View style={{ position: 'absolute', left: 8.5, top: 0.5, width: 5, height: 1.6, borderRadius: 1, backgroundColor: ink }} />
          <View style={{ position: 'absolute', left: 3, top: 4, width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: ink }} />
          <View style={{ position: 'absolute', left: 5, top: 6, width: PIE, height: PIE, borderRadius: HALF, overflow: 'hidden' }}>
            {/* Right half: 0 to 180 degrees. */}
            <View style={{ position: 'absolute', left: HALF, top: 0, width: HALF, height: PIE, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', left: -HALF, top: 0, width: PIE, height: PIE, transform: [{ rotate: `${Math.min(angle, 180)}deg` }] }}>
                <View style={[wedge, { left: 0, top: 0, width: HALF, height: PIE }]} />
              </View>
            </View>
            {/* Left half: 180 to 360 degrees. */}
            {angle > 180 ? (
              <View style={{ position: 'absolute', left: 0, top: 0, width: HALF, height: PIE, overflow: 'hidden' }}>
                <View style={{ position: 'absolute', left: 0, top: 0, width: PIE, height: PIE, transform: [{ rotate: `${angle - 180}deg` }] }}>
                  <View style={[wedge, { left: HALF, top: 0, width: HALF, height: PIE }]} />
                </View>
              </View>
            ) : null}
          </View>
          <View style={{ position: 'absolute', left: 5, top: 6, width: PIE, height: PIE, transform: [{ rotate: `${angle}deg` }] }}>
            <View style={{ position: 'absolute', left: HALF - 0.8, top: 1, width: 1.6, height: HALF - 1, borderRadius: 1, backgroundColor: ink }} />
          </View>
          <View style={{ position: 'absolute', left: 9.9, top: 10.9, width: 2.2, height: 2.2, borderRadius: 1.1, backgroundColor: ink }} />
        </View>
      )}
    </TouchableOpacity>
  );
};

export default memo(ReaderGoalClock);
