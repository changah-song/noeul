import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Modal, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Confetti } from '../Goal/GoalCompleteModal';
import Book3D from './Book3D';
import FinishedRibbon from './FinishedRibbon';
import { fontFamilies, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';

const COVER_WIDTH = 104;
const COVER_HEIGHT = 152;

/**
 * BookFinishedModal — the last page of a book turned: its cover gets its
 * ribbon (the mark it keeps on the shelf), and what reading it added up to:
 * words read, days spent in it, words looked up and saved.
 * stats: { wordCount, days, lookedUp, saved }, any of them null to leave out.
 */
const BookFinishedModal = ({ book, title, author, stats, renderCover, onClose }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const { width, height } = useWindowDimensions();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const appear = useRef(new Animated.Value(0)).current;
    const ribbon = useRef(new Animated.Value(0)).current;
    const statsAppear = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!book) return;
        appear.setValue(0);
        ribbon.setValue(0);
        Animated.sequence([
            Animated.timing(appear, {
                toValue: 1,
                duration: 360,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.spring(ribbon, {
                toValue: 1,
                friction: 6,
                tension: 90,
                useNativeDriver: true,
            }),
        ]).start();
    }, [appear, book, ribbon]);

    // The numbers come from the database a moment later; fade them in.
    const statsReady = !!stats;
    useEffect(() => {
        if (!statsReady) {
            statsAppear.setValue(0);
            return;
        }
        Animated.timing(statsAppear, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start();
    }, [statsAppear, statsReady]);

    if (!book) return null;

    const tiles = [
        { key: 'words', value: stats?.wordCount, label: t('finished.statWords') },
        { key: 'days', value: stats?.days, label: t('finished.statDays') },
        { key: 'lookedUp', value: stats?.lookedUp, label: t('finished.statLookedUp') },
        { key: 'saved', value: stats?.saved, label: t('finished.statSaved') },
    ].filter((tile) => Number.isFinite(tile.value) && tile.value > 0);

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.backdrop}>
                <Confetti width={width} height={height} colors={colors} />
                <Animated.View
                    style={[
                        styles.card,
                        {
                            opacity: appear,
                            transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
                        },
                    ]}
                    accessibilityLiveRegion="polite"
                >
                    <View style={styles.coverWrap}>
                        <Book3D width={COVER_WIDTH} height={COVER_HEIGHT} radius={3}>
                            {renderCover?.(COVER_WIDTH, COVER_HEIGHT)}
                        </Book3D>
                        <Animated.View
                            style={[
                                styles.ribbonSlot,
                                {
                                    opacity: ribbon.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
                                    transform: [{ translateY: ribbon.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] }) }],
                                },
                            ]}
                        >
                            <FinishedRibbon color={colors.accent} iconColor={colors.readerTappedWordText} />
                        </Animated.View>
                    </View>
                    <Text style={styles.title}>{t('finished.title')}</Text>
                    <Text style={styles.bookTitle} numberOfLines={2}>{title}</Text>
                    {author ? <Text style={styles.author} numberOfLines={1}>{author}</Text> : null}
                    {tiles.length > 0 ? (
                        <Animated.View style={[styles.tiles, { opacity: statsAppear }]}>
                            {tiles.map((tile) => (
                                <View key={tile.key} style={styles.tile}>
                                    <Text style={styles.tileValue}>{formatNumber(tile.value)}</Text>
                                    <Text style={styles.tileLabel} numberOfLines={2}>{tile.label}</Text>
                                </View>
                            ))}
                        </Animated.View>
                    ) : null}
                    <TouchableOpacity onPress={onClose} style={styles.button} accessibilityRole="button">
                        <Text style={styles.buttonText}>{t('finished.done')}</Text>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </Modal>
    );
};

const createStyles = (colors) => ({
    backdrop: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.overlay,
        paddingHorizontal: 28,
    },
    card: {
        width: '100%',
        maxWidth: 360,
        borderRadius: 22,
        backgroundColor: colors.surface,
        paddingTop: 28,
        paddingBottom: 18,
        paddingHorizontal: 22,
        alignItems: 'center',
    },
    coverWrap: {
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
    },
    ribbonSlot: {
        position: 'absolute',
        top: 0,
        right: 12,
    },
    title: {
        marginTop: 20,
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 22,
        lineHeight: 28,
        color: colors.text,
        textAlign: 'center',
    },
    bookTitle: {
        marginTop: 4,
        fontFamily: fontFamilies.serifMedium,
        fontSize: 16,
        lineHeight: 22,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    author: {
        marginTop: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    tiles: {
        alignSelf: 'stretch',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 8,
        marginTop: 18,
    },
    tile: {
        width: '48.5%',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: colors.surfaceMuted,
    },
    tileValue: {
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 22,
        lineHeight: 27,
        color: colors.text,
    },
    tileLabel: {
        marginTop: 1,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 12.5,
        lineHeight: 16,
        color: colors.textSecondary,
    },
    button: {
        alignSelf: 'stretch',
        marginTop: 18,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.text,
    },
    buttonText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        color: colors.surface,
    },
});

export default BookFinishedModal;
