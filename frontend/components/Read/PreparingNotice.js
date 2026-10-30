import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import LoadingDots from '../shared/LoadingDots';

/**
 * PreparingNotice — the chapter's word help (underlines, translations) is
 * still being worked out. Drawn in ink rather than as a page-colored card so
 * it reads as the app working, not one more tip, and it rises in when it
 * appears.
 */
export default function PreparingNotice() {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const enter = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(enter, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enter]);

    const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

    return (
        <Animated.View
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            accessibilityLabel={`${t('read.preparingWords')} ${t('read.preparingWordsDetail')}`}
            style={[styles.card, { opacity: enter, transform: [{ translateY }] }]}
        >
            <LoadingDots color={colors.backgroundWarm} size={7} gap={6} style={styles.dots} />
            <View style={styles.textStack}>
                <Text style={styles.title}>{t('read.preparingWords')}</Text>
                <Text style={styles.detail}>{t('read.preparingWordsDetail')}</Text>
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
        backgroundColor: colors.inkSlate,
        shadowColor: '#11151c',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 18,
        elevation: 8,
    },
    dots: {
        paddingVertical: 4,
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
        color: colors.backgroundWarm,
    },
    detail: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.backgroundWarm,
        opacity: 0.72,
    },
});
