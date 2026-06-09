import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopSection from '../Read/TopSection/TopSection';
import NativeEpubReaderView from '../../modules/native-epub-reader/src/NativeEpubReaderView';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { getSavedWords } from '../../services/Database';
import { colors, fontFamilies, spacing, textStyles } from '../../theme';

const WORD_EDGE_PATTERN = /^[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+|[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+$/g;
const DEFAULT_LYRIC_FONT_SIZE = 28;
const MIN_LYRIC_FONT_SIZE = 20;
const MAX_LYRIC_FONT_SIZE = 30;
const SONG_READER_LINE_HEIGHT = 1.54;

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

const splitLyricSegments = (line = '') => {
    const segments = String(line || '').match(/[\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+|[^\u3131-\u318e\uac00-\ud7a3a-zA-Z0-9]+/g);
    return (segments || [String(line || '')]).map((text, index) => ({
        id: `segment-${index}`,
        text,
        isWord: !!normalizeForMatch(text),
    }));
};

const buildLyricLines = (lyrics) => {
    const lines = String(lyrics || '').split(/\r?\n/);
    const sourceLines = lines.length > 0 ? lines : [''];

    return sourceLines.map((line, index) => ({
        id: `song-lyric-line-${index}`,
        text: String(line ?? ''),
        isBlank: !String(line || '').trim(),
        segments: splitLyricSegments(line),
    }));
};

const buildNativeLyricBlocks = (lyricLines) => lyricLines.map((line, index) => {
    const text = line.isBlank ? ' ' : line.text;
    return {
        id: line.id || `song-lyric-line-${index}`,
        type: 'text',
        tag: 'p',
        text,
        styleTokens: {
            textAlign: 'center',
            marginTop: 0,
            marginBottom: line.isBlank ? 18 : 10,
            fontFamily: 'serif',
        },
        spans: [{ text }],
    };
});

const SongReader = ({ song, onClose, onSongUpdate, onSongDelete, onSavedTermsChange }) => {
    const { t } = useTranslation();
    const { activeOwnerId } = useLocalOwner();
    const insets = useSafeAreaInsets();
    const { height: viewportHeight } = useWindowDimensions();
    const [savedWords, setSavedWords] = useState(null);
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    const [lyricFontSize, setLyricFontSize] = useState(() => clamp(
        Number(song?.fontSize) || DEFAULT_LYRIC_FONT_SIZE,
        MIN_LYRIC_FONT_SIZE,
        MAX_LYRIC_FONT_SIZE
    ));
    const [isMenuVisible, setIsMenuVisible] = useState(false);
    const [isEditModalVisible, setIsEditModalVisible] = useState(false);
    const [editDraft, setEditDraft] = useState(() => makeSongDraft(song));

    useEffect(() => {
        let isMounted = true;

        getSavedWords({ ownerId: activeOwnerId })
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
    }, [activeOwnerId]);

    useEffect(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setLookupPlacement('bottom');
        setClearSelectionToken((token) => token + 1);
        setLyricFontSize(clamp(
            Number(song?.fontSize) || DEFAULT_LYRIC_FONT_SIZE,
            MIN_LYRIC_FONT_SIZE,
            MAX_LYRIC_FONT_SIZE
        ));
        setIsMenuVisible(false);
        setEditDraft(makeSongDraft(song));
        setIsEditModalVisible(false);
    }, [song?.id]);

    const lyricLines = useMemo(() => buildLyricLines(song?.lyrics), [song?.lyrics]);
    const songHighlightTerms = useMemo(() => uniqueTerms([
        ...(savedWords || []),
        ...(song?.savedTerms || []),
    ]), [savedWords, song?.savedTerms]);
    const songHighlightSet = useMemo(() => new Set(
        songHighlightTerms.map(normalizeForMatch).filter(Boolean)
    ), [songHighlightTerms]);
    const sourceBook = useMemo(() => ({
        uri: song?.id ? `song:${song.id}` : null,
        title: song?.title || t('song.untitled'),
        author: song?.artist || t('common.unknownArtist'),
        language: 'ko',
    }), [song?.artist, song?.id, song?.title, t]);
    const nativeSongManifest = useMemo(() => ({
        sourceUri: song?.id ? `song:${song.id}` : 'song:unknown',
        currentSpineIndex: 0,
        currentSpineHref: 'lyrics',
        currentSpinePath: 'lyrics',
        renderMode: 'continuous',
    }), [song?.id]);
    const nativeLyricBlocks = useMemo(() => buildNativeLyricBlocks(lyricLines), [lyricLines]);

    const savedLyricsCount = useMemo(() => {
        const lyricTokens = new Set(
            String(song?.lyrics || '')
                .split(/\s+/)
                .map(normalizeForMatch)
                .filter(Boolean)
        );
        return songHighlightTerms.filter((term) => lyricTokens.has(normalizeForMatch(term))).length;
    }, [song?.lyrics, songHighlightTerms]);

    const closeLookup = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((token) => token + 1);
    }, []);

    const lookupPlacementForEvent = useCallback((event = {}) => {
        const pageY = Number(event?.nativeEvent?.pageY);
        return Number.isFinite(pageY) && pageY > viewportHeight * 0.56 ? 'top' : 'bottom';
    }, [viewportHeight]);

    const handleLyricWordPress = useCallback((word, line, event = {}) => {
        const text = cleanLyricToken(word);
        if (!text) {
            return;
        }

        setHighlightedWord(text);
        setHighlightedWordContext({
            sentence: String(line || '').trim(),
        });
        setIsNativeSelection(false);
        setLookupPlacement(lookupPlacementForEvent(event));
    }, [lookupPlacementForEvent]);

    const handleNativeWordSelected = useCallback((event = {}) => {
        const text = cleanLyricToken(event.text);
        if (!text) {
            return;
        }

        setHighlightedWord(text);
        setHighlightedWordContext({
            sentence: String(event.sentence || '').trim(),
        });
        setIsNativeSelection(false);
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');
    }, []);

    const handleNativeTextSelected = useCallback((event = {}) => {
        const text = String(event.text || '').trim();
        if (!text) {
            return;
        }

        setHighlightedWord(text);
        setHighlightedWordContext(null);
        setIsNativeSelection(true);
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');
    }, []);

    const updateLyricFontSize = useCallback((delta) => {
        const nextSize = clamp(lyricFontSize + delta, MIN_LYRIC_FONT_SIZE, MAX_LYRIC_FONT_SIZE);
        if (nextSize === lyricFontSize) {
            return;
        }

        setLyricFontSize(nextSize);
        onSongUpdate?.({ fontSize: nextSize });
    }, [lyricFontSize, onSongUpdate]);

    const openEditModal = useCallback(() => {
        setIsMenuVisible(false);
        setEditDraft(makeSongDraft(song));
        setIsEditModalVisible(true);
    }, [song]);

    const closeEditModal = useCallback(() => {
        setIsEditModalVisible(false);
        setEditDraft(makeSongDraft(song));
    }, [song]);

    const submitSongEdit = useCallback(() => {
        const title = editDraft.title.trim();
        const artist = editDraft.artist.trim() || t('common.unknownArtist');
        const lyrics = editDraft.lyrics.trim();

        if (!title || !lyrics) {
            Alert.alert(t('song.missingDetailsTitle'), t('song.missingDetailsBody'));
            return;
        }

        onSongUpdate?.({
            title,
            artist,
            lyrics,
            lines: countSongLines(lyrics),
        });
        setIsEditModalVisible(false);
    }, [editDraft.artist, editDraft.lyrics, editDraft.title, onSongUpdate, t]);

    const confirmDeleteSong = useCallback(() => {
        setIsMenuVisible(false);
        Alert.alert(
            t('song.deleteTitle'),
            t('song.deleteBody', { title: song?.title || t('song.untitled') }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => onSongDelete?.(),
                },
            ]
        );
    }, [onSongDelete, song?.title, t]);

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
    const useNativeLyricReader = Platform.OS === 'android';

    return (
        <View style={styles.container}>
            <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('song.back')}
                    activeOpacity={0.78}
                    onPress={onClose}
                    style={styles.iconButton}
                >
                    <Feather name="chevron-left" size={30} color={colors.textMuted} />
                </TouchableOpacity>
                <Text
                    style={[
                        styles.topSongTitle,
                        /[\u3131-\u318e\uac00-\ud7a3]/.test(song?.title || '') && styles.koreanTitle,
                    ]}
                    numberOfLines={1}
                >
                    {song?.title || t('song.untitled')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('song.options')}
                    activeOpacity={0.78}
                    onPress={() => setIsMenuVisible((visible) => !visible)}
                    style={styles.iconButton}
                >
                    <Feather name="more-horizontal" size={24} color={colors.textMuted} />
                </TouchableOpacity>
            </View>

            <View style={styles.songMetaRow}>
                <Text style={styles.songArtist} numberOfLines={1}>
                    {song?.artist || t('common.unknownArtist')}
                </Text>
                <Text style={styles.savedMeta} numberOfLines={1}>
                    {t('song.wordsSaved', {
                        count: savedLyricsCount,
                        noun: savedLyricsCount === 1 ? t('song.wordSingular') : t('song.wordPlural'),
                    })}
                </Text>
            </View>

            <View style={styles.divider} />

            {isMenuVisible ? (
                <Pressable
                    style={styles.menuDismissLayer}
                    onPress={() => setIsMenuVisible(false)}
                >
                    <Pressable
                        style={[styles.songMenu, { top: insets.top + 54 }]}
                        onPress={() => {}}
                    >
                        <View style={styles.menuFontRow}>
                            <Text style={styles.menuLabel}>{t('song.fontSize')}</Text>
                            <View style={styles.menuFontControls}>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={t('song.decreaseFont')}
                                    activeOpacity={0.78}
                                    onPress={() => updateLyricFontSize(-2)}
                                    disabled={lyricFontSize <= MIN_LYRIC_FONT_SIZE}
                                    style={[
                                        styles.menuFontButton,
                                        lyricFontSize <= MIN_LYRIC_FONT_SIZE && styles.disabledControl,
                                    ]}
                                >
                                    <Text style={styles.menuFontButtonText}>A-</Text>
                                </TouchableOpacity>
                                <Text style={styles.menuFontValue}>{lyricFontSize}</Text>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={t('song.increaseFont')}
                                    activeOpacity={0.78}
                                    onPress={() => updateLyricFontSize(2)}
                                    disabled={lyricFontSize >= MAX_LYRIC_FONT_SIZE}
                                    style={[
                                        styles.menuFontButton,
                                        lyricFontSize >= MAX_LYRIC_FONT_SIZE && styles.disabledControl,
                                    ]}
                                >
                                    <Text style={styles.menuFontButtonText}>A+</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            onPress={openEditModal}
                            style={styles.menuActionRow}
                        >
                            <Feather name="edit-3" size={18} color={colors.textMuted} />
                            <Text style={styles.menuActionText}>{t('common.edit')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.82}
                            onPress={confirmDeleteSong}
                            style={styles.menuActionRow}
                        >
                            <Feather name="trash-2" size={18} color={colors.danger} />
                            <Text style={[styles.menuActionText, styles.menuDangerText]}>{t('common.delete')}</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            ) : null}

            <View style={styles.readerSurface}>
                {useNativeLyricReader ? (
                    <NativeEpubReaderView
                        style={styles.nativeLyricReader}
                        bookManifest={nativeSongManifest}
                        chapterBlocks={nativeLyricBlocks}
                        chapterResources={[]}
                        chapterWindow={[]}
                        restorePosition={{ spineIndex: 0, pageIndex: 0 }}
                        renderMode="continuous"
                        fontSize={lyricFontSize}
                        lineHeight={SONG_READER_LINE_HEIGHT}
                        theme="light"
                        highlightTerms={songHighlightTerms}
                        clearSelectionToken={clearSelectionToken}
                        onWordSelected={handleNativeWordSelected}
                        onTextSelected={handleNativeTextSelected}
                        onSelectionCleared={closeLookup}
                    />
                ) : (
                    <ScrollView
                        style={styles.lyricsScroll}
                        contentContainerStyle={[
                            styles.lyricsContent,
                            { paddingBottom: insets.bottom + 190 },
                        ]}
                        showsVerticalScrollIndicator={false}
                        scrollEventThrottle={16}
                        onScroll={highlightedWord ? closeLookup : undefined}
                        onTouchStart={highlightedWord ? closeLookup : undefined}
                    >
                        {lyricLines.map((line) => (
                            <Text
                                key={line.id}
                                selectable
                                style={[
                                    styles.lyricLine,
                                    {
                                        fontSize: lyricFontSize,
                                        lineHeight: lyricFontSize * SONG_READER_LINE_HEIGHT,
                                    },
                                    line.isBlank && styles.lyricLineBlank,
                                ]}
                            >
                                {line.isBlank ? ' ' : line.segments.map((segment) => {
                                    const normalized = normalizeForMatch(segment.text);
                                    const isSaved = segment.isWord && songHighlightSet.has(normalized);
                                    const isActive = segment.isWord
                                        && normalized
                                        && normalizeForMatch(highlightedWord) === normalized
                                        && !isNativeSelection;

                                    return (
                                        <Text
                                            key={segment.id}
                                            suppressHighlighting
                                            onPress={segment.isWord
                                                ? (event) => handleLyricWordPress(segment.text, line.text, event)
                                                : undefined}
                                            style={[
                                                segment.isWord && styles.lyricWord,
                                                isSaved && styles.savedLyricWord,
                                                isActive && styles.activeLyricWord,
                                            ]}
                                        >
                                            {segment.text}
                                        </Text>
                                    );
                                })}
                            </Text>
                        ))}
                    </ScrollView>
                )}
            </View>

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
                        <Text style={styles.editTitle}>{t('song.editLyrics')}</Text>

                        <ScrollView
                            style={styles.editScroll}
                            contentContainerStyle={styles.editScrollContent}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.editLabel}>{t('common.title')}</Text>
                            <TextInput
                                value={editDraft.title}
                                onChangeText={(title) => setEditDraft((previous) => ({ ...previous, title }))}
                                style={styles.editInput}
                                placeholder={t('home.songTitlePlaceholder')}
                                placeholderTextColor={colors.textSubtle}
                            />

                            <Text style={styles.editLabel}>{t('common.artist')}</Text>
                            <TextInput
                                value={editDraft.artist}
                                onChangeText={(artist) => setEditDraft((previous) => ({ ...previous, artist }))}
                                style={styles.editInput}
                                placeholder={t('common.artist')}
                                placeholderTextColor={colors.textSubtle}
                            />

                            <Text style={styles.editLabel}>{t('common.lyrics')}</Text>
                            <TextInput
                                value={editDraft.lyrics}
                                onChangeText={(lyrics) => setEditDraft((previous) => ({ ...previous, lyrics }))}
                                style={[styles.editInput, styles.lyricsInput]}
                                placeholder={t('home.pasteLyrics')}
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
                                <Text style={styles.modalButtonSecondaryText}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.84}
                                onPress={submitSongEdit}
                                style={[styles.modalButton, styles.modalButtonPrimary]}
                            >
                                <Text style={styles.modalButtonPrimaryText}>{t('common.save')}</Text>
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
    disabledControl: {
        opacity: 0.36,
    },
    topSongTitle: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.serifBold,
        fontSize: 20,
        lineHeight: 25,
        color: colors.text,
        letterSpacing: 0,
    },
    koreanTitle: {
        fontFamily: fontFamilies.krSerifBold,
    },
    songMetaRow: {
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
        paddingBottom: spacing.sm,
        backgroundColor: colors.surfaceElevated,
    },
    songArtist: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    savedMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 17,
        color: colors.textSubtle,
    },
    menuDismissLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 20,
    },
    songMenu: {
        position: 'absolute',
        right: spacing.md,
        width: 236,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e4d8c8',
        backgroundColor: colors.surfaceElevated,
        paddingVertical: spacing.xs,
        shadowColor: 'rgba(37, 32, 24, 0.2)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 22,
        elevation: 8,
    },
    menuFontRow: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: '#eee4d7',
    },
    menuLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 15,
        color: colors.textSubtle,
        letterSpacing: 0,
    },
    menuFontControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    menuFontButton: {
        width: 42,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 17,
        backgroundColor: '#f4ede2',
    },
    menuFontButtonText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        lineHeight: 16,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    menuFontValue: {
        minWidth: 34,
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        lineHeight: 16,
        textAlign: 'center',
        color: colors.textMuted,
        fontVariant: ['tabular-nums'],
    },
    menuActionRow: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    menuActionText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        color: colors.textMuted,
        letterSpacing: 0,
    },
    menuDangerText: {
        color: colors.danger,
    },
    divider: {
        height: 1,
        backgroundColor: '#e2d7c8',
    },
    readerSurface: {
        flex: 1,
        backgroundColor: '#f6f1e9',
    },
    nativeLyricReader: {
        flex: 1,
        backgroundColor: '#f6f1e9',
    },
    lyricsScroll: {
        flex: 1,
        backgroundColor: '#f6f1e9',
    },
    lyricsContent: {
        paddingTop: spacing.xl,
        paddingHorizontal: spacing.xl,
        alignItems: 'center',
    },
    lyricLine: {
        width: '100%',
        marginBottom: 10,
        fontFamily: fontFamilies.krSerifRegular,
        color: colors.text,
        textAlign: 'center',
        letterSpacing: 0,
    },
    lyricLineBlank: {
        marginBottom: 18,
    },
    lyricWord: {
        color: colors.text,
    },
    savedLyricWord: {
        color: colors.accentStrong,
        backgroundColor: 'rgba(184, 85, 46, 0.13)',
    },
    activeLyricWord: {
        color: colors.accentStrong,
        backgroundColor: 'rgba(252, 213, 180, 0.55)',
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
