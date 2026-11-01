import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import useReduceMotion from '../../hooks/useReduceMotion';
import { endBookOpening, getBookOpening, subscribeBookOpening } from '../../services/bookOpening';
import { BookCover } from '../../screens/Home';
import LoadingBar from './LoadingBar';

const FADE_IN_MS = 160;
// The reader says "ready" a moment before the native page has painted; the
// fade out covers that moment, so it starts at once rather than after a wait.
const FADE_OUT_MS = 200;
// A book that opens at once still shows the screen this long, so it reads as
// a step and not a flicker.
const MIN_VISIBLE_MS = 250;
// Should nothing end it (a crash mid-open), it lets go of the screen. Longer
// than a book download's own timeout, which ends it on failure.
const FAILSAFE_MS = 100 * 1000;
// The cover is the screen's focus: up to this share of its height, as wide as
// the side margins allow (covers are 2:3). The rest is the bar and a tip.
const COVER_HEIGHT_SHARE = 0.56;
const COVER_SIDE_MARGIN = 28;
const COVER_ASPECT = 1.5;
const BAR_WIDTH_SHARE = 0.5;
const BAR_MAX_WIDTH = 160;
const TIP_MAX_WIDTH = 320;
const TIP_SIDE_MARGIN = 24;
// Room for the longest tip, so the cover doesn't move as tips change.
const TIP_LINES = 4;
const TIP_LINE_HEIGHT = 22;

// The tips under the bar, one at a time: the reader's features first, then
// the rest of the app. Four are the reader guide's own lines.
const TIP_KEYS = [
    'opening.tipTap',
    'opening.tipTranslationBar',
    'opening.tipSave',
    'guide.holdBody',
    'opening.tipFocus',
    'opening.tipListen',
    'guide.moreFullscreenBody',
    'opening.tipJump',
    'opening.tipContents',
    'opening.tipBookmark',
    'opening.tipUnderlines',
    'guide.moreAudioBody',
    'guide.moreGoalBody',
    'opening.tipSongs',
    'opening.tipImport',
];
// Long enough to read a two-line tip, short enough that a slow open shows a few.
const TIP_MS = 4500;
const TIP_FADE_MS = 220;
// Each opening starts on the tip after the last one shown, so they all come
// round in turn. The first opening starts anywhere.
let nextTipIndex = Math.floor(Math.random() * TIP_KEYS.length);

/**
 * BookOpeningOverlay — the screen between pressing a book and reading it:
 * the book's cover, large, a pulsing bar beneath it, and under that a tip
 * about one of the app's features, changing every few seconds. It fades in on
 * beginBookOpening(book) and out once endBookOpening() is called
 * (services/bookOpening.js). Mounted once, above the navigator.
 */
