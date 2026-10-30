import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { endBookOpening, getBookOpening, subscribeBookOpening } from '../../services/bookOpening';
import { BookCover } from '../../screens/Home';
import LoadingDots from './LoadingDots';

const FADE_IN_MS = 160;
const FADE_OUT_MS = 260;
// A book that opens at once still shows the screen this long, so it reads as
// a step and not a flicker.
const MIN_VISIBLE_MS = 450;
// The reader says "ready" a moment before the native page has painted.
const SETTLE_MS = 120;
// Should nothing end it (a crash mid-open), it lets go of the screen. Longer
// than a book download's own timeout, which ends it on failure.
const FAILSAFE_MS = 100 * 1000;
// The cover fills most of the screen: up to this share of its height, as wide
// as the side margins allow (covers are 2:3).
const COVER_HEIGHT_SHARE = 0.72;
const COVER_SIDE_MARGIN = 28;
const COVER_ASPECT = 1.5;

/**
 * BookOpeningOverlay — the screen between pressing a book and reading it:
 * the book's cover, large, with the Noeul wordmark and three pulsing dots
 * small beneath it. It fades in on beginBookOpening(book) and out once
 * endBookOpening() is called (services/bookOpening.js). Mounted once, above
 * the navigator.
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
        const wait = Math.max(0, opening.startedAt + MIN_VISIBLE_MS - Date.now()) + SETTLE_MS;
        let animation = null;
        const timer = setTimeout(() => {
            animation = Animated.timing(opacity, {
                toValue: 0,
                duration: FADE_OUT_MS,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
            });
            animation.start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }, wait);
        return () => {
            clearTimeout(timer);
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
            <View style={book ? styles.mark : styles.markAlone}>
                <Text style={book ? styles.wordmark : styles.wordmarkAlone} allowFontScaling={false}>Noeul</Text>
                <LoadingDots
                    color={colors.inkSlate}
                    size={book ? 6 : 9}
                    gap={book ? 8 : 12}
                    accessibilityLabel={t('home.openingBook')}
                />
            </View>
        </Animated.View>
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
    // Under the cover: the wordmark and the dots, small.
    mark: {
        marginTop: 28,
        alignItems: 'center',
        gap: 12,
    },
    wordmark: {
        fontFamily: fontFamilies.displayMedium,
        fontSize: 22,
        lineHeight: 28,
        color: colors.inkSlate,
    },
    // No book to show (shouldn't happen from Home): the wordmark alone, large.
    markAlone: {
        alignItems: 'center',
        gap: 28,
    },
    wordmarkAlone: {
        fontFamily: fontFamilies.displayMedium,
        fontSize: 48,
        lineHeight: 56,
        letterSpacing: -0.5,
        color: colors.inkSlate,
    },
});
