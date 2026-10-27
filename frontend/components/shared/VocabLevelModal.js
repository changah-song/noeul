import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    ToastAndroid,
    View,
} from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import { fontFamilies, useTheme } from '../../theme';
import { getVocabTiers, thetaForTier } from '../../services/vocabSizeLevels';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import { getProfileAbility, setProfileAbilityFromVocab } from '../../services/Database';
import { hasWordCheck } from '../../services/wordCheck';
import { SheetFrame, WordCheckBody, useWordCheck } from './WordCheckModal';

// The tier the reader last picked, per owner / profile / language.
export const vocabLevelPickKey = (ownerId, profileId, language) => `vocabLevelPick:${ownerId || 'guest'}:${profileId || ''}:${language}`;
const pickKey = vocabLevelPickKey;

// Index of the hardest tier at or below this ability: the row the model now
// thinks the reader knows all of. Null when there is no ability yet.
export const tierIndexForTheta = (tiers, theta) => {
    if (theta === null || theta === undefined || theta === '') return null;
    if (!Number.isFinite(Number(theta)) || !tiers.length) return null;
    let index = null;
    tiers.forEach((tier, i) => {
        if (Number(tier.theta) <= Number(theta) + 1e-6) index = i;
    });
    return index ?? 0;
};

// Rgba tint of a #rrggbb token (falls back to the token itself).
const tint = (hex, alpha) => {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!match) return hex;
    const value = parseInt(match[1], 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

/**
 * VocabLevelModal — the "tap the last row where you know all the words" grid,
 * as a bottom sheet.
 *
 * Each row is a frequency tier (the ~100 / ~300 / ~700 ... most common words);
 * selecting a row treats every row up to it as known and seeds ability `theta`
 * from the tier's baked value (see services/vocabSizeLevels.js). The seed is
 * written through `setProfileAbilityFromVocab` (clobber-safe) and the
 * displayed level is aligned to the nearest band via `setTargetLanguageLevel`.
 * The word check runs inside the same sheet (back chevron returns to the list).
 */
const VocabLevelModal = ({ visible, onClose, initialMode = 'list' }) => {
    const {
        activeProfileId,
        targetLanguage,
        setTargetLanguageLevel,
    } = useAppContext();
    // The signed-in account's id lives in the local-owner context; the app
    // context has none, so reading it there saved the level under "guest".
    const { activeOwnerId } = useLocalOwner();
    const theme = useTheme();
    const colors = theme.colors;
    const styles = useMemo(() => createStyles(colors), [colors]);
    const { t } = useTranslation();

    const tiers = useMemo(() => getVocabTiers(targetLanguage), [targetLanguage]);
    const isEnglish = targetLanguage === 'en';
    const [selectedIndex, setSelectedIndex] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    // The word check replaces the grid while it runs.
    const [checking, setChecking] = useState(false);
    // What the reader picked last time, and where reading has moved the
    // estimate since.
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

    const wordCheck = useWordCheck({
        active: visible && checking,
        onClose: () => {
            setChecking(false);
            onClose?.();
        },
    });

    useEffect(() => {
        if (!visible) return undefined;
        setChecking(initialMode === 'check' && hasWordCheck(targetLanguage));
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
    }, [visible, initialMode, activeOwnerId, activeProfileId, targetLanguage, tiers, scrollToRow]);

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
        tier.advanced ? t('vocabLevel.advancedTier') : (tier.label || formatNumber(tier.threshold))
    ), [t]);

    // The "Now" marker: where reading has moved the estimate, else the pick.
    const nowIndex = estimateIndex ?? lastPickIndex;

    if (checking) {
        return (
            <SheetFrame
                visible={visible}
                onClose={wordCheck.close}
                title={t('wordCheck.title')}
                onBack={async () => {
                    await wordCheck.stop();
                    setChecking(false);
                }}
                backLabel={t('vocabLevel.backToList')}
            >
                <WordCheckBody
                    check={wordCheck}
                    onDone={() => {
                        setChecking(false);
                        onClose?.();
                    }}
                />
            </SheetFrame>
        );
    }

    const confirmDisabled = selectedIndex == null || isSaving;

    return (
        <SheetFrame visible={visible} onClose={onClose} title={t('vocabLevel.title')} fillRatio={0.86}>
            <View style={styles.body}>
                <Text style={styles.helper}>{t('vocabLevel.instruction')}</Text>
                {hasWordCheck(targetLanguage) ? (
                    <TouchableOpacity
                        onPress={() => setChecking(true)}
                        style={styles.checkLink}
                        activeOpacity={0.7}
                        accessibilityRole="link"
                    >
                        <Text style={styles.checkLinkText}>{t('vocabLevel.takeCheck')}</Text>
                    </TouchableOpacity>
                ) : null}

                <View style={styles.listFrame}>
                    <ScrollView
                        ref={listRef}
                        style={styles.list}
                        showsVerticalScrollIndicator
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('vocabLevel.title')}
                    >
                        {tiers.map((tier, index) => {
                            const known = selectedIndex != null && index <= selectedIndex;
                            const isPick = index === selectedIndex;
                            const isNow = index === nowIndex;
                            const wasPicked = index === lastPickIndex && lastPickIndex !== nowIndex;
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
                                        index > 0 && styles.rowDivider,
                                        known && styles.rowKnown,
                                        isPick && styles.rowPick,
                                    ]}
                                >
                                    <View style={styles.rowLabelCol}>
                                        <Text style={[styles.rowLabel, known && styles.rowLabelKnown]} numberOfLines={1}>
                                            {tierLabel(tier)}
                                        </Text>
                                        {isNow ? (
                                            <Text style={styles.tagNow}>{t('vocabLevel.estimateNow')}</Text>
                                        ) : null}
                                        {wasPicked ? (
                                            <Text style={styles.tagPick} numberOfLines={1}>{t('vocabLevel.yourPick')}</Text>
                                        ) : null}
                                    </View>
                                    <Text style={[styles.word, isEnglish && styles.wordEn, known && styles.wordKnown]}>
                                        {tier.words.join(isEnglish ? ' · ' : ' ')}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleConfirm}
                    disabled={confirmDisabled}
                    style={[styles.confirmButton, confirmDisabled && styles.confirmButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: confirmDisabled }}
                >
                    <Text style={styles.confirmText}>{t('vocabLevel.confirm')}</Text>
                </TouchableOpacity>
            </View>
        </SheetFrame>
    );
};

