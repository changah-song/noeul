import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    BackHandler,
    Easing,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopSection from '../Read/TopSection/TopSection';
import FocusControls from '../Read/FocusControls';
import SavedWordsPanel from '../Read/SavedWordsPanel';
import ReaderSettingsSheet from '../Read/ReaderSettingsSheet';
import {
    ReaderFocusModeButton,
    ReaderHeaderBar,
    ReaderMenuButton,
    ReaderSavedWordsButton,
} from '../Read/ReaderHeaderBar';
import { createReaderChromeStyles } from '../Read/readerChromeStyles';
import NativeEpubReaderView from '../../modules/native-epub-reader/src/NativeEpubReaderView';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import useReaderLookup from '../../hooks/useReaderLookup';
import useLevelUnderlineTerms from '../../hooks/useLevelUnderlineTerms';
import useFocusNavigation from '../../hooks/useFocusNavigation';
import {
    applyExposureBatch,
    getBookSavedWords,
    getBookWordCandidates,
    getSavedWords,
    lookupBookHighlightSurfaces,
    recordVocabContextForSurface,
} from '../../services/Database';
import { ensureSongPreprocessed, getSongBookUri } from '../../services/songPreprocess';
import { tapCommit, tapUndo } from '../../services/haptics';
import { requestUserDataSync } from '../../services/userDataSyncQueue';
import { deriveCandidateReason, pickExampleSentence } from '../../services/wordCandidates';
import { saveWordCandidate } from '../../services/saveWordCandidate';
import { selectExposureCredits } from '../../services/readerExposure';
import { lookupLayerPlacement } from '../../services/readerSelection';
import {
    DEFAULT_SONG_READER_SETTINGS,
    brightnessOverlay,
    normalizeReaderSettings,
} from '../../services/readerSettings';
import { normalizeBookLanguage } from '../../constants/languages';
import { createNativeReaderThemeTokens, fontFamilies, spacing, textStyles, useTheme } from '../../theme';

// Song reader settings are kept apart from the book reader's (`readerSettings`)
// because Read.js holds those in memory and would overwrite changes made here.
const SONG_READER_SETTINGS_KEY = 'songReaderSettings';
const SONG_RESTORE_POSITION = { spineIndex: 0, pageIndex: 0 };
// Stable empty reference so toggling underlines off doesn't churn native.
const EMPTY_LEVEL_TERMS = [];
// Lyrics have no read-fade or word-translation support yet, and pinyin has no
// scope choice: the sheet shows only the rows the song reader acts on.
const SONG_SHEET_FEATURES = { fadeReadMarks: false, glossAnnotations: false, annotationScope: false };

// Word characters we treat as tappable/lookup-able across supported targets:
// Hangul (jamo + syllables), Latin letters, digits, and CJK ideographs
// (incl. Extension A and the compatibility block) for Chinese.
const CJK_IDEOGRAPHS = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
const WORD_CHARS = `\\u3131-\\u318e\\uac00-\\ud7a3a-zA-Z0-9${CJK_IDEOGRAPHS}`;
const WORD_EDGE_PATTERN = new RegExp(`^[^${WORD_CHARS}]+|[^${WORD_CHARS}]+$`, 'g');

const cleanLyricToken = (value) => String(value || '').replace(WORD_EDGE_PATTERN, '').trim();
const normalizeForMatch = (value) => cleanLyricToken(value).toLowerCase();
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

// CJK ideographs are emitted one-per-segment (Chinese lyrics rarely use spaces,
// so a whole run in one tappable token would select the entire line); Hangul,
// Latin, and digit runs stay grouped. On Android the native reader handles word
// selection, so this JS path only runs on iOS.
const LYRIC_SEGMENT_PATTERN = new RegExp(
    `[${CJK_IDEOGRAPHS}]|[\\u3131-\\u318e\\uac00-\\ud7a3a-zA-Z0-9]+|[^${WORD_CHARS}]+`,
    'g'
);

