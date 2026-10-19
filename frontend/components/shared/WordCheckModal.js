import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
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
import { springs, springTo, useReducedMotion } from '../../theme/motion';
import { PaperButton, PaperSheet, PressableScale } from '../ui';
import { applyWordCheckResults, getReaderLevel } from '../../services/Database';
import { createWordCheck } from '../../services/wordCheck';
import { nearestRankForTheta } from '../../services/calibrationQuiz';
import { getVocabTiers } from '../../services/vocabSizeLevels';

// Fewer answers than this are not worth saving when the reader stops early.
const MIN_ANSWERS_TO_SAVE = 10;

const GUTTER = 24;
// Sheets run edge to edge; keep the last control clear of the system bar.
const BOTTOM_INSET = initialWindowMetrics?.insets?.bottom ?? 0;

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
 *
 * Paper sheet: the word sits large in the middle, and each new word settles
 * in with a short critically damped spring so the change reads without
 * slowing the reader down. Drag-to-close is off while answering so a stray
 * swipe can't end the check.
 */
const WordCheckModal = ({ visible, onClose }) => {
    const { activeProfileId, targetLanguage, setTargetLanguageLevel } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
    const { t } = useTranslation();
    const reduced = useReducedMotion();

    const [phase, setPhase] = useState('intro'); // intro | asking | saving | done
    const [prompt, setPrompt] = useState(null);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [result, setResult] = useState(null);
    const checkRef = useRef(null);
    const savedRef = useRef(false);
    // New word: fades and rises a few px into place.
    const wordIn = useRef(new Animated.Value(1)).current;
    const progressValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) return;
        setPhase('intro');
        setPrompt(null);
        setResult(null);
        progressValue.setValue(0);
        checkRef.current = null;
        savedRef.current = false;
    }, [visible, progressValue]);

    useEffect(() => {
        if (!prompt) return;
        if (reduced) {
            wordIn.setValue(1);
            return;
        }
        wordIn.setValue(0);
        springTo(wordIn, 1, { spring: springs.snappy }).start();
    }, [prompt, reduced, wordIn]);

    const fraction = progress.total ? progress.done / progress.total : 0;

    useEffect(() => {
        if (reduced) {
            progressValue.setValue(fraction);
            return;
        }
        springTo(progressValue, fraction, { spring: springs.standard, useNativeDriver: false }).start();
    }, [fraction, progressValue, reduced]);

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

    const wordFont = targetLanguage === 'ko' ? styles.wordKorean : null;

    return (
        <PaperSheet
            visible={visible}
            onClose={close}
            maxHeightRatio={0.92}
            dragToClose={phase !== 'asking' && phase !== 'saving'}
            closeOnBackdrop={phase !== 'asking' && phase !== 'saving'}
            accessibilityLabel={t('wordCheck.title')}
        >
            <View style={styles.body}>
                <View style={styles.headerRow}>
                    <Text style={styles.eyebrow}>{t('wordCheck.title')}</Text>
                    <PressableScale
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                        style={styles.closeButton}
                    >
                        <Feather name="x" size={20} color={theme.colors.textMuted} />
                    </PressableScale>
                </View>

                {phase === 'intro' ? (
                    <View style={styles.phase}>
                        <Text style={styles.lead} accessibilityRole="header">{t('wordCheck.introTitle')}</Text>
                        <Text style={styles.helper}>{t('wordCheck.introBody')}</Text>
                        <Text style={styles.helper}>{t('wordCheck.introMadeUp')}</Text>
                        <View style={styles.spacer} />
                        <PaperButton label={t('wordCheck.start')} onPress={start} style={styles.fullButton} />
                    </View>
                ) : null}

                {phase === 'asking' && prompt ? (
                    <View style={styles.phase}>
                        <View style={styles.progressRow}>
                            <View
                                style={styles.progressTrack}
                                accessibilityRole="progressbar"
                                accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
                            >
                                <Animated.View
                                    style={[
                                        styles.progressFill,
                                        {
                                            width: progressValue.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: ['0%', '100%'],
                                                extrapolate: 'clamp',
                                            }),
                                        },
                                    ]}
                                />
                            </View>
                            <Text style={styles.count}>{`${progress.done + 1} / ${progress.total}`}</Text>
                        </View>

                        <View style={styles.wordStage}>
                            <Animated.Text
                                style={[
                                    styles.word,
                                    wordFont,
                                    {
                                        opacity: wordIn,
                                        transform: [{
                                            translateY: wordIn.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
                                        }],
                                    },
                                ]}
                                accessibilityRole="header"
                                adjustsFontSizeToFit
                                numberOfLines={1}
                            >
                                {prompt.word}
                            </Animated.Text>
                            <Text style={styles.question}>{t('wordCheck.question')}</Text>
                        </View>

                        <View style={styles.answerRow}>
                            <PaperButton
                                variant="secondary"
                                label={t('wordCheck.dontKnow')}
                                onPress={() => answer(0)}
                                style={styles.answerButton}
                            />
                            <PaperButton
                                label={t('wordCheck.know')}
                                onPress={() => answer(1)}
                                style={styles.answerButton}
                            />
                        </View>
                    </View>
                ) : null}

                {phase === 'saving' ? (
                    <View style={[styles.phase, styles.saving]}>
                        <ActivityIndicator color={theme.colors.textMuted} />
                    </View>
                ) : null}

                {phase === 'done' && result ? (
                    <View style={styles.phase}>
                        <Text style={styles.lead} accessibilityRole="header">{resultLabel || t('wordCheck.resultSaved')}</Text>
                        <Text style={styles.helper}>{t('wordCheck.resultKnown', { known: result.known, total: result.real })}</Text>
                        {result.pseudoClaimed > 0 ? (
                            <Text style={styles.note}>{t('wordCheck.resultMadeUp', { count: result.pseudoClaimed })}</Text>
                        ) : null}
                        <Text style={styles.helper}>{t('wordCheck.resultNext')}</Text>
                        <View style={styles.spacer} />
                        <PaperButton label={t('wordCheck.done')} onPress={onClose} style={styles.fullButton} />
                    </View>
                ) : null}
            </View>
        </PaperSheet>
    );
};

