import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Easing,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    ToastAndroid,
    TouchableOpacity,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import { fontFamilies, useTheme } from '../../theme';
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

// ─── Bottom sheet frame ───────────────────────────────────────────────────────
//
// The shared bottom sheet used by the level picker, the word check, and the
// Profile / onboarding pickers: dimmed backdrop, rounded top (24), grabber,
// display-serif title on the left, close (X) on the right, optional back
// chevron. Slides up in ~250 ms. `fillRatio` gives the sheet a fixed height
// (as a share of the window) so a scrolling list inside can flex; without it
// the sheet sizes to its content (capped at 90%).
export const SheetFrame = ({
    visible,
    onClose,
    title,
    onBack,
    backLabel,
    fillRatio,
    children,
    testID,
}) => {
    const theme = useTheme();
    const colors = theme.colors;
    const { t } = useTranslation();
    // A null context (no provider, e.g. in tests) means no insets.
    const safeInsets = useContext(SafeAreaInsetsContext);
    const bottomInset = safeInsets?.bottom ?? 0;
    const { height: windowHeight } = useWindowDimensions();
    const styles = useMemo(() => createSheetStyles(colors), [colors]);

    const [mounted, setMounted] = useState(visible);
    const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.timing(progress, {
                toValue: 1,
                duration: 250,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(progress, {
                toValue: 0,
                duration: 180,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, progress]);

    if (!mounted && !visible) return null;

    const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight * 0.6, 0] });
    const sizing = fillRatio
        ? { height: Math.round(windowHeight * fillRatio) }
        : { maxHeight: Math.round(windowHeight * 0.9) };

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.overlay} testID={testID}>
                <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: progress }]} />
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                />
                <Animated.View
                    style={[
                        styles.sheet,
                        sizing,
                        { paddingBottom: 20 + bottomInset, transform: [{ translateY }] },
                    ]}
                >
                    <View style={styles.grabber} />
                    <View style={styles.header}>
                        {onBack ? (
                            <TouchableOpacity
                                onPress={onBack}
                                style={styles.backButton}
                                accessibilityRole="button"
                                accessibilityLabel={backLabel || t('common.back')}
                            >
                                <Feather name="chevron-left" size={22} color={colors.inkSlate} />
                            </TouchableOpacity>
                        ) : null}
                        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityRole="button"
                            accessibilityLabel={t('common.close')}
                        >
                            <Feather name="x" size={20} color={colors.textTertiary} />
                        </TouchableOpacity>
                    </View>
                    {children}
                </Animated.View>
            </View>
        </Modal>
    );
};

// A bottom sheet of radio rows with a check on the picked one (learning
// language, interface language). `options`: [{ key, label, fontFamily?,
// disabled? }].
export const OptionSheet = ({
    visible,
    onClose,
    title,
    note,
    footnote,
    options,
    selectedKey,
    onSelect,
    rowHeight = 48,
}) => {
    const theme = useTheme();
    const colors = theme.colors;
    const styles = useMemo(() => createSheetStyles(colors), [colors]);

    return (
        <SheetFrame visible={visible} onClose={onClose} title={title}>
            {note ? <Text style={styles.note}>{note}</Text> : null}
            <ScrollView style={styles.optionScroller} bounces={false}>
                <View style={styles.optionList} accessibilityRole="radiogroup" accessibilityLabel={title}>
                    {options.map((option, index) => {
                        const selected = option.key === selectedKey;
                        return (
                            <Pressable
                                key={option.key}
                                accessibilityRole="radio"
                                accessibilityState={{ selected, disabled: !!option.disabled }}
                                disabled={!!option.disabled}
                                onPress={() => onSelect(option.key)}
                                style={({ pressed }) => [
                                    styles.optionRow,
                                    { minHeight: rowHeight },
                                    index > 0 && styles.optionRowDivider,
                                    (selected || pressed) && styles.optionRowSelected,
                                    option.disabled && styles.optionRowDisabled,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.optionLabel,
                                        option.fontFamily ? { fontFamily: option.fontFamily } : null,
                                        selected && !option.fontFamily && styles.optionLabelSelected,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {option.label}
                                </Text>
                                {selected ? <Feather name="check" size={18} color={colors.inkSlate} /> : null}
                            </Pressable>
                        );
                    })}
                </View>
                {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
            </ScrollView>
        </SheetFrame>
    );
};

const createSheetStyles = (colors) => StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    scrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.overlay,
    },
    sheet: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 10,
    },
    grabber: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.border,
    },
    header: {
        minHeight: 48,
        marginTop: 6,
        paddingLeft: 20,
        paddingRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        width: 44,
        height: 44,
        marginLeft: -12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        flex: 1,
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 21,
        lineHeight: 28,
        color: colors.text,
    },
    closeButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    note: {
        marginHorizontal: 20,
        marginBottom: 12,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    optionScroller: {
        flexGrow: 0,
    },
    optionList: {
        marginHorizontal: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.divider,
        overflow: 'hidden',
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: colors.surface,
    },
    optionRowDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
    },
    optionRowSelected: {
        backgroundColor: colors.surfaceAssist,
    },
    optionRowDisabled: {
        opacity: 0.45,
    },
    optionLabel: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    optionLabelSelected: {
        fontFamily: fontFamilies.sansSemiBold,
    },
    footnote: {
        marginHorizontal: 20,
        marginTop: 12,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 17,
        color: colors.textTertiary,
    },
});

