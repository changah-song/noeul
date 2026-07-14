import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppContext } from '../../contexts/AppContext';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing, useTheme } from '../../theme';
import { getVocabTiers, thetaForTier } from '../../services/vocabSizeLevels';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import { setProfileAbilityFromVocab } from '../../services/Database';

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
        activeOwnerId,
        activeProfileId,
        targetLanguage,
        setTargetLanguageLevel,
    } = useAppContext();
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
    const { t } = useTranslation();

    const tiers = useMemo(() => getVocabTiers(targetLanguage), [targetLanguage]);
    const [selectedIndex, setSelectedIndex] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (visible) {
            setSelectedIndex(null);
            setIsSaving(false);
        }
    }, [visible]);

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
        } catch (error) {
            console.warn('[VocabLevel] Failed to save vocab level:', error?.message ?? error);
        } finally {
            setIsSaving(false);
            onClose?.();
        }
    }, [activeOwnerId, activeProfileId, isSaving, onClose, selectedIndex, setTargetLanguageLevel, targetLanguage, tiers]);

    const tierLabel = useCallback((tier) => (
        tier.advanced ? t('vocabLevel.advancedTier') : String(tier.threshold)
    ), [t]);

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

                            <ScrollView
                                style={styles.list}
                                contentContainerStyle={styles.listContent}
                                showsVerticalScrollIndicator
                            >
                                {tiers.map((tier, index) => {
                                    const known = selectedIndex != null && index <= selectedIndex;
                                    const isPick = index === selectedIndex;
                                    return (
                                        <TouchableOpacity
                                            key={tier.threshold}
                                            activeOpacity={0.75}
                                            onPress={() => setSelectedIndex(index)}
                                            accessibilityRole="radio"
                                            accessibilityState={{ selected: isPick }}
                                            style={[styles.row, known && styles.rowKnown, isPick && styles.rowPick]}
                                        >
                                            <View style={styles.rowLabelCol}>
                                                <Text style={[styles.rowLabel, known && styles.rowLabelKnown]}>
                                                    {tierLabel(tier)}
                                                </Text>
                                                {isPick ? (
                                                    <Feather name="check" size={14} color={theme.colors.readerLevelSameUnderline} />
                                                ) : null}
                                            </View>
                                            <View style={styles.wordsCol}>
                                                {tier.words.map((word) => (
                                                    <Text
                                                        key={word}
                                                        style={[styles.word, known && styles.wordKnown]}
                                                    >
                                                        {word}
                                                    </Text>
                                                ))}
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
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.divider,
    },
    rowKnown: {
        backgroundColor: colors.accentSoft,
    },
    rowPick: {
        backgroundColor: colors.accentMuted,
    },
    rowLabelCol: {
        width: 56,
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
        color: colors.readerLevelSameUnderline,
        fontFamily: fontFamilies.sansSemiBold,
    },
    wordsCol: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm,
    },
    word: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 16,
        color: colors.text,
    },
    wordKnown: {
        color: colors.readerLevelSameUnderline,
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
