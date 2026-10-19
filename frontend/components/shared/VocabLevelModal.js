import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    ToastAndroid,
    View,
} from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, useTheme } from '../../theme';
import { PaperButton, PaperSheet, PressableScale } from '../ui';
import { getVocabTiers, thetaForTier } from '../../services/vocabSizeLevels';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import { getProfileAbility, setProfileAbilityFromVocab } from '../../services/Database';
import { hasWordCheck } from '../../services/wordCheck';
import WordCheckModal from './WordCheckModal';

const GUTTER = 24;
// Sheets run edge to edge; keep the last control clear of the system bar.
const BOTTOM_INSET = initialWindowMetrics?.insets?.bottom ?? 0;

// The tier the reader last picked, per owner / profile / language.
const pickKey = (ownerId, profileId, language) => `vocabLevelPick:${ownerId || 'guest'}:${profileId || ''}:${language}`;

// Index of the hardest tier at or below this ability: the row the model now
// thinks the reader knows all of. Null when there is no ability yet.
export const tierIndexForTheta = (tiers, theta) => {
    if (!Number.isFinite(Number(theta)) || !tiers.length) return null;
    let index = null;
    tiers.forEach((tier, i) => {
        if (Number(tier.theta) <= Number(theta) + 1e-6) index = i;
    });
    return index ?? 0;
};

/**
 * VocabLevelModal — the "tap the last row where you know all the words" grid.
 *
 * Replaces the manual level chips and the word-by-word quiz for Korean. Each row
 * is a frequency tier (the ~100 / ~300 / ~700 ... most common words); selecting a
 * row treats every row up to it as known and seeds ability `theta` from the tier's
 * baked value (see services/vocabSizeLevels.js). The seed is written through
 * `setProfileAbilityFromVocab` (clobber-safe) and the displayed level is aligned
 * to the nearest band via `setTargetLanguageLevel`.
 */
