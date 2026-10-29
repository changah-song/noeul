import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Modal, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

const PIECES = 18;
const HIGHLIGHT_ICONS = { first: 'star', best: 'trending-up', weeks: 'calendar', days: 'sun', week: 'check' };

// A few muted pieces drifting down once, behind the card: a quiet confetti.
const Confetti = ({ width, height, colors }) => {
    const pieces = useMemo(() => Array.from({ length: PIECES }, (_, index) => ({
        left: ((index * 53) % 97) / 100,
        delay: (index % 6) * 90,
        drift: ((index % 5) - 2) * 14,
        spin: ((index % 3) - 1) * 160,
        color: [
            colors.readerLevelUnderlineEasy,
            colors.readerLevelUnderlineMid,
            colors.textTertiary,
            colors.readerLevelUnderlineHard,
        ][index % 4],
        progress: new Animated.Value(0),
    })), [colors]);

    useEffect(() => {
        Animated.stagger(40, pieces.map((piece) => Animated.timing(piece.progress, {
            toValue: 1,
            duration: 1900,
            delay: piece.delay,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }))).start();
    }, [pieces]);

    return (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width, height }}>
            {pieces.map((piece, index) => (
                <Animated.View
                    // eslint-disable-next-line react/no-array-index-key
                    key={index}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: piece.left * width,
                        width: 5,
                        height: 9,
                        borderRadius: 2,
                        backgroundColor: piece.color,
                        opacity: piece.progress.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 0.75, 0.6, 0] }),
                        transform: [
                            { translateY: piece.progress.interpolate({ inputRange: [0, 1], outputRange: [-20, height * 0.55] }) },
                            { translateX: piece.progress.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] }) },
                            { rotate: piece.progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.spin}deg`] }) },
                        ],
                    }}
                />
            ))}
        </View>
    );
};

/**
 * GoalCompleteModal — today's reading goal reached: "Today's reading done",
 * the minutes, and something to be glad about every time (first goal, a new
 * best day, a week streak, days in a row, or the days this week).
 */
const GoalCompleteModal = ({ event, onClose }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const { width, height } = useWindowDimensions();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const appear = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!event) return;
        appear.setValue(0);
        Animated.timing(appear, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [appear, event]);

    if (!event) return null;

    const highlightText = (item) => ({
        first: t('goal.hlFirst'),
        best: t('goal.hlBest', { minutes: item.minutes }),
        weeks: t('goal.hlWeeks', { count: item.count }),
        days: t('goal.hlDays', { count: item.count }),
        week: t('goal.hlWeek', { count: item.count }),
    }[item.kind]);

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.backdrop}>
                <Confetti width={width} height={height} colors={colors} />
                <Animated.View
                    style={[
                        styles.card,
                        {
                            opacity: appear,
                            transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
                        },
                    ]}
                    accessibilityLiveRegion="polite"
                >
                    <View style={styles.badge}>
                        <Feather name="check" size={26} color={colors.surface} />
                    </View>
                    <Text style={styles.title}>{t('goal.completeTitle')}</Text>
                    <Text style={styles.minutes}>{t('goal.completeMinutes', { count: event.goalMinutes })}</Text>
                    <View style={styles.highlights}>
                        {event.highlights.slice(0, 3).map((item) => (
                            <View key={item.kind} style={styles.highlight}>
                                <Feather name={HIGHLIGHT_ICONS[item.kind]} size={16} color={colors.text} />
                                <Text style={styles.highlightText}>{highlightText(item)}</Text>
                            </View>
                        ))}
                    </View>
                    <TouchableOpacity onPress={onClose} style={styles.button} accessibilityRole="button">
                        <Text style={styles.buttonText}>{t('goal.keepReading')}</Text>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors) => ({
    backdrop: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.overlay,
        paddingHorizontal: 28,
    },
    card: {
        width: '100%',
        maxWidth: 360,
        borderRadius: 22,
        backgroundColor: colors.surface,
        paddingTop: 26,
        paddingBottom: 18,
        paddingHorizontal: 22,
        alignItems: 'center',
    },
    badge: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    title: {
        marginTop: 14,
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 22,
        lineHeight: 28,
        color: colors.text,
        textAlign: 'center',
    },
    minutes: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        color: colors.textSecondary,
    },
    highlights: {
        alignSelf: 'stretch',
        marginTop: 18,
        gap: 8,
    },
    highlight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: colors.surfaceMuted,
    },
    highlightText: {
        flex: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14.5,
        color: colors.text,
    },
    button: {
        alignSelf: 'stretch',
        marginTop: 18,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    buttonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
});

export default GoalCompleteModal;
