import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import { fetchCloudLevelHistory } from '../../services/abilityLogCloudSync';
import {
    getLevelStartLog,
    getProfileAbility,
    onReaderLevelChanged,
} from '../../services/Database';
import {
    describeLevel,
    levelPlaceForTheta,
    levelRange,
    startingTheta,
    wordGoal,
    wordsForTheta,
} from '../../services/levelSummary';
import { loadMilestones, markGoalCelebrated, recordGoal } from '../../services/levelMilestones';

// Below this many signals the estimate is still mostly the starting point
// (no word goals are counted yet).
const EARLY_EVENTS = 20;
const KO_BANDS = ['bookLevel.koBeginner', 'bookLevel.koIntermediate', 'bookLevel.koAdvanced'];

/**
 * LevelCard — Profile's "Your level": the level on the language's own scale
 * (Korean's reading levels, HSK, CEFR), about how many words the reader
 * knows and the likely range, where they started (set once, at onboarding),
 * and a quiet congratulations when the estimate passes a round number of
 * words. The level isn't set here: "Underlines feel off?" (`onAdjust`) offers
 * the underline slider or the word check instead.
 */
const LevelCard = ({ ownerId, profileId, language, userId, onAdjust }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [ability, setAbility] = useState(null);
    const [startTheta, setStartTheta] = useState(null);
    const [milestones, setMilestones] = useState(null);
    const [version, setVersion] = useState(0);

    useEffect(() => onReaderLevelChanged(() => setVersion((value) => value + 1)), []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [row, localStart, cloud] = await Promise.all([
                getProfileAbility({ ownerId, profileId, language }).catch(() => null),
                getLevelStartLog({ ownerId, profileId, language }).catch(() => []),
                // Where they started may only be in the account (a new phone).
                userId ? fetchCloudLevelHistory(userId, language) : { startRows: [] },
            ]);
            const startLog = [...localStart, ...cloud.startRows]
                .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
            const rowTheta = Number(row?.theta);
            let record = await loadMilestones(ownerId, profileId, language);
            // Word goals count once reading (not just the starting point) has
            // moved the estimate.
            if (Number.isFinite(rowTheta) && (Number(row?.event_count) || 0) >= EARLY_EVENTS) {
                const { reached } = wordGoal(wordsForTheta(language, rowTheta));
                ({ record } = await recordGoal(ownerId, profileId, language, reached));
            }
            if (cancelled) return;
            setAbility(row);
            setStartTheta(startingTheta(startLog));
            setMilestones(record);
        })();
        return () => {
            cancelled = true;
        };
    }, [language, ownerId, profileId, userId, version]);

    const theta = Number(ability?.theta);
    const variance = Number(ability?.theta_var ?? 2);
    const events = Number(ability?.event_count) || 0;
    const hasEstimate = Number.isFinite(theta);
    const range = hasEstimate ? levelRange(theta, variance) : null;
    const described = range ? describeLevel(language, range) : null;
    const startDescribed = startTheta != null
        ? describeLevel(language, { estimate: startTheta, low: startTheta, high: startTheta })
        : null;

    const placeName = useCallback((place) => {
        if (place.scale === 'ko') {
            return `${t(KO_BANDS[Math.ceil(place.rank / 2) - 1])} ${((place.rank - 1) % 2) + 1}`;
        }
        return place.label;
    }, [t]);
    const wordsText = useCallback((item) => (
        item?.kind === 'words'
            ? t('level.words', { words: formatNumber(item.estimate) })
            : item?.estimate ?? ''
    ), [t]);

    if (!described) return null;

    const place = levelPlaceForTheta(language, theta);
    const words = wordsForTheta(language, theta) ?? 0;
    const bestReached = (milestones?.reached ?? [])
        .reduce((best, item) => Math.max(best, Number(item.words) || 0), 0);
    const celebrate = bestReached > (milestones?.celebrated ?? 0) ? bestReached : null;
    const closeCelebration = () => {
        markGoalCelebrated(ownerId, profileId, language, celebrate);
        setMilestones((current) => (current ? { ...current, celebrated: celebrate } : current));
    };

    return (
        <View style={styles.card}>
            {celebrate ? (
                <View style={styles.celebration} accessibilityLiveRegion="polite">
                    <Feather name="award" size={20} color={colors.surface} />
                    <Text style={styles.celebrationTitle}>
                        {t('level.goalReachedTitle', { words: formatNumber(celebrate) })}
                    </Text>
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
            <Text style={styles.estimate}>
                {t('level.words', {
                    words: formatNumber(described.kind === 'words' ? described.estimate : Math.round(words)),
                })}
            </Text>
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

            {startDescribed ? (
                <Text style={styles.started}>{t('level.started', { level: wordsText(startDescribed) })}</Text>
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
    celebrationTitle: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.surface,
    },
    levelName: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13.5,
        lineHeight: 18,
        color: colors.textSecondary,
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
    started: {
        marginTop: 12,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        color: colors.textSecondary,
    },
    adjust: {
        marginTop: 10,
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
