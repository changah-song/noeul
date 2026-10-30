import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import {
    TUTORIAL_STEP_COUNT,
    TUTORIAL_STEPS,
    tutorialWaitsForAction,
} from '../../services/firstBookTutorial';

const SCRIM = 'rgba(18, 18, 20, 0.72)';
const HOLE_PAD = 6;
const MIN_HOLE = 44;
const MEASURE_EVERY_MS = 350;
// The ring pulses outward around a word or a button; around a sentence or
// the whole page a scaled ring would land far outside it.
const PULSE_MAX = 160;

const S = TUTORIAL_STEPS;

// The card's words for a step: title, body, and either the action to try
// (`hint`) or a Next button.
const copyFor = (t, progress, targetText) => {
    switch (progress.step) {
        case S.intro:
            return { eyebrow: t('tutorial.introEyebrow'), body: t('tutorial.introBody'), button: t('tutorial.start'), secondary: t('tutorial.skipExplore') };
        case S.tapWord:
            return {
                title: t('tutorial.tapTitle'),
                body: t('tutorial.tapBody'),
                hint: targetText ? t('tutorial.tapHint', { word: targetText }) : t('tutorial.tapHintAny'),
            };
        case S.sentenceBar:
            return { title: t('tutorial.barTitle'), body: t('tutorial.barBody'), button: t('tutorial.next') };
        case S.saveWord:
            return { title: t('tutorial.saveTitle'), body: t('tutorial.saveBody'), hint: t('tutorial.saveHint') };
        case S.holdSentence:
            return progress.held
                ? { title: t('tutorial.aiTitle'), body: t('tutorial.aiBody'), button: t('tutorial.next') }
                : { title: t('tutorial.holdTitle'), body: t('tutorial.holdBody'), hint: t('tutorial.holdHint') };
        case S.focus:
            return progress.focused
                ? { title: t('tutorial.focusOnTitle'), body: t('tutorial.focusOnBody'), button: t('tutorial.next') }
                : { title: t('tutorial.focusTitle'), body: t('tutorial.focusBody'), hint: t('tutorial.focusHint') };
        case S.listen:
            return progress.listening
                ? { title: t('tutorial.listenOnTitle'), body: t('tutorial.listenOnBody'), button: t('tutorial.next') }
                : { title: t('tutorial.listenTitle'), body: t('tutorial.listenBody'), hint: t('tutorial.listenHint') };
        case S.more:
            return { eyebrow: t('tutorial.moreEyebrow'), title: t('tutorial.moreTitle'), body: t('tutorial.moreBody'), button: t('tutorial.keepReading'), more: true };
        default:
            return null;
    }
};

const MORE_ITEMS = [
    { key: 'bookmark', Icon: Feather, icon: 'bookmark' },
    { key: 'jump', Icon: MaterialCommunityIcons, icon: 'gesture-swipe-horizontal' },
    { key: 'settings', Icon: Feather, icon: 'menu' },
    { key: 'learn', Icon: MaterialCommunityIcons, icon: 'cards-outline' },
    { key: 'goal', Icon: MaterialCommunityIcons, icon: 'circle-medium' },
];

/**
 * FirstBookTutorial — the strict overlay over the reader. Everything but the
 * lit target is dimmed and takes no touches; the target itself (a word on the
 * page, a button, a panel) gets them through the hole, so each step is tried
 * for real. `measureTarget()` resolves the target's rect in window dp (or
 * null); it is re-measured while the step is up, since panels slide in and
 * pages move. `title` is the book's, for the intro card.
 */
