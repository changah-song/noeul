import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

const SIDE_MARGIN = 12;
const MAX_WIDTH = 320;
const ARROW_SIZE = 8;
const ANCHOR_GAP = 4;

// A first-time tip: a dark bubble that points at a control (`anchorRef`,
// measured against `containerRef`, the screen's root view) or, with no anchor,
// a card `bottom` px above the screen's bottom edge. `actions` are extra
// buttons ({ label, onPress }); the last one is drawn as the main one. With no
// actions, a single "Got it" closes the tip.
export default function CoachTip({
    visible,
    title,
    body,
    anchorRef,
    containerRef,
    bottom = 24,
    actions,
    onClose,
}) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const { width: windowWidth } = useWindowDimensions();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const opacity = useRef(new Animated.Value(0)).current;
    const [anchor, setAnchor] = useState(null);
    const anchored = Boolean(anchorRef);

    useEffect(() => {
        if (!visible) {
            opacity.setValue(0);
            setAnchor(null);
            return undefined;
        }
        let cancelled = false;
        const measure = () => {
            const target = anchorRef?.current;
            const container = containerRef?.current;
            if (!target?.measureInWindow) {
                Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
                return;
            }
            target.measureInWindow((x, y, width, height) => {
                const place = (originX, originY) => {
                    if (cancelled) return;
                    setAnchor({ x: x - originX, y: y - originY, width, height });
                    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
                };
                if (container?.measureInWindow) {
                    container.measureInWindow((originX, originY) => place(originX || 0, originY || 0));
                } else {
                    place(0, 0);
                }
            });
        };
        // Let the anchor finish laying out first.
        const frame = requestAnimationFrame(measure);
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
        };
    }, [anchorRef, containerRef, opacity, visible]);

    if (!visible || (anchored && !anchor)) return null;

    const width = Math.min(MAX_WIDTH, windowWidth - SIDE_MARGIN * 2);
    let positionStyle;
    let arrowLeft = null;
    if (anchor) {
        const center = anchor.x + anchor.width / 2;
        const left = Math.max(SIDE_MARGIN, Math.min(center - width / 2, windowWidth - SIDE_MARGIN - width));
        positionStyle = { top: anchor.y + anchor.height + ANCHOR_GAP + ARROW_SIZE, left, width };
        arrowLeft = Math.max(14, Math.min(center - left - ARROW_SIZE, width - 14 - ARROW_SIZE * 2));
    } else {
        positionStyle = { bottom, left: (windowWidth - width) / 2, width };
    }

    const buttons = actions?.length
        ? actions
        : [{ label: t('tips.gotIt'), onPress: onClose }];

    return (
        <Animated.View
            pointerEvents="box-none"
            style={[styles.layer, positionStyle, { opacity }]}
            accessibilityLiveRegion="polite"
        >
            {arrowLeft !== null ? <View style={[styles.arrow, { left: arrowLeft }]} /> : null}
            <View style={styles.bubble}>
                <View style={styles.headerRow}>
                    <Text style={styles.title}>{title}</Text>
                    <TouchableOpacity
                        onPress={onClose}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.close')}
                    >
                        <Feather name="x" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                </View>
                {body ? <Text style={styles.body}>{body}</Text> : null}
                <View style={styles.actions}>
                    {buttons.map((action, index) => {
                        const primary = index === buttons.length - 1;
                        return (
                            <TouchableOpacity
                                key={action.label}
                                onPress={action.onPress}
                                style={[styles.action, primary && styles.actionPrimary]}
                                accessibilityRole="button"
                            >
                                <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>
                                    {action.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>
        </Animated.View>
    );
}

const createStyles = (colors) => ({
    layer: {
        position: 'absolute',
        zIndex: 40,
        elevation: 40,
    },
    arrow: {
        position: 'absolute',
        top: -ARROW_SIZE,
        width: 0,
        height: 0,
        borderLeftWidth: ARROW_SIZE,
        borderRightWidth: ARROW_SIZE,
        borderBottomWidth: ARROW_SIZE,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: colors.text,
    },
    bubble: {
        borderRadius: 14,
        backgroundColor: colors.text,
        paddingTop: 12,
        paddingBottom: 8,
        paddingHorizontal: 14,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    title: {
        flex: 1,
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.surface,
    },
    body: {
        marginTop: 4,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        lineHeight: 19,
        color: colors.surface,
        opacity: 0.82,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 6,
        marginTop: 8,
    },
    action: {
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.textTertiary,
    },
    actionPrimary: {
        backgroundColor: colors.surface,
        borderColor: colors.surface,
    },
    actionText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13.5,
        color: colors.surface,
    },
    actionTextPrimary: {
        color: colors.text,
    },
});
