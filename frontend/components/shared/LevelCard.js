import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import {
    getDailyAbilityLog,
    getProfileAbility,
    onReaderLevelChanged,
    setProfileAbilityFromVocab,
} from '../../services/Database';
import { getVocabTiers, thetaForTier } from '../../services/vocabSizeLevels';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import {
    dailyLevelSeries,
    describeLevel,
    levelRange,
    THETA_MAX,
    THETA_MIN,
} from '../../services/levelSummary';
import { tierIndexForTheta, vocabLevelPickKey } from './VocabLevelModal';

const CHART_DAYS = 30;
const CHART_HEIGHT = 96;
// Below this many signals the estimate is still mostly the starting point.
const EARLY_EVENTS = 20;

/**
 * LevelCard — Profile's "Your level": what the app thinks the reader's level
 * is (a range, from what they look up, skip and review), the level they
 * picked, and the last 30 days as a band (likely range) with a dot per day.
 * When reading has moved well away from the pick, it offers to use it.
 */
const LevelCard = ({ ownerId, profileId, language }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [ability, setAbility] = useState(null);
    const [series, setSeries] = useState([]);
    const [pickThreshold, setPickThreshold] = useState(null);
    const [version, setVersion] = useState(0);

    useEffect(() => onReaderLevelChanged(() => setVersion((value) => value + 1)), []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [row, log, pick] = await Promise.all([
                getProfileAbility({ ownerId, profileId, language }).catch(() => null),
                getDailyAbilityLog({ ownerId, profileId, language }).catch(() => []),
                AsyncStorage.getItem(vocabLevelPickKey(ownerId, profileId, language)).catch(() => null),
            ]);
            if (cancelled) return;
            setAbility(row);
            setSeries(dailyLevelSeries(log, { days: CHART_DAYS }));
            setPickThreshold(pick != null && pick !== '' ? Number(pick) : null);
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
    const pickTheta = pickThreshold != null ? thetaForTier(language, pickThreshold) : null;
    const pickDescribed = pickTheta != null
        ? describeLevel(language, { estimate: pickTheta, low: pickTheta, high: pickTheta })
        : null;
    // Reading has moved the estimate more than one spread away from the pick.
    const drifted = hasEstimate && pickTheta != null && events >= EARLY_EVENTS
        && Math.abs(theta - pickTheta) > Math.sqrt(Math.max(variance, 0.01));

    const levelText = useCallback((item) => (
        item?.kind === 'words'
            ? t('level.words', { words: formatNumber(item.estimate) })
            : item?.estimate ?? ''
    ), [t]);

    const applyEstimate = useCallback(async () => {
        if (!hasEstimate) return;
        const tiers = getVocabTiers(language);
        const index = tierIndexForTheta(tiers, theta);
        await setProfileAbilityFromVocab({
            ownerId,
            profileId,
            language,
            theta,
            nearestRank: nearestRankForTheta(language, theta),
            variance,
            details: { source: 'profile-use-estimate' },
        });
        if (index != null && tiers[index]) {
            await AsyncStorage.setItem(
                vocabLevelPickKey(ownerId, profileId, language),
                String(tiers[index].threshold)
            ).catch(() => {});
        }
    }, [hasEstimate, language, ownerId, profileId, theta, variance]);

    if (!described) return null;

    // The chart's vertical scale: the data's spread with a little room,
    // inside the model's -3..3.
    const lows = series.map((point) => levelRange(point.theta, point.variance).low);
    const highs = series.map((point) => levelRange(point.theta, point.variance).high);
    if (pickTheta != null) {
        lows.push(pickTheta);
        highs.push(pickTheta);
    }
    const yMin = Math.max(THETA_MIN, Math.min(...lows, range.low) - 0.3);
    const yMax = Math.min(THETA_MAX, Math.max(...highs, range.high) + 0.3);
    const y = (value) => CHART_HEIGHT * (1 - (value - yMin) / Math.max(0.01, yMax - yMin));

    return (
        <View style={styles.card}>
            <Text style={styles.estimate}>{levelText(described)}</Text>
            {described.low !== described.high ? (
                <Text style={styles.range}>
                    {described.kind === 'words'
                        ? t('level.wordsRange', { low: formatNumber(described.low), high: formatNumber(described.high) })
                        : t('level.tierRange', { low: described.low, high: described.high })}
                </Text>
            ) : null}
            <Text style={styles.note}>
                {events < EARLY_EVENTS ? t('level.early') : t('level.basedOn', { count: formatNumber(events) })}
            </Text>

            {series.length > 1 ? (
                <View accessible accessibilityLabel={t('level.chartA11y')} style={styles.chartBlock}>
                    <View style={[styles.chart, { height: CHART_HEIGHT }]}>
                        {pickTheta != null ? (
                            <View style={[styles.pickLine, { top: y(pickTheta) }]} />
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

            {pickDescribed ? (
                <View style={styles.pickRow}>
                    <View style={styles.pickSwatch} />
                    <Text style={styles.pickText}>{t('level.picked', { level: levelText(pickDescribed) })}</Text>
                </View>
            ) : null}
            {drifted ? (
                <View style={styles.suggestRow}>
                    <Text style={styles.suggestText}>{t('level.suggests', { level: levelText(described) })}</Text>
                    <TouchableOpacity onPress={applyEstimate} style={styles.useButton} accessibilityRole="button">
                        <Text style={styles.useButtonText}>{t('level.useThis')}</Text>
                    </TouchableOpacity>
                </View>
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
    estimate: {
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
    chartBlock: {
        marginTop: 14,
    },
    chart: {
        position: 'relative',
        marginHorizontal: 4,
    },
    pickLine: {
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
        width: 6,
        marginLeft: -3,
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
    pickRow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    pickSwatch: {
        width: 16,
        borderTopWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.textTertiary,
    },
    pickText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        color: colors.textSecondary,
    },
    suggestRow: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    suggestText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        lineHeight: 18,
        color: colors.text,
    },
    useButton: {
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    useButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13.5,
        color: colors.surface,
    },
});

export default LevelCard;