// ─── Word check ───────────────────────────────────────────────────────────────

/**
 * useWordCheck — the state and handlers of the three-minute word check
 * (services/wordCheck.js). Shared by WordCheckModal and the level picker,
 * which runs the check inside its own sheet. Resets whenever `active` turns on.
 * `stop()` saves a partial run (enough answers) without closing anything;
 * `close()` does the same and then calls onClose.
 */
export const useWordCheck = ({ active, onClose }) => {
    const { activeProfileId, targetLanguage, setTargetLanguageLevel } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const { t } = useTranslation();

    const [phase, setPhase] = useState('intro'); // intro | asking | saving | done
    const [prompt, setPrompt] = useState(null);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [result, setResult] = useState(null);
    const checkRef = useRef(null);
    const savedRef = useRef(false);

    useEffect(() => {
        if (!active) return;
        setPhase('intro');
        setPrompt(null);
        setResult(null);
        checkRef.current = null;
        savedRef.current = false;
    }, [active]);

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

    const stop = useCallback(async () => {
        const check = checkRef.current;
        if (phase === 'asking' && check && check.answers.length >= MIN_ANSWERS_TO_SAVE) {
            await save();
            ToastAndroid.show(t('wordCheck.savedPartial'), ToastAndroid.SHORT);
        }
    }, [phase, save, t]);

    const close = useCallback(async () => {
        await stop();
        onClose?.();
    }, [onClose, stop]);

    return { phase, prompt, progress, result, start, answer, stop, close, targetLanguage };
};

