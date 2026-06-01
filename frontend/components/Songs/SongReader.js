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
import { getSavedWords } from '../../services/Database';
import { colors, fontFamilies, spacing, textStyles } from '../../theme';

const WORD_EDGE_PATTERN = /^[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+|[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+$/g;

const cleanLyricToken = (value) => String(value || '').replace(WORD_EDGE_PATTERN, '').trim();

const normalizeForMatch = (value) => cleanLyricToken(value).toLowerCase();

const uniqueTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

const SongReader = ({ song, onClose, onSavedTermsChange }) => {
    const insets = useSafeAreaInsets();
    const [savedWords, setSavedWords] = useState(null);
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const suppressTapUntilRef = useRef(0);

    useEffect(() => {
        let isMounted = true;

        getSavedWords()
            .then((words) => {
                if (isMounted) {
                    setSavedWords(words);
                }
            })
            .catch((error) => {
                console.error('[SongReader] Failed to load saved words:', error);
                if (isMounted) {
                    setSavedWords([]);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setLookupPlacement('bottom');
    }, [song?.id]);

    const lyricLines = useMemo(() => String(song?.lyrics || '').split(/\r?\n/), [song?.lyrics]);
    const savedWordSet = useMemo(() => {
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

    const savedLyricsCount = useMemo(() => {
        const lyricTerms = new Set();
        lyricLines.forEach((line) => {
            line.split(/\s+/).forEach((token) => {
                const key = normalizeForMatch(token);
                if (key && savedWordSet.has(key)) {
                    lyricTerms.add(key);
                }
            });
        });
        return lyricTerms.size;
    }, [lyricLines, savedWordSet]);

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
        onSavedTermsChange?.((song?.savedTerms ?? []).filter((term) => term !== word && term !== surface));
    }, [highlightedWord, onSavedTermsChange, song?.savedTerms]);

    const renderLyricLine = (line, lineIndex) => {
        if (!line.trim()) {
            return <View key={`blank-${lineIndex}`} style={styles.lyricBlankLine} />;
        }

        const parts = line.split(/(\s+)/);

        return (
            <Text key={`${lineIndex}-${line}`} style={styles.lyricLine}>
                {parts.map((part, partIndex) => {
                    const cleanToken = cleanLyricToken(part);

                    if (!cleanToken) {
                        return <Text key={`${lineIndex}-${partIndex}`}>{part}</Text>;
                    }

                    const tokenKey = normalizeForMatch(cleanToken);
                    const isSaved = savedWordSet.has(tokenKey);
                    const isActive = selectedWordKey === tokenKey;

                    return (
                        <Text
                            key={`${lineIndex}-${partIndex}-${cleanToken}`}
                            suppressHighlighting
                            onPress={() => handleTokenPress(cleanToken, line)}
                            onLongPress={() => handleTokenLongPress(cleanToken, line)}
                            style={[
                                styles.lyricWord,
                                isSaved && styles.savedLyricWord,
                                isActive && styles.activeLyricWord,
                            ]}
                        >
                            {part}
                        </Text>
                    );
                })}
            </Text>
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
    savedLyricWord: {
        backgroundColor: 'rgba(228, 184, 104, 0.48)',
        color: '#3d3328',
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
