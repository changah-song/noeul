import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Modal,
    PanResponder,
    Pressable,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native';
import { useTheme } from '../../theme/tokens';
import { PX_PRECISION, project, rubberband, springs, springTo, useReducedMotion } from '../../theme/motion';

// Drag distance (px) before the sheet commits to following the finger.
const DRAG_SLOP = 8;
// With dragRegion="header", how far down from the sheet's top edge a drag
// may start (the grabber and title).
const HEADER_DRAG_ZONE = 76;

/**
 * PaperSheet — a bottom sheet that behaves like a physical object.
 *
 * - Opens from the bottom edge and closes back down the same path.
 * - Follows the finger 1:1 when dragged down; dragged up past its rest
 *   position it resists (rubber-band) instead of stopping dead.
 * - On release it projects where the flick is heading (Apple's decay
 *   projection) and closes if that lands past half its height, so a short
 *   fast flick dismisses as well as a long slow drag. The spring that takes
 *   over starts at the finger's speed, with a little bounce only because
 *   the gesture carried momentum.
 * - Grabbing it mid-animation stops the spring where it is (no jump).
 * - `modal` dims the page behind it (a task you must finish or dismiss);
 *   without it the page stays live behind the sheet.
 * - Reduced motion: it fades in and out instead of sliding.
 *
 * Props: visible, onClose, modal (default true), maxHeightRatio, children,
 * style (the sheet surface), dragToClose (default true), closeOnBackdrop
 * (default true; off while a task inside must not be dropped by a stray tap),
 * dragRegion ('all' by default; 'header' for sheets whose content scrolls,
 * so a drag in the list scrolls it and only the top strip moves the sheet).
 */