// The body of the word check: intro → question → result. Rendered inside a
// SheetFrame by WordCheckModal and by the level picker.
export const WordCheckBody = ({ check, onDone }) => {
    const theme = useTheme();
    const colors = theme.colors;
    const styles = useMemo(() => createStyles(colors), [colors]);
    const { t } = useTranslation();
    const { phase, prompt, progress, result, start, answer, targetLanguage } = check;

    const tiers = useMemo(() => getVocabTiers(targetLanguage), [targetLanguage]);
    // The headline result, split so the number can be set in bold.
    const resultHeadline = useMemo(() => {
        if (!result || !tiers.length) return null;
        const tier = tiers[tierIndexAtOrBelow(tiers, result.theta)];
        if (!tier) return null;
        if (tier.label) return { text: t('wordCheck.resultHsk', { level: tier.label }), strong: tier.label };
        if (tier.advanced) return { text: t('wordCheck.resultAdvanced'), strong: null };
        const count = formatNumber(tier.threshold);
        return { text: t('wordCheck.resultWords', { count }), strong: count };
    }, [result, t, tiers]);

    const renderHeadline = () => {
        if (!resultHeadline) return t('wordCheck.resultSaved');
        const { text, strong } = resultHeadline;
        const at = strong ? text.indexOf(strong) : -1;
        if (at < 0) return text;
        return (
            <>
                {text.slice(0, at)}
                <Text style={styles.leadStrong}>{strong}</Text>
                {text.slice(at + strong.length)}
            </>
        );
    };

    const fraction = progress.total ? progress.done / progress.total : 0;
    const fillWidth = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(fillWidth, {
            toValue: fraction,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
        }).start();
    }, [fraction, fillWidth]);

    const wordStyle = { ko: 'wordKo', en: 'wordEn' }[targetLanguage] || 'wordZh';

    return (
        <View style={styles.body}>
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
                    <View style={styles.progressRow}>
                        <View
                            style={styles.progressTrack}
                            accessibilityRole="progressbar"
                            accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
                        >
                            <Animated.View
                                style={[
                                    styles.progressFill,
                                    { width: fillWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                                ]}
                            />
                        </View>
                        <Text style={styles.count}>{`${progress.done + 1} / ${progress.total}`}</Text>
                    </View>
                    <View style={styles.wordStage}>
                        <Text
                            style={[styles.word, styles[wordStyle]]}
                            accessibilityRole="header"
                            adjustsFontSizeToFit
                            numberOfLines={1}
                        >
                            {prompt.word}
                        </Text>
                        <Text style={styles.question}>{t('wordCheck.question')}</Text>
                    </View>
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
                    <ActivityIndicator color={colors.textSecondary} />
                </View>
            ) : null}

            {phase === 'done' && result ? (
                <View>
                    <Text style={styles.resultLabel}>{t('wordCheck.resultLabel')}</Text>
                    <Text style={styles.resultLead}>{renderHeadline()}</Text>
                    <Text style={styles.helper}>{t('wordCheck.resultKnown', { known: result.known, total: result.real })}</Text>
                    {result.pseudoClaimed > 0 ? (
                        <Text style={styles.note}>{t('wordCheck.resultMadeUp', { count: result.pseudoClaimed })}</Text>
                    ) : null}
                    <Text style={styles.helper}>{t('wordCheck.resultNext')}</Text>
                    <TouchableOpacity style={styles.primary} onPress={onDone} activeOpacity={0.85} accessibilityRole="button">
                        <Text style={styles.primaryText}>{t('wordCheck.done')}</Text>
                    </TouchableOpacity>
                </View>
            ) : null}
        </View>
    );
};

/**
 * WordCheckModal — the three-minute word check as a bottom sheet:
 * "do you know this word?" about ~36 words picked around the reader's level,
 * with a few made-up ones mixed in. Saves through the level engine when the
 * reader finishes (or stops after enough answers) and shows where they landed.
 */
const WordCheckModal = ({ visible, onClose }) => {
    const { t } = useTranslation();
    const check = useWordCheck({ active: visible, onClose });

    return (
        <SheetFrame visible={visible} onClose={check.close} title={t('wordCheck.title')}>
            <WordCheckBody check={check} onDone={onClose} />
        </SheetFrame>
    );
};

const createStyles = (colors) => StyleSheet.create({
    body: {
        paddingHorizontal: 20,
        paddingTop: 4,
    },
    lead: {
        fontFamily: fontFamilies.displayMedium,
        fontSize: 26,
        lineHeight: 32,
        color: colors.text,
    },
    leadStrong: {
        fontFamily: fontFamilies.displaySemiBold,
    },
    resultLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    resultLead: {
        marginTop: 8,
        fontFamily: fontFamilies.displayMedium,
        fontSize: 28,
        lineHeight: 34,
        color: colors.text,
    },
    helper: {
        marginTop: 12,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textSecondary,
    },
    note: {
        marginTop: 10,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 19,
        color: colors.textTertiary,
    },
    progressRow: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    progressTrack: {
        flex: 1,
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
        fontFamily: fontFamilies.sansMedium,
        fontSize: 12,
        color: colors.textTertiary,
        fontVariant: ['tabular-nums'],
    },
    wordStage: {
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    word: {
        textAlign: 'center',
        fontSize: 44,
        lineHeight: 58,
        color: colors.text,
    },
    wordKo: {
        fontFamily: fontFamilies.krSerifSemiBold,
    },
    wordZh: {
        fontFamily: fontFamilies.krSerifSemiBold,
    },
    // Latin display serif for English words.
    wordEn: {
        fontFamily: fontFamilies.displayMedium,
    },
    question: {
        textAlign: 'center',
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        color: colors.textTertiary,
    },
    answerRow: {
        flexDirection: 'row',
        gap: 10,
    },
    primary: {
        marginTop: 22,
        minHeight: 52,
        borderRadius: 14,
        backgroundColor: colors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    answerPrimary: {
        flex: 1,
        marginTop: 0,
    },
    primaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        color: colors.white,
    },
    secondary: {
        flex: 1,
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    secondaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.text,
    },
    saving: {
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default WordCheckModal;
