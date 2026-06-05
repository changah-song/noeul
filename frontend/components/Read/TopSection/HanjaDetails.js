import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { fetchHanjaRelated } from '../../../services/api/hanjaRelated';
import { addRelatedKnownWord, getRelatedKnownWords, removeRelatedKnownWord } from '../../../services/Database';
import {
    softDeleteUserRelatedKnownWord,
    supabase,
    upsertUserRelatedKnownWord,
    upsertUserVocabEntry,
} from '../../../services/supabase';
import { colors, fontFamilies, spacing, textStyles } from '../../../theme';

const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const RELATED_WORD_PAGE_SIZE = 10;
const RELATED_WORD_LOAD_DELAY_MS = 650;
const SIDE_NAV_HIT_SLOP = { top: 22, right: 22, bottom: 22, left: 22 };
const EMPTY_HANJA_LOOKUP = {
    firstTableData: [],
    similarWordsTableData: [],
};

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeReadingEntries = (entries = []) => {
    const seen = new Set();
    const normalized = [];

    entries.forEach((entry) => {
        const reading = cleanValue(entry?.reading);
        const koreanMeaning = cleanValue(entry?.hun_korean);
        const englishMeaning = cleanValue(entry?.hun_english) || cleanValue(entry?.meaning);
        const fallbackMeaning = cleanValue(entry?.meaning);
        const key = `${reading}|${koreanMeaning}|${englishMeaning || fallbackMeaning}`;

        if ((!reading && !koreanMeaning && !englishMeaning && !fallbackMeaning) || seen.has(key)) {
            return;
        }

        seen.add(key);
        normalized.push({
            hanja: cleanValue(entry?.hanja),
            reading,
            koreanMeaning,
            englishMeaning,
            fallbackMeaning,
        });
    });

    return normalized;
};

