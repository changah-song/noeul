import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
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
import {
    CALIBRATION_LEARNING_RATE,
    nearestRankForTheta,
    selectCalibrationWords,
} from '../../services/calibrationQuiz';
import { updateThetaFromOutcome } from '../../services/Database';
import { getProficiencyLevelForLanguage } from '../../constants/proficiencyLevels';

/**
 * CalibrationQuizModal — the cold-start "check the words you know" flow.
 *
 * Shows a stratified sample of graded words, easiest band first; every
 * know / don't-know tap is persisted immediately through the standard online
 * IRT update (`updateThetaFromOutcome`, anchor disabled — see calibrationQuiz.js).
 * Persist-per-tap means quitting midway keeps the evidence gathered so far; the
 * result screen offers to align the displayed proficiency level with the
 * measured theta.
 */
const CalibrationQuizModal = ({ visible, onClose }) => {
    const {
        activeOwnerId,
        activeProfileId,
        targetLanguage,
        setTargetLanguageLevel,
        levelsByLanguage,
    } = useAppContext();
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
    const { t } = useTranslation();

    const [words, setWords] = useState([]);
    const [index, setIndex] = useState(0);
    const [finalTheta, setFinalTheta] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    // Serializes the per-tap theta writes so a fast tapper can't interleave them.
    const writeQueueRef = useRef(Promise.resolve());

    useEffect(() => {
        if (visible) {
            setWords(selectCalibrationWords(targetLanguage));
            setIndex(0);
            setFinalTheta(null);
        }
    }, [visible, targetLanguage]);

    const current = words[index] ?? null;
    const isDone = words.length > 0 && index >= words.length;

    const handleAnswer = useCallback((outcome) => {
        if (!current || isSaving) {
            return;
        }
        const answered = current;
        setIsSaving(true);
        writeQueueRef.current = writeQueueRef.current
            .then(() => updateThetaFromOutcome({
                ownerId: activeOwnerId,
                profileId: activeProfileId,
                language: targetLanguage,
                stem: answered.word,
                difficulty: answered.difficulty,
                outcome,
                learningRate: CALIBRATION_LEARNING_RATE,
                anchor: false,
            }))
            .then((nextTheta) => {
                if (Number.isFinite(Number(nextTheta))) {
                    setFinalTheta(Number(nextTheta));
                }
            })
            .catch((error) => {
                console.warn('[CalibrationQuiz] Failed to persist outcome:', error?.message ?? error);
            })
            .finally(() => setIsSaving(false));
        setIndex((value) => value + 1);
    }, [activeOwnerId, activeProfileId, current, isSaving, targetLanguage]);

    const measuredRank = finalTheta != null ? nearestRankForTheta(targetLanguage, finalTheta) : null;
    const measuredOption = useMemo(() => (
        measuredRank != null
            ? getProficiencyLevelForLanguage(targetLanguage, { [targetLanguage]: measuredRank })
            : null
    ), [measuredRank, targetLanguage]);
    const currentOption = getProficiencyLevelForLanguage(targetLanguage, levelsByLanguage);

    const handleFinish = useCallback(() => {
        // Align the displayed level with the measurement. Safe: the ability seed
        // never overwrites a theta once behavioral events exist.
        if (measuredRank != null && measuredRank !== currentOption?.rank) {
            setTargetLanguageLevel(measuredRank);
        }
        onClose?.();
    }, [currentOption?.rank, measuredRank, onClose, setTargetLanguageLevel]);

    const progressLabel = t('calibration.progress', {
        current: Math.min(index + 1, words.length),
        total: words.length,
    });

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={isDone ? handleFinish : onClose}>
                <View style={styles.backdrop}>
                    <TouchableWithoutFeedback>
                        <View style={styles.card}>
                            {!isDone ? (
                                <>
                                    <View style={styles.headerRow}>
                                        <Text style={styles.eyebrow}>{t('calibration.title')}</Text>
                                        <Text style={styles.progress}>{words.length > 0 ? progressLabel : ''}</Text>
                                    </View>
                                    <Text style={styles.helper}>{t('calibration.subtitle')}</Text>
                                    {current ? (
                                        <View style={styles.wordStage}>
                                            <Text style={styles.word}>{current.word}</Text>
                                        </View>
                                    ) : (
                                        <View style={styles.wordStage}>
                                            <ActivityIndicator color={theme.colors.textSecondary} />
                                        </View>
                                    )}
                                    <View style={styles.answerRow}>
                                        <TouchableOpacity
                                            activeOpacity={0.85}
                                            onPress={() => handleAnswer(0)}
                                            style={[styles.answerButton, styles.answerButtonSecondary]}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.answerSecondaryText}>{t('calibration.dontKnow')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            activeOpacity={0.85}
                                            onPress={() => handleAnswer(1)}
                                            style={[styles.answerButton, styles.answerButtonPrimary]}
                                            accessibilityRole="button"
                                        >
                                            <Feather name="check" size={16} color={theme.colors.white} />
                                            <Text style={styles.answerPrimaryText}>{t('calibration.know')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <Pressable onPress={onClose} style={styles.skipButton} accessibilityRole="button">
                                        <Text style={styles.skipText}>{t('calibration.finishLater')}</Text>
                                    </Pressable>
                                </>
                            ) : (
                                <>
                                    <Text style={styles.eyebrow}>{t('calibration.resultEyebrow')}</Text>
                                    <Text style={styles.resultLevel}>
                                        {measuredOption?.label ?? currentOption?.label ?? ''}
                                    </Text>
                                    <Text style={styles.helper}>{t('calibration.resultNote')}</Text>
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        onPress={handleFinish}
                                        style={[styles.answerButton, styles.answerButtonPrimary, styles.doneButton]}
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.answerPrimaryText}>{t('common.done')}</Text>
                                    </TouchableOpacity>
                                </>
                            )}
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
        maxWidth: 420,
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
        fontFamily: fontFamilies.semibold,
        fontSize: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: colors.textTertiary,
    },
    progress: {
        fontFamily: fontFamilies.medium,
        fontSize: 12,
        color: colors.textTertiary,
        fontVariant: ['tabular-nums'],
    },
    helper: {
        marginTop: spacing.sm,
        fontFamily: fontFamilies.regular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    wordStage: {
        minHeight: 108,
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: spacing.lg,
    },
    word: {
        fontFamily: fontFamilies.serifBold ?? fontFamilies.semibold,
        fontSize: 34,
        color: colors.text,
        textAlign: 'center',
    },
    answerRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    answerButton: {
        flex: 1,
        flexDirection: 'row',
        gap: spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: radii.lg ?? 16,
    },
    answerButtonSecondary: {
        backgroundColor: colors.surfaceMuted,
    },
    answerButtonPrimary: {
        backgroundColor: colors.inkSlate ?? colors.text,
    },
    answerSecondaryText: {
        fontFamily: fontFamilies.semibold,
        fontSize: 15,
        color: colors.textSecondary,
    },
    answerPrimaryText: {
        fontFamily: fontFamilies.semibold,
        fontSize: 15,
        color: colors.white,
    },
    skipButton: {
        marginTop: spacing.md,
        alignItems: 'center',
        paddingVertical: spacing.xs,
    },
    skipText: {
        fontFamily: fontFamilies.medium,
        fontSize: 13,
        color: colors.textTertiary,
    },
    resultLevel: {
        marginTop: spacing.md,
        fontFamily: fontFamilies.serifBold ?? fontFamilies.semibold,
        fontSize: 30,
        color: colors.text,
    },
    doneButton: {
        marginTop: spacing.lg,
    },
});

export default CalibrationQuizModal;
