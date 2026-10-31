import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { HomeGoalCalendar, HomeGoalCluster, HomeGoalSun } from '../Goal/HomeGoalBar';
import ProfileAvatar from './ProfileAvatar';
import { Spacing, textStyles, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

/**
 * AppTopBar — the bar across the top of Home and Learn: today's reading goal
 * (the sunset mark and streak, then the title that turns into today's
 * countdown), and the profile avatar. The goal's calendar drops down from it,
 * over whatever the screen shows below.
 *
 * Render it as the first child of the screen's content: the calendar layer is
 * placed against that parent, from the bar's bottom edge down.
 */
export default function AppTopBar({ ownerId, user, onProfilePress }) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);

    // Re-read the goal each time the screen is shown; the calendar closes
    // when it's left.
    const [focusKey, setFocusKey] = useState(0);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [barHeight, setBarHeight] = useState(64);
    useFocusEffect(useCallback(() => {
        setFocusKey((value) => value + 1);
        return () => setCalendarOpen(false);
    }, []));
    // The goal's dots, title and calendar subscribe to the reading clock
    // themselves (HomeGoalCluster / HomeGoalCalendar): it ticks every second
    // while a book is read, and the screen must not re-render on each tick.
    const toggleCalendar = useCallback(() => setCalendarOpen((value) => !value), []);
    const closeCalendar = useCallback(() => setCalendarOpen(false), []);

    return (
        <>
            <View
                style={styles.bar}
                onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
            >
                <HomeGoalSun
                    ownerId={ownerId}
                    focusKey={focusKey}
                    open={calendarOpen}
                    onPress={toggleCalendar}
                    style={styles.iconButton}
                />
                <HomeGoalCluster
                    ownerId={ownerId}
                    focusKey={focusKey}
                    calendarOpen={calendarOpen}
                    onToggleCalendar={toggleCalendar}
                    textStyle={styles.titleText}
                />
                <TouchableOpacity
                    activeOpacity={0.84}
                    accessibilityRole="button"
                    accessibilityLabel={t('tabs.profile')}
                    onPress={onProfilePress}
                    style={styles.iconButton}
                >
                    <ProfileAvatar user={user} size={34} />
                </TouchableOpacity>
            </View>
            <View pointerEvents="box-none" style={[styles.calendarLayer, { top: barHeight }]}>
                <HomeGoalCalendar
                    ownerId={ownerId}
                    focusKey={focusKey}
                    open={calendarOpen}
                    onClose={closeCalendar}
                />
            </View>
        </>
    );
}

const createStyles = (colors) => StyleSheet.create({
    bar: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.sm,
        backgroundColor: colors.bgPage,
    },
    iconButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleText: {
        textAlign: 'center',
        ...textStyles.appTitle,
        color: colors.text,
    },
    calendarLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        elevation: 30,
    },
});
