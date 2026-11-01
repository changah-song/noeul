import { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

/**
 * LocationPrompt — after a sudden jump in the book (the scrubber, the
 * contents, a leap into another chapter), asks whether this is the reader's
 * new spot. Yes saves it; No keeps the old one, which stays marked with a black
 * dot on the scrubber to get back to (screens/Read.js holds it). `onHeight`
 * hears the card's height, for what has to make room above it.
 */
const LocationPrompt = ({ visible, bottom = 24, onConfirm, onDecline, onHeight }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const enter = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) return;
        enter.setValue(0);
        Animated.timing(enter, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enter, visible]);

    if (!visible) return null;
    const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
    return (
        <View
            pointerEvents="box-none"
            style={[styles.layer, { bottom }]}
            onLayout={onHeight ? (event) => onHeight(Math.round(event?.nativeEvent?.layout?.height ?? 0)) : undefined}
        >
            <Animated.View
                accessibilityLiveRegion="polite"
                style={[styles.card, { opacity: enter, transform: [{ translateY }] }]}
            >
                <Text style={styles.title}>{t('read.newSpotTitle')}</Text>
                <Text style={styles.body}>{t('read.newSpotBody')}</Text>
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.button, styles.buttonQuiet]}
                        onPress={onDecline}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.buttonText, styles.buttonQuietText]} numberOfLines={1}>
                            {t('read.newSpotNo')}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.button, styles.buttonMain]}
                        onPress={onConfirm}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.buttonText, styles.buttonMainText]} numberOfLines={1}>
                            {t('read.newSpotYes')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </Animated.View>
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    layer: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 40,
        elevation: 40,
    },
    card: {
        borderRadius: 16,
        paddingTop: 16,
        paddingHorizontal: 18,
        paddingBottom: 14,
        gap: 6,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#11151c',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
        elevation: 8,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 21,
        color: colors.text,
    },
    body: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 19,
        color: colors.textMuted,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 8,
    },
    button: {
        flex: 1,
        minHeight: 42,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    buttonQuiet: {
        backgroundColor: colors.surfaceMuted,
    },
    buttonMain: {
        backgroundColor: colors.inkSlate,
    },
    buttonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
    },
    buttonQuietText: {
        color: colors.text,
    },
    buttonMainText: {
        color: colors.backgroundWarm,
    },
});

export default memo(LocationPrompt);