const splitLyricSegments = (line = '') => {
    const segments = String(line || '').match(LYRIC_SEGMENT_PATTERN);
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
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const chrome = useMemo(() => createReaderChromeStyles(colors), [colors]);
    const { targetLanguage, chineseScript, interfaceLanguage, isDarkMode } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const insets = useSafeAreaInsets();
    const songLanguage = normalizeBookLanguage(targetLanguage);
    const songUri = getSongBookUri(song?.id);

    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    const [highlightSurfaces, setHighlightSurfaces] = useState([]);
    const [optimisticHighlightTerms, setOptimisticHighlightTerms] = useState([]);
    const [songSavedWords, setSongSavedWords] = useState([]);
    // Bumped when the lyrics finish indexing into book_index, so the level
    // underlines and saved-word surfaces (which read book_index) reload.
    const [indexVersion, setIndexVersion] = useState(0);
    const [settings, setSettings] = useState(() => normalizeReaderSettings(null, DEFAULT_SONG_READER_SETTINGS));
    const [focusMode, setFocusMode] = useState(false);
    const [lookupPanelHeight, setLookupPanelHeight] = useState(0);
    const [isMenuVisible, setIsMenuVisible] = useState(false);
    const [isEditModalVisible, setIsEditModalVisible] = useState(false);
    const [editDraft, setEditDraft] = useState(() => makeSongDraft(song));
    const [showSavedPanel, setShowSavedPanel] = useState(false);
    const [panelCandidates, setPanelCandidates] = useState([]);
    const [panelCandidatesLoading, setPanelCandidatesLoading] = useState(false);
    const [panelSavedStems, setPanelSavedStems] = useState(() => new Set());

    const nativeReaderViewRef = useRef(null);
    // Surfaces looked up since the last exposure unit closed; a lookup is its
    // own (negative) evidence so those words must not also be credited.
    const recentLookupsRef = useRef(new Set());
    const savedSurfacesRef = useRef(new Set());
    const levelWeightsRef = useRef(new Map());
    const levelStemsRef = useRef(new Map());
    const focusControlsTranslate = useRef(new Animated.Value(0)).current;

    // ── Lookup panel (shared with the book reader) ───────────────────────────
    const handleWordLookup = useCallback(({ text, sentence }) => {
        recentLookupsRef.current.add(text);
        recordVocabContextForSurface({
            ownerId: activeOwnerId,
            surface: text,
            sentence,
            sourceBookUri: songUri,
            sourceBookTitle: song?.title ?? null,
            language: songLanguage,
        }).then((context) => {
            if (context) {
                requestUserDataSync('reader-selected-vocab-context');
            }
        }).catch((error) => {
            console.warn('[SongReader] Failed to record vocab context:', error?.message ?? error);
        });
    }, [activeOwnerId, song?.title, songLanguage, songUri]);

    const {
        highlightedWord,
        highlightedWordContext,
        isNativeSelection,
        lookupPlacement,
        clearSelectionToken,
        dismissLookup,
        clearNativeSelection,
        handleNativeWordSelected,
        handleNativeTextSelected,
        handleNativeSelectionCleared,
    } = useReaderLookup({ onWordLookup: handleWordLookup, cleanText: cleanLyricToken });

    const {
        focusNavToken,
        subscribeFocusInfo,
        handleFocusSentenceChange,
        sendFocusNav,
        resetFocusNavigation,
    } = useFocusNavigation(nativeReaderViewRef);

    // ── Settings (persisted per device, separate from book settings) ─────────
    useEffect(() => {
        let isMounted = true;
        AsyncStorage.getItem(SONG_READER_SETTINGS_KEY)
            .then((stored) => {
                if (!isMounted || !stored) {
                    return;
                }
                setSettings(normalizeReaderSettings(JSON.parse(stored), DEFAULT_SONG_READER_SETTINGS));
            })
            .catch((error) => {
                console.warn('[SongReader] Failed to load reader settings:', error?.message ?? error);
            });
        return () => {
            isMounted = false;
        };
    }, []);

    const updateSettings = useCallback((patch) => {
        // Like the book reader, any settings change closes the lookup panel
        // (the layout it was anchored to is about to change).
        dismissLookup();
        setSettings((current) => {
            const next = normalizeReaderSettings({ ...current, ...patch }, DEFAULT_SONG_READER_SETTINGS);
            AsyncStorage.setItem(SONG_READER_SETTINGS_KEY, JSON.stringify(next)).catch((error) => {
                console.warn('[SongReader] Failed to save reader settings:', error?.message ?? error);
            });
            return next;
        });
    }, [dismissLookup]);

    const handleSettingChange = useCallback((key, value) => {
        updateSettings({ [key]: value });
    }, [updateSettings]);

    const resetSongSettings = useCallback(() => {
        updateSettings({
            fontSize: DEFAULT_SONG_READER_SETTINGS.fontSize,
            lineSpacing: DEFAULT_SONG_READER_SETTINGS.lineSpacing,
            brightness: DEFAULT_SONG_READER_SETTINGS.brightness,
            readingMode: DEFAULT_SONG_READER_SETTINGS.readingMode,
            levelMarkStyle: DEFAULT_SONG_READER_SETTINGS.levelMarkStyle,
        });
    }, [updateSettings]);

    const resetSongWordSettings = useCallback(() => {
        updateSettings({
            levelMarkStyle: DEFAULT_SONG_READER_SETTINGS.levelMarkStyle,
            pinyinAnnotations: DEFAULT_SONG_READER_SETTINGS.pinyinAnnotations,
        });
    }, [updateSettings]);

    const resetFocusSettings = useCallback(() => {
        updateSettings({
            focusSwipe: DEFAULT_SONG_READER_SETTINGS.focusSwipe,
            focusSpan: DEFAULT_SONG_READER_SETTINGS.focusSpan,
        });
    }, [updateSettings]);

    // ── Saved words + highlight surfaces ─────────────────────────────────────
    useEffect(() => {
        let isMounted = true;
        getSavedWords({ ownerId: activeOwnerId, language: songLanguage })
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
    }, [activeOwnerId, songLanguage]);

    // Expand saved lemmas into the inflected surfaces that actually appear in
    // the lyrics (book_index), as the book reader does.
    useEffect(() => {
        if (!songUri || !savedWords || savedWords.length === 0) {
            setHighlightSurfaces([]);
            return undefined;
        }
        let isActive = true;
        lookupBookHighlightSurfaces(activeOwnerId, songUri, savedWords, {
            language: songLanguage,
            interfaceLanguage,
        }).then((rows) => {
            if (isActive) {
                setHighlightSurfaces(rows.map((row) => row.surface).filter(Boolean));
            }
        }).catch((error) => {
            console.warn('[SongReader] Failed to load highlight surfaces:', error?.message ?? error);
            if (isActive) {
                setHighlightSurfaces([]);
            }
        });
        return () => {
            isActive = false;
        };
    }, [activeOwnerId, indexVersion, interfaceLanguage, savedWords, songLanguage, songUri]);

    // Words saved from *this* song — drives the header count badge and the
    // saved-words panel.
    const refreshSongSavedWords = useCallback(async () => {
        if (!songUri) {
            setSongSavedWords([]);
            return;
        }
        try {
            const rows = await getBookSavedWords({
                ownerId: activeOwnerId,
                language: songLanguage,
                bookUri: songUri,
            });
            setSongSavedWords(rows);
        } catch (error) {
            console.warn('[SongReader] Failed to load song saved words:', error?.message ?? error);
        }
    }, [activeOwnerId, songLanguage, songUri]);

    useEffect(() => {
        refreshSongSavedWords();
    }, [refreshSongSavedWords]);

    // Preprocess the lyrics once (per content + interface language + script) so
    // word taps resolve against the local book index, and so level underlines
    // have graded surfaces to draw. Until it finishes, taps still work via the
    // live lookup fallback in DictionaryContent.
    useEffect(() => {
        if (!song?.id || !song?.lyrics) {
            return undefined;
        }
        let isActive = true;
        ensureSongPreprocessed({
            song,
            ownerId: activeOwnerId,
            interfaceLanguage,
            targetLanguage,
            script: targetLanguage === 'zh' ? chineseScript : undefined,
        }).then(() => {
            if (isActive) {
                setIndexVersion((value) => value + 1);
            }
        }).catch((error) => {
            console.warn('[SongReader] Failed to preprocess song lyrics:', error?.message ?? error);
        });
        return () => {
            isActive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [song?.id, song?.lyrics, activeOwnerId, interfaceLanguage, targetLanguage, chineseScript]);

    const levelUnderlineTerms = useLevelUnderlineTerms({
        ownerId: activeOwnerId,
        bookUri: songUri,
        language: songLanguage,
        refreshKey: indexVersion,
    });

    useEffect(() => {
        dismissLookup();
        setOptimisticHighlightTerms([]);
        setIsMenuVisible(false);
        setShowSavedPanel(false);
        setEditDraft(makeSongDraft(song));
        setIsEditModalVisible(false);
        resetFocusNavigation();
        recentLookupsRef.current = new Set();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [song?.id]);

    const lyricLines = useMemo(() => buildLyricLines(song?.lyrics), [song?.lyrics]);
    const readerHighlightTerms = useMemo(() => uniqueTerms([
        ...(savedWords || []),
        ...highlightSurfaces,
        ...(song?.savedTerms || []),
        ...optimisticHighlightTerms,
    ]), [highlightSurfaces, optimisticHighlightTerms, savedWords, song?.savedTerms]);
    savedSurfacesRef.current = useMemo(() => new Set(readerHighlightTerms), [readerHighlightTerms]);
    levelWeightsRef.current = useMemo(
        () => new Map(levelUnderlineTerms.map(({ text, weight }) => [text, weight])),
        [levelUnderlineTerms]
    );
    levelStemsRef.current = useMemo(
        () => new Map(levelUnderlineTerms.filter((term) => term.stem).map(({ text, stem }) => [text, stem])),
        [levelUnderlineTerms]
    );
    const songHighlightSet = useMemo(() => new Set(
        readerHighlightTerms.map(normalizeForMatch).filter(Boolean)
    ), [readerHighlightTerms]);

    const sourceBook = useMemo(() => ({
        uri: songUri,
        title: song?.title || t('song.untitled'),
        author: song?.artist || t('common.unknownArtist'),
        language: songLanguage,
    }), [song?.artist, song?.title, songLanguage, songUri, t]);

    const isScrollMode = settings.readingMode === 'scroll';
    const nativeRenderMode = focusMode ? 'focus' : (isScrollMode ? 'continuous' : 'paged');
    const nativeSongManifest = useMemo(() => ({
        sourceUri: songUri || 'song:unknown',
        currentSpineIndex: 0,
        currentSpineHref: 'lyrics',
        currentSpinePath: 'lyrics',
        renderMode: nativeRenderMode,
        readerEdgeStateEnabled: false,
    }), [nativeRenderMode, songUri]);
    const nativeLyricBlocks = useMemo(() => buildNativeLyricBlocks(lyricLines), [lyricLines]);
    const nativeReaderThemeTokens = useMemo(() => createNativeReaderThemeTokens(colors), [colors]);

    const levelMarksEnabled = settings.levelMarkStyle !== 'off';
    // Pinyin only draws while level marks are on, so the row hides with them.
    const songSheetFeatures = useMemo(
        () => ({ ...SONG_SHEET_FEATURES, pinyinAnnotations: levelMarksEnabled }),
        [levelMarksEnabled]
    );
    const readerLevelTerms = levelMarksEnabled ? levelUnderlineTerms : EMPTY_LEVEL_TERMS;
    const readerShowPinyin = songLanguage === 'zh' && settings.pinyinAnnotations && levelMarksEnabled;
    const overlay = brightnessOverlay(settings.brightness);

    // ── Exposure crediting (same rules as the book reader) ───────────────────
    const handleNativeExposure = useCallback(({ terms, chars, dwellMs } = {}) => {
        const lookedUp = recentLookupsRef.current;
        recentLookupsRef.current = new Set();
        if (!songUri) {
            return;
        }
        const skipped = selectExposureCredits({
            terms,
            chars,
            dwellMs,
            lookedUp,
            saved: savedSurfacesRef.current,
            weights: levelWeightsRef.current,
        });
        if (skipped.length === 0) {
            return;
        }
        applyExposureBatch({
            ownerId: activeOwnerId,
            language: songLanguage,
            // Credit the dictionary form, as the reader does.
            stems: skipped.map((surface) => levelStemsRef.current.get(surface) || surface),
            sourceBookUri: songUri,
            dwellSeconds: Number(dwellMs) / 1000,
        }).catch((error) => {
            console.warn('[SongReader] Failed to apply exposure batch:', error);
        });
    }, [activeOwnerId, songLanguage, songUri]);

    // ── Focus mode ───────────────────────────────────────────────────────────
    const toggleFocusMode = useCallback(() => {
        setIsMenuVisible(false);
        dismissLookup();
        setFocusMode((current) => !current);
    }, [dismissLookup]);

    const focusPanelOpen = focusMode && !!highlightedWord;
    const focusPanelTotalHeight = focusPanelOpen ? Math.max(0, Math.round(lookupPanelHeight)) : 0;
    const focusControlsBaseBottom = insets.bottom + 28;
    const focusPillTop = insets.top + spacing.xs + 52 + 12;
    const focusControlsLiftTarget = focusPanelOpen
        ? Math.max(0, focusPanelTotalHeight + 12 - focusControlsBaseBottom)
        : 0;

    useEffect(() => {
        Animated.timing(focusControlsTranslate, {
            toValue: -focusControlsLiftTarget,
            duration: 450,
            easing: Easing.bezier(0.22, 0.61, 0.36, 1),
            useNativeDriver: true,
        }).start();
    }, [focusControlsLiftTarget, focusControlsTranslate]);

    // ── Save / unsave from the lookup panel ──────────────────────────────────
    const handleWordSave = useCallback((word, options = {}) => {
        const surface = options.includeSurface === false ? '' : highlightedWord?.trim();
        tapCommit();
        setSavedWords((previous) => uniqueTerms([...(previous ?? []), word]));
        setOptimisticHighlightTerms((previous) => uniqueTerms([...previous, word, surface]));
        onSavedTermsChange?.(uniqueTerms([...(song?.savedTerms ?? []), word, surface]));
        clearNativeSelection();
    }, [clearNativeSelection, highlightedWord, onSavedTermsChange, song?.savedTerms]);

    const handleWordUnsave = useCallback((word, options = {}) => {
        const surface = options.includeSurface === false ? '' : highlightedWord?.trim();
        tapUndo();
        setSavedWords((previous) => (previous ?? []).filter((term) => term !== word));
        setOptimisticHighlightTerms((previous) => previous.filter((term) => term !== word && term !== surface));
        onSavedTermsChange?.((song?.savedTerms ?? []).filter((term) => term !== word && term !== surface));
    }, [highlightedWord, onSavedTermsChange, song?.savedTerms]);

    // ── Saved-words panel ────────────────────────────────────────────────────
    const openSavedPanel = useCallback(async () => {
        setShowSavedPanel(true);
        setPanelSavedStems(new Set());
        refreshSongSavedWords();
        setPanelCandidates([]);
        setPanelCandidatesLoading(true);
        try {
            const raw = await getBookWordCandidates({
                ownerId: activeOwnerId,
                language: songLanguage,
                interfaceLanguage,
                bookUri: songUri,
                limit: 20,
            });
            setPanelCandidates(raw.map((candidate) => ({
                ...candidate,
                reason: deriveCandidateReason(candidate),
                exampleSentence: pickExampleSentence(song?.lyrics || '', candidate.headword),
                exampleSurface: candidate.headword,
            })));
        } catch (error) {
            console.warn('[SongReader] Failed to load word candidates:', error?.message ?? error);
            setPanelCandidates([]);
        } finally {
            setPanelCandidatesLoading(false);
        }
    }, [activeOwnerId, interfaceLanguage, refreshSongSavedWords, song?.lyrics, songLanguage, songUri]);

    const handleSaveCandidate = useCallback(async (candidate) => {
        if (!candidate?.stem) {
            return;
        }
        handleWordSave(candidate.stem, { includeSurface: false });
        try {
            await saveWordCandidate({
                candidate,
                ownerId: activeOwnerId,
                language: songLanguage,
                sourceBookUri: songUri,
                sourceBookTitle: song?.title ?? null,
            });
            setPanelSavedStems((previous) => new Set(previous).add(candidate.stem));
            refreshSongSavedWords();
        } catch (error) {
            console.warn('[SongReader] Failed to save candidate word:', error?.message ?? error);
        }
    }, [activeOwnerId, handleWordSave, refreshSongSavedWords, song?.title, songLanguage, songUri]);

    // ── Song actions ─────────────────────────────────────────────────────────
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

    // Rows above the settings tabs in the sheet.
    const songSheetActions = useMemo(() => [
        {
            key: 'edit',
            label: t('song.editLyrics'),
            icon: <Feather name="edit-3" size={19} color={colors.readerBodyInk} />,
            onPress: openEditModal,
        },
        {
            key: 'delete',
            label: t('song.deleteTitle'),
            icon: <Feather name="trash-2" size={19} color={colors.danger} />,
            onPress: confirmDeleteSong,
            destructive: true,
        },
    ], [colors.danger, colors.readerBodyInk, confirmDeleteSong, openEditModal, t]);

    // Hardware back steps out of transient chrome one layer at a time (menu,
    // then lookup panel) before Home's handler closes the song. Registered only
    // while a layer is open, so it sits above Home's listener.
    useEffect(() => {
        if (!isMenuVisible && !highlightedWord) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (isMenuVisible) {
                setIsMenuVisible(false);
                return true;
            }
            if (highlightedWord) {
                dismissLookup();
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [dismissLookup, highlightedWord, isMenuVisible]);

    // Swipe-down on the bottom lookup panel dismisses it, as in the book reader.
    const lookupPanResponder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => (
            gesture.dy > 14 && gesture.dy > Math.abs(gesture.dx)
        ),
        onPanResponderRelease: (_evt, gesture) => {
            if (gesture.dy > 40) {
                dismissLookup();
            }
        },
        onPanResponderTerminationRequest: () => true,
    }), [dismissLookup]);

    const placement = lookupLayerPlacement(lookupPlacement, focusMode);
    const useNativeLyricReader = Platform.OS === 'android';
    const lyricLineHeight = settings.fontSize * settings.lineSpacing;

    return (
        <View style={styles.container}>
            <ReaderHeaderBar styles={chrome} topInset={insets.top}>
                <View style={chrome.headerLeft}>
                    <TouchableOpacity
                        style={chrome.headerIconButton}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel={t('song.back')}
                    >
                        <Feather name="chevron-left" size={24} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <ReaderSavedWordsButton
                        styles={chrome}
                        themeColors={colors}
                        count={songSavedWords.length}
                        onPress={openSavedPanel}
                        accessibilityLabel={t('read.savedTab', { count: songSavedWords.length })}
                    />
                    <ReaderFocusModeButton
                        styles={chrome}
                        themeColors={colors}
                        active={focusMode}
                        onPress={toggleFocusMode}
                        accessibilityLabel={t('read.focusMode')}
                    />
                </View>

                <View style={styles.headerTitleBlock}>
                    <Text
                        style={[
                            styles.headerTitle,
                            /[ㄱ-ㆎ가-힣]/.test(song?.title || '') && styles.koreanTitle,
                        ]}
                        numberOfLines={1}
                    >
                        {song?.title || t('song.untitled')}
                    </Text>
                    <Text style={styles.headerArtist} numberOfLines={1}>
                        {song?.artist || t('common.unknownArtist')}
                    </Text>
                </View>

                <View style={chrome.headerControls}>
                    <ReaderMenuButton
                        styles={chrome}
                        themeColors={colors}
                        open={isMenuVisible}
                        onPress={() => setIsMenuVisible((visible) => !visible)}
                        accessibilityLabel={t('song.options')}
                    />
                </View>
            </ReaderHeaderBar>

            <View style={chrome.reader}>
                {useNativeLyricReader ? (
                    <NativeEpubReaderView
                        ref={nativeReaderViewRef}
                        key={songUri || 'song:unknown'}
                        style={chrome.nativeReaderView}
                        bookManifest={nativeSongManifest}
                        chapterBlocks={nativeLyricBlocks}
                        chapterResources={[]}
                        chapterWindow={[]}
                        restorePosition={SONG_RESTORE_POSITION}
                        renderMode={nativeRenderMode}
                        readerEdgeStateEnabled={false}
                        fontSize={settings.fontSize}
                        lineHeight={settings.lineSpacing}
                        theme={isDarkMode ? 'dark' : 'light'}
                        themeTokens={nativeReaderThemeTokens}
                        highlightTerms={readerHighlightTerms}
                        levelTerms={readerLevelTerms}
                        showPinyin={readerShowPinyin}
                        clearSelectionToken={clearSelectionToken}
                        focusSentenceCount={settings.focusSpan}
                        focusSwipeEnabled={settings.focusSwipe}
                        focusNavToken={focusNavToken}
                        focusPanelHeight={focusMode ? focusPanelTotalHeight : 0}
                        onWordSelected={handleNativeWordSelected}
                        onTextSelected={handleNativeTextSelected}
                        onSelectionCleared={handleNativeSelectionCleared}
                        onFocusSentenceChange={handleFocusSentenceChange}
                        onExposure={handleNativeExposure}
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
                        onScroll={highlightedWord ? dismissLookup : undefined}
                    >
                        {lyricLines.map((line) => (
                            <Text
                                key={line.id}
                                style={[
                                    styles.lyricLine,
                                    { fontSize: settings.fontSize, lineHeight: lyricLineHeight },
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
                                                ? () => handleNativeWordSelected({
                                                    text: segment.text,
                                                    sentence: line.text,
                                                })
                                                : undefined}
                                            style={[
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
                {overlay.opacity > 0 ? (
                    <View
                        pointerEvents="none"
                        style={[
                            chrome.readerBrightnessOverlay,
                            { backgroundColor: overlay.color, opacity: overlay.opacity },
                        ]}
                    />
                ) : null}
            </View>

            {focusMode && useNativeLyricReader ? (
                <FocusControls
                    subscribe={subscribeFocusInfo}
                    focusSpan={settings.focusSpan}
                    focusSwipe={settings.focusSwipe}
                    sendFocusNav={sendFocusNav}
                    focusControlsTranslate={focusControlsTranslate}
                    focusControlsBaseBottom={focusControlsBaseBottom}
                    focusPillTop={focusPillTop}
                    styles={chrome}
                    themeColors={colors}
                />
            ) : null}

            <View
                style={[
                    chrome.lookupLayer,
                    placement === 'top' ? chrome.lookupLayerTop : chrome.lookupLayerBottom,
                    placement === 'top'
                        ? { paddingTop: insets.top + spacing.xs + 52 }
                        // The song reader hides the tab bar, so (like the book
                        // reader in fullscreen) the panel clears the gesture
                        // area — except in focus mode, where it sits flush.
                        : { paddingBottom: focusMode ? 0 : insets.bottom + 6 },
                ]}
                pointerEvents="box-none"
            >
                <View
                    onLayout={(event) => {
                        setLookupPanelHeight(event?.nativeEvent?.layout?.height ?? 0);
                    }}
                    {...(placement === 'top' ? {} : lookupPanResponder.panHandlers)}
                >
                    <TopSection
                        highlightedWord={highlightedWord}
                        sourceSentence={highlightedWordContext?.sentence ?? ''}
                        isNativeSelection={isNativeSelection}
                        placement={placement}
                        isDarkMode={isDarkMode}
                        onClose={dismissLookup}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        onSavedWordsChanged={refreshSongSavedWords}
                        currentBook={songUri}
                        sourceBook={sourceBook}
                        savedWords={savedWords ?? []}
                    />
                </View>
            </View>

            <ReaderSettingsSheet
                visible={isMenuVisible}
                onClose={() => setIsMenuVisible(false)}
                colors={colors}
                insets={insets}
                title={t('song.readerSettings')}
                language={songLanguage}
                settings={settings}
                onSettingChange={handleSettingChange}
                onResetTextSettings={resetSongSettings}
                onResetWordSettings={resetSongWordSettings}
                onResetFocusSettings={resetFocusSettings}
                actions={songSheetActions}
                features={songSheetFeatures}
            />

            <SavedWordsPanel
                visible={showSavedPanel}
                colors={colors}
                insets={insets}
                initialTab="saved"
                savedWords={songSavedWords}
                candidates={panelCandidates}
                candidatesLoading={panelCandidatesLoading}
                savedStems={panelSavedStems}
                onSaveCandidate={handleSaveCandidate}
                onClose={() => setShowSavedPanel(false)}
            />

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

const createStyles = (colors) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.readerPaper,
    },
    headerTitleBlock: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
    },
    headerTitle: {
        maxWidth: '100%',
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 15,
        lineHeight: 20,
        color: colors.readerBodyInk,
        letterSpacing: 0,
        textAlign: 'center',
    },
    koreanTitle: {
        fontFamily: fontFamilies.krSerifBold,
    },
    headerArtist: {
        maxWidth: '100%',
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        color: colors.readerSubtleInk,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        textAlign: 'center',
    },
    lyricsScroll: {
        flex: 1,
        backgroundColor: colors.readerPaper,
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
        color: colors.readerBodyInk,
        textAlign: 'center',
        letterSpacing: 0,
    },
    lyricLineBlank: {
        marginBottom: 18,
    },
    savedLyricWord: {
        textDecorationLine: 'underline',
        textDecorationStyle: 'dotted',
        textDecorationColor: colors.textTertiary,
    },
    activeLyricWord: {
        color: colors.bgPage,
        backgroundColor: colors.accent,
    },
    modalBackdrop: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.overlay,
    },
    editModal: {
        maxHeight: '84%',
        backgroundColor: colors.surfaceElevated,
        borderRadius: 4,
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
        borderRadius: 3,
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
        borderRadius: 4,
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
