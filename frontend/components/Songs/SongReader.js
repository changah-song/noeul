import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopSection from '../Read/TopSection/TopSection';
import { getSavedWords } from '../../services/Database';
import { colors, fontFamilies, spacing, textStyles } from '../../theme';

const WORD_EDGE_PATTERN = /^[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+|[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+$/g;
const DEFAULT_LYRIC_FONT_SIZE = 28;
const MIN_LYRIC_FONT_SIZE = 20;
const MAX_LYRIC_FONT_SIZE = 40;
const ACTIVE_TAP_HIGHLIGHT_COLOR = 'rgba(252, 213, 180, 0.33)';
const SAVED_HIGHLIGHT_COLOR = '#f7d488';
const TEXT_SELECTION_HIGHLIGHT_COLOR = '#e3e7ee';

const cleanLyricToken = (value) => String(value || '').replace(WORD_EDGE_PATTERN, '').trim();

const normalizeForMatch = (value) => cleanLyricToken(value).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const countSongLines = (lyrics) => String(lyrics || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;

const uniqueTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

const makeSongDraft = (song) => ({
    title: song?.title || '',
    artist: song?.artist || '',
    lyrics: song?.lyrics || '',
});

const SongReader = ({ song, onClose, onSongUpdate, onSongDelete, onSavedTermsChange }) => {
    const insets = useSafeAreaInsets();
    const [savedWords, setSavedWords] = useState(null);
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [lyricFontSize, setLyricFontSize] = useState(() => clamp(
        Number(song?.fontSize) || DEFAULT_LYRIC_FONT_SIZE,
        MIN_LYRIC_FONT_SIZE,
        MAX_LYRIC_FONT_SIZE
    ));
    const [isEditModalVisible, setIsEditModalVisible] = useState(false);
    const [editDraft, setEditDraft] = useState(() => makeSongDraft(song));

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
        setLyricFontSize(clamp(
            Number(song?.fontSize) || DEFAULT_LYRIC_FONT_SIZE,
            MIN_LYRIC_FONT_SIZE,
            MAX_LYRIC_FONT_SIZE
        ));
        setEditDraft(makeSongDraft(song));
        setIsEditModalVisible(false);
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
        selectWord(word, sourceSentence, false);
    }, [selectWord]);

    const closeLookup = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
    }, []);

    const updateLyricFontSize = useCallback((delta) => {
        setLyricFontSize((currentSize) => {
            const nextSize = clamp(currentSize + delta, MIN_LYRIC_FONT_SIZE, MAX_LYRIC_FONT_SIZE);
            if (nextSize !== currentSize) {
                onSongUpdate?.({ fontSize: nextSize });
            }
            return nextSize;
        });
    }, [onSongUpdate]);

    const openEditModal = useCallback(() => {
        setEditDraft(makeSongDraft(song));
        setIsEditModalVisible(true);
    }, [song]);

    const closeEditModal = useCallback(() => {
        setIsEditModalVisible(false);
        setEditDraft(makeSongDraft(song));
    }, [song]);

    const submitSongEdit = useCallback(() => {
        const title = editDraft.title.trim();
        const artist = editDraft.artist.trim() || 'Unknown artist';
        const lyrics = editDraft.lyrics.trim();

        if (!title || !lyrics) {
            Alert.alert('Missing song details', 'Keep a title and lyrics before saving.');
            return;
        }

        onSongUpdate?.({
            title,
            artist,
            lyrics,
            lines: countSongLines(lyrics),
        });
        setIsEditModalVisible(false);
    }, [editDraft.artist, editDraft.lyrics, editDraft.title, onSongUpdate]);

    const confirmDeleteSong = useCallback(() => {
        Alert.alert(
            'Delete song',
            `Delete "${song?.title || 'Untitled song'}" from your saved songs?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => onSongDelete?.(),
                },
            ]
        );
    }, [onSongDelete, song?.title]);

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

    const renderLyricsText = () => {
        return (
            <Text
                selectable
                selectionColor={TEXT_SELECTION_HIGHLIGHT_COLOR}
                style={[
                    styles.lyricLine,
                    {
                        fontSize: lyricFontSize,
                        lineHeight: Math.round(lyricFontSize * 1.54),
                    },
                ]}
            >
                {lyricLines.map((line, lineIndex) => {
                    const parts = line.split(/(\s+)/);

                    return (
                        <Text key={`line-${lineIndex}`}>
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
                            {lineIndex < lyricLines.length - 1 ? '\n' : ''}
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
                <View style={styles.topActions}>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Decrease lyrics font size"
                        activeOpacity={0.78}
                        onPress={() => updateLyricFontSize(-2)}
                        disabled={lyricFontSize <= MIN_LYRIC_FONT_SIZE}
                        style={[styles.fontButton, lyricFontSize <= MIN_LYRIC_FONT_SIZE && styles.disabledControl]}
                    >
                        <Text style={styles.fontButtonText}>A-</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Increase lyrics font size"
                        activeOpacity={0.78}
                        onPress={() => updateLyricFontSize(2)}
                        disabled={lyricFontSize >= MAX_LYRIC_FONT_SIZE}
                        style={[styles.fontButton, lyricFontSize >= MAX_LYRIC_FONT_SIZE && styles.disabledControl]}
                    >
                        <Text style={styles.fontButtonText}>A+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Edit song lyrics"
                        activeOpacity={0.78}
                        onPress={openEditModal}
                        style={styles.iconButton}
                    >
                        <Feather name="edit-3" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Delete song"
                        activeOpacity={0.78}
                        onPress={confirmDeleteSong}
                        style={styles.iconButton}
                    >
                        <Feather name="trash-2" size={20} color={colors.danger} />
                    </TouchableOpacity>
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
                        {renderLyricsText()}
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

            <Modal visible={isEditModalVisible} animationType="fade" transparent onRequestClose={closeEditModal}>
                <Pressable style={styles.modalBackdrop} onPress={closeEditModal}>
                    <Pressable style={styles.editModal} onPress={() => {}}>
                        <Text style={styles.editTitle}>Edit lyrics</Text>

                        <ScrollView
                            style={styles.editScroll}
                            contentContainerStyle={styles.editScrollContent}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.editLabel}>Title</Text>
                            <TextInput
                                value={editDraft.title}
                                onChangeText={(title) => setEditDraft((previous) => ({ ...previous, title }))}
                                style={styles.editInput}
                                placeholder="Song title"
                                placeholderTextColor={colors.textSubtle}
                            />

                            <Text style={styles.editLabel}>Artist</Text>
                            <TextInput
                                value={editDraft.artist}
                                onChangeText={(artist) => setEditDraft((previous) => ({ ...previous, artist }))}
                                style={styles.editInput}
                                placeholder="Artist"
                                placeholderTextColor={colors.textSubtle}
                            />

                            <Text style={styles.editLabel}>Lyrics</Text>
                            <TextInput
                                value={editDraft.lyrics}
                                onChangeText={(lyrics) => setEditDraft((previous) => ({ ...previous, lyrics }))}
                                style={[styles.editInput, styles.lyricsInput]}
                                placeholder="Paste lyrics here"
                                placeholderTextColor={colors.textSubtle}
                                multiline
                                textAlignVertical="top"
                            />
                        </ScrollView>

                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                activeOpacity={0.84}
                                onPress={closeEditModal}
                                style={[styles.modalButton, styles.modalButtonSecondary]}
                            >
                                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.84}
                                onPress={submitSongEdit}
                                style={[styles.modalButton, styles.modalButtonPrimary]}
                            >
                                <Text style={styles.modalButtonPrimaryText}>Save</Text>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
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
    topActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    fontButton: {
        minWidth: 38,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        backgroundColor: '#f4ede2',
        paddingHorizontal: spacing.xs,
    },
    fontButtonText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        lineHeight: 16,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    disabledControl: {
        opacity: 0.36,
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
        color: colors.text,
        letterSpacing: 0,
        includeFontPadding: true,
    },
    lyricWord: {
        borderRadius: 4,
        overflow: 'hidden',
    },
    activeLyricWord: {
        backgroundColor: ACTIVE_TAP_HIGHLIGHT_COLOR,
    },
    savedLyricWord: {
        backgroundColor: SAVED_HIGHLIGHT_COLOR,
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
    modalBackdrop: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        backgroundColor: 'rgba(37, 32, 24, 0.38)',
    },
    editModal: {
        maxHeight: '84%',
        backgroundColor: colors.surfaceElevated,
        borderRadius: 28,
        padding: spacing.xl,
        gap: spacing.md,
    },
    editTitle: {
        ...textStyles.title,
    },
    editScroll: {
        maxHeight: 460,
    },
    editScrollContent: {
        gap: spacing.sm,
        paddingBottom: spacing.xs,
    },
    editLabel: {
        ...textStyles.eyebrow,
        letterSpacing: 0,
    },
    editInput: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        color: colors.text,
        backgroundColor: colors.surface,
        ...textStyles.body,
    },
    lyricsInput: {
        minHeight: 220,
        lineHeight: 22,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
    modalButton: {
        minWidth: 94,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        paddingHorizontal: spacing.lg,
    },
    modalButtonSecondary: {
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    modalButtonPrimary: {
        backgroundColor: colors.text,
    },
    modalButtonSecondaryText: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    modalButtonPrimaryText: {
        ...textStyles.sectionTitle,
        fontSize: 15,
        color: colors.white,
        letterSpacing: 0,
    },
});

export default SongReader;