const PaperSheet = ({
    visible,
    onClose,
    modal = true,
    maxHeightRatio = 0.86,
    dragToClose = true,
    closeOnBackdrop = true,
    dragRegion = 'all',
    style,
    children,
    accessibilityLabel,
}) => {
    const { colors, elevation } = useTheme();
    const { height: windowHeight } = useWindowDimensions();
    const reduced = useReducedMotion();
    const [mounted, setMounted] = useState(visible);
    const [sheetHeight, setSheetHeight] = useState(windowHeight * 0.5);
    const translateY = useRef(new Animated.Value(windowHeight)).current;
    const fade = useRef(new Animated.Value(0)).current;
    const heightRef = useRef(sheetHeight);
    heightRef.current = sheetHeight;
    const closingRef = useRef(false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const startYRef = useRef(0);
    // Where the sheet rests (its top edge before any translate), measured.
    const sheetYRef = useRef(0);
    const currentYRef = useRef(windowHeight);

    useEffect(() => {
        const id = translateY.addListener(({ value }) => {
            currentYRef.current = value;
            // Once a closing sheet is out of sight, drop the Modal at once:
            // waiting for the spring's tail to settle would leave an invisible
            // window swallowing the next tap.
            if (closingRef.current && value >= heightRef.current) setMounted(false);
        });
        return () => translateY.removeListener(id);
    }, [translateY]);

    useEffect(() => {
        if (visible) {
            closingRef.current = false;
            setMounted(true);
            if (reduced) {
                translateY.setValue(0);
                Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
            } else {
                fade.setValue(1);
                translateY.setValue(Math.max(heightRef.current, windowHeight * 0.4));
                springTo(translateY, 0, { spring: springs.standard }).start();
            }
        } else if (mounted) {
            closingRef.current = true;
            const done = ({ finished }) => {
                if (finished && closingRef.current) setMounted(false);
            };
            if (reduced) {
                Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }).start(done);
            } else {
                springTo(translateY, heightRef.current + 24, { spring: springs.standard, precision: PX_PRECISION }).start(done);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, reduced]);

    // The sheet takes touches that start on its own surface (controls inside
    // it still get theirs first). Otherwise a touchable further up the
    // screen's tree claims the touch and the sheet never sees the drag, and
    // a tap on the sheet's blank paper could leak through to the page.
    const engagedRef = useRef(false);
    const dragYRef = useRef(0);
    const pan = useMemo(() => {
        const startedInRegion = (g) => {
            if (dragRegion !== 'header') return true;
            const sheetTop = sheetYRef.current + Math.max(0, startYRef.current);
            return g.y0 - sheetTop < HEADER_DRAG_ZONE;
        };
        const wantsDrag = (g) => (
            dragToClose
            && Math.abs(g.dy) > DRAG_SLOP
            && Math.abs(g.dy) > Math.abs(g.dx) * 1.4
            && startedInRegion(g)
        );
        return PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_event, g) => wantsDrag(g),
            onPanResponderGrant: (_event, g) => {
                engagedRef.current = false;
                // Catch it where it is, even mid-spring.
                translateY.stopAnimation((value) => {
                    startYRef.current = value;
                    dragYRef.current = value;
                });
                if (wantsDrag(g)) engagedRef.current = true;
            },
            onPanResponderMove: (_event, g) => {
                if (!engagedRef.current) {
                    if (!wantsDrag(g)) return;
                    engagedRef.current = true;
                }
                const next = startYRef.current + g.dy;
                dragYRef.current = next < 0 ? rubberband(next, heightRef.current) : next;
                translateY.setValue(dragYRef.current);
            },
            onPanResponderRelease: (_event, g) => {
                if (!engagedRef.current) {
                    // A tap, or a drag that never committed: settle if it was
                    // caught mid-animation, otherwise nothing to do.
                    if (!closingRef.current && startYRef.current !== 0) springTo(translateY, 0).start();
                    return;
                }
                engagedRef.current = false;
                const projected = dragYRef.current + project(g.vy);
                if (projected > heightRef.current * 0.5) {
                    closingRef.current = true;
                    springTo(translateY, heightRef.current + 24, {
                        spring: springs.flick,
                        gestureVelocity: g.vy,
                        precision: PX_PRECISION,
                    }).start(({ finished }) => {
                        if (finished && closingRef.current) setMounted(false);
                    });
                    onCloseRef.current?.();
                    return;
                }
                springTo(translateY, 0, {
                    spring: Math.abs(g.vy) > 0.3 ? springs.flick : springs.standard,
                    gestureVelocity: g.vy,
                }).start();
            },
            // A list inside the sheet that starts scrolling takes over.
            onPanResponderTerminationRequest: () => !engagedRef.current,
            onPanResponderTerminate: () => {
                engagedRef.current = false;
                if (!closingRef.current) springTo(translateY, 0).start();
            },
        });
    }, [dragRegion, dragToClose, translateY]);

    if (!mounted) return null;

    const scrimOpacity = reduced
        ? fade
        : translateY.interpolate({
            inputRange: [0, Math.max(1, sheetHeight)],
            outputRange: [1, 0],
            extrapolate: 'clamp',
        });

    const sheet = (
        <Animated.View
            accessibilityViewIsModal={modal}
            accessibilityLabel={accessibilityLabel}
            onLayout={(event) => {
                sheetYRef.current = event.nativeEvent.layout.y;
                setSheetHeight(event.nativeEvent.layout.height);
            }}
            style={[
                styles.sheet,
                elevation.sheet,
                {
                    backgroundColor: colors.surface,
                    maxHeight: windowHeight * maxHeightRatio,
                    opacity: reduced ? fade : 1,
                    transform: [{ translateY }],
                },
                style,
            ]}
            {...pan.panHandlers}
        >
            <View style={styles.grabberWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            </View>
            {children}
        </Animated.View>
    );

    if (!modal) {
        return (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                {sheet}
            </View>
        );
    }

    return (
        <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
            <View style={styles.fill}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: scrimOpacity }]} />
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={closeOnBackdrop ? onClose : undefined}
                    accessibilityRole={closeOnBackdrop ? 'button' : undefined}
                    accessibilityLabel={closeOnBackdrop ? 'Close' : undefined}
                />
                {sheet}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    fill: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
    },
    grabberWrap: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 6,
    },
    grabber: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
});

export default PaperSheet;
