import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    ToastAndroid,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing, useTheme } from '../../theme';
import { getVocabTiers, thetaForTier } from '../../services/vocabSizeLevels';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import { getProfileAbility, setProfileAbilityFromVocab } from '../../services/Database';
import { hasWordCheck } from '../../services/wordCheck';
import WordCheckModal from './WordCheckModal';

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

    const tierLabel = useCallback((tier) => (
        tier.advanced ? t('vocabLevel.advancedTier') : (tier.label || String(tier.threshold))
    ), [t]);

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

    return (
        <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card}>
                            <View style={styles.headerRow}>
                                <Text style={styles.eyebrow}>{t('vocabLevel.title')}</Text>
                                <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
                                    <Feather name="x" size={20} color={theme.colors.textTertiary} />
                                </Pressable>
                            </View>
                            <Text style={styles.helper}>{t('vocabLevel.instruction')}</Text>
                            {hasWordCheck(targetLanguage) ? (
                                <TouchableOpacity
                                    onPress={() => setChecking(true)}
                                    style={styles.checkLink}
                                    activeOpacity={0.7}
                                    accessibilityRole="button"
                                >
                                    <Feather name="check-square" size={15} color={theme.colors.textSecondary} />
                                    <Text style={styles.checkLinkText}>{t('vocabLevel.takeCheck')}</Text>
                                </TouchableOpacity>
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
                                        <TouchableOpacity
                                            key={tier.threshold}
                                            activeOpacity={0.75}
                                            onPress={() => setSelectedIndex(index)}
                                            onLayout={(event) => {
                                                rowOffsetsRef.current[index] = event.nativeEvent.layout.y;
                                                if (index === (lastPickIndex ?? estimateIndex)) scrollToRow(index);
                                            }}
                                            accessibilityRole="radio"
                                            accessibilityState={{ selected: isPick }}
                                            style={[
                                                styles.row,
                                                known && styles.rowKnown,
                                                isPick && styles.rowPick,
                                                wasPicked && styles.rowLastPick,
                                                isEstimate && styles.rowEstimate,
                                            ]}
                                        >
                                            <View style={styles.rowLabelCol}>
                                                <Text style={[styles.rowLabel, known && styles.rowLabelKnown]}>
                                                    {tierLabel(tier)}
                                                </Text>
                                                {isPick ? (
                                                    <Feather name="check" size={14} color={theme.colors.readerLevelUnderlineEasy} />
                                                ) : null}
                                            </View>
                                            <View style={styles.wordsCol}>
                                                <Text style={[styles.word, known && styles.wordKnown]}>
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
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            <TouchableOpacity
                                activeOpacity={0.85}
                                onPress={handleConfirm}
                                disabled={selectedIndex == null || isSaving}
                                style={[styles.confirmButton, (selectedIndex == null || isSaving) && styles.confirmButtonDisabled]}
                                accessibilityRole="button"
                            >
                                <Text style={styles.confirmText}>{t('vocabLevel.confirm')}</Text>
                            </TouchableOpacity>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const createStyles = (colors) => StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: colors.overlay,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
    },
    card: {
        width: '100%',
        maxWidth: 460,
        maxHeight: '82%',
        backgroundColor: colors.surface,
        borderRadius: radii.xl ?? 24,
        padding: spacing.xl,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: colors.textTertiary,
    },
    helper: {
        marginTop: spacing.sm,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    checkLink: {
        marginTop: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingVertical: 4,
    },
    checkLinkText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
    list: {
        marginTop: spacing.md,
        borderRadius: radii.lg ?? 16,
        borderWidth: 1,
        borderColor: colors.border,
    },
    listContent: {
        paddingVertical: spacing.xs,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: 6,
        paddingHorizontal: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.divider,
    },
    rowKnown: {
        backgroundColor: colors.accentSoft,
    },
    rowPick: {
        backgroundColor: colors.accentMuted,
    },
    // The tier saved last time: a thin bar on the left that stays while the
    // reader tries other rows.
    rowLastPick: {
        borderLeftWidth: 3,
        borderLeftColor: colors.readerLevelUnderlineEasy,
    },
    // Where reading has moved the estimate since: a light dashed outline.
    rowEstimate: {
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.readerLevelUnderlineMid,
        borderRadius: 6,
    },
    tagRow: {
        flexDirection: 'row',
        gap: 6,
        marginTop: 3,
    },
    tag: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    tagPick: {
        color: colors.readerLevelUnderlineEasy,
    },
    tagEstimate: {
        color: colors.readerLevelUnderlineMid,
    },
    rowLabelCol: {
        width: 48,
        alignItems: 'center',
        gap: spacing.xxs ?? 2,
    },
    rowLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        color: colors.textTertiary,
        fontVariant: ['tabular-nums'],
    },
    rowLabelKnown: {
        color: colors.readerLevelUnderlineEasy,
        fontFamily: fontFamilies.sansSemiBold,
    },
    wordsCol: {
        flex: 1,
    },
    word: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 14,
        lineHeight: 19,
        color: colors.text,
    },
    wordKnown: {
        color: colors.readerLevelUnderlineEasy,
    },
    confirmButton: {
        marginTop: spacing.lg,
        paddingVertical: spacing.md,
        borderRadius: radii.lg ?? 16,
        alignItems: 'center',
        backgroundColor: colors.inkSlate ?? colors.text,
    },
    confirmButtonDisabled: {
        opacity: 0.4,
    },
    confirmText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.white,
    },
});

export default VocabLevelModal;
