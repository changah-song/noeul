import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fontFamilies, radii, useTheme } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import { getLearnedWords, getWordStats } from '../../services/Database';

/**
 * WordStatsCard — Profile's "Your words": how many new words the reader has
 * met (looked up or saved), how many they are learning (saved, still
 * highlighted) and how many they have learned (saved words that faded out
 * while reading). The counts are read from the reader's own history
 * (Database.getWordStats), not estimated. Tapping "Learned" lists the words.
 */
const WordStatsCard = ({ ownerId, profileId, language, navigation }) => {
    const { colors } = useTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [stats, setStats] = useState(null);
    const [learnedWords, setLearnedWords] = useState(null);
    const [showLearned, setShowLearned] = useState(false);
    const [version, setVersion] = useState(0);

    // Counts change while reading: read them again whenever Profile is shown.
    useEffect(() => navigation?.addListener?.('focus', () => setVersion((value) => value + 1)), [navigation]);

    useEffect(() => {
        let cancelled = false;
        getWordStats({ ownerId, profileId, language })
            .then((next) => {
                if (!cancelled) setStats(next);
            })
            .catch((error) => {
                console.warn('[WordStatsCard] Failed to read word stats:', error?.message ?? error);
            });
        return () => {
            cancelled = true;
        };
    }, [language, ownerId, profileId, version]);

    const openLearned = useCallback(async () => {
        setShowLearned(true);
        try {
            setLearnedWords(await getLearnedWords({ ownerId, profileId, language }));
        } catch (error) {
            console.warn('[WordStatsCard] Failed to read learned words:', error?.message ?? error);
            setLearnedWords([]);
        }
    }, [language, ownerId, profileId]);

    if (!stats) return null;

    const cells = [
        { key: 'met', value: stats.met, label: t('wordStats.met') },
        { key: 'learning', value: stats.learning, label: t('wordStats.learning') },
        { key: 'learned', value: stats.learned, label: t('wordStats.learned'), onPress: openLearned },
    ];

    return (
        <>
            <View style={styles.card}>
                {cells.map((cell, index) => {
                    const body = (
                        <>
                            <Text style={styles.value}>{formatNumber(cell.value)}</Text>
                            <View style={styles.labelRow}>
                                <Text style={styles.label} numberOfLines={2}>{cell.label}</Text>
                                {cell.onPress ? <Feather name="chevron-right" size={14} color={colors.textTertiary} /> : null}
                            </View>
                        </>
                    );
                    const cellStyle = styles.cell;
                    return (
                        <Fragment key={cell.key}>
                            {/* A short vertical hairline between the cells. */}
                            {index > 0 ? <View style={styles.cellDivider} /> : null}
                            {cell.onPress ? (
                                <TouchableOpacity
                                    style={cellStyle}
                                    activeOpacity={0.7}
                                    onPress={cell.onPress}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${cell.label}, ${formatNumber(cell.value)}`}
                                    accessibilityHint={t('wordStats.learnedOpenHint')}
                                >
                                    {body}
                                </TouchableOpacity>
                            ) : (
                                <View
                                    style={cellStyle}
                                    accessible
                                    accessibilityLabel={`${cell.label}, ${formatNumber(cell.value)}`}
                                >
                                    {body}
                                </View>
                            )}
                        </Fragment>
                    );
                })}
            </View>

            <Modal
                visible={showLearned}
                animationType="fade"
                transparent
                statusBarTranslucent
                onRequestClose={() => setShowLearned(false)}
            >
                <Pressable style={styles.backdrop} onPress={() => setShowLearned(false)}>
                    {/* Taps inside the sheet stay in it. */}
                    <Pressable style={styles.sheet} onPress={() => {}}>
                        <View style={styles.sheetHeader}>
                            <Text style={styles.sheetTitle}>{t('wordStats.learnedTitle')}</Text>
                            <TouchableOpacity
                                onPress={() => setShowLearned(false)}
                                style={styles.closeButton}
                                accessibilityRole="button"
                                accessibilityLabel={t('common.done')}
                            >
                                <Feather name="x" size={20} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.sheetNote}>{t('wordStats.learnedNote')}</Text>
                        {learnedWords && learnedWords.length === 0 ? (
                            <Text style={styles.empty}>{t('learn.learnedEmptyTitle')}</Text>
                        ) : (
                            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                                {(learnedWords ?? []).map((row, index) => (
                                    <View key={row.id} style={[styles.wordRow, index > 0 && styles.wordRowDivider]}>
                                        <Text style={styles.word}>{row.word}</Text>
                                        {row.def ? <Text style={styles.def} numberOfLines={2}>{row.def}</Text> : null}
                                    </View>
                                ))}
                            </ScrollView>
                        )}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
};

const createStyles = (colors) => ({
    card: {
        marginHorizontal: 24,
        borderRadius: radii.control,
        borderWidth: 1,
        borderColor: colors.divider,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        // Cells stretch to the tallest one and keep their numbers on one top
        // line, so a label that wraps to two lines can't push its number up.
        alignItems: 'stretch',
        overflow: 'hidden',
    },
    cell: {
        flex: 1,
        minWidth: 0,
        minHeight: 72,
        justifyContent: 'flex-start',
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    cellDivider: {
        alignSelf: 'center',
        width: 1,
        height: 40,
        backgroundColor: colors.divider,
    },
    value: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 20,
        lineHeight: 26,
        color: colors.text,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    label: {
        flexShrink: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textTertiary,
    },
    backdrop: {
        flex: 1,
        backgroundColor: colors.overlay,
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 64,
    },
    sheet: {
        maxHeight: '100%',
        borderRadius: radii.sheet,
        padding: 20,
        backgroundColor: colors.surfaceElevated,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sheetTitle: {
        flex: 1,
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 21,
        lineHeight: 28,
        color: colors.text,
    },
    closeButton: {
        width: 44,
        height: 44,
        marginRight: -12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sheetNote: {
        marginBottom: 8,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
    },
    empty: {
        paddingVertical: 20,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
        color: colors.textTertiary,
    },
    list: {
        flexGrow: 0,
    },
    wordRow: {
        paddingVertical: 10,
        gap: 2,
    },
    wordRowDivider: {
        borderTopWidth: 1,
        borderTopColor: colors.divider,
    },
    word: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 17,
        lineHeight: 24,
        color: colors.text,
    },
    def: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        color: colors.textMuted,
    },
});

export default WordStatsCard;
