import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
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
    ToastAndroid,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TopSection from '../Read/TopSection/TopSection';
import SelectionExplainPanel from '../Read/SelectionExplainPanel';
import FocusControls from '../Read/FocusControls';
import SavedWordsPanel from '../Read/SavedWordsPanel';
import ReaderSettingsSheet from '../Read/ReaderSettingsSheet';
import {
    ReaderBackButton,
    ReaderFocusModeButton,
    ReaderHeaderBar,
    ReaderMenuButton,
    ReaderTitleButton,
} from '../Read/ReaderHeaderBar';
import { createReaderChromeStyles } from '../Read/readerChromeStyles';
import NativeEpubReaderView from '../../modules/native-epub-reader/src/NativeEpubReaderView';
import { useAppContext } from '../../contexts/AppContext';
import { useLocalOwner } from '../../contexts/LocalOwnerContext';
import { useTranslation } from '../../hooks/useTranslation';
import { localizeStoredPlaceholder } from '../../i18n/userFacing';
import useReaderLookup from '../../hooks/useReaderLookup';
import useLevelUnderlineTerms from '../../hooks/useLevelUnderlineTerms';
import useFocusNavigation from '../../hooks/useFocusNavigation';
import useSavedWordFades from '../../hooks/useSavedWordFades';
import { highlightStrengthsFor, unseenShownTerms } from '../../services/savedWordFade';
import {
    applyExposureBatch,
    getBookLookupWords,
    getBookSavedWords,
    getBookWordCandidates,
    getSavedWords,
    lookupBookHighlightSurfaces,
    recordVocabContextForSurface,
} from '../../services/Database';
import { ensureSongPreprocessed, getSongBookUri } from '../../services/songPreprocess';
import { searchSongs } from '../../services/api/songSearch';
import { findSongVideo } from '../../services/api/songVideo';
import { chapterTranslations } from '../../services/chapterTranslations';
import { activeLineIndex, lineEndTime, lyricLineTimes, parseLrc } from '../../services/lrc';
import { buildLevelLookup, tintWord as tintLyricWord } from '../../services/lyricTint';
import SongPlayer, { PLAYER_STATE } from './SongPlayer';
import SingAlongLyrics, { TRANSLATION_SCALE, translationTextStyle } from './SingAlongLyrics';
import { tapCommit, tapUndo } from '../../services/haptics';
import { requestUserDataSync } from '../../services/userDataSyncQueue';
import { deriveCandidateReason, pickExampleSentence } from '../../services/wordCandidates';
import { saveWordCandidate } from '../../services/saveWordCandidate';
import { selectExposureCredits } from '../../services/readerExposure';
import { createReadingPaceTracker } from '../../services/readingPace';
import { lookupLayerPlacement } from '../../services/readerSelection';
import {
    DEFAULT_SONG_READER_SETTINGS,
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
// scope choice: the sheet shows only the rows the song reader acts on. Songs
// have one row of their own: each line's translation under it.
const SONG_SHEET_FEATURES = {
    glossAnnotations: false,
    annotationScope: false,
    hideSavedAnnotations: false,
    lineTranslations: true,
};

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

const PLAYBACK_RATES = [1, 0.75, 0.5];
const OFFSET_STEP = 0.5;

// Same song title, ignoring case, spacing, punctuation and a bracketed part
// ("Through the Night (밤편지)" vs "Through the Night").
const titleKey = (value) => String(value || '')
    .toLowerCase()
    .replace(/[([{].*?[)\]}]/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
const sameTitle = (a, b) => {
    const left = titleKey(a);
    const right = titleKey(b);
    return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
};

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

// `translations` (line text → its translation) adds each line's translation
// under it as an inert block: drawn in the muted ink, never tapped or credited
// as reading (the native reader skips inert blocks).
const buildNativeLyricBlocks = (lyricLines, translations) => lyricLines.flatMap((line, index) => {
    const text = line.isBlank ? ' ' : line.text;
    const id = line.id || `song-lyric-line-${index}`;
    const translation = line.isBlank ? '' : translations?.get(line.text.trim());
    const blocks = [{
        id,
        type: 'text',
        tag: 'p',
        text,
        styleTokens: {
            textAlign: 'center',
            marginTop: 0,
            marginBottom: line.isBlank ? 18 : (translation ? 0 : 10),
            fontFamily: 'serif',
            // The translation sits right under the line: no reader line-height
            // leading below it.
            ...(translation ? { tightBottom: true } : null),
        },
        spans: [{ text }],
    }];
    if (translation) {
        blocks.push({
            id: `${id}-translation`,
            type: 'text',
            tag: 'p',
            text: translation,
            styleTokens: {
                textAlign: 'center',
                marginTop: -2,
                marginBottom: 16,
                fontScale: TRANSLATION_SCALE,
                lineHeight: 1.15,
                fontFamily: 'sans-serif',
                inert: true,
            },
            spans: [{ text: translation }],
        });
    }
    return blocks;
});

const SongReader = ({ song, onClose, onSongUpdate, onSongDelete, onSavedTermsChange }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const chrome = useMemo(() => createReaderChromeStyles(colors), [colors]);
    const { targetLanguage, chineseScript, interfaceLanguage, isDarkMode, setThemeMode } = useAppContext();
    const { activeOwnerId } = useLocalOwner();
    const insets = useSafeAreaInsets();
    const songLanguage = normalizeBookLanguage(targetLanguage);
    const songUri = getSongBookUri(song?.id);

    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    const [highlightSurfaces, setHighlightSurfaces] = useState([]);
    // In-song surface → saved word, for fading (services/savedWordFade.js).
    const [highlightSurfaceWords, setHighlightSurfaceWords] = useState(() => new Map());
    const [savedWordsVersion, setSavedWordsVersion] = useState(0);
    // Underlined words tapped in this song: their underline turns dotted.
    const [tappedTerms, setTappedTerms] = useState([]);
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
    const readingPaceRef = useRef(null);
    if (!readingPaceRef.current) readingPaceRef.current = createReadingPaceTracker();
    const savedSurfacesRef = useRef(new Set());
    const levelWeightsRef = useRef(new Map());
    const levelStemsRef = useRef(new Map());
    const focusControlsTranslate = useRef(new Animated.Value(0)).current;
    const highlightSurfaceWordsRef = useRef(highlightSurfaceWords);
    highlightSurfaceWordsRef.current = highlightSurfaceWords;
    const songSavedTermsRef = useRef(song?.savedTerms);
    songSavedTermsRef.current = song?.savedTerms;

    // Saved words fade as the reader passes them without a lookup; once one
    // fades out it is learned and leaves the highlights.
    const {
        fades: savedWordFades,
        onSavedPassed: onSavedWordsPassed,
        onLookedUp: onSavedWordLookedUp,
    } = useSavedWordFades({
        ownerId: activeOwnerId,
        language: songLanguage,
        onLearned: (words) => {
            const surfaces = new Set(words);
            highlightSurfaceWordsRef.current.forEach((word, surface) => {
                if (words.includes(word)) surfaces.add(surface);
            });
            setOptimisticHighlightTerms((previous) => previous.filter((term) => !surfaces.has(term)));
            onSavedTermsChange?.((songSavedTermsRef.current ?? []).filter((term) => !surfaces.has(term)));
            setSavedWordsVersion((value) => value + 1);
            ToastAndroid.show(
                t(words.length === 1 ? 'savedFade.learnedOne' : 'savedFade.learnedMany', { word: words[0], count: words.length }),
                ToastAndroid.SHORT
            );
        },
    });
    const onSavedWordLookedUpRef = useRef(onSavedWordLookedUp);
    onSavedWordLookedUpRef.current = onSavedWordLookedUp;

    // ── Lookup panel (shared with the book reader) ───────────────────────────
    const handleWordLookup = useCallback(({ text, sentence }) => {
        recentLookupsRef.current.add(text);
        setTappedTerms((previous) => (
            previous.some((term) => term.text === text) ? previous : [...previous, { text, at: Date.now() }]
        ));
        // Looking a saved word up again brings its faded highlight back.
        if (savedSurfacesRef.current.has(text)) {
            onSavedWordLookedUpRef.current?.(highlightSurfaceWordsRef.current.get(text) || text);
        }
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
        textSelection,
        lookupPlacement,
        clearSelectionToken,
        dismissLookup,
        openTextSelection,
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
        // The theme is the app's setting, not one of the song reader's.
        if (key === 'themeMode') {
            setThemeMode?.(value);
            return;
        }
        updateSettings({ [key]: value });
    }, [setThemeMode, updateSettings]);

    const resetSongSettings = useCallback(() => {
        updateSettings({
            fontSize: DEFAULT_SONG_READER_SETTINGS.fontSize,
            lineSpacing: DEFAULT_SONG_READER_SETTINGS.lineSpacing,
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

    // ── Saved words + highlight surfaces ─────────────────────────────────────
    useEffect(() => {
        let active = true;
        setTappedTerms([]);
        getBookLookupWords({ ownerId: activeOwnerId, language: songLanguage, bookUri: songUri })
            .then((words) => {
                if (active) setTappedTerms(words.map((text) => ({ text, at: 0 })));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [activeOwnerId, songLanguage, songUri]);

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
    }, [activeOwnerId, songLanguage, savedWordsVersion]);

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
                setHighlightSurfaceWords(new Map(
                    rows.filter((row) => row.surface && row.stem).map((row) => [row.surface, row.stem])
                ));
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

    // ── Line translations ────────────────────────────────────────────────────
    // Each line's translation in the app's language, under the line. Fetched
    // for the whole song at once and kept on the phone (chapterTranslations),
    // so a song is translated once. Line text → translation.
    const [lineTranslations, setLineTranslations] = useState(() => new Map());
    const showLineTranslations = settings.lineTranslations !== false;
    useEffect(() => {
        if (!showLineTranslations || !songUri) {
            setLineTranslations(new Map());
            return undefined;
        }
        const texts = [...new Set(lyricLines.filter((line) => !line.isBlank).map((line) => line.text.trim()))];
        let active = true;
        const fill = () => {
            if (!active) return;
            const next = new Map();
            texts.forEach((text) => {
                const translated = chapterTranslations.peek(text, songLanguage, interfaceLanguage);
                // The same language (or a line that reads the same) needs none.
                if (translated && translated !== text) next.set(text, translated);
            });
            setLineTranslations((current) => (
                current.size === next.size && [...next].every(([key, value]) => current.get(key) === value)
                    ? current
                    : next
            ));
        };
        fill();
        chapterTranslations.prefetchChapter({
            key: `${songUri}\u0002${song?.lyrics || ''}`,
            paragraphs: texts,
            source: songLanguage,
            target: interfaceLanguage,
        }).then(fill).catch((error) => {
            console.warn('[SongReader] Line translations failed:', error?.message ?? error);
        });
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interfaceLanguage, lyricLines, showLineTranslations, songLanguage, songUri]);
    const readerHighlightTerms = useMemo(() => uniqueTerms([
        ...(savedWords || []),
        ...highlightSurfaces,
        ...(song?.savedTerms || []),
        ...optimisticHighlightTerms,
    ]), [highlightSurfaces, optimisticHighlightTerms, savedWords, song?.savedTerms]);
    savedSurfacesRef.current = useMemo(() => new Set(readerHighlightTerms), [readerHighlightTerms]);
    const highlightStrengths = useMemo(
        () => highlightStrengthsFor(readerHighlightTerms, highlightSurfaceWords, savedWordFades),
        [readerHighlightTerms, highlightSurfaceWords, savedWordFades]
    );
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
    // Focus mode is one line at a time, without its translation.
    const nativeLyricBlocks = useMemo(
        () => buildNativeLyricBlocks(lyricLines, focusMode ? null : lineTranslations),
        [focusMode, lineTranslations, lyricLines]
    );
    const nativeReaderThemeTokens = useMemo(() => createNativeReaderThemeTokens(colors), [colors]);

    const levelMarksEnabled = settings.levelMarkStyle !== 'off';
    // Pinyin only draws while level marks are on, so the row hides with them.
    const songSheetFeatures = useMemo(
        () => ({ ...SONG_SHEET_FEATURES, pinyinAnnotations: levelMarksEnabled }),
        [levelMarksEnabled]
    );
    const readerLevelTerms = levelMarksEnabled ? levelUnderlineTerms : EMPTY_LEVEL_TERMS;
    const readerShowPinyin = songLanguage === 'zh' && settings.pinyinAnnotations && levelMarksEnabled;

    // ── Exposure crediting (same rules as the book reader) ───────────────────
    const handleNativeExposure = useCallback(({ terms, chars, dwellMs } = {}) => {
        const lookedUp = recentLookupsRef.current;
        recentLookupsRef.current = new Set();
        // Lyrics scrolled through, not read, don't count (services/readingPace.js).
        const wasRead = readingPaceRef.current.observe({ language: songLanguage, chars, dwellMs });
        if (!songUri || !wasRead) {
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

    // Saved words fade a step each time their part of the song settles on
    // screen, once per part per session (as in the book reader).
    const savedShownCountedRef = useRef(new Set());
    const handleSavedTermsShown = useCallback(({ terms, unitKey } = {}) => {
        if (!songUri) {
            return;
        }
        const fresh = unseenShownTerms(savedShownCountedRef.current, songUri, unitKey, terms);
        if (fresh.length === 0) {
            return;
        }
        onSavedWordsPassed({ surfaces: fresh, surfaceToWord: highlightSurfaceWordsRef.current });
    }, [onSavedWordsPassed, songUri]);

    // ── Player ───────────────────────────────────────────────────────────────
    // The song's YouTube video over the lyrics, with the line being sung lit
    // when the lyrics are timed. Opening it the first time finds timed lyrics
    // (LRCLIB, through the song search) if the song has none, then the video
    // (once per song; the backend shares what it found with every user).
    const [playerOpen, setPlayerOpen] = useState(false);
    const [videoStatus, setVideoStatus] = useState('idle'); // finding | ready | missing | error
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(1);
    const [loopLine, setLoopLine] = useState(null);
    const [lyricOffset, setLyricOffset] = useState(() => (typeof song?.lyricOffset === 'number' ? song.lyricOffset : 0));
    const playerRef = useRef(null);
    const timeListenersRef = useRef(new Set());
    const lastTimeRef = useRef(0);
    const timedLines = useMemo(() => parseLrc(song?.syncedLyrics), [song?.syncedLyrics]);
    const lineTimes = useMemo(() => lyricLineTimes(lyricLines, timedLines), [lyricLines, timedLines]);
    const hasTiming = useMemo(() => lineTimes.some((time) => time != null), [lineTimes]);
    const playbackRef = useRef({ lineTimes, lyricOffset, loopLine });
    playbackRef.current = { lineTimes, lyricOffset, loopLine };

    const subscribeTime = useCallback((listener) => {
        timeListenersRef.current.add(listener);
        listener(lastTimeRef.current);
        return () => timeListenersRef.current.delete(listener);
    }, []);

    const handlePlayerTime = useCallback((time) => {
        lastTimeRef.current = time;
        const { lineTimes: times, lyricOffset: offset, loopLine: loop } = playbackRef.current;
        if (loop != null) {
            const start = times[loop];
            const end = lineEndTime(times, loop);
            if (start != null && end != null && time + offset >= end - 0.1) {
                playerRef.current?.seek(start - offset);
            }
        }
        timeListenersRef.current.forEach((listener) => listener(time));
    }, []);

    // Resolves true when the song has a video to play.
    const findPlayback = useCallback(async ({ retry = false } = {}) => {
        if (song?.video?.id) {
            setVideoStatus('ready');
            return true;
        }
        if (song?.video === null && !retry) {
            setVideoStatus('missing');
            return false;
        }
        setVideoStatus('finding');
        const patch = {};
        let duration = Number.isFinite(song?.duration) ? song.duration : null;
        if (!song?.syncedLyrics && !song?.syncedChecked) {
            try {
                const results = await searchSongs({
                    query: [song?.artist, song?.title].filter(Boolean).join(' '),
                    language: songLanguage,
                });
                const match = results.find((result) => result.syncedLyrics && sameTitle(result.title, song?.title));
                if (match) {
                    patch.syncedLyrics = match.syncedLyrics;
                    patch.duration = Number.isFinite(match.duration) ? match.duration : null;
                    duration = patch.duration;
                }
            } catch (error) {
                console.warn('[SongReader] Timed lyrics search failed:', error?.message ?? error);
            }
            patch.syncedChecked = true;
        }
        let found = false;
        try {
            const video = await findSongVideo({ title: song?.title, artist: song?.artist, duration });
            patch.video = video ?? null;
            found = Boolean(video?.id);
            setVideoStatus(found ? 'ready' : 'missing');
        } catch (error) {
            console.warn('[SongReader] Video lookup failed:', error?.message ?? error);
            setVideoStatus('error');
        }
        if (Object.keys(patch).length > 0) {
            onSongUpdate?.(patch);
        }
        return found;
    }, [onSongUpdate, song?.artist, song?.duration, song?.syncedChecked, song?.syncedLyrics, song?.title, song?.video, songLanguage]);

    const openPlayer = useCallback(() => {
        setIsMenuVisible(false);
        dismissLookup();
        setFocusMode(false);
        setPlayerOpen(true);
        findPlayback().catch(() => {});
    }, [dismissLookup, findPlayback]);


    const closePlayer = useCallback(() => {
        setPlayerOpen(false);
        setPlaying(false);
        setLoopLine(null);
        lastTimeRef.current = 0;
    }, []);

    // The player opens by itself when the song has a video: at once when one
    // was found before, else after a quiet first lookup (a song with no video
    // just stays as lyrics, with no notice). Once per song opened.
    const autoOpenedRef = useRef(null);
    const findPlaybackRef = useRef(findPlayback);
    findPlaybackRef.current = findPlayback;
    useEffect(() => {
        if (!song?.id || autoOpenedRef.current === song.id) return undefined;
        autoOpenedRef.current = song.id;
        if (song.video?.id) {
            setPlayerOpen(true);
            setVideoStatus('ready');
            return undefined;
        }
        if (song.video === null || !song.title) return undefined;
        let active = true;
        findPlaybackRef.current().then((found) => {
            if (active && found) setPlayerOpen(true);
        }).catch(() => {});
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [song?.id]);

    // ── Focus mode ───────────────────────────────────────────────────────────
    // One line at a time, swiped; the player closes for it (the lyrics would
    // move under the reader as the song plays).
    const toggleFocusMode = useCallback(() => {
        setIsMenuVisible(false);
        dismissLookup();
        if (!focusMode) closePlayer();
        setFocusMode(!focusMode);
    }, [closePlayer, dismissLookup, focusMode]);

    const togglePlay = useCallback(() => {
        if (playing) playerRef.current?.pause();
        else playerRef.current?.play();
    }, [playing]);

    const cycleRate = useCallback(() => {
        const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length];
        setRate(next);
        playerRef.current?.setRate(next);
    }, [rate]);

    // Back or forward one timed line from the one being sung. Back from the
    // first second or so of a line goes to the line before; later, to the
    // start of this one (as a music player's back button does).
    const [followToken, setFollowToken] = useState(0);
    const stepLine = useCallback((direction) => {
        const time = lastTimeRef.current + lyricOffset;
        const current = loopLine ?? activeLineIndex(lineTimes, time);
        let target = -1;
        if (direction < 0 && current >= 0 && loopLine == null && time - lineTimes[current] > 1.5) {
            target = current;
        } else {
            for (let index = current + direction; index >= 0 && index < lineTimes.length; index += direction) {
                if (lineTimes[index] != null) {
                    target = index;
                    break;
                }
            }
        }
        if (target < 0) return;
        if (loopLine != null) setLoopLine(target);
        setFollowToken((value) => value + 1);
        lastTimeRef.current = Math.max(0, lineTimes[target] - lyricOffset);
        playerRef.current?.seek(lastTimeRef.current);
        playerRef.current?.play();
    }, [lineTimes, loopLine, lyricOffset]);

    const toggleLoop = useCallback(() => {
        if (loopLine != null) {
            setLoopLine(null);
            return;
        }
        const current = activeLineIndex(lineTimes, lastTimeRef.current + lyricOffset);
        if (current >= 0) setLoopLine(current);
    }, [lineTimes, loopLine, lyricOffset]);

    // The timing nudge is kept with the song, written a moment after the last tap.
    const offsetSaveTimerRef = useRef(null);
    const nudgeOffset = useCallback((delta) => {
        setLyricOffset((current) => {
            const next = Math.max(-30, Math.min(30, Math.round((current + delta) * 10) / 10));
            if (offsetSaveTimerRef.current) clearTimeout(offsetSaveTimerRef.current);
            offsetSaveTimerRef.current = setTimeout(() => onSongUpdate?.({ lyricOffset: next }), 1200);
            return next;
        });
    }, [onSongUpdate]);
    useEffect(() => () => {
        if (offsetSaveTimerRef.current) clearTimeout(offsetSaveTimerRef.current);
    }, []);

    const handlePlayerState = useCallback((state) => {
        setPlaying(state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING);
    }, []);

    const singAlong = playerOpen && videoStatus === 'ready' && hasTiming;

    const focusPanelOpen = focusMode && (!!highlightedWord || !!textSelection);

    // A word tap, as in the book reader: a second tap on the word whose panel
    // is open saves it (or takes the save back) through the panel's own save
    // button; any other tap goes to the shared lookup handler (which closes an
    // open panel or opens a new lookup).
    const saveToggleRef = useRef(null);
    const handleWordTap = useCallback((event = {}) => {
        const open = !isNativeSelection && highlightedWord;
        const sameWord = open
            && normalizeForMatch(event?.text) === normalizeForMatch(highlightedWord);
        if (event?.again || sameWord) {
            saveToggleRef.current?.();
            return;
        }
        handleNativeWordSelected(event);
    }, [handleNativeWordSelected, highlightedWord, isNativeSelection]);

    // A long press on a word in the JS lyric views explains it in its line,
    // as a long press does in the book reader.
    const explainWord = useCallback(({ text, sentence } = {}) => {
        const word = cleanLyricToken(text);
        if (!word) return;
        openTextSelection({ text: word, sentence });
    }, [openTextSelection]);

    // Level colours for the JS lyric views, by the book reader's rules.
    const levelLookup = useMemo(() => buildLevelLookup(readerLevelTerms), [readerLevelTerms]);
    const tappedSet = useMemo(
        () => new Set(tappedTerms.map((term) => normalizeForMatch(term.text)).filter(Boolean)),
        [tappedTerms]
    );
    const tintColors = useMemo(() => ({
        easy: colors.readerLevelUnderlineEasy,
        mid: colors.readerLevelUnderlineMid,
        hard: colors.readerLevelUnderlineHard,
        ink: colors.readerBodyInk,
    }), [colors]);
    const tintWord = useCallback(
        (text) => tintLyricWord(text, levelLookup, tintColors, tappedSet),
        [levelLookup, tappedSet, tintColors]
    );

    // The explanation's sentence: what native sent, else the lyric line the
    // selection sits in.
    const selectionSentence = useMemo(() => {
        if (!textSelection) return '';
        if (textSelection.sentence) return textSelection.sentence;
        const line = lyricLines.find((item) => !item.isBlank && item.text.includes(textSelection.text));
        return line?.text ?? textSelection.text;
    }, [lyricLines, textSelection]);
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
        const artist = editDraft.artist.trim();
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
            t('song.deleteBody', { title: localizeStoredPlaceholder(song?.title, t) || t('song.untitled') }),
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
            key: 'saved',
            label: t('read.savedTab', { count: songSavedWords.length }),
            icon: <MaterialCommunityIcons name="cards-outline" size={21} color={colors.readerBodyInk} />,
            onPress: () => {
                setIsMenuVisible(false);
                openSavedPanel();
            },
        },
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
    ], [colors.danger, colors.readerBodyInk, confirmDeleteSong, openEditModal, openSavedPanel, songSavedWords.length, t]);

    // Hardware back steps out of transient chrome one layer at a time (menu,
    // then lookup panel) before Home's handler closes the song. Registered only
    // while a layer is open, so it sits above Home's listener.
    useEffect(() => {
        const lookupOpen = !!highlightedWord || !!textSelection;
        if (!isMenuVisible && !lookupOpen && !playerOpen) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (isMenuVisible) {
                setIsMenuVisible(false);
                return true;
            }
            if (lookupOpen) {
                dismissLookup();
                return true;
            }
            if (playerOpen) {
                closePlayer();
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [closePlayer, dismissLookup, highlightedWord, isMenuVisible, playerOpen, textSelection]);

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
    const songTitleLabel = localizeStoredPlaceholder(song?.title, t) || t('song.untitled');
    const songArtistLabel = localizeStoredPlaceholder(song?.artist, t) || t('common.unknownArtist');
    const useNativeLyricReader = Platform.OS === 'android';
    const lyricLineHeight = settings.fontSize * settings.lineSpacing;

    return (
        <View style={styles.container}>
            <ReaderHeaderBar styles={chrome} topInset={insets.top}>
                <ReaderBackButton
                    styles={chrome}
                    themeColors={colors}
                    onPress={onClose}
                    accessibilityLabel={t('song.back')}
                />
                {/* The artist over the song, as the book reader shows the book
                    over its chapter. Saved words are in the menu, as there. */}
                <ReaderTitleButton
                    styles={chrome}
                    themeColors={colors}
                    bookTitle={songArtistLabel}
                    chapterTitle={songTitleLabel}
                    disabled
                    accessibilityLabel={`${songTitleLabel}, ${songArtistLabel}`}
                />
                {useNativeLyricReader ? (
                    <ReaderFocusModeButton
                        styles={chrome}
                        themeColors={colors}
                        active={focusMode}
                        onPress={toggleFocusMode}
                        accessibilityLabel={t('read.focusMode')}
                    />
                ) : null}
                <TouchableOpacity
                    style={[chrome.headerIconButton, playerOpen && chrome.headerIconButtonActive]}
                    onPress={playerOpen ? closePlayer : openPlayer}
                    accessibilityRole="button"
                    accessibilityState={{ selected: playerOpen }}
                    accessibilityLabel={playerOpen ? t('song.player.hide') : t('song.player.open')}
                >
                    <Feather name="music" size={21} color={colors.inkSlate} />
                </TouchableOpacity>
                <ReaderMenuButton
                    styles={chrome}
                    themeColors={colors}
                    open={isMenuVisible}
                    onPress={() => setIsMenuVisible((visible) => !visible)}
                    accessibilityLabel={t('song.options')}
                />
            </ReaderHeaderBar>

            {playerOpen ? (
                <View style={styles.playerArea}>
                    {videoStatus === 'ready' && song?.video?.id ? (
                        <SongPlayer
                            ref={playerRef}
                            videoId={song.video.id}
                            onTime={handlePlayerTime}
                            onStateChange={handlePlayerState}
                            onRateChange={setRate}
                            onError={() => setVideoStatus('error')}
                        />
                    ) : (
                        <View style={styles.playerNotice}>
                            {videoStatus === 'finding' ? (
                                <ActivityIndicator size="small" color={colors.readerMutedInk} />
                            ) : null}
                            <Text style={styles.playerNoticeText}>
                                {videoStatus === 'finding'
                                    ? t('song.player.finding')
                                    : videoStatus === 'missing'
                                        ? t('song.player.notFound')
                                        : t('song.player.unavailable')}
                            </Text>
                            {videoStatus === 'missing' || videoStatus === 'error' ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    onPress={() => findPlayback({ retry: true })}
                                    style={styles.playerRetry}
                                >
                                    <Text style={styles.playerRetryText}>{t('common.tryAgain')}</Text>
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    )}
                    {videoStatus === 'ready' ? (
                        <View style={styles.playerControls}>
                            {hasTiming ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={t('song.player.previousLine')}
                                    onPress={() => stepLine(-1)}
                                    style={styles.playerButtonStep}
                                >
                                    <Feather name="skip-back" size={18} color={colors.readerBodyInk} />
                                </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={playing ? t('song.player.pause') : t('song.player.play')}
                                onPress={togglePlay}
                                style={styles.playerButton}
                            >
                                <Feather name={playing ? 'pause' : 'play'} size={20} color={colors.readerBodyInk} />
                            </TouchableOpacity>
                            {hasTiming ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={t('song.player.nextLine')}
                                    onPress={() => stepLine(1)}
                                    style={styles.playerButtonStep}
                                >
                                    <Feather name="skip-forward" size={18} color={colors.readerBodyInk} />
                                </TouchableOpacity>
                            ) : null}
                            {hasTiming ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={t('song.player.loopLine')}
                                    accessibilityState={{ selected: loopLine != null }}
                                    onPress={toggleLoop}
                                    style={[styles.playerButton, loopLine != null && styles.playerButtonActive]}
                                >
                                    <Feather name="repeat" size={18} color={colors.readerBodyInk} />
                                </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={t('song.player.speed', { rate: String(rate) })}
                                onPress={cycleRate}
                                style={styles.playerButton}
                            >
                                <Text style={styles.playerRateText}>{`${rate}×`}</Text>
                            </TouchableOpacity>
                            {hasTiming ? (
                                <View style={styles.offsetGroup}>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={t('song.player.lyricsEarlier')}
                                        onPress={() => nudgeOffset(OFFSET_STEP)}
                                        style={styles.playerButtonSmall}
                                    >
                                        <Feather name="minus" size={16} color={colors.readerBodyInk} />
                                    </TouchableOpacity>
                                    <Text style={styles.offsetText}>
                                        {`${lyricOffset > 0 ? '−' : lyricOffset < 0 ? '+' : ''}${Math.abs(lyricOffset).toFixed(1)}s`}
                                    </Text>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={t('song.player.lyricsLater')}
                                        onPress={() => nudgeOffset(-OFFSET_STEP)}
                                        style={styles.playerButtonSmall}
                                    >
                                        <Feather name="plus" size={16} color={colors.readerBodyInk} />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <Text style={styles.untimedText} numberOfLines={2}>{t('song.player.untimed')}</Text>
                            )}
                        </View>
                    ) : null}
                </View>
            ) : null}

            <View style={chrome.reader}>
                {singAlong ? (
                    <SingAlongLyrics
                        lines={lyricLines}
                        times={lineTimes}
                        translations={lineTranslations}
                        subscribeTime={subscribeTime}
                        offset={lyricOffset}
                        fontSize={settings.fontSize}
                        lineHeight={lyricLineHeight}
                        isWordSaved={(text) => songHighlightSet.has(normalizeForMatch(text))}
                        activeWord={(text) => !isNativeSelection
                            && !!highlightedWord
                            && normalizeForMatch(highlightedWord) === normalizeForMatch(text)}
                        onWordPress={handleWordTap}
                        onBackgroundPress={dismissLookup}
                        onWordLongPress={explainWord}
                        tintWord={tintWord}
                        followToken={followToken}
                        bottomPadding={insets.bottom + 190}
                        colors={colors}
                        styles={styles}
                    />
                ) : useNativeLyricReader ? (
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
                        highlightStrengths={highlightStrengths}
                        tappedTerms={tappedTerms}
                        levelTerms={readerLevelTerms}
                        showPinyin={readerShowPinyin}
                        clearSelectionToken={clearSelectionToken}
                        focusSentenceCount={1}
                        focusSwipeEnabled
                        focusNavToken={focusNavToken}
                        focusPanelHeight={focusMode ? focusPanelTotalHeight : 0}
                        onWordSelected={handleWordTap}
                        onTextSelected={handleNativeTextSelected}
                        onSelectionCleared={handleNativeSelectionCleared}
                        onFocusSentenceChange={handleFocusSentenceChange}
                        onExposure={handleNativeExposure}
                        onSavedTermsShown={handleSavedTermsShown}
                    />
                ) : (
                    <ScrollView
                        style={styles.lyricsScroll}
                        contentContainerStyle={styles.lyricsContentFill}
                        showsVerticalScrollIndicator={false}
                        scrollEventThrottle={16}
                        onScroll={highlightedWord ? dismissLookup : undefined}
                    >
                        <Pressable
                            onPress={dismissLookup}
                            accessible={false}
                            // The margins are inside, so a tap there closes the panel too.
                            style={[styles.lyricsContent, { paddingBottom: insets.bottom + 190 }]}
                        >
                        {lyricLines.map((line) => {
                            const translation = line.isBlank ? '' : lineTranslations.get(line.text.trim());
                            return (
                            <View key={line.id} style={styles.lyricBlock}>
                            <Text
                                suppressHighlighting
                                onPress={dismissLookup}
                                style={[
                                    styles.lyricLine,
                                    { fontSize: settings.fontSize, lineHeight: lyricLineHeight },
                                    line.isBlank && styles.lyricLineBlank,
                                    translation && styles.lyricLineTranslated,
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
                                                ? () => handleWordTap({
                                                    text: segment.text,
                                                    sentence: line.text,
                                                })
                                                : undefined}
                                            onLongPress={segment.isWord
                                                ? () => explainWord({ text: segment.text, sentence: line.text })
                                                : undefined}
                                            style={[
                                                styles.lyricWord,
                                                isSaved && styles.savedLyricWord,
                                                isActive && styles.activeLyricWord,
                                            ]}
                                        >
                                            {segment.isWord && !isSaved && !isActive
                                                ? tintWord(segment.text).map((piece, pieceIndex) => (piece.color ? (
                                                    // eslint-disable-next-line react/no-array-index-key
                                                    <Text key={pieceIndex} style={{ color: piece.color }}>{piece.text}</Text>
                                                ) : piece.text))
                                                : segment.text}
                                        </Text>
                                    );
                                })}
                            </Text>
                            {translation ? (
                                <Text
                                    suppressHighlighting
                                    onPress={dismissLookup}
                                    style={[
                                        styles.lineTranslation,
                                        translationTextStyle(settings.fontSize, lyricLineHeight),
                                    ]}
                                >
                                    {translation}
                                </Text>
                            ) : null}
                            </View>
                            );
                        })}
                        </Pressable>
                    </ScrollView>
                )}
            </View>

            {focusMode && useNativeLyricReader ? (
                <FocusControls
                    subscribe={subscribeFocusInfo}
                    focusSpan={1}
                    focusSwipe
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
                        // Flush to the bottom edge; the panel keeps clear of the
                        // navigation buttons itself (bottomInset), as in a book.
                        : null,
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
                        phraseWord={highlightedWordContext?.phraseWord ?? ''}
                        isNativeSelection={isNativeSelection}
                        placement={placement}
                        bottomInset={insets.bottom}
                        isDarkMode={isDarkMode}
                        onClose={dismissLookup}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        onSavedWordsChanged={refreshSongSavedWords}
                        currentBook={songUri}
                        sourceBook={sourceBook}
                        savedWords={savedWords ?? []}
                        saveToggleRef={saveToggleRef}
                    />
                    {/* Always mounted, so it can slide away when closed. */}
                    <SelectionExplainPanel
                        text={textSelection?.text ?? ''}
                        sentence={selectionSentence}
                        language={songLanguage}
                        interfaceLanguage={interfaceLanguage}
                        bottomInset={insets.bottom}
                        ownerId={activeOwnerId}
                        bookUri={songUri}
                        bookTitle={song?.title ?? null}
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
                actions={songSheetActions}
                features={songSheetFeatures}
            />

            <SavedWordsPanel
                title={t('read.savedPanelTitleSong')}
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
    playerArea: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.readerHairline,
        backgroundColor: colors.readerPaper,
    },
    playerNotice: {
        aspectRatio: 16 / 9,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: spacing.xl,
        backgroundColor: colors.readerSurface,
    },
    playerNoticeText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.readerMutedInk,
        textAlign: 'center',
    },
    playerRetry: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.readerBorder,
    },
    playerRetryText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.readerBodyInk,
    },
    playerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.md,
        paddingVertical: 8,
    },
    playerButton: {
        minWidth: 40,
        height: 40,
        paddingHorizontal: 8,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playerButtonStep: {
        width: 36,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playerButtonActive: {
        backgroundColor: colors.accentSoft,
    },
    playerButtonSmall: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    playerRateText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        color: colors.readerBodyInk,
    },
    offsetGroup: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    offsetText: {
        minWidth: 44,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        color: colors.readerMutedInk,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
    },
    untimedText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular ?? fontFamilies.sansMedium,
        fontSize: 12,
        color: colors.readerMutedInk,
    },
    lyricsScroll: {
        flex: 1,
        backgroundColor: colors.readerPaper,
    },
    lyricsContentFill: {
        flexGrow: 1,
    },
    lyricsContent: {
        flexGrow: 1,
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
    lyricBlock: {
        width: '100%',
    },
    lyricLineTranslated: {
        marginBottom: 0,
    },
    lineTranslation: {
        width: '100%',
        marginBottom: 16,
        fontFamily: fontFamilies.sansRegular ?? fontFamilies.sansMedium,
        color: colors.readerMutedInk,
        textAlign: 'center',
        letterSpacing: 0,
    },
    // Saved and tapped words look as they do in the book reader: a saved word
    // is a solid ink chip, the tapped one the reader's tapped-word surface.
    // A word's plain look, set explicitly so a word that stops being saved or
    // tapped really loses the chip (Android keeps a nested Text's old
    // background when the style just leaves it out).
    lyricWord: {
        color: colors.readerBodyInk,
        backgroundColor: 'transparent',
    },
    savedLyricWord: {
        color: colors.readerSavedWordSurfaceText,
        backgroundColor: colors.readerSavedWordSurfaceBg,
    },
    activeLyricWord: {
        color: colors.readerTappedWordText,
        backgroundColor: colors.readerTappedWordBg,
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