export default function BookOpeningOverlay() {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const styles = useMemo(() => createStyles(colors), [colors]);

    const [opening, setOpening] = useState(getBookOpening);
    useEffect(() => subscribeBookOpening(setOpening), []);

    const [mounted, setMounted] = useState(opening.visible);
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (opening.visible) {
            setMounted(true);
            opacity.stopAnimation();
            Animated.timing(opacity, {
                toValue: 1,
                duration: FADE_IN_MS,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }).start();
            const failsafe = setTimeout(endBookOpening, FAILSAFE_MS);
            return () => clearTimeout(failsafe);
        }
        if (!mounted) return undefined;
        let animation = null;
        const fadeOut = () => {
            animation = Animated.timing(opacity, {
                toValue: 0,
                duration: FADE_OUT_MS,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
            });
            animation.start(({ finished }) => {
                if (finished) setMounted(false);
            });
        };
        // Past the minimum (the usual case), fade in this same turn: a timer
        // would wait behind the reader's start-up work on the JS thread.
        const wait = Math.max(0, opening.startedAt + MIN_VISIBLE_MS - Date.now());
        const timer = wait > 0 ? setTimeout(fadeOut, wait) : null;
        if (!timer) fadeOut();
        return () => {
            if (timer) clearTimeout(timer);
            animation?.stop();
        };
        // `mounted` only gates the fade out; it must not restart it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opacity, opening.startedAt, opening.visible]);

    if (!mounted) return null;

    const coverWidth = Math.round(Math.min(
        windowWidth - COVER_SIDE_MARGIN * 2,
        (windowHeight * COVER_HEIGHT_SHARE) / COVER_ASPECT
    ));
    const coverHeight = Math.round(coverWidth * COVER_ASPECT);
    const barWidth = Math.round(Math.min(BAR_MAX_WIDTH, coverWidth * BAR_WIDTH_SHARE));
    const tipWidth = Math.min(TIP_MAX_WIDTH, windowWidth - TIP_SIDE_MARGIN * 2);
    const book = opening.book;

    return (
        <Animated.View
            pointerEvents={opening.visible ? 'auto' : 'none'}
            style={[styles.root, { opacity }]}
        >
            {book ? (
                <Animated.View
                    style={[
                        styles.coverFrame,
                        {
                            width: coverWidth,
                            height: coverHeight,
                            transform: [{ scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
                        },
                    ]}
                >
                    <BookCover book={book} width={coverWidth} height={coverHeight} style={styles.cover} />
                </Animated.View>
            ) : null}
            <LoadingBar
                color={colors.inkSlate}
                width={barWidth}
                style={book ? styles.barUnderCover : null}
                accessibilityLabel={t('home.openingBook')}
            />
            <OpeningTip key={opening.token} width={tipWidth} styles={styles} />
        </Animated.View>
    );
}

/**
 * OpeningTip — one tip at a time under the bar, crossfading to the next every
 * few seconds. Keyed by the opening, so each opening starts afresh.
 */
function OpeningTip({ width, styles }) {
    const { t } = useTranslation();
    const reduceMotion = useReduceMotion();
    const [index, setIndex] = useState(() => nextTipIndex);
    const fade = useRef(new Animated.Value(1)).current;
    // Set when a tip has faded out, so the next one fades in once it's drawn.
    const fadeInPendingRef = useRef(false);

    useEffect(() => {
        nextTipIndex = (index + 1) % TIP_KEYS.length;
        if (!fadeInPendingRef.current) return undefined;
        fadeInPendingRef.current = false;
        const animation = Animated.timing(fade, {
            toValue: 1,
            duration: TIP_FADE_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [fade, index]);

    useEffect(() => {
        let animation = null;
        const timer = setInterval(() => {
            animation = Animated.timing(fade, {
                toValue: 0,
                duration: TIP_FADE_MS,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            });
            animation.start(({ finished }) => {
                if (!finished) return;
                fadeInPendingRef.current = true;
                setIndex((current) => (current + 1) % TIP_KEYS.length);
            });
        }, TIP_MS);
        return () => {
            clearInterval(timer);
            animation?.stop();
        };
    }, [fade]);

    // A small rise as each tip comes in; with reduced motion, the fade alone.
    const translateY = reduceMotion ? 0 : fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

    return (
        <View style={[styles.tipBox, { width }]}>
            <Animated.Text
                style={[styles.tip, { opacity: fade, transform: [{ translateY }] }]}
                accessibilityLiveRegion="polite"
            >
                {t(TIP_KEYS[index])}
            </Animated.Text>
        </View>
    );
}

const createStyles = (colors) => StyleSheet.create({
    root: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
        elevation: 1000,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.backgroundWarm,
    },
    coverFrame: {
        borderRadius: 4,
        backgroundColor: colors.surface,
        shadowColor: '#11151c',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.22,
        shadowRadius: 28,
        elevation: 12,
    },
    cover: {
        borderRadius: 4,
        overflow: 'hidden',
    },
    barUnderCover: {
        marginTop: 36,
    },
    // Tall enough for the longest tip; a shorter one sits at the top of it.
    tipBox: {
        marginTop: 24,
        minHeight: TIP_LINES * TIP_LINE_HEIGHT,
        alignItems: 'center',
    },
    tip: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: TIP_LINE_HEIGHT,
        textAlign: 'center',
        color: colors.textMuted,
    },
});