const uniqueValues = (values) => [...new Set(values.map(cleanValue).filter(Boolean))];

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
    sourceWordDetails = {},
    handleHanjaPress,
    onKnownWordMarked,
    onKnownWordRemoved,
    onSourceWordAutoSaved,
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
    const [knownKeys, setKnownKeys] = useState(new Set());
    const [hanjaLookupByCharacter, setHanjaLookupByCharacter] = useState({});
    const [isPreloadingHanja, setIsPreloadingHanja] = useState(false);
    const [visibleRelatedCount, setVisibleRelatedCount] = useState(RELATED_WORD_PAGE_SIZE);
    const [isLoadingMoreRelated, setIsLoadingMoreRelated] = useState(false);
    const lastRelatedLoadCountRef = useRef(0);
    const relatedLoadTimerRef = useRef(null);
    const activeHanja = characters[activeHanjaIndex] ?? characters[0] ?? null;
    const activeLookup = activeHanja ? hanjaLookupByCharacter[activeHanja] : null;
    const title = activeLookup?.firstTableData ?? [];
    const result = activeLookup?.similarWordsTableData ?? [];
    const isLoading = Boolean(activeHanja && isPreloadingHanja && !activeLookup);

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

    const readingEntries = isLoading || !Array.isArray(title)
        ? []
        : normalizeReadingEntries(title);
    const headerEntry = isLoading ? {} : title?.[0] ?? {};
    const headerReadingParts = readingEntries
        .map((entry) => ({
            koreanMeaning: entry.koreanMeaning,
            reading: entry.reading,
        }))
        .filter((entry) => entry.koreanMeaning || entry.reading);
    const meaningLabels = uniqueValues(readingEntries.map((entry) => (
        entry.englishMeaning || entry.fallbackMeaning
    )));
    const headerMeaning = meaningLabels.length > 0
        ? meaningLabels.join(' / ')
        : headerEntry.meaning;
    const relatedWords = !isLoading && Array.isArray(result) ? result : [];
    const visibleRelatedWords = relatedWords.slice(0, visibleRelatedCount);
    const hasMoreRelatedWords = visibleRelatedCount < relatedWords.length;
    const canGoPrevious = activeHanjaIndex > 0;
    const canGoNext = activeHanjaIndex < characters.length - 1;
    const linkedWord = sourceWord || 'this word';
    const language = sourceWordDetails?.language ?? 'ko';

    useEffect(() => {
        setActiveHanjaIndex(initialIndex);
    }, [charactersKey, initialIndex]);

    useEffect(() => {
        let isCancelled = false;
        const uniqueCharacters = [...new Set(charactersKey.split('|').filter(Boolean))];

        setHanjaLookupByCharacter({});

        if (uniqueCharacters.length === 0) {
            setIsPreloadingHanja(false);
            return () => {
                isCancelled = true;
            };
        }

        setIsPreloadingHanja(true);
        let pendingRequests = uniqueCharacters.length;

        uniqueCharacters.forEach(async (character) => {
            let lookup = EMPTY_HANJA_LOOKUP;

            try {
                lookup = await fetchHanjaRelated(character);
            } catch (error) {
                console.warn(`[HanjaDetails] preload failed for "${character}":`, error.message);
            }

            if (isCancelled) {
                return;
            }

            setHanjaLookupByCharacter((previous) => ({
                ...previous,
                [character]: lookup ?? EMPTY_HANJA_LOOKUP,
            }));

            pendingRequests -= 1;
            if (pendingRequests === 0) {
                setIsPreloadingHanja(false);
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [charactersKey]);

    useEffect(() => {
        setVisibleRelatedCount(RELATED_WORD_PAGE_SIZE);
        setIsLoadingMoreRelated(false);
        lastRelatedLoadCountRef.current = 0;

        if (relatedLoadTimerRef.current) {
            clearTimeout(relatedLoadTimerRef.current);
            relatedLoadTimerRef.current = null;
        }
    }, [activeHanja]);

    useEffect(() => {
        let isCancelled = false;
        setKnownKeys(new Set());

        if (!activeHanja || !sourceWord) {
            return () => {
                isCancelled = true;
            };
        }

        getRelatedKnownWords(sourceWord, language)
            .then((knownWords) => {
                if (!isCancelled) {
                    setKnownKeys(new Set(knownWords.map(relatedWordKey)));
                }
            })
            .catch((error) => {
                console.warn(`[HanjaDetails] related known words load failed for "${sourceWord}":`, error.message);
            });

        return () => {
            isCancelled = true;
        };
    }, [activeHanja, language, sourceWord]);

    useEffect(() => {
        return () => {
            if (relatedLoadTimerRef.current) {
                clearTimeout(relatedLoadTimerRef.current);
            }
        };
    }, []);

    const close = () => handleHanjaPress(null);

    const goToPreviousHanja = () => {
        if (!canGoPrevious) {
            return;
        }

        setActiveHanjaIndex((currentIndex) => currentIndex - 1);
    };

    const goToNextHanja = () => {
        if (!canGoNext) {
            return;
        }

        setActiveHanjaIndex((currentIndex) => currentIndex + 1);
    };

    const handleRelatedScroll = ({ nativeEvent }) => {
        if (!nativeEvent || !hasMoreRelatedWords || isLoadingMoreRelated) {
            return;
        }

        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);

        if (distanceFromBottom > 24) {
            return;
        }

        if (lastRelatedLoadCountRef.current === visibleRelatedCount) {
            return;
        }

        lastRelatedLoadCountRef.current = visibleRelatedCount;
        setIsLoadingMoreRelated(true);

        relatedLoadTimerRef.current = setTimeout(() => {
            setVisibleRelatedCount((currentCount) => (
                Math.min(currentCount + RELATED_WORD_PAGE_SIZE, relatedWords.length)
            ));
            setIsLoadingMoreRelated(false);
            relatedLoadTimerRef.current = null;
        }, RELATED_WORD_LOAD_DELAY_MS);
    };

    const handleKnownPress = async (entry) => {
        const key = relatedWordKey(entry);
        const known = knownKeys.has(key);
        const markedAt = new Date().toISOString();
        const knownEntry = {
            korean: entry.korean,
            hanja: entry.hanja,
            meaning: entry.meaning,
            sourceHanja: activeHanja,
            markedAt,
            updatedAt: markedAt,
        };
        const relation = {
            language,
            mainWord: sourceWord,
            mainHanja: sourceWordDetails?.hanja ?? null,
            mainDefinition: sourceWordDetails?.definition ?? null,
            relatedWord: knownEntry.korean,
            relatedHanja: knownEntry.hanja,
            relatedDefinition: knownEntry.meaning,
            sourceHanja: knownEntry.sourceHanja,
            markedAt,
            updatedAt: markedAt,
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
                ? await removeRelatedKnownWord(sourceWord, knownEntry, language, {
                    mainHanja: sourceWordDetails?.hanja ?? null,
                    mainDefinition: sourceWordDetails?.definition ?? null,
                })
                : await addRelatedKnownWord(sourceWord, knownEntry, {
                    createIfMissing: true,
                    mainWord: sourceWordDetails,
                    language,
                });

            if (!known) {
                onSourceWordAutoSaved?.(sourceWord, sourceWordDetails);
            }

            if (known || nextKnownWords.length > 0) {
                setKnownKeys(new Set(nextKnownWords.map(relatedWordKey)));
            }

            supabase.auth.getUser()
                .then(({ data: { user } }) => {
                    if (!user) {
                        return null;
                    }

                    if (known) {
                        return softDeleteUserRelatedKnownWord(user.id, relation);
                    }

                    return Promise.all([
                        upsertUserVocabEntry(user.id, {
                            word: sourceWord,
                            hanja: sourceWordDetails?.hanja ?? null,
                            definition: sourceWordDetails?.definition ?? null,
                            level: sourceWordDetails?.level ?? 'unorganized',
                            status: sourceWordDetails?.level ?? 'unorganized',
                            sourceBookUri: sourceWordDetails?.sourceBookUri ?? null,
                            sourceBookTitle: sourceWordDetails?.sourceBookTitle ?? null,
                            contextSentence: sourceWordDetails?.contextSentence ?? null,
                            isFavorite: sourceWordDetails?.isFavorite ?? false,
                            priority: sourceWordDetails?.priority ?? 'normal',
                            createdAt: sourceWordDetails?.createdAt ?? markedAt,
                            updatedAt: sourceWordDetails?.updatedAt ?? markedAt,
                            language,
                        }),
                        upsertUserRelatedKnownWord(user.id, relation),
                    ]);
                })
                .catch((syncError) => {
                    console.warn(`[HanjaDetails] related known word cloud sync failed for "${sourceWord}":`, syncError.message);
                });
        } catch (error) {
            console.warn(`[HanjaDetails] related known word toggle failed for "${sourceWord}":`, error.message);
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
                    <View style={styles.cardContent}>
                        <View style={[styles.header, { backgroundColor: palette.header, borderBottomColor: palette.border }]}>
                            <View style={[styles.hanjaTile, { backgroundColor: palette.card, borderColor: palette.border }]}>
                                <Text selectable style={[styles.hanjaCharacter, { color: palette.text }]}>{activeHanja}</Text>
                            </View>

                            <View style={styles.headerCopy}>
                                <Text selectable numberOfLines={2} style={[styles.readingText, { color: palette.text }]}>
                                    {headerReadingParts.length > 0 ? headerReadingParts.map((entry, index) => (
                                        <Text key={`${entry.koreanMeaning}-${entry.reading}-${index}`}>
                                            {index > 0 ? ' / ' : ''}
                                            {entry.koreanMeaning ? (
                                                <Text style={styles.headerKoreanDefinition}>
                                                    {entry.koreanMeaning}
                                                </Text>
                                            ) : null}
                                            {entry.koreanMeaning && entry.reading ? ' ' : ''}
                                            {entry.reading ? (
                                                <Text style={styles.headerReadingSound}>
                                                    {entry.reading}
                                                </Text>
                                            ) : null}
                                        </Text>
                                    )) : (headerEntry.reading || (isLoading ? 'Loading...' : 'Hanja'))}
                                </Text>
                                <Text selectable numberOfLines={2} style={[styles.meaningText, { color: palette.muted }]}>
                                    {headerMeaning || (isLoading ? 'Fetching related hanja details' : 'Meaning unavailable')}
                                </Text>
                            </View>
                        </View>

                        <View style={[styles.noteRow, { backgroundColor: palette.card, borderBottomColor: palette.border }]}>
                            <MaterialIcons name="link" size={18} color={palette.accent} />
                            <Text style={[styles.noteText, { color: palette.muted }]}>
                                Mark words you <Text style={[styles.noteStrong, { color: palette.text }]}>already know</Text> - they'll be linked to{' '}
                                <Text style={[styles.noteStrong, { color: palette.text }]}>{linkedWord}</Text> as related references.
                            </Text>
                        </View>

                        <ScrollView
                            style={styles.relatedList}
                            showsVerticalScrollIndicator={false}
                            onScroll={handleRelatedScroll}
                            scrollEventThrottle={16}
                        >
                            {isLoading ? (
                                <View style={styles.emptyState}>
                                    <ActivityIndicator size="small" color={palette.accent} />
                                    <Text style={[styles.emptyText, { color: palette.muted }]}>Loading related words...</Text>
                                </View>
                            ) : relatedWords.length > 0 ? (
                                <>
                                    {visibleRelatedWords.map((word, index) => {
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
                                                    {known ? (
                                                        <MaterialIcons
                                                            name="check"
                                                            size={17}
                                                            color={palette.knownText}
                                                        />
                                                    ) : null}
                                                    <Text
                                                        numberOfLines={1}
                                                        adjustsFontSizeToFit
                                                        minimumFontScale={0.86}
                                                        style={[
                                                            styles.knownButtonText,
                                                            { color: known ? palette.knownText : palette.muted },
                                                        ]}
                                                    >
                                                        I already know
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        );
                                    })}
                                </>
                            ) : (
                                <View style={styles.emptyState}>
                                    <Text style={[styles.emptyText, { color: palette.muted }]}>No related words available</Text>
                                </View>
                            )}
                        </ScrollView>
                    </View>

                    {canGoPrevious ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Previous Hanja"
                            activeOpacity={0.72}
                            onPress={goToPreviousHanja}
                            style={[
                                styles.sideNavButton,
                                styles.sideNavLeft,
                            ]}
                            hitSlop={SIDE_NAV_HIT_SLOP}
                        >
                            <MaterialIcons name="chevron-left" size={22} color={palette.muted} />
                        </TouchableOpacity>
                    ) : null}
                    {canGoNext ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel="Next Hanja"
                            activeOpacity={0.72}
                            onPress={goToNextHanja}
                            style={[
                                styles.sideNavButton,
                                styles.sideNavRight,
                            ]}
                            hitSlop={SIDE_NAV_HIT_SLOP}
                        >
                            <MaterialIcons name="chevron-right" size={22} color={palette.muted} />
                        </TouchableOpacity>
                    ) : null}
                    {isLoadingMoreRelated ? (
                        <View pointerEvents="none" style={styles.loadMoreSpinner}>
                            <ActivityIndicator size="small" color={palette.accent} />
                        </View>
                    ) : null}
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
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.xl,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    card: {
        width: '100%',
        maxHeight: '82%',
        borderRadius: 18,
        borderWidth: 1,
        overflow: 'hidden',
        position: 'relative',
        shadowColor: 'rgba(45, 37, 27, 0.24)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 12,
    },
    cardContent: {
        width: '100%',
    },
    header: {
        minHeight: 104,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 36,
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
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 18,
        lineHeight: 24,
    },
    headerKoreanDefinition: {
        fontFamily: fontFamilies.krSerifRegular,
    },
    headerReadingSound: {
        fontFamily: fontFamilies.krSerifBold,
    },
    meaningText: {
        ...textStyles.body,
        fontSize: 15,
        lineHeight: 21,
    },
    sideNavButton: {
        position: 'absolute',
        top: '50%',
        width: 34,
        height: 64,
        marginTop: -32,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.52,
        zIndex: 4,
    },
    sideNavLeft: {
        left: 3,
    },
    sideNavRight: {
        right: 3,
    },
    noteRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs,
        paddingHorizontal: 36,
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
        paddingHorizontal: 36,
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
        width: 128,
        minWidth: 112,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 10,
        flexShrink: 0,
    },
    knownButtonText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 15,
        letterSpacing: 0,
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
    loadMoreSpinner: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 14,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 5,
    },
});

export default HanjaDetails;
