import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import hanjaRelated from '../../../services/api/hanjaRelated';
import { addRelatedKnownWord, getRelatedKnownWords, removeRelatedKnownWord } from '../../../services/Database';
import { colors, fontFamilies, radii, spacing, textStyles } from '../../../theme';

const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeHanjaCharacters = (characters, fallback) => {
    const normalized = Array.isArray(characters)
        ? characters.map(cleanValue).filter((char) => HANJA_RE.test(char))
        : [];

    if (normalized.length > 0) {
        return normalized;
    }

    const fallbackCharacters = cleanValue(fallback).split('').filter((char) => HANJA_RE.test(char));
    return fallbackCharacters.length > 0 ? fallbackCharacters : [];
};

const HanjaDetails = ({
    hanja,
    hanjaCharacters = [],
    initialHanjaIndex = 0,
    sourceWord,
    handleHanjaPress,
    onKnownWordMarked,
    onKnownWordRemoved,
    isDarkMode,
}) => {
    const characters = normalizeHanjaCharacters(hanjaCharacters, hanja);
    const charactersKey = characters.join('|');
    const fallbackIndex = characters.indexOf(cleanValue(hanja));
    const initialIndex = Math.max(
        0,
        Math.min(
            Number.isInteger(initialHanjaIndex)
                ? initialHanjaIndex
                : fallbackIndex,
            Math.max(characters.length - 1, 0)
        )
    );
    const [activeHanjaIndex, setActiveHanjaIndex] = useState(initialIndex);
    const activeHanja = characters[activeHanjaIndex] ?? characters[0] ?? null;
    const { firstTableData: title, similarWordsTableData: result, isLoading } = hanjaRelated({ query: activeHanja });
    const [knownKeys, setKnownKeys] = useState(new Set());

    const palette = isDarkMode
        ? {
            overlay: 'rgba(0, 0, 0, 0.38)',
            card: '#1d1915',
            header: '#2b2419',
            row: '#1d1915',
            border: 'rgba(239, 225, 203, 0.18)',
            text: '#f7efe5',
            muted: '#c1b4a2',
            accent: colors.accent,
            accentSoft: colors.accentSoft,
            knownBg: 'rgba(99, 173, 150, 0.18)',
            knownText: '#8ad0bd',
        }
        : {
            overlay: 'rgba(53, 46, 37, 0.22)',
            card: '#ffffff',
            header: '#fff4dc',
            row: '#ffffff',
            border: '#eadcc5',
            text: colors.text,
            muted: colors.textMuted,
            accent: colors.accentStrong,
            accentSoft: colors.accentSoft,
            knownBg: colors.accentStrong,
            knownText: '#ffffff',
        };

    const headerEntry = isLoading ? {} : title?.[0] ?? {};
    const relatedWords = !isLoading && Array.isArray(result) ? result : [];
    const canNavigateHanja = characters.length > 1;
    const linkedWord = sourceWord || 'this word';

    useEffect(() => {
        setActiveHanjaIndex(initialIndex);
    }, [charactersKey, initialIndex]);

    useEffect(() => {
        let isCancelled = false;
        setKnownKeys(new Set());

        if (!activeHanja || !sourceWord) {
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
    }, [activeHanja, sourceWord]);

    const close = () => handleHanjaPress(null);

    const goToPreviousHanja = () => {
        if (!canNavigateHanja) {
            return;
        }

        setActiveHanjaIndex((currentIndex) => (
            currentIndex <= 0 ? characters.length - 1 : currentIndex - 1
        ));
    };

    const goToNextHanja = () => {
        if (!canNavigateHanja) {
            return;
        }

        setActiveHanjaIndex((currentIndex) => (
            currentIndex >= characters.length - 1 ? 0 : currentIndex + 1
        ));
    };

    const handleKnownPress = async (entry) => {
        const key = relatedWordKey(entry);
        const known = knownKeys.has(key);
        const knownEntry = {
            korean: entry.korean,
            hanja: entry.hanja,
            meaning: entry.meaning,
            sourceHanja: activeHanja,
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
        <Modal visible={activeHanja !== null} animationType="fade" transparent onRequestClose={close}>
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
                            <Text selectable style={[styles.hanjaCharacter, { color: palette.text }]}>{activeHanja}</Text>
                        </View>

                        <View style={styles.headerCopy}>
                            <Text selectable numberOfLines={1} style={[styles.readingText, { color: palette.text }]}>
                                {headerEntry.reading || (isLoading ? 'Loading...' : 'Hanja')}
                            </Text>
                            <Text selectable numberOfLines={2} style={[styles.meaningText, { color: palette.muted }]}>
                                {headerEntry.meaning || (isLoading ? 'Fetching related hanja details' : 'Meaning unavailable')}
                            </Text>
                        </View>

                        <View style={styles.headerActions}>
                            {canNavigateHanja ? (
                                <View style={[styles.hanjaNavigator, { borderColor: palette.border, backgroundColor: palette.card }]}>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel="Previous Hanja"
                                        activeOpacity={0.78}
                                        onPress={goToPreviousHanja}
                                        style={styles.hanjaNavButton}
                                    >
                                        <MaterialIcons name="chevron-left" size={20} color={palette.muted} />
                                    </TouchableOpacity>
                                    <Text style={[styles.hanjaNavCount, { color: palette.muted }]}>
                                        {activeHanjaIndex + 1}/{characters.length}
                                    </Text>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel="Next Hanja"
                                        activeOpacity={0.78}
                                        onPress={goToNextHanja}
                                        style={styles.hanjaNavButton}
                                    >
                                        <MaterialIcons name="chevron-right" size={20} color={palette.muted} />
                                    </TouchableOpacity>
                                </View>
                            ) : null}

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
                    </View>

                    <View style={[styles.noteRow, { backgroundColor: palette.card, borderBottomColor: palette.border }]}>
                        <MaterialIcons name="link" size={18} color={palette.accent} />
                        <Text style={[styles.noteText, { color: palette.muted }]}>
                            Mark words you <Text style={[styles.noteStrong, { color: palette.text }]}>already know</Text> - they'll be linked to{' '}
                            <Text style={[styles.noteStrong, { color: palette.text }]}>{linkedWord}</Text> as related references.
                        </Text>
                    </View>

                    <ScrollView style={styles.relatedList} showsVerticalScrollIndicator={false}>
                        {isLoading ? (
                            <View style={styles.emptyState}>
                                <ActivityIndicator size="small" color={palette.accent} />
                                <Text style={[styles.emptyText, { color: palette.muted }]}>Loading related words...</Text>
                            </View>
                        ) : relatedWords.length > 0 ? relatedWords.map((word, index) => {
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
                                        accessibilityLabel={known ? `${word.korean} marked as known` : `Mark ${word.korean} as already known`}
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
                                        <MaterialIcons
                                            name={known ? 'check' : 'add'}
                                            size={20}
                                            color={known ? palette.knownText : palette.muted}
                                        />
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
        justifyContent: 'flex-end',
        paddingHorizontal: spacing.lg,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    card: {
        width: '100%',
        maxHeight: '62%',
        marginBottom: 150,
        borderRadius: 18,
        borderWidth: 1,
        overflow: 'hidden',
        shadowColor: 'rgba(45, 37, 27, 0.24)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 12,
    },
    header: {
        minHeight: 104,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 20,
        paddingVertical: 18,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    hanjaTile: {
        width: 64,
        height: 64,
        borderRadius: 14,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hanjaCharacter: {
        fontFamily: fontFamilies.krSerifBold,
        fontSize: 39,
        lineHeight: 48,
    },
    headerCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    readingText: {
        fontFamily: fontFamilies.krSerifBold,
        fontSize: 18,
        lineHeight: 24,
    },
    meaningText: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 21,
    },
    headerActions: {
        alignSelf: 'flex-start',
        alignItems: 'flex-end',
        gap: spacing.xs,
    },
    hanjaNavigator: {
        height: 34,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 17,
        overflow: 'hidden',
    },
    hanjaNavButton: {
        width: 27,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hanjaNavCount: {
        minWidth: 28,
        textAlign: 'center',
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
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
        paddingHorizontal: 20,
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
        minHeight: 74,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: 20,
        paddingVertical: 10,
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
        fontFamily: fontFamilies.krSerifBold,
        fontSize: 19,
        lineHeight: 24,
    },
    relatedHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 14,
        lineHeight: 19,
    },
    relatedMeaning: {
        ...textStyles.body,
        fontSize: 16,
        lineHeight: 21,
    },
    knownButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
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
