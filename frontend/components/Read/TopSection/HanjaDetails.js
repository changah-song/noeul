import { useEffect, useState } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import hanjaRelated from '../../../services/api/hanjaRelated';
import { addRelatedKnownWord, getRelatedKnownWords, removeRelatedKnownWord } from '../../../services/Database';
import { colors, fontFamilies, radii, spacing, textStyles } from '../../../theme';

const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const HanjaDetails = ({
    hanja,
    sourceWord,
    handleHanjaPress,
    onKnownWordMarked,
    onKnownWordRemoved,
    isDarkMode,
}) => {
    const { firstTableData: title, similarWordsTableData: result } = hanjaRelated({ query: hanja });
    const [knownKeys, setKnownKeys] = useState(new Set());

    const palette = isDarkMode
        ? {
            overlay: 'rgba(0, 0, 0, 0.52)',
            card: '#1d1915',
            header: '#2b2419',
            row: '#1d1915',
            border: 'rgba(239, 225, 203, 0.18)',
            text: '#f7efe5',
            muted: '#c1b4a2',
            accent: '#dca147',
            accentSoft: 'rgba(220, 161, 71, 0.16)',
            knownBg: 'rgba(99, 173, 150, 0.18)',
            knownText: '#8ad0bd',
        }
        : {
            overlay: 'rgba(28, 24, 19, 0.28)',
            card: colors.surfaceElevated,
            header: '#fff4dc',
            row: colors.surfaceElevated,
            border: '#e5d7c2',
            text: colors.text,
            muted: colors.textMuted,
            accent: colors.accentStrong,
            accentSoft: colors.accentSoft,
            knownBg: '#e6f3ef',
            knownText: '#3d8172',
        };

    const headerEntry = title?.[0] ?? {};
    const relatedWords = Array.isArray(result) ? result : [];
    const linkedWord = sourceWord || 'this word';

    useEffect(() => {
        let isCancelled = false;
        setKnownKeys(new Set());

        if (!hanja || !sourceWord) {
            return () => {
                isCancelled = true;
            };
        }

        getRelatedKnownWords(sourceWord)
            .then((knownWords) => {
                if (!isCancelled) {
                    setKnownKeys(new Set(knownWords.map(relatedWordKey)));
                }
            })
            .catch((error) => {
                console.log(`[HanjaDetails] related known words load failed for "${sourceWord}":`, error.message);
            });

        return () => {
            isCancelled = true;
        };
    }, [hanja, sourceWord]);

    const close = () => handleHanjaPress(null);

    const handleKnownPress = async (entry) => {
        const key = relatedWordKey(entry);
        const known = knownKeys.has(key);
        const knownEntry = {
            korean: entry.korean,
            hanja: entry.hanja,
            meaning: entry.meaning,
            sourceHanja: hanja,
        };

        setKnownKeys((previous) => {
            const next = new Set(previous);
            if (known) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });

        if (known) {
            onKnownWordRemoved?.(sourceWord, knownEntry);
        } else {
            onKnownWordMarked?.(sourceWord, knownEntry);
        }

        if (!sourceWord) {
            return;
        }

        try {
            const nextKnownWords = known
                ? await removeRelatedKnownWord(sourceWord, knownEntry)
                : await addRelatedKnownWord(sourceWord, knownEntry);

            if (known || nextKnownWords.length > 0) {
                setKnownKeys(new Set(nextKnownWords.map(relatedWordKey)));
            }
        } catch (error) {
            console.log(`[HanjaDetails] related known word toggle failed for "${sourceWord}":`, error.message);
        }
    };

    return (
        <Modal visible={hanja !== null} animationType="fade" transparent onRequestClose={close}>
            <View style={styles.modalRoot}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Close Hanja details"
                    activeOpacity={1}
                    style={[styles.backdrop, { backgroundColor: palette.overlay }]}
                    onPress={close}
                />

                <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <View style={[styles.header, { backgroundColor: palette.header, borderBottomColor: palette.border }]}>
                        <View style={[styles.hanjaTile, { backgroundColor: palette.card, borderColor: palette.border }]}>
                            <Text selectable style={[styles.hanjaCharacter, { color: palette.text }]}>{hanja}</Text>
                        </View>

                        <View style={styles.headerCopy}>
                            <Text selectable numberOfLines={1} style={[styles.readingText, { color: palette.text }]}>
                                {headerEntry.reading || 'Hanja'}
                            </Text>
                            <Text selectable numberOfLines={2} style={[styles.meaningText, { color: palette.muted }]}>
                                {headerEntry.meaning || 'Meaning unavailable'}
                            </Text>
                        </View>

                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Close Hanja details"
                            activeOpacity={0.75}
                            style={styles.closeButton}
                            onPress={close}
                        >
                            <MaterialIcons name="close" size={22} color={palette.muted} />
                        </TouchableOpacity>
                    </View>

                    <View style={[styles.noteRow, { backgroundColor: palette.card, borderBottomColor: palette.border }]}>
                        <MaterialIcons name="link" size={18} color={palette.accent} />
                        <Text style={[styles.noteText, { color: palette.muted }]}>
                            Mark words you <Text style={[styles.noteStrong, { color: palette.text }]}>already know</Text> - they'll be linked to{' '}
                            <Text style={[styles.noteStrong, { color: palette.text }]}>{linkedWord}</Text> as related references.
                        </Text>
                    </View>

                    <ScrollView style={styles.relatedList} showsVerticalScrollIndicator={false}>
                        {relatedWords.length > 0 ? relatedWords.map((word, index) => {
                            const known = knownKeys.has(relatedWordKey(word));

                            return (
                                <View
                                    key={`${word.korean}-${word.hanja}-${index}`}
                                    style={[
                                        styles.relatedRow,
                                        { backgroundColor: palette.row, borderBottomColor: palette.border },
                                    ]}
                                >
                                    <View style={styles.relatedCopy}>
                                        <View style={styles.relatedTitleRow}>
                                            <Text selectable style={[styles.relatedKorean, { color: palette.text }]}>
                                                {word.korean}
                                            </Text>
                                            <Text selectable style={[styles.relatedHanja, { color: palette.muted }]}>
                                                {word.hanja}
                                            </Text>
                                        </View>
                                        <Text selectable numberOfLines={2} style={[styles.relatedMeaning, { color: palette.muted }]}>
                                            {word.meaning}
                                        </Text>
                                    </View>

                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={`Mark ${word.korean} as already known`}
                                        activeOpacity={0.82}
                                        onPress={() => handleKnownPress(word)}
                                        style={[
                                            styles.knownButton,
                                            {
                                                backgroundColor: known ? palette.knownBg : palette.card,
                                                borderColor: known ? palette.knownBg : palette.border,
                                            },
                                        ]}
                                    >
                                        {known ? <MaterialIcons name="check" size={15} color={palette.knownText} /> : null}
                                        <Text style={[styles.knownButtonText, { color: known ? palette.knownText : palette.muted }]}>
                                            I know this
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            );
                        }) : (
                            <View style={styles.emptyState}>
                                <Text style={[styles.emptyText, { color: palette.muted }]}>No related words available</Text>
                            </View>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    card: {
        width: '94%',
        maxHeight: '86%',
        borderRadius: radii.lg,
        borderWidth: 1,
        overflow: 'hidden',
    },
    header: {
        minHeight: 104,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    hanjaTile: {
        width: 72,
        height: 72,
        borderRadius: radii.sm,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hanjaCharacter: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 43,
        lineHeight: 52,
    },
    headerCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    readingText: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 17,
        lineHeight: 22,
    },
    meaningText: {
        ...textStyles.body,
        fontSize: 16,
        lineHeight: 22,
    },
    closeButton: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 17,
        alignSelf: 'flex-start',
    },
    noteRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    noteText: {
        ...textStyles.body,
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
    },
    noteStrong: {
        fontFamily: fontFamilies.sansBold,
    },
    relatedList: {
        flexGrow: 0,
    },
    relatedRow: {
        minHeight: 66,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    relatedCopy: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    relatedTitleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: spacing.xs,
    },
    relatedKorean: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 17,
        lineHeight: 22,
    },
    relatedHanja: {
        fontFamily: fontFamilies.serifMedium,
        fontSize: 12,
        lineHeight: 17,
    },
    relatedMeaning: {
        ...textStyles.body,
        fontSize: 13,
        lineHeight: 17,
    },
    knownButton: {
        minHeight: 30,
        borderRadius: 15,
        borderWidth: 1,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
    },
    knownButtonText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 16,
    },
    emptyState: {
        minHeight: 96,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.lg,
    },
    emptyText: {
        ...textStyles.body,
        fontStyle: 'italic',
    },
});

export default HanjaDetails;
