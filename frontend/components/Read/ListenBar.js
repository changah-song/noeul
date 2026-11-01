import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import useReduceMotion from '../../hooks/useReduceMotion';
import { LISTEN_RATES } from '../../services/listenPlayer';
import { formatNumber } from '../../services/interfaceLanguage';

// Listen-mode transport, a floating rounded bar: previous / play-pause /
// next, the speed chip (opens speed, pitch and voice settings), the two study
// toggles (dictionary mode: stop on underlined words; translation mode: read
// each sentence's translation), then close. Sits where the focus arrows
// normally are and lifts with the dictionary panel the same way.
//
// With an `origin` (the play button's spot: { bottom, right, size }) it grows
// out of that button when it opens, and shrinks back into it when `open`
// goes false; otherwise it fades. `onExited` hears when it's gone.
const OPEN_MS = 380;
const CLOSE_MS = 300;
const ListenBar = ({
    open = true,
    origin = null,
    onExited,
    playing,
    rate,
    explainWords,
    translateSentences,
    onTogglePlay,
    onPrevious,
    onNext,
    onOpenVoice,
    onToggleExplain,
    onToggleTranslate,
    onClose,
    bottom,
    translateY,
    styles,
    themeColors,
}) => {
    const { t } = useTranslation();
    const rateLabel = t('read.listenRateValue', { rate: formatNumber(LISTEN_RATES.includes(rate) ? rate : 1) });
    const reduceMotion = useReduceMotion();
    const { width: windowWidth } = useWindowDimensions();

    // Where it grows from (or shrinks into) is taken when it starts to open
    // or close: the button's spot can change under it meanwhile.
    const [shownOpen, setShownOpen] = useState(open);
    const [anchor, setAnchor] = useState(origin);
    if (shownOpen !== open) {
        setShownOpen(open);
        setAnchor(origin);
    }

    const appear = useRef(new Animated.Value(0)).current;
    // The growing shape is a window over the bar: clipped while it moves,
    // and not after, so the bar's shadow shows.
    const [moving, setMoving] = useState(true);
    const onExitedRef = useRef(onExited);
    onExitedRef.current = onExited;
    useEffect(() => {
        setMoving(true);
        const animation = Animated.timing(appear, {
            toValue: open ? 1 : 0,
            duration: reduceMotion ? 0 : (open ? OPEN_MS : CLOSE_MS),
            easing: open ? Easing.bezier(0.2, 0.8, 0.2, 1) : Easing.bezier(0.4, 0, 0.6, 1),
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (!finished) return;
            if (open) setMoving(false);
            else onExitedRef.current?.();
        });
        return () => animation.stop();
    }, [appear, open, reduceMotion]);

    const motion = useMemo(() => {
        const flat = StyleSheet.flatten(styles.listenBar) || {};
        const side = StyleSheet.flatten(styles.listenBarWrap)?.right ?? 14;
        const barHeight = flat.height || 64;
        const barWidth = Math.max(barHeight, windowWidth - side * 2);
        if (!anchor) {
            return {
                outer: {
                    opacity: appear,
                    transform: [
                        { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                        { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                    ],
                },
                clip: null,
                unclip: null,
                controls: null,
                seed: null,
            };
        }
        // At the start the window shows only the bar's right end, a circle
        // the bar's height across, scaled down to the button and moved onto
        // it; then the window opens leftward as it grows to full size.
        const startScale = anchor.size / barHeight;
        const startX = side - anchor.right;
        const startY = (bottom + barHeight / 2) - (anchor.bottom + anchor.size / 2);
        const closedClip = barWidth - barHeight;
        return {
            outer: {
                transform: [
                    { translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [startX, 0] }) },
                    { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [startY, 0] }) },
                    // Grow about the right end.
                    { translateX: barWidth / 2 },
                    { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [startScale, 1] }) },
                    { translateX: -barWidth / 2 },
                ],
            },
            clip: {
                borderRadius: barHeight / 2,
                transform: [{ translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [closedClip, 0] }) }],
            },
            unclip: {
                transform: [{ translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [-closedClip, 0] }) }],
            },
            controls: {
                opacity: appear.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }),
            },
            // The button's own triangle, until the controls come in.
            seed: {
                width: barHeight,
                height: barHeight,
                opacity: appear.interpolate({ inputRange: [0, 0.35], outputRange: [1, 0], extrapolate: 'clamp' }),
            },
            // The button's icon, 20 across and nudged 2 right, at the start's scale.
            seedIconSize: 20 / startScale,
            seedNudge: 2 / startScale,
        };
    }, [anchor, appear, bottom, styles.listenBar, styles.listenBarWrap, windowWidth]);

    return (
        <Animated.View
            pointerEvents={open ? 'box-none' : 'none'}
            style={[styles.listenBarWrap, { bottom, transform: [{ translateY }] }]}
        >
            <Animated.View style={motion.outer}>
                <Animated.View style={[motion.clip, motion.clip && moving ? { overflow: 'hidden' } : null]}>
                    <Animated.View style={motion.unclip}>
                        <View style={styles.listenBar}>
                            <Animated.View style={[localStyles.controls, motion.controls]}>
                                <TouchableOpacity
                                    style={styles.listenButton}
                                    onPress={onPrevious}
                                    activeOpacity={0.72}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('read.focusPreviousSentence')}
                                >
                                    <MaterialIcons name="skip-previous" size={24} color={themeColors.inkSlate} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.listenPlayButton}
                                    onPress={onTogglePlay}
                                    activeOpacity={0.8}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: playing }}
                                    accessibilityLabel={playing ? t('read.listenPause') : t('read.listenPlay')}
                                >
                                    <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={26} color={themeColors.readerPaper} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.listenButton}
                                    onPress={onNext}
                                    activeOpacity={0.72}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('read.focusNextSentence')}
                                >
                                    <MaterialIcons name="skip-next" size={24} color={themeColors.inkSlate} />
                                </TouchableOpacity>
                                <View style={styles.listenDivider} />
                                <TouchableOpacity
                                    style={styles.listenSpeedChip}
                                    onPress={onOpenVoice}
                                    activeOpacity={0.72}
                                    hitSlop={{ top: 4, bottom: 4 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${t('read.listenVoiceTitle')}, ${t('read.listenSpeed', { rate: rateLabel })}`}
                                >
                                    <MaterialCommunityIcons name="waveform" size={15} color={themeColors.inkSlate} />
                                    <Text style={styles.listenSpeedLabel}>{rateLabel}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.listenToggle, explainWords ? styles.listenToggleActive : null]}
                                    onPress={onToggleExplain}
                                    activeOpacity={0.72}
                                    hitSlop={{ top: 4, bottom: 4 }}
                                    accessibilityRole="switch"
                                    accessibilityState={{ checked: !!explainWords }}
                                    accessibilityLabel={t('read.listenExplain')}
                                >
                                    <MaterialIcons
                                        name="school"
                                        size={17}
                                        color={explainWords ? themeColors.readerPaper : themeColors.inkSlate}
                                    />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.listenToggle, translateSentences ? styles.listenToggleActive : null]}
                                    onPress={onToggleTranslate}
                                    activeOpacity={0.72}
                                    hitSlop={{ top: 4, bottom: 4 }}
                                    accessibilityRole="switch"
                                    accessibilityState={{ checked: !!translateSentences }}
                                    accessibilityLabel={t('read.listenTranslate')}
                                >
                                    <MaterialIcons
                                        name="translate"
                                        size={17}
                                        color={translateSentences ? themeColors.readerPaper : themeColors.inkSlate}
                                    />
                                </TouchableOpacity>
                                <View style={styles.listenSpacer} />
                                <TouchableOpacity
                                    style={styles.listenCloseButton}
                                    onPress={onClose}
                                    activeOpacity={0.72}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('read.listenStop')}
                                >
                                    <Feather name="x" size={20} color={themeColors.textTertiary} />
                                </TouchableOpacity>
                            </Animated.View>
                            {motion.seed ? (
                                <Animated.View pointerEvents="none" style={[localStyles.seed, motion.seed]}>
                                    <Feather
                                        name="play"
                                        size={motion.seedIconSize}
                                        color={themeColors.readerBodyInk}
                                        style={{ marginLeft: motion.seedNudge }}
                                    />
                                </Animated.View>
                            ) : null}
                        </View>
                    </Animated.View>
                </Animated.View>
            </Animated.View>
        </Animated.View>
    );
};

const localStyles = StyleSheet.create({
    controls: {
        flex: 1,
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
    },
    seed: {
        position: 'absolute',
        top: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default memo(ListenBar);