const VocabLevelModal = ({ visible, onClose }) => {
    const {
        activeProfileId,
        targetLanguage,
        setTargetLanguageLevel,
    } = useAppContext();
    // The signed-in account's id lives in the local-owner context; the app
    // context has none, so reading it there saved the level under "guest".
    const { activeOwnerId } = useLocalOwner();
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
    const { t } = useTranslation();

    const tiers = useMemo(() => getVocabTiers(targetLanguage), [targetLanguage]);
    const [selectedIndex, setSelectedIndex] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    // The word check replaces the grid while it runs.
    const [checking, setChecking] = useState(false);
    // What the reader picked last time, and where reading has moved the
    // estimate since — both shown as light highlights when the grid opens.
    const [lastPickIndex, setLastPickIndex] = useState(null);
    const [estimateIndex, setEstimateIndex] = useState(null);
    // Row offsets, so the list can open scrolled to the remembered pick.
    const listRef = useRef(null);
    const rowOffsetsRef = useRef({});
    const scrolledForOpenRef = useRef(false);
    const scrollToRow = useCallback((index) => {
        const y = rowOffsetsRef.current[index];
        if (index == null || y == null || scrolledForOpenRef.current) return;
        scrolledForOpenRef.current = true;
        listRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: false });
    }, []);

    useEffect(() => {
        if (!visible) return undefined;
        setSelectedIndex(null);
        setIsSaving(false);
        scrolledForOpenRef.current = false;
        let cancelled = false;
        (async () => {
            let pick = null;
            try {
                const stored = await AsyncStorage.getItem(pickKey(activeOwnerId, activeProfileId, targetLanguage));
                const index = tiers.findIndex((tier) => String(tier.threshold) === String(stored));
                pick = index >= 0 ? index : null;
            } catch {
                pick = null;
            }
            let estimate = null;
            try {
                const ability = await getProfileAbility({
                    ownerId: activeOwnerId,
                    profileId: activeProfileId,
                    language: targetLanguage,
                });
                // Only once reading has had a say: a fresh seed equals the pick.
                const events = Number(ability?.event_count ?? ability?.eventCount ?? 0);
                if (events > 1) estimate = tierIndexForTheta(tiers, ability?.theta);
            } catch {
                estimate = null;
            }
            if (cancelled) return;
            setLastPickIndex(pick);
            setEstimateIndex(estimate);
            setSelectedIndex(pick);
            scrollToRow(pick ?? estimate);
        })();
        return () => {
            cancelled = true;
        };
    }, [visible, activeOwnerId, activeProfileId, targetLanguage, tiers, scrollToRow]);

    const handleConfirm = useCallback(async () => {
        if (selectedIndex == null || isSaving) {
            return;
        }
        const tier = tiers[selectedIndex];
        if (!tier) {
            onClose?.();
            return;
        }
        setIsSaving(true);
        const theta = thetaForTier(targetLanguage, tier.threshold);
        const nearestRank = nearestRankForTheta(targetLanguage, theta);
        try {
            await setProfileAbilityFromVocab({
                ownerId: activeOwnerId,
                profileId: activeProfileId,
                language: targetLanguage,
                theta,
                nearestRank,
            });
            // Keep the displayed band + fallback seed aligned with the measurement.
            setTargetLanguageLevel(nearestRank);
            await AsyncStorage.setItem(
                pickKey(activeOwnerId, activeProfileId, targetLanguage),
                String(tier.threshold)
            ).catch(() => {});
            ToastAndroid.show(t('vocabLevel.saved'), ToastAndroid.SHORT);
        } catch (error) {
            console.warn('[VocabLevel] Failed to save vocab level:', error?.message ?? error);
        } finally {
            setIsSaving(false);
            onClose?.();
        }
    }, [activeOwnerId, activeProfileId, isSaving, onClose, selectedIndex, setTargetLanguageLevel, t, targetLanguage, tiers]);

    const tierLabel = useCallback((tier) => {
        if (tier.advanced) return t('vocabLevel.advancedTier');
        if (tier.label) return tier.label;
        return Number(tier.threshold).toLocaleString();
    }, [t]);

    if (checking) {
        return (
            <WordCheckModal
                visible={visible}
                onClose={() => {
                    setChecking(false);
                    onClose?.();
                }}
            />
        );
    }

    const canConfirm = selectedIndex != null && !isSaving;

    return (
        <PaperSheet visible={visible} onClose={onClose} maxHeightRatio={0.9} dragRegion="header" accessibilityLabel={t('vocabLevel.title')}>
            <View style={styles.body}>
                <View style={styles.headerRow}>
                    <Text style={styles.title} accessibilityRole="header">{t('vocabLevel.title')}</Text>
                    <PressableScale
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                        style={styles.closeButton}
                    >
                        <Feather name="x" size={20} color={theme.colors.textMuted} />
                    </PressableScale>
                </View>
                <Text style={styles.helper}>{t('vocabLevel.instruction')}</Text>
                {hasWordCheck(targetLanguage) ? (
                    <PaperButton
                        variant="quiet"
                        size="md"
                        label={t('vocabLevel.takeCheck')}
                        onPress={() => setChecking(true)}
                        style={styles.checkLink}
                    />
                ) : null}

                <ScrollView
                    ref={listRef}
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator
                >
                    {tiers.map((tier, index) => {
                        const known = selectedIndex != null && index <= selectedIndex;
                        const isPick = index === selectedIndex;
                        const wasPicked = index === lastPickIndex;
                        const isEstimate = estimateIndex != null && index === estimateIndex && estimateIndex !== lastPickIndex;
                        return (
                            <Pressable
                                key={tier.threshold}
                                onPress={() => setSelectedIndex(index)}
                                onLayout={(event) => {
                                    rowOffsetsRef.current[index] = event.nativeEvent.layout.y;
                                    if (index === (lastPickIndex ?? estimateIndex)) scrollToRow(index);
                                }}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: isPick, checked: isPick }}
                                style={({ pressed }) => [
                                    styles.row,
                                    known && styles.rowKnown,
                                    pressed && styles.rowPressed,
                                ]}
                            >
                                <View style={[styles.pickBar, isPick && styles.pickBarOn]} />
                                <Text
                                    style={[styles.rowLabel, known && styles.rowLabelKnown, isPick && styles.rowLabelPick]}
                                >
                                    {tierLabel(tier)}
                                </Text>
                                <View style={styles.wordsCol}>
                                    <Text style={[styles.word, selectedIndex != null && !known && styles.wordUnknown]}>
                                        {tier.words.join('  ')}
                                    </Text>
                                    {wasPicked || isEstimate ? (
                                        <View style={styles.tagRow}>
                                            {wasPicked ? (
                                                <Text style={[styles.tag, styles.tagPick]}>{t('vocabLevel.yourPick')}</Text>
                                            ) : null}
                                            {isEstimate ? (
                                                <Text style={[styles.tag, styles.tagEstimate]}>{t('vocabLevel.estimateNow')}</Text>
                                            ) : null}
                                        </View>
                                    ) : null}
                                </View>
                                <View style={styles.checkCol}>
                                    {isPick ? <Feather name="check" size={18} color={theme.colors.tint} /> : null}
                                </View>
                            </Pressable>
                        );
                    })}
                </ScrollView>

                <PaperButton
                    label={t('vocabLevel.confirm')}
                    onPress={handleConfirm}
                    disabled={!canConfirm}
                    accessibilityState={{ disabled: !canConfirm }}
                    style={styles.confirmButton}
                />
            </View>
        </PaperSheet>
    );
};

