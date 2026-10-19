import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    ToastAndroid,
    TouchableOpacity,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { fontFamilies, radii, spacing, useTheme } from '../../theme';
import { applyWordCheckResults, getReaderLevel } from '../../services/Database';
import { createWordCheck } from '../../services/wordCheck';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import { getVocabTiers } from '../../services/vocabSizeLevels';

// Fewer answers than this are not worth saving when the reader stops early.
const MIN_ANSWERS_TO_SAVE = 10;

const tierIndexAtOrBelow = (tiers, theta) => {
    let index = 0;
    tiers.forEach((tier, i) => {
        if (Number(tier.theta) <= Number(theta) + 1e-6) index = i;
    });
    return index;
};

/**
 * WordCheckModal — the three-minute word check (services/wordCheck.js):
 * "do you know this word?" about ~36 words picked around the reader's level,
 * with a few made-up ones mixed in. Saves through the level engine when the
 * reader finishes (or stops after enough answers) and shows where they landed.
 */
const WordCheckModal = ({ visible, onClose }) => {
    const { activeProfileId, targetLanguage, setTargetLanguageLevel } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
    const { t } = useTranslation();

    const [phase, setPhase] = useState('intro'); // intro | asking | saving | done
    const [prompt, setPrompt] = useState(null);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [result, setResult] = useState(null);
    const checkRef = useRef(null);
    const savedRef = useRef(false);

    useEffect(() => {
        if (!visible) return;
        setPhase('intro');
        setPrompt(null);
        setResult(null);
        checkRef.current = null;
        savedRef.current = false;
    }, [visible]);

    const start = useCallback(async () => {
        let reader = null;
        try {
            reader = await getReaderLevel({ ownerId: activeOwnerId, profileId: activeProfileId, language: targetLanguage });
        } catch {
            reader = { theta: 0, variance: 2 };
        }
        const check = createWordCheck({ language: targetLanguage, reader });
        checkRef.current = check;
        setProgress(check.progress());
        setPrompt(check.next());
        setPhase('asking');
    }, [activeOwnerId, activeProfileId, targetLanguage]);

    const save = useCallback(async () => {
        const check = checkRef.current;
        if (!check || savedRef.current) return null;
        savedRef.current = true;
        const summary = check.result();
        try {
            const state = await applyWordCheckResults({
                ownerId: activeOwnerId,
                profileId: activeProfileId,
                language: targetLanguage,
                answers: check.answers,
            });
            const theta = state?.theta ?? summary.theta;
            setTargetLanguageLevel?.(nearestRankForTheta(targetLanguage, theta));
            return { ...summary, theta, variance: state?.variance ?? summary.variance };
        } catch (error) {
            console.warn('[WordCheck] Failed to save answers:', error?.message ?? error);
            return summary;
        }
    }, [activeOwnerId, activeProfileId, setTargetLanguageLevel, targetLanguage]);

    const answer = useCallback(async (outcome) => {
        const check = checkRef.current;
        if (!check || phase !== 'asking') return;
        check.answer(outcome);
        setProgress(check.progress());
        const next = check.next();
        if (next) {
            setPrompt(next);
            return;
        }
        setPhase('saving');
        const saved = await save();
        setResult(saved);
        setPhase('done');
    }, [phase, save]);

    const close = useCallback(async () => {
        const check = checkRef.current;
        if (phase === 'asking' && check && check.answers.length >= MIN_ANSWERS_TO_SAVE) {
            await save();
            ToastAndroid.show(t('wordCheck.savedPartial'), ToastAndroid.SHORT);
        }
        onClose?.();
    }, [onClose, phase, save, t]);

    const tiers = useMemo(() => getVocabTiers(targetLanguage), [targetLanguage]);
    const resultLabel = useMemo(() => {
        if (!result || !tiers.length) return null;
        const tier = tiers[tierIndexAtOrBelow(tiers, result.theta)];
        if (!tier) return null;
        if (tier.label) return t('wordCheck.resultHsk', { level: tier.label });
        if (tier.advanced) return t('wordCheck.resultAdvanced');
        return t('wordCheck.resultWords', { count: Number(tier.threshold).toLocaleString() });
    }, [result, t, tiers]);

    const fraction = progress.total ? progress.done / progress.total : 0;

    return (
        <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={styles.headerRow}>
                        <Text style={styles.eyebrow}>{t('wordCheck.title')}</Text>
                        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                            <Feather name="x" size={20} color={theme.colors.textTertiary} />
                        </Pressable>
                    </View>

                    {phase === 'intro' ? (
                        <View>
                            <Text style={styles.lead}>{t('wordCheck.introTitle')}</Text>
                            <Text style={styles.helper}>{t('wordCheck.introBody')}</Text>
                            <Text style={styles.helper}>{t('wordCheck.introMadeUp')}</Text>
                            <TouchableOpacity style={styles.primary} onPress={start} activeOpacity={0.85} accessibilityRole="button">
                                <Text style={styles.primaryText}>{t('wordCheck.start')}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : null}

                    {phase === 'asking' && prompt ? (
                        <View>
                            <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
                                <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
                            </View>
                            <Text style={styles.count}>{`${progress.done + 1} / ${progress.total}`}</Text>
                            <Text style={styles.word} accessibilityRole="header">{prompt.word}</Text>
                            <Text style={styles.question}>{t('wordCheck.question')}</Text>
                            <View style={styles.answerRow}>
                                <TouchableOpacity style={styles.secondary} onPress={() => answer(0)} activeOpacity={0.8} accessibilityRole="button">
                                    <Text style={styles.secondaryText}>{t('wordCheck.dontKnow')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.primary, styles.answerPrimary]} onPress={() => answer(1)} activeOpacity={0.85} accessibilityRole="button">
                                    <Text style={styles.primaryText}>{t('wordCheck.know')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : null}

                    {phase === 'saving' ? (
                        <View style={styles.saving}>
                            <ActivityIndicator color={theme.colors.textSecondary} />
                        </View>
                    ) : null}

                    {phase === 'done' && result ? (
                        <View>
                            <Text style={styles.lead}>{resultLabel || t('wordCheck.resultSaved')}</Text>
                            <Text style={styles.helper}>{t('wordCheck.resultKnown', { known: result.known, total: result.real })}</Text>
                            {result.pseudoClaimed > 0 ? (
                                <Text style={styles.note}>{t('wordCheck.resultMadeUp', { count: result.pseudoClaimed })}</Text>
                            ) : null}
                            <Text style={styles.helper}>{t('wordCheck.resultNext')}</Text>
                            <TouchableOpacity style={styles.primary} onPress={onClose} activeOpacity={0.85} accessibilityRole="button">
                                <Text style={styles.primaryText}>{t('wordCheck.done')}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : null}
                </View>
            </View>
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
        backgroundColor: colors.surface,
        borderRadius: radii.xl ?? 24,
        padding: spacing.xl,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.md,
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: colors.textTertiary,
    },
    lead: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 18,
        lineHeight: 25,
        color: colors.text,
    },
    helper: {
        marginTop: spacing.sm,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textSecondary,
    },
    note: {
        marginTop: spacing.sm,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 19,
        color: colors.textTertiary,
    },
    progressTrack: {
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.divider,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: colors.inkSlate,
    },
    count: {
        marginTop: 6,
        alignSelf: 'flex-end',
        fontFamily: fontFamilies.sansMedium,
        fontSize: 12,
        color: colors.textTertiary,
    },
    word: {
        marginTop: spacing.xl,
        textAlign: 'center',
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 40,
        lineHeight: 52,
        color: colors.text,
    },
    question: {
        marginTop: spacing.sm,
        textAlign: 'center',
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        color: colors.textTertiary,
    },
    answerRow: {
        marginTop: spacing.xl,
        flexDirection: 'row',
        gap: spacing.sm,
    },
    primary: {
        marginTop: spacing.lg,
        minHeight: 50,
        borderRadius: radii.lg ?? 16,
        backgroundColor: colors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
    },
    answerPrimary: {
        flex: 1,
        marginTop: 0,
    },
    primaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
    secondary: {
        flex: 1,
        minHeight: 50,
        borderRadius: radii.lg ?? 16,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
    },
    secondaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    saving: {
        height: 160,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default WordCheckModal;
