import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import {
    getDailyAbilityLog,
    getLevelStartLog,
    getProfileAbility,
    onReaderLevelChanged,
} from '../../services/Database';
import {
    dailyLevelSeries,
    describeLevel,
    levelPlaceForTheta,
    levelRange,
    roundWords,
    startingTheta,
    THETA_MAX,
    THETA_MIN,
    wordGoal,
    wordsForTheta,
} from '../../services/levelSummary';
import { loadMilestones, markGoalCelebrated, recordGoal } from '../../services/levelMilestones';

const CHART_DAYS = 30;
const CHART_HEIGHT = 96;
// Below this many signals the estimate is still mostly the starting point
// (no goals are counted yet).
const EARLY_EVENTS = 20;
const KO_BANDS = ['bookLevel.koBeginner', 'bookLevel.koIntermediate', 'bookLevel.koAdvanced'];

/**
 * LevelCard — Profile's "Your level":
 * - the level on the language's own scale (Korean's reading levels, HSK,
 *   CEFR) and about how many words the reader knows, with the likely range;
 * - a bar to the next small word goal (and the next level), and a
 *   congratulations when a goal is passed, flagged on the chart that day;
 * - the last 30 days as a band (likely range) with a dot per day, and where
 *   they started (set once, at onboarding).
 * The level isn't set here: "Underlines feel off?" (`onAdjust`) offers the
 * underline slider or the word check instead.
 */
