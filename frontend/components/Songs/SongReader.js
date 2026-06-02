import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopSection from '../Read/TopSection/TopSection';
import {
    getSavedVocabForHighlights,
    recordImplicitReadingReview,
    recordVocabEncounterBatch,
} from '../../services/Database';
import { colors, fontFamilies, spacing, textStyles } from '../../theme';

const WORD_EDGE_PATTERN = /^[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+|[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+$/g;

const cleanLyricToken = (value) => String(value || '').replace(WORD_EDGE_PATTERN, '').trim();

const normalizeForMatch = (value) => cleanLyricToken(value).toLowerCase();

const uniqueTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

const styleForHighlightTone = (tone) => {
    switch (tone) {
        case 'strong':
            return styles.savedLyricWordStrong;
        case 'soft':
            return styles.savedLyricWordSoft;
        case 'faint':
            return styles.savedLyricWordFaint;
        case 'normal':
        default:
            return styles.savedLyricWord;
    }
};

const SongReader = ({ song, onClose, onSavedTermsChange }) => {
    const insets = useSafeAreaInsets();
    const [savedWords, setSavedWords] = useState(null);
    const [savedVocabRows, setSavedVocabRows] = useState([]);
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const suppressTapUntilRef = useRef(0);
    const scrollYRef = useRef(0);
    const viewportHeightRef = useRef(0);
    const lineLayoutsRef = useRef(new Map());
    const encounterTimerRef = useRef(null);
    const visibleLineKeysRef = useRef('');
    const recordingEncountersRef = useRef(false);

    const refreshSavedVocabRows = useCallback(async () => {
        const rows = await getSavedVocabForHighlights();
        setSavedVocabRows(rows);
        setSavedWords(rows.map((row) => row.word).filter(Boolean));
        return rows;
    }, []);

    useEffect(() => {
        let isMounted = true;

        getSavedVocabForHighlights()
            .then((rows) => {
                if (isMounted) {
                    setSavedVocabRows(rows);
                    setSavedWords(rows.map((row) => row.word).filter(Boolean));
                }
            })
            .catch((error) => {
                console.error('[SongReader] Failed to load saved vocab rows:', error);
                if (isMounted) {
                    setSavedVocabRows([]);
                    setSavedWords([]);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (encounterTimerRef.current) {
            clearTimeout(encounterTimerRef.current);
            encounterTimerRef.current = null;
        }
        scrollYRef.current = 0;
        viewportHeightRef.current = 0;
        lineLayoutsRef.current.clear();
        visibleLineKeysRef.current = '';
        recordingEncountersRef.current = false;
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setLookupPlacement('bottom');
    }, [song?.id]);

    useEffect(() => () => {
        if (encounterTimerRef.current) {
            clearTimeout(encounterTimerRef.current);
            encounterTimerRef.current = null;
        }
        lineLayoutsRef.current.clear();
        visibleLineKeysRef.current = '';
    }, []);

    const lyricLines = useMemo(() => String(song?.lyrics || '').split(/\r?\n/), [song?.lyrics]);
    const savedVocabByToken = useMemo(() => {
        const map = new Map();

        savedVocabRows.forEach((row) => {
            const key = normalizeForMatch(row.word);
            if (key) {
                map.set(key, row);
            }
        });

        return map;
    }, [savedVocabRows]);
    const optimisticSavedWordSet = useMemo(() => {
        const normalized = [...(savedWords || []), ...(song?.savedTerms || [])]
            .map(normalizeForMatch)
            .filter(Boolean);
        return new Set(normalized);
    }, [savedWords, song?.savedTerms]);
    const selectedWordKey = normalizeForMatch(highlightedWord);
    const sourceBook = useMemo(() => ({
        uri: song?.id ? `song:${song.id}` : null,
        title: song?.title || 'Untitled song',
        author: song?.artist || 'Unknown artist',
    }), [song?.artist, song?.id, song?.title]);
    const songSourceTitle = useMemo(() => {
        const title = song?.title || 'Untitled song';
        const artist = song?.artist || 'Unknown artist';
        return `${title} · ${artist}`;
    }, [song?.artist, song?.title]);

    const getVisibleLineIndices = useCallback(() => {
        const viewportHeight = viewportHeightRef.current;

        if (viewportHeight <= 0) {
            return [];
        }

        const viewportTop = scrollYRef.current;
        const viewportBottom = viewportTop + viewportHeight;

        return Array.from(lineLayoutsRef.current.entries())
            .filter(([, layout]) => {
                const lineTop = layout.y;
                const lineBottom = layout.y + layout.height;
                return lineBottom >= viewportTop && lineTop <= viewportBottom;
            })
            .map(([lineIndex]) => lineIndex)
            .sort((a, b) => a - b);
    }, []);

    const recordVisibleLyricEncounters = useCallback(async () => {
        if (!song?.id || recordingEncountersRef.current) {
            return;
        }

        const visibleLineIndices = getVisibleLineIndices();
        if (visibleLineIndices.length === 0) {
            return;
        }

        const payload = [];
        const seenEncounterKeys = new Set();

        visibleLineIndices.forEach((lineIndex) => {
            const line = lyricLines[lineIndex] || '';
            const locationKey = `line:${lineIndex}`;

            line.split(/\s+/).forEach((token) => {
                const tokenKey = normalizeForMatch(token);
                const vocabRow = savedVocabByToken.get(tokenKey);

                if (!vocabRow || vocabRow.highlightTone === 'hidden') {
                    return;
                }

                const vocabId = Number(vocabRow.id);
                if (!Number.isInteger(vocabId) || vocabId <= 0) {
                    return;
                }

                const encounterKey = `${vocabId}:${locationKey}`;
                if (seenEncounterKeys.has(encounterKey)) {
                    return;
                }

                seenEncounterKeys.add(encounterKey);
                payload.push({
                    vocabId,
                    sourceType: 'song',
                    sourceUri: `song:${song.id}`,
                    sourceTitle: songSourceTitle,
                    locationKey,
                });
            });
        });

        if (payload.length === 0) {
            return;
        }

        recordingEncountersRef.current = true;

        try {
            const result = await recordVocabEncounterBatch(payload);
            const reviewIds = Array.isArray(result?.affectedVocabIds) && result.affectedVocabIds.length > 0
                ? result.affectedVocabIds
                : [...new Set(payload.map((item) => item.vocabId))];

            await Promise.all(reviewIds.map((vocabId) => recordImplicitReadingReview(vocabId)));

            if (result?.insertedCount > 0) {
                await refreshSavedVocabRows();
            }
        } catch (error) {
            console.error('[SongReader] Failed to record lyric encounters:', error);
        } finally {
            recordingEncountersRef.current = false;
        }
    }, [getVisibleLineIndices, lyricLines, refreshSavedVocabRows, savedVocabByToken, song?.id, songSourceTitle]);

    const scheduleVisibleEncounterScan = useCallback(() => {
        const visibleLineIndices = getVisibleLineIndices();
        const visibleLineKey = visibleLineIndices.join(',');
        const hadPendingTimer = !!encounterTimerRef.current;

        if (encounterTimerRef.current) {
            clearTimeout(encounterTimerRef.current);
            encounterTimerRef.current = null;
        }

        if (!visibleLineKey) {
            visibleLineKeysRef.current = '';
            return;
        }

        if (visibleLineKeysRef.current === visibleLineKey && !hadPendingTimer) {
            return;
        }

        visibleLineKeysRef.current = visibleLineKey;
        encounterTimerRef.current = setTimeout(() => {
            encounterTimerRef.current = null;
            recordVisibleLyricEncounters();
        }, 2000);
    }, [getVisibleLineIndices, recordVisibleLyricEncounters]);

    useEffect(() => {
        visibleLineKeysRef.current = '';
        scheduleVisibleEncounterScan();
    }, [savedVocabRows, scheduleVisibleEncounterScan]);

    const savedLyricsCount = useMemo(() => {
        const lyricTerms = new Set();
        lyricLines.forEach((line) => {
            line.split(/\s+/).forEach((token) => {
                const key = normalizeForMatch(token);
                const vocabRow = savedVocabByToken.get(key);
                const isVisibleSavedWord = (
                    (vocabRow && vocabRow.highlightTone !== 'hidden') ||
                    (!vocabRow && optimisticSavedWordSet.has(key))
                );

                if (key && isVisibleSavedWord) {
                    lyricTerms.add(key);
                }
            });
        });
        return lyricTerms.size;
    }, [lyricLines, optimisticSavedWordSet, savedVocabByToken]);

    const selectWord = useCallback((word, sourceSentence, nativeSelection = false) => {
        if (!word) {
            return;
        }

        setHighlightedWord(word);
        setHighlightedWordContext({ sentence: sourceSentence || '' });
        setIsNativeSelection(nativeSelection);
        setLookupPlacement('bottom');
    }, []);

    const handleTokenPress = useCallback((word, sourceSentence) => {
        if (Date.now() < suppressTapUntilRef.current) {
            return;
        }

        selectWord(word, sourceSentence, false);
    }, [selectWord]);

    const handleTokenLongPress = useCallback((word, sourceSentence) => {
        suppressTapUntilRef.current = Date.now() + 650;
        selectWord(word, sourceSentence, true);
    }, [selectWord]);

    const closeLookup = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
    }, []);

    const handleWordSave = useCallback((word, options = {}) => {
        const surface = options.includeSurface === false ? '' : highlightedWord?.trim();
        setSavedWords((previous) => uniqueTerms([...(previous ?? []), word, surface]));
        onSavedTermsChange?.(uniqueTerms([...(song?.savedTerms ?? []), word, surface]));
    }, [highlightedWord, onSavedTermsChange, song?.savedTerms]);

    const handleWordUnsave = useCallback((word, options = {}) => {
        const surface = options.includeSurface === false ? '' : highlightedWord?.trim();
        setSavedWords((previous) => (
            previous ?? []
        ).filter((term) => term !== word && term !== surface));
        setSavedVocabRows((previous) => previous.filter((row) => row.word !== word && row.word !== surface));
        onSavedTermsChange?.((song?.savedTerms ?? []).filter((term) => term !== word && term !== surface));
    }, [highlightedWord, onSavedTermsChange, song?.savedTerms]);

    const handleLineLayout = useCallback((lineIndex, event) => {
        const { y, height } = event.nativeEvent.layout;
        lineLayoutsRef.current.set(lineIndex, { y, height });
        scheduleVisibleEncounterScan();
    }, [scheduleVisibleEncounterScan]);

    const renderLyricLine = (line, lineIndex) => {
        if (!line.trim()) {
            return (
                <View
                    key={`blank-${lineIndex}`}
                    onLayout={(event) => handleLineLayout(lineIndex, event)}
                    style={styles.lyricLineShell}
                >
                    <View style={styles.lyricBlankLine} />
                </View>
            );
        }

        const parts = line.split(/(\s+)/);

        return (
            <View
                key={`${lineIndex}-${line}`}
                onLayout={(event) => handleLineLayout(lineIndex, event)}
                style={styles.lyricLineShell}
            >
                <Text style={styles.lyricLine}>
                    {parts.map((part, partIndex) => {
                        const cleanToken = cleanLyricToken(part);

                        if (!cleanToken) {
                            return <Text key={`${lineIndex}-${partIndex}`}>{part}</Text>;
                        }

                        const tokenKey = normalizeForMatch(cleanToken);
                        const vocabRow = savedVocabByToken.get(tokenKey);
                        const optimisticSaved = !vocabRow && optimisticSavedWordSet.has(tokenKey);
                        const isSaved = (
                            (vocabRow && vocabRow.highlightTone !== 'hidden') ||
                            optimisticSaved
                        );
                        const isActive = selectedWordKey === tokenKey;
                        const highlightTone = vocabRow?.highlightTone || 'strong';

                        return (
                            <Text
                                key={`${lineIndex}-${partIndex}-${cleanToken}`}
                                suppressHighlighting
                                onPress={() => handleTokenPress(cleanToken, line)}
                                onLongPress={() => handleTokenLongPress(cleanToken, line)}
                                style={[
                                    styles.lyricWord,
                                    isSaved && styleForHighlightTone(highlightTone),
                                    isActive && styles.activeLyricWord,
                                ]}
                            >
                                {part}
                            </Text>
                        );
                    })}
                </Text>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Back to songs"
                    activeOpacity={0.78}
                    onPress={onClose}
                    style={styles.iconButton}
                >
                    <Feather name="chevron-left" size={30} color={colors.textMuted} />
                </TouchableOpacity>
                <View style={styles.iconButton}>
                    <Feather name="more-horizontal" size={24} color={colors.textMuted} />
                </View>
            </View>

            <View style={styles.songHeader}>
                <Text
                    style={[
                        styles.songTitle,
                        /[\u3131-\u318e\uac00-\ud7a3]/.test(song?.title || '') && styles.koreanTitle,
                    ]}
                    numberOfLines={2}
                >
                    {song?.title || 'Untitled song'}
                </Text>
                <Text style={styles.songMeta} numberOfLines={1}>
                    {song?.artist || 'Unknown artist'}
                </Text>
                <Text style={styles.savedMeta}>
                    {savedLyricsCount} saved
                </Text>
            </View>

            <View style={styles.divider} />

            <ScrollView
                showsVerticalScrollIndicator={false}
                onLayout={(event) => {
                    viewportHeightRef.current = event.nativeEvent.layout.height;
                    scheduleVisibleEncounterScan();
                }}
                onScroll={(event) => {
                    scrollYRef.current = event.nativeEvent.contentOffset.y;
                    scheduleVisibleEncounterScan();
                }}
                scrollEventThrottle={250}
                contentContainerStyle={[
                    styles.lyricsContent,
                    { paddingBottom: insets.bottom + 152 },
                ]}
            >
                {savedWords === null ? (
                    <View style={styles.loadingState}>
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                        <Text style={styles.loadingText}>Loading saved highlights...</Text>
                    </View>
                ) : (
                    <View style={styles.lyricBlock}>
                        {lyricLines.map(renderLyricLine)}
                    </View>
                )}
            </ScrollView>

            <View
                style={[
                    styles.lookupLayer,
                    lookupPlacement === 'top' ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    lookupPlacement === 'top'
                        ? { paddingTop: insets.top + 72 }
                        : { paddingBottom: insets.bottom + 6 },
                ]}
                pointerEvents="box-none"
            >
                {highlightedWord ? (
                    <Pressable style={styles.lookupDismissZone} onPress={closeLookup} />
                ) : null}

                <TopSection
                    highlightedWord={highlightedWord}
                    sourceSentence={highlightedWordContext?.sentence ?? ''}
                    isNativeSelection={isNativeSelection}
                    isDarkMode={false}
                    onClose={closeLookup}
                    onWordSave={handleWordSave}
                    onWordUnsave={handleWordUnsave}
                    currentBook={null}
                    sourceBook={sourceBook}
                    savedWords={savedWords ?? []}
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f6f1e9',
    },
    topBar: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        backgroundColor: colors.surfaceElevated,
    },
    iconButton: {
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 21,
    },
    songHeader: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.md,
        paddingBottom: spacing.lg,
        backgroundColor: colors.surfaceElevated,
    },
    songTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 32,
        lineHeight: 39,
        color: colors.text,
        letterSpacing: 0,
    },
    koreanTitle: {
        fontFamily: fontFamilies.krSerifBold,
    },
    songMeta: {
        ...textStyles.sectionTitle,
        marginTop: 2,
        fontSize: 17,
        lineHeight: 22,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    savedMeta: {
        ...textStyles.body,
        marginTop: 4,
        fontSize: 14,
        lineHeight: 19,
        color: colors.textSubtle,
    },
    divider: {
        height: 1,
        backgroundColor: '#e2d7c8',
    },
    lyricsContent: {
        flexGrow: 1,
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.xl,
    },
    lyricBlock: {
        width: '100%',
        maxWidth: 520,
        alignItems: 'center',
        gap: spacing.sm,
    },
    lyricLineShell: {
        width: '100%',
        alignItems: 'center',
    },
    lyricLine: {
        width: '100%',
        textAlign: 'center',
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 28,
        lineHeight: 43,
        color: colors.text,
        letterSpacing: 0,
        includeFontPadding: true,
    },
    lyricWord: {
        borderRadius: 4,
        overflow: 'hidden',
    },
    activeLyricWord: {
        backgroundColor: 'rgba(188, 204, 194, 0.38)',
    },
    savedLyricWordStrong: {
        backgroundColor: 'rgba(228, 184, 104, 0.68)',
        color: '#3d3328',
    },
    savedLyricWord: {
        backgroundColor: 'rgba(228, 184, 104, 0.48)',
        color: '#3d3328',
    },
    savedLyricWordSoft: {
        backgroundColor: 'rgba(228, 184, 104, 0.26)',
        color: '#3d3328',
    },
    savedLyricWordFaint: {
        backgroundColor: 'rgba(228, 184, 104, 0.12)',
        color: '#3d3328',
        textDecorationLine: 'underline',
        textDecorationColor: 'rgba(128, 92, 36, 0.34)',
    },
    lyricBlankLine: {
        height: 28,
    },
    loadingState: {
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    loadingText: {
        ...textStyles.bodyMuted,
    },
    lookupLayer: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
    },
    lookupLayerTop: {
        justifyContent: 'flex-start',
    },
    lookupLayerBottom: {
        justifyContent: 'flex-end',
    },
    lookupDismissZone: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'transparent',
    },
});

export default SongReader;
