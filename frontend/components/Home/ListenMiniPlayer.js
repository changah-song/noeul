import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import {
    getReaderListen,
    runReaderListenCommand,
    subscribeReaderListen,
} from '../../services/readerListenState';

/**
 * ListenMiniPlayer — the reader's listen mode, carried onto Home while it is
 * on (services/readerListenState.js): the book and chapter, previous /
 * play-pause / next and stop. Tapping the title goes back to the reader.
 * Subscribes on its own, so Home doesn't re-render as the voice plays.
 */
const ListenMiniPlayer = ({ onOpenReader }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [listen, setListen] = useState(getReaderListen);
    useEffect(() => subscribeReaderListen(setListen), []);

    const enter = useRef(new Animated.Value(listen.active ? 1 : 0)).current;
    useEffect(() => {
        Animated.timing(enter, {
            toValue: listen.active ? 1 : 0,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enter, listen.active]);

    if (!listen.active) return null;

    return (
        <Animated.View
            style={[
                styles.player,
                {
                    opacity: enter,
                    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                },
            ]}
        >
            <TouchableOpacity
                style={styles.titleButton}
                onPress={onOpenReader}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${t('read.listen')}: ${listen.title}`}
            >
                <MaterialIcons name="headphones" size={18} color={colors.textMuted} />
                <View style={styles.titleStack}>
                    <Text style={styles.title} numberOfLines={1}>{listen.title}</Text>
                    {listen.subtitle ? (
                        <Text style={styles.subtitle} numberOfLines={1}>{listen.subtitle}</Text>
                    ) : null}
                </View>
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.control}
                onPress={() => runReaderListenCommand('previous')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('read.focusPreviousSentence')}
            >
                <MaterialIcons name="skip-previous" size={24} color={colors.inkSlate} />
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.playButton}
                onPress={() => runReaderListenCommand('toggle')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={listen.playing ? t('read.listenPause') : t('read.listenPlay')}
            >
                <MaterialIcons name={listen.playing ? 'pause' : 'play-arrow'} size={24} color={colors.backgroundWarm} />
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.control}
                onPress={() => runReaderListenCommand('next')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('read.focusNextSentence')}
            >
                <MaterialIcons name="skip-next" size={24} color={colors.inkSlate} />
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.control}
                onPress={() => runReaderListenCommand('stop')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('read.listenStop')}
            >
                <MaterialIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
        </Animated.View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    player: {
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 8,
        minHeight: 60,
        paddingLeft: 14,
        paddingRight: 6,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
    },
    titleButton: {
        flex: 1,
        minWidth: 0,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    titleStack: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 19,
        color: colors.text,
    },
    subtitle: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textMuted,
    },
    control: {
        width: 40,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.inkSlate,
    },
});

export default memo(ListenMiniPlayer);