const createStyles = (colors) => StyleSheet.create({
    body: {
        flex: 1,
        minHeight: 0,
    },
    helper: {
        marginTop: 2,
        marginHorizontal: 20,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
    },
    checkLink: {
        marginTop: 4,
        marginHorizontal: 20,
        alignSelf: 'flex-start',
        minHeight: 36,
        justifyContent: 'center',
    },
    checkLinkText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 20,
        color: colors.inkSlate,
        textDecorationLine: 'underline',
    },
    listFrame: {
        flex: 1,
        minHeight: 0,
        marginTop: 10,
        marginHorizontal: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.divider,
        overflow: 'hidden',
    },
    list: {
        flex: 1,
    },
    row: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 14,
        backgroundColor: colors.surface,
    },
    rowDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
    },
    rowKnown: {
        backgroundColor: tint(colors.readerLevelUnderlineEasy, 0.05),
    },
    rowPick: {
        backgroundColor: tint(colors.readerLevelUnderlineEasy, 0.12),
    },
    rowLabelCol: {
        width: 64,
        alignItems: 'flex-start',
        gap: 2,
    },
    rowLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        color: colors.textTertiary,
        fontVariant: ['tabular-nums'],
    },
    rowLabelKnown: {
        color: colors.readerLevelUnderlineEasy,
    },
    tagNow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        lineHeight: 13,
        color: colors.readerLevelUnderlineMid,
    },
    tagPick: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        lineHeight: 13,
        color: colors.textTertiary,
    },
    word: {
        flex: 1,
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.text,
    },
    wordEn: {
        fontFamily: fontFamilies.displayRegular,
    },
    wordKnown: {
        color: colors.readerLevelUnderlineEasy,
    },
    confirmButton: {
        marginTop: 14,
        marginHorizontal: 16,
        minHeight: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.inkSlate,
    },
    confirmButtonDisabled: {
        opacity: 0.35,
    },
    confirmText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        color: colors.white,
    },
});

export default VocabLevelModal;