export default function FirstBookTutorial({
    progress,
    title,
    containerRef,
    measureTarget,
    blockWhenNoTarget = true,
    insets,
    onNext,
    onSkip,
}) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [target, setTarget] = useState(null);
    const [origin, setOrigin] = useState({ x: 0, y: 0 });
    const pulse = useRef(new Animated.Value(0)).current;
    const step = progress?.step ?? null;
    const doneKey = progress ? `${progress.held}|${progress.focused}|${progress.listening}` : '';

    // Where the target is now, re-read while the step is up.
    useEffect(() => {
        if (step == null) return undefined;
        let cancelled = false;
        setTarget(null);
        const measure = async () => {
            try {
                const rect = await measureTarget?.();
                if (!cancelled) setTarget(rect && rect.width > 0 && rect.height > 0 ? rect : null);
            } catch {
                if (!cancelled) setTarget(null);
            }
            containerRef?.current?.measureInWindow?.((x, y) => {
                if (!cancelled) setOrigin({ x: x || 0, y: y || 0 });
            });
        };
        measure();
        const timer = setInterval(measure, MEASURE_EVERY_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [containerRef, doneKey, measureTarget, step]);

    useEffect(() => {
        const loop = Animated.loop(Animated.timing(pulse, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }));
        loop.start();
        return () => loop.stop();
    }, [pulse]);

    if (step == null) return null;
    const copy = copyFor(t, progress, target?.text);
    if (!copy) return null;

    const counted = step >= S.tapWord && step <= S.listen;
    const waiting = tutorialWaitsForAction(progress);
    const hole = target ? (() => {
        const x = target.x - origin.x;
        const y = target.y - origin.y;
        const width = Math.max(MIN_HOLE, target.width + HOLE_PAD * 2);
        const height = Math.max(MIN_HOLE, target.height + HOLE_PAD * 2);
        return {
            left: Math.max(0, x + target.width / 2 - width / 2),
            top: Math.max(0, y + target.height / 2 - height / 2),
            width,
            height,
        };
    })() : null;
    // Intro and the last card dim the whole page; a "done" step with nothing
    // to light (focus mode on) leaves the page free to try.
    const fullScrim = !hole && (step === S.intro || step === S.more || (waiting && blockWhenNoTarget));

    const holeCenter = hole ? hole.top + hole.height / 2 : 0;
    let cardPosition;
    if (step === S.intro) {
        cardPosition = { top: windowHeight * 0.3 };
    } else if (step === S.more) {
        cardPosition = { top: (insets?.top ?? 0) + 40 };
    } else if ((hole && holeCenter > windowHeight * 0.5) || (step === S.holdSentence && progress.held)
        || (step === S.listen && progress.listening)) {
        cardPosition = { top: (insets?.top ?? 0) + 64 };
    } else {
        cardPosition = { bottom: (insets?.bottom ?? 0) + 20 };
    }

    const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
    const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0] });

    return (
        <View pointerEvents="box-none" style={styles.layer} accessibilityViewIsModal>
            {fullScrim ? <View style={[StyleSheet.absoluteFill, styles.scrim]} /> : null}
            {hole ? (
                <>
                    {/* Four dim panes around the hole: they take every touch,
                        so only the lit target can be used. */}
                    <View style={[styles.scrim, styles.pane, { left: 0, right: 0, top: 0, height: hole.top }]} />
                    <View style={[styles.scrim, styles.pane, { left: 0, right: 0, top: hole.top + hole.height, bottom: 0 }]} />
                    <View style={[styles.scrim, styles.pane, { left: 0, width: hole.left, top: hole.top, height: hole.height }]} />
                    <View style={[styles.scrim, styles.pane, { left: hole.left + hole.width, right: 0, top: hole.top, height: hole.height }]} />
                    <View pointerEvents="none" style={[styles.ring, hole]} />
                    {waiting && hole.width <= PULSE_MAX && hole.height <= PULSE_MAX ? (
                        <Animated.View
                            pointerEvents="none"
                            style={[styles.ring, hole, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
                        />
                    ) : null}
                </>
            ) : null}

            <View
                style={[styles.card, { width: Math.min(420, windowWidth - 32), left: (windowWidth - Math.min(420, windowWidth - 32)) / 2 }, cardPosition]}
                accessibilityLiveRegion="polite"
            >
                <View style={styles.cardTop}>
                    {counted ? (
                        <View style={styles.counterRow}>
                            <Text style={styles.counter}>{t('tutorial.counter', { step, total: TUTORIAL_STEP_COUNT })}</Text>
                            <View style={styles.segments}>
                                {Array.from({ length: TUTORIAL_STEP_COUNT }, (_, index) => (
                                    <View key={index} style={[styles.segment, index < step && styles.segmentOn]} />
                                ))}
                            </View>
                        </View>
                    ) : (
                        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
                    )}
                    {counted ? (
                        <TouchableOpacity onPress={onSkip} style={styles.skip} accessibilityRole="button">
                            <Text style={styles.skipText}>{t('tutorial.skip')}</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
                {step === S.intro ? (
                    <Text style={styles.title} accessibilityRole="header">{title || t('tutorial.introFallbackTitle')}</Text>
                ) : (
                    <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
                )}
                {copy.body ? <Text style={styles.body}>{copy.body}</Text> : null}
                {copy.more ? (
                    <View style={styles.moreList}>
                        {MORE_ITEMS.map(({ key, Icon, icon }) => (
                            <View key={key} style={styles.moreRow}>
                                <View style={styles.moreIcon}>
                                    <Icon name={icon} size={18} color={colors.text} />
                                </View>
                                <View style={styles.moreCopy}>
                                    <Text style={styles.moreTitle}>{t(`tutorial.more.${key}Title`)}</Text>
                                    <Text style={styles.moreBody}>{t(`tutorial.more.${key}Body`)}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                ) : null}
                {copy.hint ? (
                    <View style={styles.hint}>
                        <MaterialCommunityIcons name="gesture-tap" size={18} color={colors.inkSlate} />
                        <Text style={styles.hintText}>{copy.hint}</Text>
                    </View>
                ) : null}
                {copy.button ? (
                    <TouchableOpacity onPress={onNext} style={styles.primary} accessibilityRole="button" testID="tutorial-next">
                        <Text style={styles.primaryText}>{copy.button}</Text>
                    </TouchableOpacity>
                ) : null}
                {copy.secondary ? (
                    <TouchableOpacity onPress={onSkip} style={styles.secondary} accessibilityRole="button">
                        <Text style={styles.secondaryText}>{copy.secondary}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );
}

/**
 * TutorialReplayToast — after the tutorial ends or is skipped: where to find
 * it again, with Replay.
 */
export function TutorialReplayToast({ visible, bottom = 24, onReplay, onClose }) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);

    useEffect(() => {
        if (!visible) return undefined;
        const timer = setTimeout(() => onClose?.(), 7000);
        return () => clearTimeout(timer);
    }, [onClose, visible]);

    if (!visible) return null;
    return (
        <View pointerEvents="box-none" style={[styles.toastLayer, { bottom }]}>
            <View style={styles.toast} accessibilityLiveRegion="polite">
                <Text style={styles.toastText}>{t('tutorial.replayToast')}</Text>
                <TouchableOpacity onPress={onReplay} style={styles.toastButton} accessibilityRole="button">
                    <Text style={styles.toastButtonText}>{t('tutorial.replay')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const createStyles = (colors) => StyleSheet.create({
    layer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 60,
        elevation: 60,
    },
    scrim: {
        backgroundColor: SCRIM,
    },
    pane: {
        position: 'absolute',
    },
    ring: {
        position: 'absolute',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#ffffff',
    },
    card: {
        position: 'absolute',
        borderRadius: 18,
        paddingTop: 12,
        paddingBottom: 16,
        paddingHorizontal: 18,
        backgroundColor: colors.surface,
        shadowColor: '#000',
        shadowOpacity: 0.28,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
        elevation: 12,
        gap: 8,
    },
    cardTop: {
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    counterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    counter: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        color: colors.text,
        fontVariant: ['tabular-nums'],
    },
    segments: {
        flexDirection: 'row',
        gap: 3,
    },
    segment: {
        width: 14,
        height: 3,
        borderRadius: 2,
        backgroundColor: colors.surfaceStrong,
    },
    segmentOn: {
        backgroundColor: colors.inkSlate,
    },
    eyebrow: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        letterSpacing: 0.4,
        color: colors.textMuted,
    },
    skip: {
        minHeight: 44,
        minWidth: 44,
        marginRight: -8,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    skipText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.textMuted,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 19,
        lineHeight: 25,
        color: colors.text,
    },
    body: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        color: colors.textSecondary,
    },
    hint: {
        marginTop: 2,
        minHeight: 38,
        borderRadius: 10,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.surfaceMuted,
    },
    hintText: {
        flex: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.inkSlate,
    },
    primary: {
        marginTop: 4,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.inkSlate,
    },
    primaryText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
    secondary: {
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.textSecondary,
    },
    moreList: {
        marginTop: 2,
    },
    moreRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 7,
    },
    moreIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
    },
    moreCopy: {
        flex: 1,
        minWidth: 0,
    },
    moreTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 19,
        color: colors.text,
    },
    moreBody: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textMuted,
    },
    toastLayer: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 60,
        elevation: 60,
    },
    toast: {
        minHeight: 52,
        borderRadius: 14,
        paddingLeft: 16,
        paddingRight: 6,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.inkSlate,
    },
    toastText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: colors.surface,
    },
    toastButton: {
        minHeight: 44,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    toastButtonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: colors.surface,
        textDecorationLine: 'underline',
    },
});
