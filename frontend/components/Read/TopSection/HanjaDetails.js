import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppContext } from '../../../contexts/AppContext';
import { useTranslation } from '../../../hooks/useTranslation';
import { useLocalOwner } from '../../../contexts/LocalOwnerContext';
import { fetchHanjaRelated } from '../../../services/api/hanjaRelated';
import { addRelatedKnownWord, getRelatedKnownWords, removeRelatedKnownWord } from '../../../services/Database';
import {
    softDeleteUserRelatedKnownWord,
    supabase,
    upsertUserRelatedKnownWord,
    upsertUserVocabEntry,
} from '../../../services/supabase';
import { isCurrentSyncGeneration } from '../../../services/localOwnerCoordinator';
import { fontFamilies, useTheme } from '../../../theme';

const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const HANJA_RE = /[㐀-䶿一-鿿豈-﫿]/;
const CARD_GAP = 12;
const INITIAL_VISIBLE_COUNT = 2;
const RELATED_PAGE_SIZE = 3;
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
        const englishMeaning = cleanValue(entry?.hun_display) || cleanValue(entry?.meaning);
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
    sourceWord,
    sourceWordDetails = {},
    onKnownWordMarked,
    onKnownWordRemoved,
    onSourceWordAutoSaved,
    onCarouselIndexChange,
}) => {
    const { interfaceLanguage } = useAppContext();
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const { activeOwnerId, syncGeneration } = useLocalOwner();
    const characters = normalizeHanjaCharacters(hanjaCharacters, hanja);
    const charactersKey = characters.join('|');

    const [knownKeys, setKnownKeys] = useState(new Set());
    const [hanjaLookupByCharacter, setHanjaLookupByCharacter] = useState({});
    const [isPreloadingHanja, setIsPreloadingHanja] = useState(false);
    const [visibleCountByChar, setVisibleCountByChar] = useState({});
    const [activeDotIndex, setActiveDotIndex] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const lastReportedIndexRef = useRef(0);

    const cardWidth = containerWidth > 0 ? containerWidth * 0.86 : 0;
    const language = sourceWordDetails?.language ?? 'ko';

    const palette = useMemo(() => ({
        cardBg: colors.readerSurface,
        tileBg: colors.surfaceMuted,
        border: colors.readerBorder,
        divider: colors.readerHairline,
        text: colors.readerBodyInk,
        muted: colors.readerMutedInk,
        secondaryText: colors.textSecondary,
        accent: colors.readerProgressFill,
    }), [colors]);

    useEffect(() => {
        let isCancelled = false;
        const uniqueCharacters = [...new Set(charactersKey.split('|').filter(Boolean))];

        setHanjaLookupByCharacter({});
        setVisibleCountByChar({});
        setActiveDotIndex(0);
        lastReportedIndexRef.current = 0;

        if (uniqueCharacters.length === 0) {
            setIsPreloadingHanja(false);
            return () => { isCancelled = true; };
        }

        setIsPreloadingHanja(true);
        let pendingRequests = uniqueCharacters.length;

        uniqueCharacters.forEach(async (character) => {
            let lookup = EMPTY_HANJA_LOOKUP;

            try {
                lookup = await fetchHanjaRelated(character, { interfaceLanguage });
            } catch (error) {
                console.warn(`[HanjaDetails] preload failed for "${character}":`, error.message);
            }

            if (isCancelled) { return; }

            setHanjaLookupByCharacter((previous) => ({
                ...previous,
                [character]: lookup ?? EMPTY_HANJA_LOOKUP,
            }));

            pendingRequests -= 1;
            if (pendingRequests === 0) {
                setIsPreloadingHanja(false);
            }
        });

        return () => { isCancelled = true; };
    }, [charactersKey, interfaceLanguage]);

    useEffect(() => {
        let isCancelled = false;
        setKnownKeys(new Set());

        if (!sourceWord) {
            return () => { isCancelled = true; };
        }

        getRelatedKnownWords(sourceWord, language, { ownerId: activeOwnerId })
            .then((knownWords) => {
                if (!isCancelled) {
                    setKnownKeys(new Set(knownWords.map(relatedWordKey)));
                }
            })
            .catch((error) => {
                console.warn(`[HanjaDetails] related known words load failed for "${sourceWord}":`, error.message);
            });

        return () => { isCancelled = true; };
    }, [activeOwnerId, language, sourceWord]);

    const showMoreRelatedWords = (char, totalCount) => {
        setVisibleCountByChar((prev) => {
            const currentCount = prev[char] ?? INITIAL_VISIBLE_COUNT;
            return {
                ...prev,
                [char]: Math.min(totalCount, currentCount + RELATED_PAGE_SIZE),
            };
        });
    };

    const handleKnownPress = async (entry, sourceHanjaChar = null) => {
        const key = relatedWordKey(entry);
        const known = knownKeys.has(key);
        const markedAt = new Date().toISOString();
        const knownEntry = {
            korean: entry.korean,
            hanja: entry.hanja,
            meaning: entry.meaning,
            sourceHanja: sourceHanjaChar,
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
            if (known) { next.delete(key); } else { next.add(key); }
            return next;
        });

        if (known) {
            onKnownWordRemoved?.(sourceWord, knownEntry);
        } else {
            onKnownWordMarked?.(sourceWord, knownEntry);
        }

        if (!sourceWord) { return; }

        try {
            const nextKnownWords = known
                ? await removeRelatedKnownWord(sourceWord, knownEntry, language, {
                    ownerId: activeOwnerId,
                    mainHanja: sourceWordDetails?.hanja ?? null,
                    mainDefinition: sourceWordDetails?.definition ?? null,
                })
                : await addRelatedKnownWord(sourceWord, knownEntry, {
                    ownerId: activeOwnerId,
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

            const ownerId = activeOwnerId;
            const generation = syncGeneration;

            supabase.auth.getUser()
                .then(({ data: { user } }) => {
                    if (!user || ownerId !== user.id || !isCurrentSyncGeneration(generation)) {
                        return null;
                    }

                    if (known) {
                        return softDeleteUserRelatedKnownWord({ user, ownerId, generation, relation });
                    }

                    return Promise.all([
                        upsertUserVocabEntry({
                            user, ownerId, generation,
                            entry: {
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
                            },
                        }),
                        upsertUserRelatedKnownWord({ user, ownerId, generation, relation }),
                    ]);
                })
                .catch((syncError) => {
                    console.warn(`[HanjaDetails] cloud sync failed for "${sourceWord}":`, syncError.message);
                });
        } catch (error) {
            console.warn(`[HanjaDetails] known word toggle failed for "${sourceWord}":`, error.message);
        }
    };

    if (characters.length === 0) {
        return null;
    }

    return (
        <View
            style={styles.section}
            onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        >
            {/* Section header: eyebrow + pagination dots */}
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionEyebrow}>ROOT CHARACTERS</Text>
                {characters.length > 1 ? (
                    <View style={styles.dots}>
                        {characters.map((char, i) => (
                            <View
                                key={`${char}-${i}-dot`}
                                style={[styles.dot, i === activeDotIndex && styles.dotActive]}
                            />
                        ))}
                    </View>
                ) : null}
            </View>

            {/* Horizontal carousel — only render once we have a measured width */}
            {containerWidth > 0 ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.carousel}
                    contentContainerStyle={[
                        styles.carouselContent,
                        { paddingRight: containerWidth - cardWidth },
                    ]}
                    decelerationRate="fast"
                    snapToInterval={cardWidth + CARD_GAP}
                    snapToAlignment="start"
                    onMomentumScrollEnd={(e) => {
                        const scrollX = e.nativeEvent.contentOffset.x;
                        const newIndex = Math.round(scrollX / (cardWidth + CARD_GAP));
                        const boundedIndex = Math.min(Math.max(newIndex, 0), characters.length - 1);
                        setActiveDotIndex(boundedIndex);
                        if (boundedIndex !== lastReportedIndexRef.current) {
                            lastReportedIndexRef.current = boundedIndex;
                            onCarouselIndexChange?.(boundedIndex);
                        }
                    }}
                >
                    {characters.map((char, charIndex) => {
                        const lookup = hanjaLookupByCharacter[char];
                        const charTitle = lookup?.firstTableData ?? [];
                        const charResult = lookup?.similarWordsTableData ?? [];
                        const charIsLoading = isPreloadingHanja && !lookup;

                        const readingEntries = charIsLoading ? [] : normalizeReadingEntries(charTitle);
                        const headerEntry = charIsLoading ? {} : (charTitle?.[0] ?? {});
                        const meaningLabels = uniqueValues(
                            readingEntries.map((e) => e.englishMeaning || e.fallbackMeaning)
                        );
                        const meaningText = meaningLabels.length > 0
                            ? meaningLabels.join(' · ')
                            : cleanValue(headerEntry.meaning);
                        const readingParts = readingEntries
                            .map((e) => [e.koreanMeaning, e.reading].filter(Boolean).join(' '))
                            .filter(Boolean);
                        const titleDisplay = readingParts.length > 0
                            ? readingParts.join(' / ')
                            : char;
                        const primaryMeaning = meaningText || titleDisplay;

                        const relatedWords = !charIsLoading && Array.isArray(charResult) ? charResult : [];
                        const visibleCount = visibleCountByChar[char] ?? INITIAL_VISIBLE_COUNT;
                        const visibleWords = relatedWords.slice(0, visibleCount);
                        const hasMore = relatedWords.length > visibleCount;

                        return (
                            <View
                                key={`${char}-${charIndex}`}
                                style={[
                                    styles.card,
                                    {
                                        width: cardWidth,
                                        borderColor: palette.border,
                                        backgroundColor: palette.cardBg,
                                    },
                                ]}
                            >
                                {/* Character tile + meaning */}
                                <View style={styles.cardHeader}>
                                    <View style={[styles.hanjaTile, { backgroundColor: palette.tileBg }]}>
                                        <Text style={[styles.hanjaChar, { color: palette.accent }]}>
                                            {char}
                                        </Text>
                                    </View>
                                    <View style={styles.cardCopy}>
                                        <Text style={styles.cardEyebrow}>MEANING</Text>
                                        {charIsLoading ? (
                                            <View style={styles.shimmerLine} />
                                        ) : (
                                            <Text
                                                style={[styles.cardTitle, { color: palette.text }]}
                                                numberOfLines={1}
                                            >
                                                {primaryMeaning}
                                            </Text>
                                        )}
                                    </View>
                                </View>

                                {/* Divider */}
                                <View style={[styles.cardDivider, { borderColor: palette.divider }]} />

                                {/* Related words section */}
                                <Text style={styles.relatedEyebrow}>RELATED WORDS</Text>

                                {charIsLoading ? (
                                    <View style={styles.loadingRow}>
                                        <ActivityIndicator size="small" color={palette.muted} />
                                    </View>
                                ) : relatedWords.length === 0 ? (
                                    <Text style={[styles.emptyText, { color: palette.muted }]}>
                                        {t('hanja.none')}
                                    </Text>
                                ) : (
                                    <>
                                        {visibleWords.map((word, idx) => {
                                            const wKey = relatedWordKey(word);
                                            const known = knownKeys.has(wKey);

                                            return (
                                                <View key={`${wKey}-${idx}`} style={styles.relatedRow}>
                                                    <View style={styles.relatedInfo}>
                                                        <Text>
                                                            <Text style={[styles.relatedKorean, { color: palette.text }]}>
                                                                {word.korean}
                                                            </Text>
                                                            {word.hanja ? (
                                                                <Text style={[styles.relatedHanja, { color: palette.secondaryText }]}>
                                                                    {' '}{word.hanja}
                                                                </Text>
                                                            ) : null}
                                                        </Text>
                                                        <Text
                                                            style={[styles.relatedMeaning, { color: palette.muted }]}
                                                            numberOfLines={1}
                                                        >
                                                            {word.meaning || t('hanja.meaningUnavailable')}
                                                        </Text>
                                                    </View>

                                                    <TouchableOpacity
                                                        accessibilityRole="button"
                                                        accessibilityLabel={known
                                                            ? t('hanja.markedKnown', { word: word.korean })
                                                            : t('hanja.markKnown', { word: word.korean })}
                                                        activeOpacity={0.82}
                                                        onPress={() => handleKnownPress(word, char)}
                                                        style={[
                                                            styles.circle,
                                                            known ? styles.circleFilled : styles.circleEmpty,
                                                        ]}
                                                    >
                                                        {known ? (
                                                            <MaterialIcons
                                                                name="check"
                                                                size={17}
                                                                color={colors.readerTappedWordText}
                                                            />
                                                        ) : null}
                                                    </TouchableOpacity>
                                                </View>
                                            );
                                        })}

                                        {hasMore ? (
                                            <TouchableOpacity
                                                activeOpacity={0.82}
                                                onPress={() => showMoreRelatedWords(char, relatedWords.length)}
                                                style={styles.seeMoreRow}
                                                accessibilityRole="button"
                                                accessibilityLabel="See more related words"
                                            >
                                                <Text style={[styles.seeMoreText, { color: palette.secondaryText }]}>
                                                    See more
                                                </Text>
                                                <MaterialIcons
                                                    name="keyboard-arrow-down"
                                                    size={15}
                                                    color={palette.secondaryText}
                                                />
                                            </TouchableOpacity>
                                        ) : null}
                                    </>
                                )}
                            </View>
                        );
                    })}
                </ScrollView>
            ) : null}
        </View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    section: {
        marginTop: 18,
        gap: 12,
        paddingHorizontal: 24,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionEyebrow: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 2.2,
        textTransform: 'uppercase',
        color: colors.textTertiary,
    },
    dots: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.dotInactive,
    },
    dotActive: {
        backgroundColor: colors.readerTappedWordBg,
    },
    carousel: {
        marginHorizontal: -24,
    },
    carouselContent: {
        gap: CARD_GAP,
        paddingHorizontal: 24,
        paddingBottom: 2,
    },
    card: {
        borderWidth: 1,
        borderRadius: 4,
        padding: 16,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    hanjaTile: {
        width: 54,
        height: 54,
        flexShrink: 0,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hanjaChar: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 32,
        lineHeight: 39,
    },
    cardCopy: {
        flex: 1,
        minWidth: 0,
    },
    cardEyebrow: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        lineHeight: 12,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        color: colors.textSubtle,
    },
    cardTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 17,
        lineHeight: 22,
        marginTop: 3,
    },
    shimmerLine: {
        height: 16,
        width: '58%',
        borderRadius: 2,
        backgroundColor: colors.surfaceMuted,
        marginTop: 5,
    },
    cardDivider: {
        borderTopWidth: 1,
        marginTop: 14,
        marginBottom: 13,
    },
    relatedEyebrow: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        lineHeight: 12,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        color: colors.textSubtle,
        marginBottom: 2,
    },
    loadingRow: {
        paddingVertical: 14,
        alignItems: 'center',
    },
    emptyText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        fontStyle: 'italic',
        marginTop: 10,
    },
    relatedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 12,
    },
    relatedInfo: {
        flex: 1,
        minWidth: 0,
        gap: 1,
    },
    relatedKorean: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 16,
        lineHeight: 21,
    },
    relatedHanja: {
        fontFamily: fontFamilies.krSerifRegular,
        fontSize: 14,
        lineHeight: 19,
    },
    relatedMeaning: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
    },
    // Circle toggle: two states only — filled (known) and empty (unknown)
    circle: {
        width: 30,
        height: 30,
        borderRadius: 15,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    circleFilled: {
        backgroundColor: colors.readerTappedWordBg,
    },
    circleEmpty: {
        borderWidth: 1.5,
        borderColor: colors.readerBorder,
    },
    seeMoreRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 2,
        marginTop: 13,
    },
    seeMoreText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
    },
});

export default HanjaDetails;
