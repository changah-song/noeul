import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import LoadingDots from '../shared/LoadingDots';

/**
 * PreparingNotice — the chapter's word help (underlines, translations) is
 * still being worked out, and then (`done`) that it's ready. Tonal with the
 * page (white on white, near-black on night paper) so it stays quiet while
 * you read; it rises in when it appears, and the dots turn into a check when
 * it's done.
 */
export default function PreparingNotice({ done = false }) {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const enter = useRef(new Animated.Value(0)).current;
    const check = useRef(new Animated.Value(done ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(enter, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enter]);

    useEffect(() => {
        if (!done) return;
        check.setValue(0);
        Animated.spring(check, {
            toValue: 1,
            stiffness: 260,
            damping: 14,
            mass: 1,
            useNativeDriver: true,
        }).start();
    }, [check, done]);

    const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
    const title = done ? t('read.wordHelpReady') : t('read.preparingWords');
    const detail = done ? t('read.wordHelpReadyDetail') : t('read.preparingWordsDetail');

    return (
        <Animated.View
            accessibilityLiveRegion="polite"
            accessibilityRole={done ? 'text' : 'progressbar'}
            accessibilityLabel={`${title} ${detail}`}
            style={[styles.card, { opacity: enter, transform: [{ translateY }] }]}
        >
            {done ? (
                <Animated.View style={[styles.checkBadge, { transform: [{ scale: check }] }]}>
                    <Feather name="check" size={15} color={colors.inkSlate} />
                </Animated.View>
            ) : (
                <LoadingDots color={colors.inkSlate} size={7} gap={6} style={styles.dots} />
            )}
            <View style={styles.textStack}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.detail}>{detail}</Text>
            </View>
        </Animated.View>
    );
}

const createStyles = (colors) => StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginBottom: 8,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 14,
        backgroundColor: colors.readerSurface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.readerBorder,
        shadowColor: '#11151c',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.10,
        shadowRadius: 18,
        elevation: 4,
    },
    dots: {
        paddingVertical: 4,
    },
    // The finished state: a muted disc with a check, where the dots were.
    checkBadge: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
    },
    textStack: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.text,
    },
    detail: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textMuted,
    },
});