const createStyles = (colors) => StyleSheet.create({
    body: {
        // A steady height across phases, so the sheet doesn't jump as the
        // check moves from intro to words to result.
        minHeight: 470,
        paddingHorizontal: GUTTER,
        paddingTop: 4,
        paddingBottom: 20 + BOTTOM_INSET,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.96,
        textTransform: 'uppercase',
        color: colors.textMuted,
    },
    closeButton: {
        width: 44,
        height: 44,
        marginRight: -10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
    },
    // flexGrow (not flex: 1) so a phase is never shorter than its content.
    phase: {
        flexGrow: 1,
    },
    spacer: {
        flexGrow: 1,
        minHeight: 24,
    },
    lead: {
        fontFamily: fontFamilies.displayRegular,
        fontSize: 30,
        lineHeight: 34,
        letterSpacing: -0.6,
        color: colors.text,
        marginBottom: 6,
    },
    helper: {
        marginTop: 10,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textMuted,
    },
    note: {
        marginTop: 10,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 19,
        color: colors.textTertiary,
    },
    progressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    progressTrack: {
        flex: 1,
        height: 2,
        borderRadius: 1,
        backgroundColor: colors.border,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.inkSlate,
    },
    count: {
        minWidth: 52,
        textAlign: 'right',
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        color: colors.textMuted,
        fontVariant: ['tabular-nums'],
    },
    wordStage: {
        flexGrow: 1,
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
    },
    word: {
        textAlign: 'center',
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 48,
        lineHeight: 60,
        color: colors.text,
    },
    wordKorean: {
        fontFamily: fontFamilies.krSerifSemiBold,
    },
    question: {
        marginTop: 10,
        textAlign: 'center',
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textMuted,
    },
    answerRow: {
        flexDirection: 'row',
        gap: 10,
    },
    answerButton: {
        flex: 1,
        paddingHorizontal: 12,
    },
    fullButton: {
        alignSelf: 'stretch',
    },
    saving: {
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default WordCheckModal;