const LevelCard = ({ ownerId, profileId, language, onAdjust }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [ability, setAbility] = useState(null);
    const [series, setSeries] = useState([]);
    const [startTheta, setStartTheta] = useState(null);
    const [milestones, setMilestones] = useState(null);
    const [version, setVersion] = useState(0);

    useEffect(() => onReaderLevelChanged(() => setVersion((value) => value + 1)), []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [row, log, startLog] = await Promise.all([
                getProfileAbility({ ownerId, profileId, language }).catch(() => null),
                getDailyAbilityLog({ ownerId, profileId, language }).catch(() => []),
                getLevelStartLog({ ownerId, profileId, language }).catch(() => []),
            ]);
            const rowTheta = Number(row?.theta);
            let record = await loadMilestones(ownerId, profileId, language);
            // Goals count once reading (not just the starting point) has moved
            // the estimate.
            if (Number.isFinite(rowTheta) && (Number(row?.event_count) || 0) >= EARLY_EVENTS) {
                const { reached } = wordGoal(wordsForTheta(language, rowTheta));
                ({ record } = await recordGoal(ownerId, profileId, language, reached));
            }
            if (cancelled) return;
            setAbility(row);
            setSeries(dailyLevelSeries(log, { days: CHART_DAYS }));
            setStartTheta(startingTheta(startLog));
            setMilestones(record);
        })();
        return () => {
            cancelled = true;
        };
    }, [language, ownerId, profileId, version]);

    const theta = Number(ability?.theta);
    const variance = Number(ability?.theta_var ?? 2);
    const events = Number(ability?.event_count) || 0;
    const hasEstimate = Number.isFinite(theta);
    const range = hasEstimate ? levelRange(theta, variance) : null;
    const described = range ? describeLevel(language, range) : null;
    const startDescribed = startTheta != null
        ? describeLevel(language, { estimate: startTheta, low: startTheta, high: startTheta })
        : null;

    const placeName = useCallback((place, which = 'current') => {
        if (place.scale === 'ko') {
            const rank = which === 'next' ? place.nextRank : place.rank;
            if (!rank) return null;
            return `${t(KO_BANDS[Math.ceil(rank / 2) - 1])} ${((rank - 1) % 2) + 1}`;
        }
        return which === 'next' ? place.nextLabel : place.label;
    }, [t]);
    const wordsText = useCallback((item) => (
        item?.kind === 'words'
            ? t('level.words', { words: formatNumber(item.estimate) })
            : item?.estimate ?? ''
    ), [t]);

    if (!described) return null;

    const place = levelPlaceForTheta(language, theta);
    const words = wordsForTheta(language, theta) ?? 0;
    const goal = wordGoal(words);
    const nextLevelName = placeName(place, 'next');
    const reachedGoals = milestones?.reached ?? [];
    const bestReached = reachedGoals.reduce((best, item) => Math.max(best, Number(item.words) || 0), 0);
    const celebrate = bestReached > (milestones?.celebrated ?? 0) ? bestReached : null;
    const closeCelebration = () => {
        markGoalCelebrated(ownerId, profileId, language, celebrate);
        setMilestones((current) => (current ? { ...current, celebrated: celebrate } : current));
    };

    // The chart's vertical scale: the data's spread with a little room,
    // inside the model's -3..3.
    const lows = series.map((point) => levelRange(point.theta, point.variance).low);
    const highs = series.map((point) => levelRange(point.theta, point.variance).high);
    if (startTheta != null) {
        lows.push(startTheta);
        highs.push(startTheta);
    }
    const yMin = Math.max(THETA_MIN, Math.min(...lows, range.low) - 0.3);
    const yMax = Math.min(THETA_MAX, Math.max(...highs, range.high) + 0.3);
    const y = (value) => CHART_HEIGHT * (1 - (value - yMin) / Math.max(0.01, yMax - yMin));
    const goalDays = new Set(reachedGoals.map((item) => String(item.at || '').slice(0, 10)));

    return (
        <View style={styles.card}>
            {celebrate ? (
                <View style={styles.celebration} accessibilityLiveRegion="polite">
                    <Feather name="award" size={22} color={colors.surface} />
                    <View style={styles.celebrationText}>
                        <Text style={styles.celebrationTitle}>
                            {t('level.goalReachedTitle', { words: formatNumber(celebrate) })}
                        </Text>
                        <Text style={styles.celebrationBody}>
                            {t('level.goalReachedBody', { next: formatNumber(goal.next) })}
                        </Text>
                    </View>
                    <TouchableOpacity
                        onPress={closeCelebration}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                    >
                        <Feather name="x" size={18} color={colors.surface} />
                    </TouchableOpacity>
                </View>
            ) : null}

            <Text style={styles.levelName}>{placeName(place)}</Text>
            <Text style={styles.estimate}>{t('level.words', { words: formatNumber(described.kind === 'words' ? described.estimate : Math.round(words)) })}</Text>
            {described.kind === 'words' && described.low !== described.high ? (
                <Text style={styles.range}>
                    {t('level.wordsRange', { low: formatNumber(described.low), high: formatNumber(described.high) })}
                </Text>
            ) : null}
            {described.kind === 'tiers' && described.low !== described.high ? (
                <Text style={styles.range}>{t('level.tierRange', { low: described.low, high: described.high })}</Text>
            ) : null}
            <Text style={styles.note}>
                {events < EARLY_EVENTS ? t('level.early') : t('level.basedOn', { count: formatNumber(events) })}
            </Text>

            <View style={styles.goal}>
                <View style={styles.goalLabels}>
                    <Text style={styles.goalLabel}>{t('level.nextGoal', { words: formatNumber(goal.next) })}</Text>
                    <Text style={styles.goalPercent}>{`${Math.round(goal.progress * 100)}%`}</Text>
                </View>
                <View
                    style={styles.goalTrack}
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: 100, now: Math.round(goal.progress * 100) }}
                >
                    <View style={[styles.goalFill, { width: `${Math.max(3, goal.progress * 100)}%` }]} />
                </View>
                {nextLevelName && place.nextWords ? (
                    <Text style={styles.nextLevel}>
                        {t('level.nextLevel', { level: nextLevelName, words: formatNumber(roundWords(place.nextWords)) })}
                    </Text>
                ) : null}
            </View>

            {series.length > 1 ? (
                <View accessible accessibilityLabel={t('level.chartA11y')} style={styles.chartBlock}>
                    <View style={[styles.chart, { height: CHART_HEIGHT }]}>
                        {startTheta != null ? (
                            <View style={[styles.startLine, { top: y(startTheta) }]} />
                        ) : null}
                        {series.map((point) => {
                            const band = levelRange(point.theta, point.variance);
                            const left = `${(point.index / (CHART_DAYS - 1)) * 100}%`;
                            return (
                                <View key={point.day} style={[styles.day, { left }]}>
                                    <View
                                        style={[
                                            styles.band,
                                            { top: y(band.high), height: Math.max(2, y(band.low) - y(band.high)) },
                                        ]}
                                    />
                                    <View style={[styles.dot, { top: y(point.theta) - 3 }]} />
                                    {goalDays.has(point.day) ? (
                                        <View style={[styles.flag, { top: Math.max(0, y(band.high) - 14) }]}>
                                            <Feather name="flag" size={11} color={colors.danger} />
                                        </View>
                                    ) : null}
                                </View>
                            );
                        })}
                    </View>
                    <View style={styles.axis}>
                        <Text style={styles.axisText}>{t('level.chartStart', { count: CHART_DAYS })}</Text>
                        <Text style={styles.axisText}>{t('level.chartEnd')}</Text>
                    </View>
                </View>
            ) : null}

            {startDescribed ? (
                <View style={styles.legendRow}>
                    <View style={styles.startSwatch} />
                    <Text style={styles.legendText}>{t('level.started', { level: wordsText(startDescribed) })}</Text>
                </View>
            ) : null}
            {reachedGoals.length > 0 ? (
                <View style={styles.legendRow}>
                    <Feather name="flag" size={12} color={colors.danger} />
                    <Text style={styles.legendText}>{t('level.goalLegend')}</Text>
                </View>
            ) : null}
            {onAdjust ? (
                <TouchableOpacity
                    onPress={onAdjust}
                    style={styles.adjust}
                    hitSlop={{ top: 8, bottom: 8 }}
                    accessibilityRole="button"
                >
                    <Text style={styles.adjustText}>{t('level.adjust')}</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
};

const createStyles = (colors) => ({
    card: {
        marginHorizontal: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 14,
    },
    celebration: {
        marginBottom: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        backgroundColor: colors.text,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    celebrationText: {
        flex: 1,
        minWidth: 0,
    },
    celebrationTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.surface,
    },
    celebrationBody: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.surface,
        opacity: 0.82,
    },
    levelName: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13.5,
        lineHeight: 18,
        color: colors.textSecondary,
        textTransform: 'none',
    },
    estimate: {
        marginTop: 2,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 22,
        lineHeight: 28,
        color: colors.text,
    },
    range: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: colors.textSecondary,
    },
    note: {
        marginTop: 2,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12.5,
        lineHeight: 17,
        color: colors.textTertiary,
    },
    goal: {
        marginTop: 14,
    },
    goalLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
    },
    goalLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13.5,
        color: colors.text,
    },
    goalPercent: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12.5,
        color: colors.textTertiary,
    },
    goalTrack: {
        marginTop: 6,
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: colors.surfaceMuted,
    },
    goalFill: {
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.text,
    },
    nextLevel: {
        marginTop: 6,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12.5,
        lineHeight: 17,
        color: colors.textTertiary,
    },
    chartBlock: {
        marginTop: 16,
    },
    chart: {
        position: 'relative',
        marginHorizontal: 4,
    },
    startLine: {
        position: 'absolute',
        left: 0,
        right: 0,
        borderTopWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.textTertiary,
    },
    day: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 12,
        marginLeft: -6,
        alignItems: 'center',
    },
    band: {
        position: 'absolute',
        width: 6,
        borderRadius: 3,
        backgroundColor: colors.accentMuted,
    },
    dot: {
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.text,
    },
    flag: {
        position: 'absolute',
    },
    axis: {
        marginTop: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    axisText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11.5,
        color: colors.textTertiary,
    },
    legendRow: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    startSwatch: {
        width: 16,
        borderTopWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.textTertiary,
    },
    legendText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        color: colors.textSecondary,
    },
    adjust: {
        marginTop: 12,
        alignSelf: 'flex-start',
    },
    adjustText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13.5,
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
});

export default LevelCard;