const createStyles = (colors) => StyleSheet.create({
    body: {
        flexShrink: 1,
        paddingHorizontal: GUTTER,
        paddingTop: 4,
        paddingBottom: 20 + BOTTOM_INSET,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    title: {
        flex: 1,
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        lineHeight: 31,
        letterSpacing: -0.4,
        color: colors.text,
    },
    closeButton: {
        width: 44,
        height: 44,
        marginRight: -10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
    },
    helper: {
        marginTop: 6,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 21,
        color: colors.textMuted,
    },
    checkLink: {
        alignSelf: 'flex-start',
        marginTop: 2,
        marginLeft: -4,
    },
    list: {
        flexGrow: 0,
        flexShrink: 1,
        marginTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.divider,
    },
    listContent: {
        paddingBottom: 2,
    },
    row: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingRight: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.divider,
    },
    // Every row up to the pick reads as "known": a faint tint wash.
    rowKnown: {
        backgroundColor: colors.tintSoft,
    },
    rowPressed: {
        backgroundColor: colors.accentSoft,
    },
    // The picked row: a tint bar on the leading edge and a check.
    pickBar: {
        alignSelf: 'stretch',
        width: 3,
        marginVertical: -10,
        backgroundColor: 'transparent',
    },
    pickBarOn: {
        backgroundColor: colors.tint,
    },
    rowLabel: {
        // Wide enough for "Advanced"; longer translations wrap.
        width: 78,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        lineHeight: 19,
        color: colors.textMuted,
        fontVariant: ['tabular-nums'],
    },
    rowLabelKnown: {
        color: colors.tint,
    },
    rowLabelPick: {
        fontFamily: fontFamilies.sansBold,
    },
    wordsCol: {
        flex: 1,
        minWidth: 0,
    },
    word: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
    },
    wordUnknown: {
        color: colors.textMuted,
    },
    checkCol: {
        width: 22,
        alignItems: 'center',
    },
    tagRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 2,
    },
    tag: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
    },
    tagPick: {
        color: colors.tint,
    },
    tagEstimate: {
        color: colors.textMuted,
    },
    confirmButton: {
        marginTop: 16,
        alignSelf: 'stretch',
    },
});

export default VocabLevelModal;
