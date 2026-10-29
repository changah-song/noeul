import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
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
    levelRange,
    startingTheta,
    THETA_MAX,
    THETA_MIN,
} from '../../services/levelSummary';

const CHART_DAYS = 30;
const CHART_HEIGHT = 96;
// Below this many signals the estimate is still mostly the starting point.
const EARLY_EVENTS = 20;

/**
 * LevelCard — Profile's "Your level": what the app thinks the reader's level
 * is (a range, from what they look up, skip and review), where they started
 * (set once, at onboarding), and the last 30 days as a band (likely range)
 * with a dot per day. The level isn't set here: "Underlines feel off?"
 * (`onAdjust`) offers the underline slider or the word check instead.
 */
const LevelCard = ({ ownerId, profileId, language, onAdjust }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [ability, setAbility] = useState(null);
    const [series, setSeries] = useState([]);
    const [startTheta, setStartTheta] = useState(null);
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
            if (cancelled) return;
            setAbility(row);
            setSeries(dailyLevelSeries(log, { days: CHART_DAYS }));
            setStartTheta(startingTheta(startLog));
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
    const pickTheta = startTheta;
    const pickDescribed = pickTheta != null
        ? describeLevel(language, { estimate: pickTheta, low: pickTheta, high: pickTheta })
        : null;

    const levelText = useCallback((item) => (
        item?.kind === 'words'
            ? t('level.words', { words: formatNumber(item.estimate) })
            : item?.estimate ?? ''
    ), [t]);

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
                    <Text style={styles.pickText}>{t('level.started', { level: levelText(pickDescribed) })}</Text>
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
