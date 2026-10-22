import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Animated, BackHandler, Easing, PanResponder, View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, findNodeHandle, ToastAndroid, PermissionsAndroid, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialIcons } from '@expo/vector-icons';

import TopSection from '../components/Read/TopSection/TopSection';
import TocDrawer from '../components/Read/TocDrawer';
import FocusControls from '../components/Read/FocusControls';
import {
    ReaderBackButton,
    ReaderCheckpointButton,
    ReaderFocusModeButton,
    ReaderFullscreenButton,
    ReaderHeaderBar,
    ReaderListenButton,
    ReaderMenuButton,
    ReaderProgressButton,
    ReaderSavedWordsButton,
} from '../components/Read/ReaderHeaderBar';
import { createReaderChromeStyles } from '../components/Read/readerChromeStyles';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import { formatNumber } from '../services/interfaceLanguage';
import {
    getUserFacingErrorMessage,
    localizeGeneratedSectionLabel,
    stripStoredPlaceholder,
} from '../i18n/userFacing';
import NativeEpubReaderView, {
    sendFocusNavCommand,
    sendExtendSelection,
    supportsExtendSelection,
    sendSeekToPosition,
    supportsImperativeFocusNav,
    supportsSeekToPosition,
    sendSpokenWord,
    supportsSpokenWord,
    updateListenSession,
    stopListenSession,
    addListenControlListener,
} from '../modules/native-epub-reader/src/NativeEpubReaderView';
import ListenBar from '../components/Read/ListenBar';
import ListenVoiceSheet from '../components/Read/ListenVoiceSheet';
import VocabLevelModal from '../components/shared/VocabLevelModal';
import { hasVocabSizeGrid } from '../services/vocabSizeLevels';
import { createListenPlayer, voiceLocaleFor, voiceSampleFor, LISTEN_PITCHES, LISTEN_RATES } from '../services/listenPlayer';
import { translateText } from '../services/api/googleTranslate';
import {
    PREPROCESS_VERSION,
    deleteBookBookmark,
    deleteBookNote,
    getBookBookmarks,
    getBookNotes,
    getBookPreprocessChapter,
    getBookLookupWords,
    getBookSavedWords,
    getBookWordCandidates,
    getCachedPKnown,
    applyExposureBatch,
    getProfileAbility,
    getSavedWords,
    insertBookBookmark,
    insertBookNote,
    insertCacheEntries,
    insertBookIndexEntries,
    insertData,
    logInteractionEvent,
    lookupBookHighlightSurfaces,
    lookupBookAnnotationSurfaces,
    countBookRowsInInterfaceLanguage,
    resetBookPreprocessChapters,
    lookupCacheByStems,
    markBookPreprocessChapter,
    markBookPreprocessMeta,
    recordVocabContext,
    recordVocabContextForSurface,
    scoreWordsForProfile,
    vocabEntryExists,
} from '../services/Database';
import { deriveCandidateReason, pickExampleSentence } from '../services/wordCandidates';
import { findActiveBookmark } from '../services/bookmarks';
import { tapSelect, tapCommit, tapUndo } from '../services/haptics';
import BeforeYouGoSheet from '../components/Read/BeforeYouGoSheet';
import SavedWordsPanel from '../components/Read/SavedWordsPanel';
import NotesLogSheet from '../components/Read/NotesLogSheet';
import ReaderSettingsSheet from '../components/Read/ReaderSettingsSheet';
import preprocessChapter from '../services/api/preprocessChapter';
import { withNormalizedSurfaceIndex } from '../services/dictionaryLookup';
import { updateUserBookProgress } from '../services/bookCloudSync';
import { addReadingMillis } from '../services/dailyProgress';
import { countReadableTextWords, readEpubPackageXml } from '../services/epubMetadata';
import { readPdfPackageXml } from '../services/pdfMetadata';
import {
    isPublicDomainBookUri,
    readPublicDomainTextPackage,
} from '../services/publicDomainBooks';
import {
    fetchUserPreferences,
    getTimestampMs,
    updateUserPreferenceFields,
} from '../services/preferencesCloudSync';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { requestUserDataSync } from '../services/userDataSyncQueue';
import {
    SUPPORTED_BOOK_LANGUAGES,
    normalizeBookLanguage,
} from '../constants/languages';
import { loadLevelUnderlineTerms } from '../hooks/useLevelUnderlineTerms';
import { bookIndexLanguages, tagPreprocessCacheEntries } from '../services/preprocessCacheEntries';
import { selectExposureCredits } from '../services/readerExposure';
import useSavedWordFades from '../hooks/useSavedWordFades';
import { ONBOARDING_FLOW_SEEN_KEY } from './Onboarding';
import { useFocusEffect } from '@react-navigation/native';
import { highlightStrengthsFor, unseenShownTerms } from '../services/savedWordFade';
import { ANNOTATION_SCOPES, annotationsBySurface, buildAnnotatedLevelTerms } from '../services/readerAnnotations';
import { createNativeReaderThemeTokens, fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';

const LOOKUP_HINT_DISMISSED_KEY = 'lookupHintDismissed';
// Listen mode preferences (speed, stop on underlined words, AI meaning).
const LISTEN_PREFS_KEY = 'listenPrefs';
// voices: the chosen on-device voice per engine locale (ko-KR, en-US, ...);
// a locale without one reads with the phone's default voice.
const DEFAULT_LISTEN_PREFS = { rate: 1, pitch: 1, voices: {}, explainWords: false, translateSentences: false };
// How one utterance in `locale` is read under the current listen prefs.
const listenVoiceFor = (prefs, locale) => ({
    locale,
    rate: prefs.rate,
    pitch: prefs.pitch,
    voice: prefs.voices?.[locale] || null,
});
// Engine failures in a row before listen mode gives up (one bad sentence is skipped).
const LISTEN_MAX_CONSECUTIVE_ERRORS = 3;
const cleanListenText = (value) => (typeof value === 'string' ? value.trim() : '');

const READER_SETTINGS_KEY = 'readerSettings';
const READER_SETTINGS_UPDATED_AT_KEY = 'readerSettingsUpdatedAt';
const DEFAULT_READER_SETTINGS = {
    fontSize: 18,
    isDarkMode: false,
    lineSpacing: 2.05,
    brightness: 0.62,
    focusSpan: 1,
    focusSwipe: false,
    readingMode: 'paged',
    levelMarkStyle: 'underline',
    // 0..1: only words at least this hard on the green→red scale are marked
    // (0 = every graded word, 1 = only the hardest).
    levelMarkThreshold: 0,
    // Chinese only: draw pinyin above words. Loosens line spacing when on, so
    // it re-paginates. Ignored for non-Chinese books.
    pinyinAnnotations: false,
    // Short translation under words (any language). Also re-paginates.
    glossAnnotations: false,
    // Which words get pinyin / translations: 'underlined' (graded words) or
    // 'all' (every word in the book), chosen separately for each.
    pinyinScope: 'underlined',
    glossScope: 'underlined',
    // No pinyin / translation on saved (highlighted) words, so the reader can
    // try to recall a word they looked up before.
    hideSavedAnnotations: true,
};
const READING_MODES = ['paged', 'scroll'];

const shallowEqualObjects = (a, b) => {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) {
        return false;
    }
    return aKeys.every((key) => a[key] === b[key]);
};
// Whether graded words get a solid gradient underline. 'off' hides the marks but
// the model keeps learning from reading.
const LEVEL_MARK_STYLES = ['off', 'underline'];
// Stable empty reference so toggling underlines off doesn't hand native a fresh
// array each render (which would churn the level matcher).
const EMPTY_LEVEL_TERMS = [];

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 30;
const FOCUS_SPAN_MIN = 1;
const FOCUS_SPAN_MAX = 5;
// Focus mode emits a page event on every sentence step; persisting each one
// (screen state + library patch + AsyncStorage write) is what made beam
// navigation feel sluggish, so steps coalesce to the trailing event.
const FOCUS_PAGE_CHANGE_DEBOUNCE_MS = 400;
// Only the values are used here; the settings sheet labels its choices with
// read.lineSpacing* keys (LINE_SPACING_CHOICES).
const LINE_SPACING_STEPS = [
    { value: 1.4 },
    { value: 1.65 },
    { value: 1.85 },
    { value: 2.05 },
    { value: 2.3 },
    { value: 2.6 },
];
const BRIGHTNESS_MIN = 0.2;
const BRIGHTNESS_MAX = 1;
const BOOK_LEVEL_LABELS = {
    en: {
        1: 'A1',
        2: 'A2',
        3: 'B1',
        4: 'B2',
        5: 'C1',
        6: 'C2',
    },
    zh: {
        1: 'HSK 1',
        2: 'HSK 2',
        3: 'HSK 3',
        4: 'HSK 4',
        5: 'HSK 5',
        6: 'HSK 6',
        7: 'HSK 7',
    },
    ko: {
        1: '초급',
        2: '중급',
        3: '고급',
    },
};
const BOOK_LEVEL_SYSTEMS = {
    en: 'CEFR',
    zh: 'HSK',
    ko: 'NIKL',
};
const BOOK_LEVEL_PERCENTILE = 0.8;

const uniqTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

const getBookLevelLabelForRank = (language, rank) => {
    const normalizedLanguage = normalizeBookLanguage(language);
    const numericRank = Number(rank);
    if (!Number.isFinite(numericRank)) {
        return null;
    }
    return BOOK_LEVEL_LABELS[normalizedLanguage]?.[numericRank] ?? String(numericRank);
};

const createBookLevelAccumulator = (language) => ({
    language: normalizeBookLanguage(language),
    sampleSize: 0,
    matchedCount: 0,
    unknownCount: 0,
    distribution: {},
});

const parseBookLevelStats = (stats) => {
    if (!stats) {
        return null;
    }
    if (typeof stats === 'object') {
        return stats;
    }
    if (typeof stats !== 'string') {
        return null;
    }
    try {
        return JSON.parse(stats);
    } catch (_error) {
        return null;
    }
};

const addBookLevelScoreToAccumulator = (accumulator, score) => {
    const parsedScore = parseBookLevelStats(score);
    if (!accumulator || !parsedScore) {
        return accumulator;
    }

    accumulator.sampleSize += Number(parsedScore.sample_size) || 0;
    accumulator.matchedCount += Number(parsedScore.matched_count) || 0;
    accumulator.unknownCount += Number(parsedScore.unknown_count) || 0;

    (parsedScore.distribution || []).forEach((entry) => {
        const rank = Number(entry?.rank);
        const count = Number(entry?.count);
        if (!Number.isFinite(rank) || !Number.isFinite(count) || count <= 0) {
            return;
        }
        accumulator.distribution[rank] = (accumulator.distribution[rank] || 0) + count;
    });

    return accumulator;
};

const addStoredBookLevelToAccumulator = (accumulator, row) => (
    addBookLevelScoreToAccumulator(accumulator, row?.book_level_stats)
);

const finalizeBookLevelAccumulator = (accumulator) => {
    if (!accumulator) {
        return null;
    }

    const sortedRanks = Object.keys(accumulator.distribution)
        .map((rank) => Number(rank))
        .filter((rank) => Number.isFinite(rank))
        .sort((a, b) => a - b);
    const matchedCount = accumulator.matchedCount;
    let estimatedRank = null;

    if (matchedCount > 0) {
        const threshold = Math.max(1, Math.ceil(matchedCount * BOOK_LEVEL_PERCENTILE));
        let running = 0;
        for (const rank of sortedRanks) {
            running += accumulator.distribution[rank] || 0;
            if (running >= threshold) {
                estimatedRank = rank;
                break;
            }
        }
    }

    const level = getBookLevelLabelForRank(accumulator.language, estimatedRank);
    return {
        language: accumulator.language,
        basis: 'vocabulary',
        method: '80th_percentile_known_vocab',
        note: 'Estimated from vocabulary only.',
        sample_size: accumulator.sampleSize,
        matched_count: matchedCount,
        unknown_count: accumulator.unknownCount,
        coverage: accumulator.sampleSize > 0
            ? Number((matchedCount / accumulator.sampleSize).toFixed(4))
            : 0,
        level_rank: estimatedRank,
        level,
        proficiency_system: BOOK_LEVEL_SYSTEMS[accumulator.language],
        proficiency_level: level,
        proficiency_rank: estimatedRank,
        distribution: sortedRanks.map((rank) => ({
            rank,
            level: getBookLevelLabelForRank(accumulator.language, rank),
            count: accumulator.distribution[rank],
        })),
    };
};

const clampProgress = (value) => {
    const progress = Number(value);
    if (!Number.isFinite(progress)) {
        return 0;
    }

    return Math.min(Math.max(progress, 0), 1);
};

const clampNumber = (value, min, max, fallback = min) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(Math.max(numeric, min), max);
};



const progressForBookPosition = (spineIndex, totalSpineItems, pageIndex = null, pagesInChapter = null) => {
    if (!Number.isInteger(spineIndex) || totalSpineItems <= 0) {
        return null;
    }

    const chapterProgress = (
        Number.isInteger(pageIndex)
        && Number.isInteger(pagesInChapter)
        && pagesInChapter > 0
    )
        ? Math.min(Math.max((pageIndex + 1) / pagesInChapter, 0), 1)
        : 0;

    return clampProgress((spineIndex + chapterProgress) / totalSpineItems);
};

const flattenTocItems = (items, depth = 0) => {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.flatMap((item) => {
        const itemDepth = Number.isFinite(Number(item?.depth))
            ? Math.max(0, Number(item.depth))
            : depth;

        return [
            { ...item, depth: itemDepth },
            ...flattenTocItems(item?.subitems, itemDepth + 1),
        ];
    });
};

const titleForTocItem = (item) => (
    String(item?.title || item?.label || '').trim()
);

const titleForSpineItem = (item) => (
    String(item?.title || item?.label || '').trim()
);

const spineIndexForReaderPackage = (readerPackage) => {
    const spineIndex = readerPackage?.loadedSpineItem?.index
        ?? readerPackage?.bookManifest?.currentSpineIndex;

    return Number.isInteger(spineIndex) ? spineIndex : null;
};

const chapterBlocksForReaderPackage = (readerPackage) => (
    readerPackage?.loadedChapterBlocks
    || readerPackage?.firstChapterBlocks
    || []
);

const chapterResourcesForReaderPackage = (readerPackage) => (
    readerPackage?.loadedChapterResources
    || readerPackage?.firstChapterResources
    || []
);

const chapterTextForReaderPackage = (readerPackage) => (
    chapterBlocksForReaderPackage(readerPackage)
        .filter((block) => !block?.excludeFromText)
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
);

const isPdfBook = (book, uri = '') => (
    String(book?.format || '').toLowerCase() === 'pdf'
    || String(uri || '').toLowerCase().split('?')[0].endsWith('.pdf')
);

const CHAPTER_PREPROCESS_RADIUS = 1;

const buildChapterPreprocessOrder = (centerSpineIndex, totalSpineItems) => {
    if (!Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
        return [];
    }

    const order = [centerSpineIndex];
    for (let offset = 1; offset <= CHAPTER_PREPROCESS_RADIUS; offset += 1) {
        const nextSpineIndex = centerSpineIndex + offset;
        const previousSpineIndex = centerSpineIndex - offset;
        if (nextSpineIndex < totalSpineItems) {
            order.push(nextSpineIndex);
        }
        if (previousSpineIndex >= 0) {
            order.push(previousSpineIndex);
        }
    }

    return order;
};

const chapterWindowEntryForPackage = (readerPackage, role) => {
    const spineIndex = spineIndexForReaderPackage(readerPackage);
    const blocks = chapterBlocksForReaderPackage(readerPackage);

    if (!Number.isInteger(spineIndex) || !Array.isArray(blocks) || blocks.length === 0) {
        return null;
    }

    const loadedSpineItem = readerPackage?.loadedSpineItem || {};

    return {
        role,
        spineIndex,
        href: loadedSpineItem.href || readerPackage?.bookManifest?.currentSpineHref || '',
        path: loadedSpineItem.path || readerPackage?.bookManifest?.currentSpinePath || '',
        title: titleForSpineItem(loadedSpineItem),
        blocks,
        resources: chapterResourcesForReaderPackage(readerPackage),
    };
};

const Read = ({
    books,
    setBooks,
    currentBook: selectedCurrentBook,
    onPreprocessComplete,
    user,
    navigation,
    route,
}) => {
    const { t, language: interfaceLanguage } = useTranslation();
    const { targetLanguage, isDarkMode, setIsDarkMode } = useAppContext();
    const { colors: themeColors } = useTheme();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const chrome = useMemo(() => createReaderChromeStyles(themeColors), [themeColors]);
    const nativeReaderThemeTokens = useMemo(
        () => createNativeReaderThemeTokens(themeColors),
        [themeColors]
    );
    const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    // Temporary handoff QA toggles for the long-press translation banner.
    const [translationBannerLoadingPreview] = useState(false);
    const [translationBannerErrorPreview] = useState(false);
    const [translationBannerCopiedPreview] = useState(false);
    const [translationBannerTextPreview] = useState('');
    const [showLookupHint, setShowLookupHint] = useState(true);
    // The open chapter's words (underlines, translations, levels) are still
    // being fetched: the reader shows a short "getting ready" note meanwhile.
    const [currentChapterPreparing, setCurrentChapterPreparing] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showBeforeYouGo, setShowBeforeYouGo] = useState(false);
    const [showSavedPanel, setShowSavedPanel] = useState(false);
    const [savedPanelTab, setSavedPanelTab] = useState('saved');
    const [bookSavedWords, setBookSavedWords] = useState([]);
    const [panelCandidates, setPanelCandidates] = useState([]);
    const [panelCandidatesLoading, setPanelCandidatesLoading] = useState(false);
    const [panelSavedStems, setPanelSavedStems] = useState(() => new Set());
    // (before-you-go is now note-only; candidates live in the saved-words panel)
    const [showNotesLog, setShowNotesLog] = useState(false);
    const [bookNotes, setBookNotes] = useState([]);
    const [bookBookmarks, setBookBookmarks] = useState([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    // Saved-word fading: in-book surface → saved word (소문을 → 소문), and a
    // counter that reloads the saved words when some become learned.
    const [highlightSurfaceWords, setHighlightSurfaceWords] = useState(() => new Map());
    const [savedWordsVersion, setSavedWordsVersion] = useState(0);
    // Underlined words tapped in this book ([{ text, at }]): their underline
    // turns dotted. Earlier lookups load settled (at 0); a new tap animates.
    const [tappedTerms, setTappedTerms] = useState([]);
    const [highlightTerms, setHighlightTerms] = useState(null);
    const [optimisticHighlightTerms, setOptimisticHighlightTerms] = useState([]);
    const [levelUnderlineTerms, setLevelUnderlineTerms] = useState([]);
    // Every word in the book with its pinyin / gloss, loaded only while word
    // annotations are on.
    const [annotationRows, setAnnotationRows] = useState([]);
    const [highlightTermsReady, setHighlightTermsReady] = useState(false);
    const [readerLocationInfo, setReaderLocationInfo] = useState(null);
    const [toc, setToc] = useState([]);
    const [showToc, setShowToc] = useState(false);
    const [bookLoadState, setBookLoadState] = useState('idle');
    const [bookLoadError, setBookLoadError] = useState('');
    const [readerRetryKey, setReaderRetryKey] = useState(0);
    const [nativeReaderPackage, setNativeReaderPackage] = useState(null);
    const [nativeChapterWindow, setNativeChapterWindow] = useState([]);
    const [nativeRestorePosition, setNativeRestorePosition] = useState(null);
    const [currentSpineIndex, setCurrentSpineIndex] = useState(null);
    const [chapterTransitionDirection, setChapterTransitionDirection] = useState('none:0');

    // ── Focus (sentence beam) mode ───────────────────────────────────────────
    const [focusMode, setFocusMode] = useState(false);
    const [focusNavToken, setFocusNavToken] = useState('none:0');
    // Listen mode: the phone's text-to-speech reads the focused sentence and
    // steps the beam on; study mode stops on each underlined word first.
    // Cold start: a profile with no reading history yet is asked for its
    // vocabulary size once, the first time a book opens.
    const [showVocabLevelPrompt, setShowVocabLevelPrompt] = useState(false);
    const [listenActive, setListenActive] = useState(false);
    const [listenPlaying, setListenPlaying] = useState(false);
    const [listenPrefs, setListenPrefs] = useState(DEFAULT_LISTEN_PREFS);
    const listenPrefsRef = useRef(DEFAULT_LISTEN_PREFS);
    const listenPlayingRef = useRef(false);
    const listenPlayerRef = useRef(null);
    const listenFocusRef = useRef(null);
    const listenSpokenKeyRef = useRef('');
    const listenRunRef = useRef(0);
    const listenCtxRef = useRef({});
    const listenErrorsRef = useRef(0);
    const listenChapterEndRef = useRef(null);
    // The sentence after the one the beam is on, as the reader last reported
    // it (focus events and step results carry it as `next`), and the step in
    // flight that will report it.
    const listenNextRef = useRef({ index: null, next: null });
    const listenMovingRef = useRef(null);
    const rememberListenNext = (payload) => {
        if (payload && Number.isInteger(payload.index) && payload.next) {
            listenNextRef.current = { index: payload.index, next: payload.next };
        }
    };
    const listenSpeakRef = useRef(null);
    const listenPauseRef = useRef(null);
    const sendFocusNavRef = useRef(null);
    const [lookupPanelHeight, setLookupPanelHeight] = useState(0);
    // Focus info (sentence index/total) updates on every beam step. It is kept
    // in a ref and pushed to a single subscriber (FocusControls) instead of
    // screen state so beam navigation doesn't re-render the whole reader.
    const focusInfoRef = useRef({ index: 0, count: 1, total: 0 });
    const focusInfoListenerRef = useRef(null);
    const publishFocusInfo = useCallback((next) => {
        focusInfoRef.current = next;
        focusInfoListenerRef.current?.(next);
    }, []);
    const subscribeFocusInfo = useCallback((listener) => {
        focusInfoListenerRef.current = listener;
        listener(focusInfoRef.current);
        return () => {
            if (focusInfoListenerRef.current === listener) {
                focusInfoListenerRef.current = null;
            }
        };
    }, []);
    const focusNavCounterRef = useRef(0);
    const nativeReaderViewRef = useRef(null);
    // In focus mode, page events arrive on every sentence step; they are
    // coalesced so only the trailing event is persisted (see
    // handleNativePageChange). The processor is captured alongside the event
    // so a flush that happens after a book or mode switch still patches the
    // book the event came from.
    const pendingFocusPageChangeRef = useRef(null);
    const focusPageChangeTimeoutRef = useRef(null);
    const flushPendingFocusPageChange = useCallback(() => {
        if (focusPageChangeTimeoutRef.current) {
            clearTimeout(focusPageChangeTimeoutRef.current);
            focusPageChangeTimeoutRef.current = null;
        }
        const pending = pendingFocusPageChangeRef.current;
        pendingFocusPageChangeRef.current = null;
        if (pending) {
            pending.process(pending.event);
        }
    }, []);
    // Flush (don't drop) any pending step when the reader unmounts so the last
    // position still lands in the library.
    useEffect(() => flushPendingFocusPageChange, [flushPendingFocusPageChange]);
    const focusControlsTranslate = useRef(new Animated.Value(0)).current;
    const focusSwipeKnobAnim = useRef(new Animated.Value(0)).current;

    // ── Preprocessing state ──────────────────────────────────────────────────
    // 'idle'         — no preprocessing requested
    // 'checking'     — querying local DB to see if this book is already cached
    // 'preprocessing'— backend call in progress
    // 'retrying'     — network error, waiting to retry
    // 'done'         — book is fully preprocessed and cached locally
    // 'error'        — failed after all retries (non-fatal, live API still works)
    const [preprocessStatus, setPreprocessStatus] = useState('idle');

    // Stores full extracted text for legacy reader paths; chapter preprocessing
    // uses the current native reader package instead.
    const extractedTextRef = useRef(null);
    const preprocessingInFlightRef = useRef(false);
    const chapterPreprocessTokenRef = useRef(0);
    const activeChapterPreprocessRef = useRef({ bookUri: null, centerSpineIndex: null });
    const readingSessionStartedAtRef = useRef(Date.now());
    const readingSessionOwnerIdRef = useRef(activeOwnerId);
    const chapterLoadTokenRef = useRef(0);
    const nativeReaderPackageRef = useRef(null);
    const nativeRestorePositionRef = useRef(null);
    const currentSpineIndexRef = useRef(null);
    // Surfaces looked up recently, to exclude from exposure crediting: a lookup is
    // its own (stronger, negative) evidence, so the same word must not also be
    // credited as a skip. Cleared each time native closes an exposure unit.
    const recentLookupsRef = useRef(new Set());
    // Gradient weights of the current underline snapshot, keyed by surface. Used
    // to rank exposure candidates by how uncertain the model is about them.
    const levelUnderlineWeightsRef = useRef(new Map());
    const levelUnderlineStemsRef = useRef(new Map());
    // Saved words are excluded from exposure: they're already in the SRS loop and
    // earn graded evidence in Learn, so crediting them again through a far noisier
    // channel would double-count them.
    const savedSurfacesRef = useRef(new Set());
    const bookCompletionInProgressRef = useRef(false);
    const parsedChapterCacheRef = useRef(new Map());
    const parsedChapterInflightRef = useRef(new Map());
    const chapterPrefetchTokenRef = useRef(0);
    const cloudProgressSyncTimeoutRef = useRef(null);
    const cloudReaderSettingsSyncTimeoutRef = useRef(null);
    const readerSettingsCloudUserRef = useRef(null);
    const readerSettingsUpdatedAtRef = useRef(null);
    const readerSettingsRef = useRef(DEFAULT_READER_SETTINGS);
    const loadNativeReaderPackageRef = useRef(null);
    // Monotonic counter stamped onto a restorePosition that represents a
    // deliberate jump; see handleSelectBookmark.
    const seekTokenRef = useRef(0);
    const recordedVocabContextsRef = useRef({ book: null, keys: new Set() });
    const updateNativeRestorePosition = useCallback((position) => {
        // Page changes repeat the same position often (every focus-mode step
        // resends it); skip the re-render, and the prop round trip to native,
        // when nothing moved.
        const previous = nativeRestorePositionRef.current;
        if (previous && position && shallowEqualObjects(previous, position)) {
            return;
        }
        nativeRestorePositionRef.current = position;
        setNativeRestorePosition(position);
    }, []);
    const selectedBook = books.find(book => book.uri === selectedCurrentBook) ?? null;
    const selectedBookLanguage = normalizeBookLanguage(selectedBook?.language ?? 'ko');
    // Book-driven: any book in a language we can look up opens with *its own*
    // dictionary, regardless of the learner's current target language. The
    // dictionary/segmentation/level pipeline is keyed on activeBookLanguage below.
    const activeBook = selectedBook && SUPPORTED_BOOK_LANGUAGES.includes(selectedBookLanguage)
        ? selectedBook
        : null;
    const currentBook = activeBook?.uri ?? null;
    const activeBookLanguage = activeBook ? selectedBookLanguage : targetLanguage;
    const shouldUseHeuristicHighlights = !activeBook?.preprocessed;
    const translationBannerVisualState = useMemo(() => ({
        loading: translationBannerLoadingPreview,
        error: translationBannerErrorPreview,
        copied: translationBannerCopiedPreview,
        translatedText: translationBannerTextPreview,
        errorMessage: t('lookup.noTranslation'),
    }), [
        t,
        translationBannerCopiedPreview,
        translationBannerErrorPreview,
        translationBannerLoadingPreview,
        translationBannerTextPreview,
    ]);

    // Load saved words for highlighting on mount
    useEffect(() => {
        // Ignore a load that finishes after the language/owner changed, so the
        // previous book's words don't overwrite the current ones.
        let isActive = true;
        getSavedWords({ ownerId: activeOwnerId, language: activeBookLanguage })
            .then(words => {
                if (isActive) setSavedWords(words);
            })
            .catch(err => {
                console.error('[Read] Failed to load saved words:', err);
                if (isActive) setSavedWords([]);
            });
        return () => {
            isActive = false;
        };
    }, [activeBookLanguage, activeOwnerId, savedWordsVersion]);

    // Words saved from *this* book — drives the top-bar count pill and the saved
    // panel's "Saved" tab. Refreshed on mount and after every save.
    const refreshBookSavedWords = useCallback(async () => {
        if (!currentBook) {
            setBookSavedWords([]);
            return;
        }
        try {
            const rows = await getBookSavedWords({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                bookUri: currentBook,
            });
            setBookSavedWords(rows);
        } catch (error) {
            console.warn('[Read] Failed to load book saved words:', error?.message ?? error);
        }
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    useEffect(() => {
        refreshBookSavedWords();
    }, [refreshBookSavedWords]);

    useEffect(() => {
        let active = true;
        setTappedTerms([]);
        getBookLookupWords({ ownerId: activeOwnerId, language: activeBookLanguage, bookUri: currentBook })
            .then((words) => {
                if (active) setTappedTerms(words.map((text) => ({ text, at: 0 })));
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    // Saved words fade as the reader passes them without a lookup; once one
    // fades out it is learned and leaves the highlights and the saved lists.
    const highlightSurfaceWordsRef = useRef(highlightSurfaceWords);
    highlightSurfaceWordsRef.current = highlightSurfaceWords;
    const {
        fades: savedWordFades,
        onSavedPassed: onSavedWordsPassed,
        onLookedUp: onSavedWordLookedUp,
    } = useSavedWordFades({
        ownerId: activeOwnerId,
        language: activeBookLanguage,
        onLearned: (words) => {
            const learned = new Set(words);
            const surfaces = new Set(words);
            highlightSurfaceWordsRef.current.forEach((word, surface) => {
                if (learned.has(word)) surfaces.add(surface);
            });
            setOptimisticHighlightTerms((previous) => previous.filter((term) => !surfaces.has(term)));
            setSavedWordsVersion((value) => value + 1);
            refreshBookSavedWords();
            ToastAndroid.show(
                t(words.length === 1 ? 'savedFade.learnedOne' : 'savedFade.learnedMany', { word: words[0], count: words.length }),
                ToastAndroid.SHORT
            );
        },
    });

    useEffect(() => {
        if (savedWords === null) {
            setHighlightTermsReady(false);
            return;
        }

        if (!currentBook) {
            setHighlightTerms(savedWords);
            setHighlightTermsReady(true);
            return;
        }

        // Even when the book isn't fully preprocessed yet, expand saved words
        // into whatever in-book surface forms have already been indexed. A saved
        // lemma otherwise only highlights where its bare form literally appears,
        // so inflected occurrences ("먹었다" for saved "먹다") silently go
        // unhighlighted — the "sometimes not highlighted" case. We still don't
        // block the reader on this in heuristic mode (see
        // isReaderWaitingForHighlights); it upgrades in place once surfaces load.

        let isActive = true;

        const loadHighlightTerms = async () => {
            try {
                const surfaceRows = await lookupBookHighlightSurfaces(activeOwnerId, currentBook, savedWords, {
                    language: activeBookLanguage,
                    interfaceLanguage,
                });
                if (!isActive) {
                    return;
                }

                const mergedTerms = [...new Set([
                    ...savedWords,
                    ...surfaceRows.map((row) => row.surface).filter(Boolean),
                ])];

                setHighlightSurfaceWords(new Map(
                    surfaceRows.filter((row) => row.surface && row.stem).map((row) => [row.surface, row.stem])
                ));
                setHighlightTerms(mergedTerms);
                setHighlightTermsReady(true);
            } catch (error) {
                console.error('[Read] Failed to load book highlight surfaces:', error);
                if (isActive) {
                    setHighlightTerms(savedWords);
                    setHighlightTermsReady(true);
                }
            }
        };

        loadHighlightTerms();

        return () => {
            isActive = false;
        };
    }, [
        activeBookLanguage,
        activeOwnerId,
        currentBook,
        interfaceLanguage,
        preprocessStatus,
        savedWords,
        shouldUseHeuristicHighlights,
    ]);

    // Level underlines are a per-chapter SNAPSHOT of the ability model, not a live
    // readout. `theta` moves on every lookup, and re-shading mid-page would mean a
    // word three lines down silently changing color while you read — unsettling,
    // and it undermines trust in the marks. So this deliberately keys off the book
    // and the committed spine index (reader open + chapter boundary) and reads
    // theta fresh INSIDE the effect rather than depending on it.
    useEffect(() => {
        if (!currentBook) {
            setLevelUnderlineTerms([]);
            return;
        }

        let isActive = true;

        const loadTerms = () => loadLevelUnderlineTerms({
            ownerId: activeOwnerId,
            bookUri: currentBook,
            language: activeBookLanguage,
        });

        loadTerms().then((terms) => {
            if (isActive) {
                setLevelUnderlineTerms(terms);
            }
        }).catch((error) => {
            console.error('[Read] Failed to load book level underline surfaces:', error);
            if (isActive) {
                setLevelUnderlineTerms([]);
            }
        });

        return () => {
            isActive = false;
        };
    }, [
        activeBookLanguage,
        activeBook?.preprocessed,
        activeOwnerId,
        currentBook,
        currentSpineIndex,
        preprocessStatus,
    ]);

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        const elapsed = Date.now() - readingSessionStartedAtRef.current;
        const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
        if (elapsed >= 5000) {
            addReadingMillis(sessionOwnerId, elapsed);
        }

        // A coalesced focus-mode step captured its own processor (closing over
        // the previous book), so flushing here still records the position the
        // reader left off at before the switch resets everything below.
        flushPendingFocusPageChange();

        setPreprocessStatus('idle');
        setCurrentChapterPreparing(false);
        extractedTextRef.current = null;
        preprocessingInFlightRef.current = false;
        activeChapterPreprocessRef.current = { bookUri: null, centerSpineIndex: null };
        chapterPreprocessTokenRef.current += 1;
        readingSessionStartedAtRef.current = Date.now();
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setLookupPlacement('bottom');
        setClearSelectionToken((value) => value + 1);
        setHighlightTerms(null);
        setOptimisticHighlightTerms([]);
        setHighlightTermsReady(savedWords !== null && !currentBook);
        setBookLoadState(currentBook ? 'loading' : 'idle');
        setBookLoadError('');
        setShowMenu(false);
        setIsFullscreen(false);
        setReaderRetryKey(0);
        setNativeReaderPackage(null);
        setNativeChapterWindow([]);
        updateNativeRestorePosition(null);
        nativeReaderPackageRef.current = null;
        bookCompletionInProgressRef.current = false;
        setCurrentSpineIndex(null);
        currentSpineIndexRef.current = null;
        setChapterTransitionDirection('none:0');
        chapterLoadTokenRef.current += 1;
        chapterPrefetchTokenRef.current += 1;
        readingSessionOwnerIdRef.current = activeOwnerId;
        parsedChapterCacheRef.current = new Map();
        parsedChapterInflightRef.current = new Map();
        setToc([]);
        setShowToc(false);
        publishFocusInfo({ index: 0, count: 1, total: 0 });
        setFocusNavToken('none:0');
        focusNavCounterRef.current = 0;
    }, [activeOwnerId, currentBook, updateNativeRestorePosition, publishFocusInfo, flushPendingFocusPageChange]);

    useEffect(() => {
        return () => {
            const elapsed = Date.now() - readingSessionStartedAtRef.current;
            const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
            if (elapsed >= 5000) {
                addReadingMillis(sessionOwnerId, elapsed);
            }
            if (cloudProgressSyncTimeoutRef.current) {
                clearTimeout(cloudProgressSyncTimeoutRef.current);
            }
            if (cloudReaderSettingsSyncTimeoutRef.current) {
                clearTimeout(cloudReaderSettingsSyncTimeoutRef.current);
            }
        };
    }, []);

    const scheduleCloudProgressSync = useCallback((book) => {
        if (
            !user?.id
            || !book?.cloudId
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            return;
        }

        const ownerId = activeOwnerId;
        const generation = syncGeneration;
        if (cloudProgressSyncTimeoutRef.current) {
            clearTimeout(cloudProgressSyncTimeoutRef.current);
        }

        cloudProgressSyncTimeoutRef.current = setTimeout(() => {
            if (!isCurrentSyncGeneration(generation)) {
                return;
            }

            updateUserBookProgress({
                user,
                ownerId,
                generation,
                book,
            }).catch((error) => {
                console.warn('[Read] Cloud progress sync failed:', error);
            });
        }, 3000);
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

    const handleWordSave = useCallback((word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        // A firmer click for committing a word to your deck — you feel it land.
        tapCommit();
        setSavedWords(prev => uniqTerms([...(prev ?? []), word]));
        setOptimisticHighlightTerms((prev) => {
            return uniqTerms([
                ...prev,
                word,
                ...(surface ? [surface] : []),
            ]);
        });
        setClearSelectionToken((value) => value + 1);
    }, [highlightedWord]);

    const handleWordUnsave = useCallback((word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        // A gentler tick for the undo — lighter than the save on purpose.
        tapUndo();
        setSavedWords(prev => (prev ?? []).filter(w => w !== word));
        setOptimisticHighlightTerms(prev => prev.filter(term => term !== word && term !== surface));
    }, [highlightedWord]);

    // Refs let the native selection callbacks read the latest panel/focus state
    // without being re-created (which would churn the native view's props).
    const lookupOpenRef = useRef(false);
    const focusModeRef = useRef(false);
    useEffect(() => {
        lookupOpenRef.current = !!highlightedWord;
    }, [highlightedWord]);
    useEffect(() => {
        focusModeRef.current = focusMode;
    }, [focusMode]);

    const handleNativeWordSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        // A word tap while a lookup panel is already open should only dismiss the
        // panel — not register the tapped word as a new selection. Tapping empty
        // space already routes through onSelectionCleared, and native text
        // selections clear themselves, so this closes the last remaining gap.
        // Focus mode normally suppresses this natively (the tap never reaches
        // JS); this also catches a tap that lands before the native view has
        // learned the panel opened.
        if (lookupOpenRef.current) {
            dismissPanelRef.current?.();
            return;
        }

        // A genuine new selection (not a panel dismiss): a whisper-light tick so
        // the lookup feels physical the instant you touch a word.
        tapSelect();

        const sentence = typeof event.sentence === 'string' ? event.sentence.trim() : '';

        // Looking a word up is its own (much stronger) evidence, so this word must
        // not also be credited as a skip when the current exposure unit closes.
        recentLookupsRef.current.add(text);
        // Its underline dissolves into dots in front of the reader and stays.
        setTappedTerms((previous) => (
            previous.some((term) => term.text === text) ? previous : [...previous, { text, at: Date.now() }]
        ));
        // Looking a saved word up again brings its faded highlight back.
        if (savedSurfacesRef.current.has(text)) {
            onSavedWordLookedUp(highlightSurfaceWordsRef.current.get(text) || text);
        }

        setIsNativeSelection(false);
        setHighlightedWord(text);
        setHighlightedWordContext({
            sentence,
        });
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');

        recordVocabContextForSurface({
            ownerId: activeOwnerId,
            surface: text,
            sentence,
            sourceBookUri: currentBook,
            sourceBookTitle: activeBook?.title ?? null,
            language: activeBookLanguage,
        }).then((context) => {
            if (context) {
                requestUserDataSync('reader-selected-vocab-context');
            }
        }).catch((error) => {
            console.warn('[Read] Failed to record vocab context:', error?.message ?? error);
        });
    }, [activeBook?.title, activeBookLanguage, activeOwnerId, currentBook]);

    const handleNativeSelectionCleared = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
    }, []);

    const dismissPanelRef = useRef(null);
    dismissPanelRef.current = () => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((v) => v + 1);
    };

    const handleNativeTextSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        setIsNativeSelection(true);
        setHighlightedWord(text);
        setHighlightedWordContext(null);
        // Growing an open selection keeps the panel where it is.
        if (extendingSelectionRef.current) {
            extendingSelectionRef.current = false;
            return;
        }
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');
    }, []);

    const extendingSelectionRef = useRef(false);
    const handleExtendSelection = useCallback((direction) => {
        const viewTag = findNodeHandle(nativeReaderViewRef.current);
        if (viewTag == null) {
            return;
        }
        extendingSelectionRef.current = true;
        sendExtendSelection(viewTag, direction)
            .then((extended) => {
                if (!extended) {
                    extendingSelectionRef.current = false;
                }
            })
            .catch((error) => {
                extendingSelectionRef.current = false;
                console.warn('[Read] Extend selection failed:', error?.message ?? error);
            });
    }, []);

    // ── Book text extraction callback ────────────────────────────────────────
    // Always stores the text so it's available for older reader paths. The
    // native reader chapter queue drives preprocessing for the current flow.
    const handleBookTextExtracted = useCallback((text) => {
        if (!text) {
            console.warn('[Read] Received empty book text — extraction may have failed');
            return;
        }
        extractedTextRef.current = text;
    }, []);

    useEffect(() => {
        if (preprocessStatus !== 'done') {
            return undefined;
        }

        const timeout = setTimeout(() => {
            setPreprocessStatus('idle');
        }, 4000);

        return () => clearTimeout(timeout);
    }, [preprocessStatus]);

    // ── Settings ─────────────────────────────────────────────────────────────
    const [settings, setSettings] = useState(DEFAULT_READER_SETTINGS);
    const [readerSettingsLoaded, setReaderSettingsLoaded] = useState(false);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        readerSettingsRef.current = settings;
    }, [settings]);

    useEffect(() => {
        const loadLookupHintDismissed = async () => {
            try {
                const dismissed = await AsyncStorage.getItem(LOOKUP_HINT_DISMISSED_KEY);
                setShowLookupHint(dismissed !== 'true');
            } catch (error) {
                console.error('[Read] Error loading lookup hint state:', error);
            }
        };

        loadLookupHintDismissed();
    }, []);

    const scheduleCloudReaderSettingsSync = useCallback((nextSettings, updatedAt = new Date().toISOString()) => {
        if (
            !user?.id
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            return;
        }

        const ownerId = activeOwnerId;
        const generation = syncGeneration;
        if (cloudReaderSettingsSyncTimeoutRef.current) {
            clearTimeout(cloudReaderSettingsSyncTimeoutRef.current);
        }

        cloudReaderSettingsSyncTimeoutRef.current = setTimeout(() => {
            if (!isCurrentSyncGeneration(generation)) {
                return;
            }

            updateUserPreferenceFields({
                user,
                ownerId,
                generation,
                patch: {
                    reader_settings: {
                        ...nextSettings,
                        updatedAt,
                    },
                    updated_at: updatedAt,
                },
            }).catch((error) => {
                console.warn('[Read] Failed to sync reader settings:', error?.message ?? error);
            });
        }, 2500);
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

    const loadSettings = async () => {
        try {
            const [savedSettings, savedUpdatedAt] = await Promise.all([
                AsyncStorage.getItem(READER_SETTINGS_KEY),
                AsyncStorage.getItem(READER_SETTINGS_UPDATED_AT_KEY),
            ]);
            if (savedSettings) {
                const parsedSettings = JSON.parse(savedSettings);
                if (typeof parsedSettings?.isDarkMode === 'boolean') {
                    setIsDarkMode(parsedSettings.isDarkMode);
                }
                const nextSettings = {
                    ...DEFAULT_READER_SETTINGS,
                    ...parsedSettings,
                    isDarkMode: typeof parsedSettings?.isDarkMode === 'boolean'
                        ? parsedSettings.isDarkMode
                        : isDarkMode,
                };
                readerSettingsRef.current = nextSettings;
                setSettings(nextSettings);
            }
            readerSettingsUpdatedAtRef.current = savedUpdatedAt ?? null;
        } catch (error) {
            console.error('[Read] Error loading settings:', error);
        } finally {
            setReaderSettingsLoaded(true);
        }
    };

    // Stable so the cloud-merge effect below (which lists it as a dependency)
    // isn't restarted, and its in-flight fetch cancelled, on every render.
    const saveSettings = useCallback(async (newSettings, updatedAt = new Date().toISOString(), options = {}) => {
        const { syncCloud = true } = options;
        try {
            readerSettingsUpdatedAtRef.current = updatedAt;
            await Promise.all([
                AsyncStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(newSettings)),
                AsyncStorage.setItem(READER_SETTINGS_UPDATED_AT_KEY, updatedAt),
            ]);
            if (syncCloud) {
                scheduleCloudReaderSettingsSync(newSettings, updatedAt);
            }
        } catch (error) {
            console.error('[Read] Error saving settings:', error);
        }
    }, [scheduleCloudReaderSettingsSync]);

    useEffect(() => {
        if (!readerSettingsLoaded) {
            return;
        }

        if (!user?.id) {
            readerSettingsCloudUserRef.current = null;
            return;
        }

        if (
            syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            readerSettingsCloudUserRef.current = null;
            return;
        }

        if (readerSettingsCloudUserRef.current === user.id) {
            return;
        }

        let isMounted = true;
        let mergeFinished = false;
        readerSettingsCloudUserRef.current = user.id;
        const ownerId = activeOwnerId;
        const generation = syncGeneration;

        const mergeCloudReaderSettings = async () => {
            try {
                const cloudPreferences = await fetchUserPreferences(user.id);
                if (!isMounted || !isCurrentSyncGeneration(generation)) {
                    return;
                }
                const cloudReaderSettings = cloudPreferences?.reader_settings;
                const hasCloudSettings = cloudReaderSettings
                    && typeof cloudReaderSettings === 'object'
                    && !Array.isArray(cloudReaderSettings)
                    && Object.keys(cloudReaderSettings).length > 0;

                const cloudUpdatedAt = cloudReaderSettings?.updatedAt
                    ?? cloudReaderSettings?.updated_at
                    ?? cloudPreferences?.updated_at
                    ?? null;
                const localUpdatedAt = readerSettingsUpdatedAtRef.current;

                if (hasCloudSettings && getTimestampMs(cloudUpdatedAt) > getTimestampMs(localUpdatedAt)) {
                    const nextSettings = {
                        ...DEFAULT_READER_SETTINGS,
                        ...cloudReaderSettings,
                    };
                    delete nextSettings.updatedAt;
                    delete nextSettings.updated_at;
                    if (typeof nextSettings.isDarkMode === 'boolean') {
                        setIsDarkMode(nextSettings.isDarkMode);
                    } else {
                        nextSettings.isDarkMode = isDarkMode;
                    }

                    if (!isMounted) {
                        return;
                    }

                    readerSettingsRef.current = nextSettings;
                    setSettings(nextSettings);
                    mergeFinished = true;
                    await saveSettings(nextSettings, cloudUpdatedAt, { syncCloud: false });
                    return;
                }

                mergeFinished = true;

                const updatedAt = localUpdatedAt ?? new Date().toISOString();
                await updateUserPreferenceFields({
                    user,
                    ownerId,
                    generation,
                    patch: {
                        reader_settings: {
                            ...readerSettingsRef.current,
                            updatedAt,
                        },
                        updated_at: updatedAt,
                    },
                });
            } catch (error) {
                readerSettingsCloudUserRef.current = null;
                console.warn('[Read] Failed to merge cloud reader settings:', error?.message ?? error);
            }
        };

        mergeCloudReaderSettings();

        return () => {
            isMounted = false;
            // A merge cancelled before it applied must run again on the next
            // pass instead of being treated as done for this user.
            if (!mergeFinished && readerSettingsCloudUserRef.current === user.id) {
                readerSettingsCloudUserRef.current = null;
            }
        };
    }, [activeOwnerId, isDarkMode, readerSettingsLoaded, saveSettings, setIsDarkMode, syncGeneration, syncPaused, user]);

    const updateSettings = (patch) => {
        if ('isDarkMode' in patch) {
            setIsDarkMode(patch.isDarkMode);
        }
        const newSettings = {
            ...settings,
            isDarkMode,
            ...patch,
        };
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((current) => current + 1);
        setSettings(newSettings);
        readerSettingsRef.current = newSettings;
        saveSettings(newSettings);
    };

    const handleSettingChange = (key, value) => {
        updateSettings({ [key]: value });
    };

    const resetBookSettings = () => {
        updateSettings({
            fontSize: DEFAULT_READER_SETTINGS.fontSize,
            lineSpacing: DEFAULT_READER_SETTINGS.lineSpacing,
            brightness: DEFAULT_READER_SETTINGS.brightness,
            readingMode: DEFAULT_READER_SETTINGS.readingMode,
            levelMarkStyle: DEFAULT_READER_SETTINGS.levelMarkStyle,
            levelMarkThreshold: DEFAULT_READER_SETTINGS.levelMarkThreshold,
        });
    };

    const resetWordSettings = () => {
        updateSettings({
            pinyinAnnotations: DEFAULT_READER_SETTINGS.pinyinAnnotations,
            glossAnnotations: DEFAULT_READER_SETTINGS.glossAnnotations,
            pinyinScope: DEFAULT_READER_SETTINGS.pinyinScope,
            glossScope: DEFAULT_READER_SETTINGS.glossScope,
            hideSavedAnnotations: DEFAULT_READER_SETTINGS.hideSavedAnnotations,
        });
    };

    const resetFocusSettings = () => {
        updateSettings({
            focusSwipe: DEFAULT_READER_SETTINGS.focusSwipe,
            focusSpan: DEFAULT_READER_SETTINGS.focusSpan,
        });
    };

    // Fullscreen is a per-visit state: leaving the reader drops it, so coming
    // back always shows the header again.
    useEffect(() => {
        const unsubscribeBlur = navigation?.addListener?.('blur', () => {
            setIsFullscreen(false);
        });
        return () => {
            unsubscribeBlur?.();
        };
    }, [navigation]);

    // The reader has no tab bar, so the header's back chevron is the way out.
    const goBackFromReader = useCallback(() => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
        } else {
            navigation?.navigate?.('Home');
        }
    }, [navigation]);

    const dismissLookup = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);
    }, []);

    // Hardware back steps out of transient reader chrome one layer at a time:
    // the options dropdown, then the open lookup panel, then fullscreen. Focus
    // mode is deliberately NOT unwound here — from focus mode back leaves the
    // reader like any other read view, and when focus mode is also fullscreen
    // back only drops fullscreen (leaving focus mode intact). Only registers
    // when one of those layers is active so normal back behaviour is untouched
    // otherwise.
    useEffect(() => {
        if (!showMenu && !highlightedWord && !isFullscreen) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (showMenu) {
                setShowMenu(false);
                return true;
            }
            if (highlightedWord) {
                dismissLookup();
                return true;
            }
            if (isFullscreen) {
                setIsFullscreen(false);
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [showMenu, isFullscreen, highlightedWord, dismissLookup]);

    // Last resort while the reader is on screen: back returns to Read home
    // rather than closing the app (there is no tab bar here, and the history
    // can hold only this screen when Android restores the app into a book).
    // Registered on focus, so the layer handler above (added later) runs first.
    useFocusEffect(useCallback(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            navigation.navigate('Home');
            return true;
        });
        return () => subscription.remove();
    }, [navigation]));

    // Swipe-down anywhere on the lookup panel dismisses it (mirrors the hardware
    // back / close-button paths). Only claims clearly downward drags so it doesn't
    // fight scrolling inside the panel.
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

    useEffect(() => {
        setSettings((current) => {
            if (current.isDarkMode === isDarkMode) {
                return current;
            }
            const nextSettings = {
                ...current,
                isDarkMode,
            };
            readerSettingsRef.current = nextSettings;
            return nextSettings;
        });
    }, [isDarkMode]);

    const dismissLookupHint = useCallback(async () => {
        setShowLookupHint(false);
        try {
            await AsyncStorage.setItem(LOOKUP_HINT_DISMISSED_KEY, 'true');
        } catch (error) {
            console.error('[Read] Error saving lookup hint state:', error);
        }
    }, []);

    const activeBookSizeMb = typeof activeBook?.size === 'number'
        ? activeBook.size / (1024 * 1024)
        : null;
    const savedWordsList = useMemo(() => savedWords ?? [], [savedWords]);
    const readerHighlightTerms = useMemo(() => {
        const dbReaderHighlightTerms = highlightTerms ?? savedWordsList;
        return uniqTerms([
            ...dbReaderHighlightTerms,
            ...optimisticHighlightTerms,
        ]);
    }, [savedWordsList, highlightTerms, optimisticHighlightTerms]);
    savedSurfacesRef.current = useMemo(
        () => new Set(readerHighlightTerms),
        [readerHighlightTerms]
    );
    const highlightStrengths = useMemo(
        () => highlightStrengthsFor(readerHighlightTerms, highlightSurfaceWords, savedWordFades),
        [readerHighlightTerms, highlightSurfaceWords, savedWordFades]
    );
    levelUnderlineWeightsRef.current = useMemo(
        () => new Map(levelUnderlineTerms.map(({ text, weight }) => [text, weight])),
        [levelUnderlineTerms]
    );
    levelUnderlineStemsRef.current = useMemo(
        () => new Map(levelUnderlineTerms.filter((term) => term.stem).map(({ text, stem }) => [text, stem])),
        [levelUnderlineTerms]
    );
    const isReaderWaitingForHighlights = !!currentBook && !shouldUseHeuristicHighlights && !highlightTermsReady;
    const nativeChapterBlocks = chapterBlocksForReaderPackage(nativeReaderPackage);
    const nativeChapterResources = chapterResourcesForReaderPackage(nativeReaderPackage);
    const nativeChapterTotal = nativeReaderPackage?.spine?.length ?? 0;
    const flattenedToc = useMemo(() => flattenTocItems(toc), [toc]);
    const activeSpineIndex = Number.isInteger(currentSpineIndex)
        ? currentSpineIndex
        : spineIndexForReaderPackage(nativeReaderPackage);
    const activeChapterTitle = useMemo(() => {
        const fallbackTitle = Number.isInteger(activeSpineIndex)
            ? t('read.chapterNumber', { number: formatNumber(activeSpineIndex + 1) })
            : t('read.defaultTitle');

        if (Number.isInteger(activeSpineIndex) && flattenedToc.length > 0) {
            const tocItem = flattenedToc.reduce((activeItem, item) => {
                if (
                    item?.disabled
                    || !Number.isInteger(item?.spineIndex)
                    || item.spineIndex > activeSpineIndex
                ) {
                    return activeItem;
                }

                return item;
            }, null);
            const tocTitle = titleForTocItem(tocItem);
            if (tocTitle) {
                return localizeGeneratedSectionLabel(tocTitle, t);
            }
        }

        return localizeGeneratedSectionLabel(titleForSpineItem(nativeReaderPackage?.loadedSpineItem), t) || fallbackTitle;
    }, [activeSpineIndex, flattenedToc, nativeReaderPackage?.loadedSpineItem, t]);
    const headerBookTitle = (
        stripStoredPlaceholder(activeBook?.title)
        || stripStoredPlaceholder(nativeReaderPackage?.metadata?.title)
        || stripStoredPlaceholder(nativeReaderPackage?.bookManifest?.title)
        || t('read.defaultTitle')
    );
    // Memoized so a new object reference isn't serialized across the native
    // bridge on every render (e.g. every focus-mode sentence step).
    const nativeBookManifest = useMemo(() => ({
        ...(nativeReaderPackage?.bookManifest ?? {}),
        // Native line breaking follows the book's language (Korean: keep words whole).
        language: activeBookLanguage,
        chapterTransitionDirection,
        currentChapterTitle: activeChapterTitle,
        currentSpineTitle: activeChapterTitle,
        currentBookTitle: headerBookTitle,
    }), [nativeReaderPackage?.bookManifest, activeBookLanguage, chapterTransitionDirection, activeChapterTitle, headerBookTitle]);
    const bookProgress = clampProgress(
        typeof readerLocationInfo?.percentage === 'number'
            ? readerLocationInfo.percentage
            : activeBook?.progress
    );
    // The header shows progress through the whole book, the same number Home
    // and the book page show. (It used to show progress through the current
    // chapter, so a short first chapter read "100%" while Home said 50%.)
    const progressPercent = Math.round(bookProgress * 100);
    const progressLabel = t('common.percent', { value: formatNumber(progressPercent) });
    const progressFillWidth = `${progressPercent}%`;
    const chapterIndexLabel = Number.isInteger(activeSpineIndex)
        ? t('read.chapterNumber', { number: formatNumber(activeSpineIndex + 1) })
        : t('read.defaultTitle');
    // ─── Note-to-self panel ──────────────────────────────────────────────────
    // Reached by long-pressing the header bookmark icon. Saving keeps the book
    // open; the note lands in the checkpoints sheet alongside bookmarks.
    const openBeforeYouGo = useCallback(() => {
        setShowMenu(false);
        setShowBeforeYouGo(true);
    }, []);

    // Open the saved-words tracker panel. Refreshes the saved list and loads the
    // full ranked candidate set (not the daily-rotated slice) for the Suggested
    // tab, since this is an on-demand browse surface.
    const openSavedPanel = useCallback(async (tab = 'saved') => {
        setSavedPanelTab(tab);
        setShowSavedPanel(true);
        setPanelSavedStems(new Set());
        refreshBookSavedWords();
        setPanelCandidates([]);
        setPanelCandidatesLoading(true);
        try {
            const raw = await getBookWordCandidates({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                interfaceLanguage,
                bookUri: currentBook,
                limit: 20,
            });
            const chapterText = chapterTextForReaderPackage(nativeReaderPackage);
            const withReason = raw.map((candidate) => ({
                ...candidate,
                reason: deriveCandidateReason(candidate),
                exampleSentence: pickExampleSentence(chapterText, candidate.headword),
                exampleSurface: candidate.headword,
            }));
            setPanelCandidates(withReason);
        } catch (error) {
            console.warn('[Read] Failed to load word candidates:', error?.message ?? error);
            setPanelCandidates([]);
        } finally {
            setPanelCandidatesLoading(false);
        }
    }, [activeOwnerId, activeBookLanguage, interfaceLanguage, currentBook, nativeReaderPackage, refreshBookSavedWords]);

    const handleSaveCandidate = useCallback(async (candidate) => {
        if (!candidate?.stem) return;
        const word = candidate.stem;
        const hanja = candidate.hanja || '';
        const definition = candidate.gloss || '';
        // Optimistically highlight it in the reader like an in-line save.
        handleWordSave(word, { includeSurface: false });
        let wordStored = false;
        try {
            const createdAt = new Date().toISOString();
            const alreadySaved = await vocabEntryExists(word, hanja, definition, activeBookLanguage, {
                ownerId: activeOwnerId,
            });
            wordStored = alreadySaved;
            if (!alreadySaved) {
                const pKnown = await getCachedPKnown({
                    ownerId: activeOwnerId,
                    language: activeBookLanguage,
                    word,
                });
                await insertData(word, hanja, definition, {
                    ownerId: activeOwnerId,
                    level: 'unorganized',
                    sourceBookUri: currentBook ?? null,
                    sourceBookTitle: activeBook?.title ?? null,
                    contextSentence: candidate.exampleSentence || null,
                    createdAt,
                    updatedAt: createdAt,
                    language: activeBookLanguage,
                    pKnown,
                });
                wordStored = true;
            }
            if (candidate.exampleSentence) {
                await recordVocabContext({
                    ownerId: activeOwnerId,
                    word,
                    hanja,
                    definition,
                    sentence: candidate.exampleSentence,
                    sourceBookUri: currentBook ?? null,
                    sourceBookTitle: activeBook?.title ?? null,
                    language: activeBookLanguage,
                });
            }
            requestUserDataSync('candidate-save');
            logInteractionEvent({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                word,
                hanja,
                def: definition,
                eventType: 'save',
                sourceBookUri: currentBook ?? null,
                sentence: candidate.exampleSentence || null,
            }).catch(() => {});
            setPanelSavedStems((prev) => new Set(prev).add(word));
            refreshBookSavedWords();
        } catch (error) {
            console.warn('[Read] Failed to save candidate word:', error?.message ?? error);
            if (!wordStored) {
                // The word never reached the deck: undo the optimistic highlight.
                setSavedWords((prev) => (prev ?? []).filter((w) => w !== word));
                setOptimisticHighlightTerms((prev) => prev.filter((term) => term !== word));
            }
        }
    }, [activeOwnerId, activeBookLanguage, currentBook, activeBook, refreshBookSavedWords]);

    const handleSaveNote = useCallback(async (text) => {
        try {
            return await insertBookNote({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                bookUri: currentBook,
                note: text,
                chapterLabel: activeChapterTitle || chapterIndexLabel || null,
                progress: typeof bookProgress === 'number' ? bookProgress : null,
            });
        } catch (error) {
            console.warn('[Read] Failed to save note:', error?.message ?? error);
            return null;
        }
    }, [activeOwnerId, activeBookLanguage, currentBook, activeChapterTitle, chapterIndexLabel, bookProgress]);

    // ─── Checkpoints (bookmarks + notes) ─────────────────────────────────────
    // Both live in the same sheet, so open it with a fresh read of both lists —
    // a note saved seconds ago must show up without a reopen of the book.
    const openNotesLog = useCallback(async () => {
        setShowMenu(false);
        setShowNotesLog(true);
        try {
            const [notes, bookmarks] = await Promise.all([
                getBookNotes(currentBook, {
                    ownerId: activeOwnerId,
                    language: activeBookLanguage,
                }),
                getBookBookmarks(currentBook, {
                    ownerId: activeOwnerId,
                    language: activeBookLanguage,
                }),
            ]);
            setBookNotes(notes);
            setBookBookmarks(bookmarks);
        } catch (error) {
            console.warn('[Read] Failed to load checkpoints:', error?.message ?? error);
        }
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    const handleDeleteNote = useCallback(async (id) => {
        try {
            await deleteBookNote(id, { ownerId: activeOwnerId });
            setBookNotes((prev) => prev.filter((note) => note.id !== id));
        } catch (error) {
            console.warn('[Read] Failed to delete note:', error?.message ?? error);
        }
    }, [activeOwnerId]);

    // Load the book's bookmarks as soon as it opens so the header icon can show
    // filled/outline for the current page without waiting for the sheet.
    useEffect(() => {
        let isActive = true;
        // Notes are only read when the checkpoints sheet opens; drop the previous
        // book's so they can't show under this one.
        setBookNotes([]);
        if (!currentBook) {
            setBookBookmarks([]);
            return undefined;
        }
        getBookBookmarks(currentBook, {
            ownerId: activeOwnerId,
            language: activeBookLanguage,
        })
            .then((rows) => {
                if (isActive) setBookBookmarks(rows);
            })
            .catch((error) => {
                console.warn('[Read] Failed to load bookmarks:', error?.message ?? error);
            });
        return () => {
            isActive = false;
        };
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    // Which saved bookmark, if any, the reader is sitting on — drives the header
    // icon's filled/hollow state. See services/bookmarks for why this matches on
    // block id rather than page number.
    const currentReaderPosition = nativeRestorePosition || activeBook?.nativePosition || null;
    const activeBookmark = useMemo(
        () => findActiveBookmark(bookBookmarks, currentReaderPosition),
        [bookBookmarks, currentReaderPosition]
    );

    const toggleBookmark = useCallback(async () => {
        // In focus mode page events are debounced, so the tracked position can
        // trail the reader by up to FOCUS_PAGE_CHANGE_DEBOUNCE_MS. Flush first
        // or a bookmark taken right after a sentence step records the page the
        // reader just left.
        flushPendingFocusPageChange();
        const position = nativeRestorePositionRef.current || activeBook?.nativePosition || null;
        if (!currentBook || !Number.isInteger(position?.spineIndex)) {
            return;
        }
        try {
            if (activeBookmark) {
                const removedBookmark = activeBookmark;
                setBookBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== removedBookmark.id));
                try {
                    await deleteBookBookmark(removedBookmark.id, { ownerId: activeOwnerId });
                } catch (error) {
                    // Still saved: put it back rather than show it as removed.
                    setBookBookmarks((prev) => (
                        prev.some((bookmark) => bookmark.id === removedBookmark.id)
                            ? prev
                            : [removedBookmark, ...prev]
                    ));
                    throw error;
                }
                return;
            }
            // pagesInChapter can be absent on a position that came from a
            // chapter load rather than a page event; the live location info
            // still knows the count, and it's what makes "Page 4 of 12" read
            // as a real page number instead of a bare index.
            const pagesInChapter = Number.isInteger(position.pagesInChapter)
                ? position.pagesInChapter
                : (Number.isInteger(readerLocationInfo?.pagesInChapter)
                    ? readerLocationInfo.pagesInChapter
                    : null);
            const created = await insertBookBookmark({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                bookUri: currentBook,
                spineIndex: position.spineIndex,
                pageIndex: Number.isInteger(position.pageIndex) ? position.pageIndex : 0,
                pagesInChapter,
                href: position.href || null,
                firstBlockId: position.firstBlockId || null,
                chapterLabel: activeChapterTitle || chapterIndexLabel || null,
                progress: typeof bookProgress === 'number' ? bookProgress : null,
            });
            if (created) {
                setBookBookmarks((prev) => [created, ...prev]);
            }
        } catch (error) {
            console.warn('[Read] Failed to toggle bookmark:', error?.message ?? error);
        }
    }, [
        activeBook,
        activeBookmark,
        activeBookLanguage,
        activeChapterTitle,
        activeOwnerId,
        bookProgress,
        chapterIndexLabel,
        currentBook,
        flushPendingFocusPageChange,
        readerLocationInfo,
    ]);

    const handleDeleteBookmark = useCallback(async (id) => {
        try {
            await deleteBookBookmark(id, { ownerId: activeOwnerId });
            setBookBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== id));
        } catch (error) {
            console.warn('[Read] Failed to remove bookmark:', error?.message ?? error);
        }
    }, [activeOwnerId]);

    // Jump the reader to a saved checkpoint, mirroring how the TOC navigates:
    // reload the target chapter when it differs, otherwise seek in place.
    const handleSelectBookmark = useCallback((bookmark) => {
        if (!Number.isInteger(bookmark?.spineIndex)) {
            return;
        }
        setShowNotesLog(false);
        // A pending focus-mode page event would land after the jump and push the
        // old position straight back, so retire it before moving.
        flushPendingFocusPageChange();
        // The seek token is what tells the native view this is a deliberate jump
        // rather than the position echo pushed on every page event. Without it
        // an in-chapter jump is dropped as a no-op in continuous mode, where a
        // "page" is the whole chapter and the target always resolves to the
        // chapter already on screen.
        seekTokenRef.current += 1;
        const position = {
            spineIndex: bookmark.spineIndex,
            pageIndex: Number.isInteger(bookmark.pageIndex) ? bookmark.pageIndex : 0,
            pagesInChapter: Number.isInteger(bookmark.pagesInChapter) ? bookmark.pagesInChapter : null,
            href: bookmark.href || '',
            firstBlockId: bookmark.firstBlockId || null,
            seekToken: `seek:${seekTokenRef.current}`,
        };

        if (bookmark.spineIndex !== activeSpineIndex) {
            // Different chapter: the loader hands the position to the native
            // view, which seeks to it while repaginating the new chapter.
            loadNativeReaderPackageRef.current?.(bookmark.spineIndex, {
                restorePosition: position,
                animateChapterTransition: false,
            });
            return;
        }

        // Same chapter. Keep JS position state in step, then move the reader
        // with an explicit command — the prop alone has repeatedly proven
        // unreliable for this, since it doubles as the passive position echo.
        updateNativeRestorePosition(position);
        if (supportsSeekToPosition) {
            const viewTag = findNodeHandle(nativeReaderViewRef.current);
            if (viewTag != null) {
                sendSeekToPosition(viewTag, position).catch((error) => {
                    console.warn('[Read] Checkpoint seek failed:', error?.message ?? error);
                });
            }
        }
    }, [activeSpineIndex, flushPendingFocusPageChange, updateNativeRestorePosition]);

    useEffect(() => {
        const unsubscribeFocus = navigation?.addListener?.('focus', () => {
            bookCompletionInProgressRef.current = false;
        });

        if (navigation?.isFocused?.()) {
            bookCompletionInProgressRef.current = false;
        }

        return () => {
            unsubscribeFocus?.();
        };
    }, [navigation]);

    const handleBookLoadError = useCallback((reason) => {
        const lowerReason = String(reason || '').toLowerCase();
        const likelyTooLarge = lowerReason.includes('readasdataurl')
            || lowerReason.includes('outofmemory')
            || (typeof activeBookSizeMb === 'number' && activeBookSizeMb >= 25);

        setBookLoadState('error');
        setBookLoadError(
            likelyTooLarge
                ? t('read.bookTooLarge')
                : t('read.bookOpenFailed')
        );
    }, [activeBookSizeMb, t]);

    const retryBookLoad = useCallback(() => {
        setBookLoadError('');
        setBookLoadState('loading');
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);
        setReaderRetryKey((prev) => prev + 1);
    }, []);

    const cacheParsedChapterPackage = useCallback((parsedPackage) => {
        const spineIndex = spineIndexForReaderPackage(parsedPackage);
        if (!Number.isInteger(spineIndex)) {
            return null;
        }

        parsedChapterCacheRef.current.set(spineIndex, parsedPackage);
        return spineIndex;
    }, []);

    const pruneParsedChapterCache = useCallback((centerSpineIndex) => {
        if (!Number.isInteger(centerSpineIndex)) {
            return;
        }

        const keepSpineIndexes = new Set([
            centerSpineIndex - 1,
            centerSpineIndex,
            centerSpineIndex + 1,
        ]);

        parsedChapterCacheRef.current.forEach((_, spineIndex) => {
            if (!keepSpineIndexes.has(spineIndex)) {
                parsedChapterCacheRef.current.delete(spineIndex);
            }
        });
    }, []);

    const updateNativeChapterWindowForSpine = useCallback((centerSpineIndex, currentPackage = null) => {
        if (!Number.isInteger(centerSpineIndex)) {
            setNativeChapterWindow([]);
            return [];
        }

        if (currentPackage) {
            cacheParsedChapterPackage(currentPackage);
        }

        pruneParsedChapterCache(centerSpineIndex);

        const totalSpineItems = (
            currentPackage?.spine?.length
            ?? nativeReaderPackageRef.current?.spine?.length
            ?? 0
        );
        const chapterSpecs = [
            { role: 'previous', spineIndex: centerSpineIndex - 1 },
            { role: 'current', spineIndex: centerSpineIndex },
            { role: 'next', spineIndex: centerSpineIndex + 1 },
        ].filter(({ spineIndex }) => (
            spineIndex >= 0 && (!totalSpineItems || spineIndex < totalSpineItems)
        ));

        const entries = chapterSpecs
            .map(({ role, spineIndex }) => (
                chapterWindowEntryForPackage(parsedChapterCacheRef.current.get(spineIndex), role)
            ))
            .filter(Boolean);

        setNativeChapterWindow(entries);

        return entries;
    }, [cacheParsedChapterPackage, pruneParsedChapterCache]);

    const loadParsedChapterPackage = useCallback(async (requestedSpineIndex = null, reason = 'load') => {
        if (!currentBook) {
            return null;
        }

        const cacheKey = Number.isInteger(requestedSpineIndex) ? requestedSpineIndex : 'auto';
        if (Number.isInteger(requestedSpineIndex) && parsedChapterCacheRef.current.has(requestedSpineIndex)) {
            return parsedChapterCacheRef.current.get(requestedSpineIndex);
        }

        if (parsedChapterInflightRef.current.has(cacheKey)) {
            return parsedChapterInflightRef.current.get(cacheKey);
        }

        const loadOptions = Number.isInteger(requestedSpineIndex)
            ? { spineIndex: requestedSpineIndex }
            : {};
        const fallbackName = activeBook?.originalFilename
            || activeBook?.title
            || currentBook.split('/').pop()
            || '';
        const packageLoader = isPublicDomainBookUri(currentBook)
            ? readPublicDomainTextPackage(currentBook, loadOptions)
            : isPdfBook(activeBook, currentBook)
                ? readPdfPackageXml(currentBook, fallbackName, loadOptions)
                : readEpubPackageXml(
                    currentBook,
                    fallbackName,
                    loadOptions
                );

        // Switching books replaces both maps; a load still running for the old
        // book must not land in (or clear entries from) the new book's maps.
        const chapterCacheAtStart = parsedChapterCacheRef.current;
        const inflightAtStart = parsedChapterInflightRef.current;
        const loadPromise = packageLoader.then((parsedPackage) => {
            if (parsedChapterCacheRef.current !== chapterCacheAtStart) {
                return null;
            }
            cacheParsedChapterPackage(parsedPackage);
            return parsedPackage;
        }).finally(() => {
            inflightAtStart.delete(cacheKey);
        });

        inflightAtStart.set(cacheKey, loadPromise);
        return loadPromise;
    }, [
        activeBook?.format,
        activeBook?.originalFilename,
        activeBook?.title,
        cacheParsedChapterPackage,
        currentBook,
    ]);

    const prefetchAdjacentChapters = useCallback((centerSpineIndex, totalSpineItems) => {
        if (!currentBook || !Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
            return;
        }

        const prefetchToken = chapterPrefetchTokenRef.current + 1;
        chapterPrefetchTokenRef.current = prefetchToken;

        [
            { role: 'previous', spineIndex: centerSpineIndex - 1 },
            { role: 'next', spineIndex: centerSpineIndex + 1 },
        ]
            .filter(({ spineIndex }) => spineIndex >= 0 && spineIndex < totalSpineItems)
            .forEach(({ role, spineIndex }) => {
                if (parsedChapterCacheRef.current.has(spineIndex)) {
                    updateNativeChapterWindowForSpine(centerSpineIndex);
                    return;
                }

                loadParsedChapterPackage(spineIndex, `prefetch:${role}`)
                    .then(() => {
                        if (chapterPrefetchTokenRef.current !== prefetchToken) {
                            return;
                        }
                        updateNativeChapterWindowForSpine(centerSpineIndex);
                    })
                    .catch((error) => {
                        if (chapterPrefetchTokenRef.current !== prefetchToken) {
                            return;
                        }
                        console.warn(`[Read] Adjacent chapter prefetch failed (${role} ${spineIndex}):`, error);
                    });
            });
    }, [currentBook, loadParsedChapterPackage, updateNativeChapterWindowForSpine]);

    const persistChapterPreprocessResults = useCallback(async ({
        bookUri,
        results = [],
        surfaceIndex = [],
        language = 'ko',
    }) => {
        const normalizedLanguage = normalizeBookLanguage(language);
        const cacheScope = { language: normalizedLanguage, interfaceLanguage };
        const cacheEntries = tagPreprocessCacheEntries(results, cacheScope);
        await insertCacheEntries(cacheEntries, cacheScope);

        const stems = [...new Set(cacheEntries.map((entry) => entry.stem).filter(Boolean))];
        if (stems.length === 0) {
            return 0;
        }

        // Index each stem by its row in the app language, or failing that the
        // English row a Korean word fell back to.
        const stemToId = {};
        for (const indexLanguage of bookIndexLanguages(cacheScope)) {
            const cachedRows = await lookupCacheByStems(stems, {
                language: normalizedLanguage,
                interfaceLanguage: indexLanguage,
            });
            cachedRows.forEach((row) => {
                if (stemToId[row.stem] == null) {
                    stemToId[row.stem] = row.id;
                }
            });
        }

        const seenSurfaceStem = new Set();
        const bookIndexEntries = withNormalizedSurfaceIndex(surfaceIndex, normalizedLanguage)
            .filter((entry) => entry?.surface && stemToId[entry.stem] != null)
            .map((entry) => ({
                surface: entry.surface,
                stem_id: stemToId[entry.stem],
            }))
            .filter((entry) => {
                const key = `${entry.surface}|${entry.stem_id}`;
                if (seenSurfaceStem.has(key)) {
                    return false;
                }
                seenSurfaceStem.add(key);
                return true;
            });

        await insertBookIndexEntries(bookUri, bookIndexEntries, { ownerId: activeOwnerId });

        // Phase 2.4: batch-score this chapter's vocabulary on write, so the reader
        // never has to compute P(known) per word at scroll time. Compute-on-write,
        // read-fast (design doc §4 serving). Non-fatal: a scoring failure must not
        // break preprocessing — the score cache can be rebuilt later on next open.
        try {
            await scoreWordsForProfile({
                ownerId: activeOwnerId,
                language: normalizedLanguage,
                stems,
                sourceBookUri: bookUri,
            });
        } catch (scoreError) {
            console.warn('[Read] Chapter baseline scoring failed (non-fatal):', scoreError);
        }

        return bookIndexEntries.length;
    }, [activeOwnerId, interfaceLanguage]);

    const startChapterPreprocessing = useCallback(async (
        centerSpineIndex,
        totalSpineItems,
        currentPackage = null
    ) => {
        if (!currentBook || !Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
            return;
        }

        const queue = buildChapterPreprocessOrder(centerSpineIndex, totalSpineItems);
        if (queue.length === 0) {
            return;
        }

        const activePreprocess = activeChapterPreprocessRef.current;
        if (
            preprocessingInFlightRef.current
            && activePreprocess.bookUri === currentBook
            && activePreprocess.centerSpineIndex === centerSpineIndex
        ) {
            return;
        }

        const preprocessToken = chapterPreprocessTokenRef.current + 1;
        chapterPreprocessTokenRef.current = preprocessToken;
        preprocessingInFlightRef.current = true;
        activeChapterPreprocessRef.current = { bookUri: currentBook, centerSpineIndex };

        // Translations (the words' glosses and definitions) are fetched in the
        // app language. A book processed in another language has none in this
        // one, so process its chapters again; the old rows stay as a fallback
        // until the new ones arrive.
        try {
            const rowsInLanguage = await countBookRowsInInterfaceLanguage(
                activeOwnerId,
                currentBook,
                { language: activeBookLanguage, interfaceLanguage }
            );
            if (rowsInLanguage === 0) {
                await resetBookPreprocessChapters(activeOwnerId, currentBook, { language: activeBookLanguage });
            }
        } catch (error) {
            console.warn('[Read] Could not check the book\'s translation language:', error);
        }
        if (chapterPreprocessTokenRef.current !== preprocessToken) {
            return;
        }

        setBooks((prevBooks) => prevBooks.map((book) => (
            book.uri === currentBook ? { ...book, preprocessed: false, preprocessing: true } : book
        )));
        setPreprocessStatus('preprocessing');

        let completedChapters = 0;
        let failedChapters = 0;
        let totalSurfaceCount = 0;
        let totalWordCount = 0;
        let countedWordChapters = 0;
        const bookLevelAccumulator = createBookLevelAccumulator(activeBookLanguage);

        try {
            await markBookPreprocessMeta({
                ownerId: activeOwnerId,
                bookUri: currentBook,
                status: 'partial',
                surfaceCount: 0,
                preprocessVersion: PREPROCESS_VERSION,
            });

            for (const spineIndex of queue) {
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                const isCurrentChapter = spineIndex === centerSpineIndex;
                const existingChapter = await getBookPreprocessChapter(
                    activeOwnerId,
                    currentBook,
                    spineIndex,
                    PREPROCESS_VERSION
                );
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                if (existingChapter?.status === 'complete') {
                    addStoredBookLevelToAccumulator(bookLevelAccumulator, existingChapter);
                    completedChapters += 1;
                    totalSurfaceCount += Number(existingChapter.surface_count) || 0;
                    if (isCurrentChapter) {
                        setPreprocessStatus('done');
                        setCurrentChapterPreparing(false);
                    }
                    continue;
                }

                await markBookPreprocessChapter({
                    ownerId: activeOwnerId,
                    bookUri: currentBook,
                    spineIndex,
                    status: 'processing',
                    surfaceCount: 0,
                    preprocessVersion: PREPROCESS_VERSION,
                });
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                setPreprocessStatus('preprocessing');
                if (isCurrentChapter) {
                    setCurrentChapterPreparing(true);
                }

                try {
                    const chapterPackage = (
                        isCurrentChapter
                        && currentPackage
                        && spineIndexForReaderPackage(currentPackage) === spineIndex
                    )
                        ? currentPackage
                        : await loadParsedChapterPackage(spineIndex, `preprocess:${spineIndex}`);

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    const chapterText = chapterTextForReaderPackage(chapterPackage);
                    totalWordCount += countReadableTextWords(chapterText);
                    countedWordChapters += 1;
                    const {
                        results = [],
                        surface_index: surfaceIndex = [],
                        stats = {},
                    } = await preprocessChapter({
                        bookUri: currentBook,
                        spineIndex,
                        text: chapterText,
                        language: activeBookLanguage,
                        interfaceLanguage,
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    const surfaceCount = await persistChapterPreprocessResults({
                        bookUri: currentBook,
                        results,
                        surfaceIndex,
                        language: activeBookLanguage,
                    });
                    const chapterBookLevel = stats?.book_level ?? null;
                    addBookLevelScoreToAccumulator(bookLevelAccumulator, chapterBookLevel);

                    await markBookPreprocessChapter({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        spineIndex,
                        status: 'complete',
                        surfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
                        bookLevel: chapterBookLevel,
                        completedAt: new Date().toISOString(),
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    completedChapters += 1;
                    totalSurfaceCount += surfaceCount;
                    await markBookPreprocessMeta({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        status: 'partial',
                        surfaceCount: totalSurfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
                        bookLevel: finalizeBookLevelAccumulator(bookLevelAccumulator),
                    });
                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    if (isCurrentChapter) {
                        setPreprocessStatus('done');
                        setCurrentChapterPreparing(false);
                    }

                    const visibleSpineIndex = currentSpineIndexRef.current;
                    if (
                        Number.isInteger(visibleSpineIndex)
                        && Math.abs(spineIndex - visibleSpineIndex) > 1
                    ) {
                        parsedChapterCacheRef.current.delete(spineIndex);
                    }
                } catch (error) {
                    failedChapters += 1;
                    console.warn(`[Read] Chapter preprocess failed for spine ${spineIndex}:`, error);
                    await markBookPreprocessChapter({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        spineIndex,
                        status: 'failed',
                        surfaceCount: 0,
                        preprocessVersion: PREPROCESS_VERSION,
                        completedAt: new Date().toISOString(),
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    if (isCurrentChapter) {
                        setPreprocessStatus('error');
                        setCurrentChapterPreparing(false);
                    }
                }
            }

            if (chapterPreprocessTokenRef.current !== preprocessToken) {
                return;
            }

            const fullBookWindow = queue.length >= totalSpineItems;
            const windowSucceeded = failedChapters === 0 && completedChapters > 0;
            const finalStatus = !windowSucceeded
                ? (completedChapters > 0 ? 'partial' : 'failed')
                : (fullBookWindow ? 'complete' : 'partial');
            const completedWordCount = (
                finalStatus === 'complete'
                && countedWordChapters === queue.length
                && totalWordCount > 0
                    ? totalWordCount
                    : null
            );
            const completedBookLevel = finalizeBookLevelAccumulator(bookLevelAccumulator);
            await markBookPreprocessMeta({
                ownerId: activeOwnerId,
                bookUri: currentBook,
                status: finalStatus,
                surfaceCount: totalSurfaceCount,
                preprocessVersion: PREPROCESS_VERSION,
                bookLevel: completedBookLevel,
                completedAt: finalStatus === 'complete' ? new Date().toISOString() : null,
            });

            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? {
                        ...book,
                        preprocessed: fullBookWindow && finalStatus === 'complete',
                        preprocessing: false,
                        ...(completedWordCount != null
                            ? { wordCount: completedWordCount }
                            : {}),
                        ...(completedBookLevel?.level
                            ? { difficulty: completedBookLevel.level, bookLevel: completedBookLevel }
                            : {}),
                    }
                    : book
            )));

            if (completedWordCount != null && activeBook?.cloudId) {
                scheduleCloudProgressSync({
                    ...activeBook,
                    wordCount: completedWordCount,
                    ...(completedBookLevel?.level
                        ? { difficulty: completedBookLevel.level, bookLevel: completedBookLevel }
                        : {}),
                    preprocessed: fullBookWindow && finalStatus === 'complete',
                    preprocessing: false,
                });
            }

            if (windowSucceeded) {
                setPreprocessStatus('done');
                if (fullBookWindow) {
                    onPreprocessComplete?.(currentBook);
                }
            } else {
                setPreprocessStatus('error');
            }
        } finally {
            if (chapterPreprocessTokenRef.current === preprocessToken) {
                preprocessingInFlightRef.current = false;
                activeChapterPreprocessRef.current = { bookUri: null, centerSpineIndex: null };
            }
        }
    }, [
        currentBook,
        activeOwnerId,
        activeBook,
        activeBookLanguage,
        interfaceLanguage,
        loadParsedChapterPackage,
        onPreprocessComplete,
        persistChapterPreprocessResults,
        scheduleCloudProgressSync,
        setBooks,
    ]);

    const loadNativeReaderPackage = useCallback(async (
        requestedSpineIndex = null,
        { animateChapterTransition = false, restorePosition = null } = {}
    ) => {
        if (!currentBook) {
            setNativeReaderPackage(null);
            setNativeChapterWindow([]);
        updateNativeRestorePosition(null);
            nativeReaderPackageRef.current = null;
            setBookLoadState('idle');
            setBookLoadError('');
            setReaderLocationInfo(null);
            setCurrentSpineIndex(null);
            currentSpineIndexRef.current = null;
            setChapterTransitionDirection('none:0');
            return;
        }

        const requestedRestorePosition = (
            restorePosition && Number.isInteger(restorePosition.spineIndex)
                ? restorePosition
                : null
        );
        const isChapterNavigation = Number.isInteger(requestedSpineIndex);
        const previousSpineIndex = currentSpineIndexRef.current;
        if (isChapterNavigation && requestedSpineIndex !== previousSpineIndex) {
            setHighlightedWord('');
            setHighlightedWordContext(null);
            setIsNativeSelection(false);
            setClearSelectionToken((value) => value + 1);
        }
        const nextTransitionDirection = (
            animateChapterTransition && isChapterNavigation && Number.isInteger(previousSpineIndex)
                ? (
                    requestedSpineIndex > previousSpineIndex
                        ? 'next'
                        : (requestedSpineIndex < previousSpineIndex ? 'previous' : 'none')
                )
                : 'none'
        );
        const canKeepCurrentReader = (
            isChapterNavigation
            && nativeReaderPackageRef.current?.bookManifest?.sourceUri === currentBook
        );
        const loadToken = chapterLoadTokenRef.current + 1;
        chapterLoadTokenRef.current = loadToken;

        setBookLoadError('');
        if (!requestedRestorePosition) {
            updateNativeRestorePosition(null);
        }
        if (!canKeepCurrentReader) {
            setBookLoadState('loading');
            setNativeReaderPackage(null);
            setNativeChapterWindow([]);
            nativeReaderPackageRef.current = null;
            setToc([]);
            setChapterTransitionDirection('none:0');
        }

        try {
            const parsedPackage = await loadParsedChapterPackage(
                requestedSpineIndex,
                isChapterNavigation ? 'navigate' : 'initial'
            );

            if (chapterLoadTokenRef.current !== loadToken) {
                return;
            }

            if (!parsedPackage) {
                return;
            }

            const loadedSpineIndex = spineIndexForReaderPackage(parsedPackage) ?? 0;
            const totalSpineItems = parsedPackage.spine?.length ?? 0;
            const nextRestorePosition = (
                requestedRestorePosition?.spineIndex === loadedSpineIndex
                    ? requestedRestorePosition
                    : null
            );

            setCurrentSpineIndex(loadedSpineIndex);
            currentSpineIndexRef.current = loadedSpineIndex;
            nativeReaderPackageRef.current = parsedPackage;
            updateNativeRestorePosition(nextRestorePosition);
            setToc(Array.isArray(parsedPackage.toc) ? parsedPackage.toc : []);
            setChapterTransitionDirection((prev) => {
                const previousToken = Number(String(prev).split(':')[1]) || 0;
                const direction = canKeepCurrentReader && animateChapterTransition ? nextTransitionDirection : 'none';
                return `${direction}:${previousToken + 1}`;
            });
            setNativeReaderPackage(parsedPackage);
            updateNativeChapterWindowForSpine(loadedSpineIndex, parsedPackage);
            prefetchAdjacentChapters(loadedSpineIndex, totalSpineItems);
            const restorePageIndex = Number.isInteger(nextRestorePosition?.pageIndex)
                ? nextRestorePosition.pageIndex
                : null;
            const restorePagesInChapter = Number.isInteger(nextRestorePosition?.pagesInChapter)
                ? nextRestorePosition.pagesInChapter
                : null;

            setReaderLocationInfo({
                page: totalSpineItems > 0 ? loadedSpineIndex + 1 : null,
                total: totalSpineItems || null,
                percentage: progressForBookPosition(
                    loadedSpineIndex,
                    totalSpineItems,
                    restorePageIndex,
                    restorePagesInChapter
                ),
                href: parsedPackage.loadedSpineItem?.path || '',
                pageInChapter: Number.isInteger(restorePageIndex) ? restorePageIndex + 1 : null,
                pagesInChapter: restorePagesInChapter,
            });
            startChapterPreprocessing(loadedSpineIndex, totalSpineItems, parsedPackage);
            setBookLoadState('ready');
            setBookLoadError('');
        } catch (error) {
            if (chapterLoadTokenRef.current !== loadToken) {
                return;
            }

            console.error('[Read] Native reader load failed:', error);
            if (canKeepCurrentReader && nativeReaderPackageRef.current) {
                setBookLoadState('ready');
                setBookLoadError(getUserFacingErrorMessage(error, t, 'read.nativeChapterUnsupported', interfaceLanguage));
                setChapterTransitionDirection('none:0');
                return;
            }

            setBookLoadState('error');
            setBookLoadError(getUserFacingErrorMessage(error, t, 'read.nativeUnsupported', interfaceLanguage));
            setChapterTransitionDirection('none:0');
        }
    }, [
        currentBook,
        interfaceLanguage,
        loadParsedChapterPackage,
        prefetchAdjacentChapters,
        startChapterPreprocessing,
        t,
        updateNativeChapterWindowForSpine,
    ]);

    loadNativeReaderPackageRef.current = loadNativeReaderPackage;

    // Keep this tied to the actual book identity. The loader callback is
    // recreated when Read updates parent book state, and depending on it here
    // reloads the same spine repeatedly.
    useEffect(() => {
        const savedNativePosition = activeBook?.nativePosition || null;
        const savedSpineIndex = Number.isInteger(savedNativePosition?.spineIndex)
            ? savedNativePosition.spineIndex
            : null;

        loadNativeReaderPackageRef.current?.(savedSpineIndex, { restorePosition: savedNativePosition });

        return () => {
            chapterLoadTokenRef.current += 1;
            chapterPrefetchTokenRef.current += 1;
            chapterPreprocessTokenRef.current += 1;
        };
    }, [activeBook?.uri, currentBook, readerRetryKey]);

    /**
     * Consume one exposure unit native just closed — a page, a focus span, or a
     * scrolled-past block. Native owns "what was shown and for how long"; this owns
     * the intent filters and the plausibility gate.
     *
     * Three subtractions before anything counts as "skipped because known":
     *   1. units left too fast for their length — never really read (dwell gate)
     *   2. words looked up recently — a lookup already logged its own (much
     *      stronger, negative) evidence; crediting a positive too would partly
     *      cancel it
     *   3. saved words — already earning graded evidence through the SRS loop
     *
     * Every survivor is credited (services/readerExposure.js): the level engine
     * weighs each one by how much it says, and learns the reader's lookup habit
     * by comparing lookups with words read past, so dropping some would make
     * the reader look like they tap more than they do. Not while listen mode
     * reads aloud.
     */
    const handleNativeExposure = useCallback(({ terms, chars, dwellMs } = {}) => {
        // Each closed unit ends the window in which a tap could have belonged to
        // it; taps after this point belong to the next unit.
        const lookedUp = recentLookupsRef.current;
        recentLookupsRef.current = new Set();

        if (!currentBook) {
            return;
        }
        // While listen mode reads aloud, the page moves at the voice's pace and
        // nobody taps; not looking a word up says nothing.
        if (listenPlayingRef.current) {
            return;
        }
        if (!Array.isArray(terms) || terms.length === 0) {
            return;
        }
        const skipped = selectExposureCredits({
            terms,
            chars,
            dwellMs,
            lookedUp,
            saved: savedSurfacesRef.current,
            weights: levelUnderlineWeightsRef.current,
        });

        if (skipped.length === 0) {
            return;
        }

        // Credit the dictionary form (소문을 → 소문): the level engine and the
        // event log match words by stem.
        const stems = levelUnderlineStemsRef.current;
        applyExposureBatch({
            ownerId: activeOwnerId,
            language: activeBookLanguage,
            stems: skipped.map((surface) => stems.get(surface) || surface),
            sourceBookUri: currentBook,
            dwellSeconds: Number(dwellMs) / 1000,
        }).catch((error) => {
            console.warn('[Read] Failed to apply exposure batch:', error);
        });
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    /**
     * A page (or focus span, or scrolled paragraph) with saved words has
     * settled on screen: each fades a step, and the reader watches its box
     * lose pixels. Once per page per session; not while listen mode reads.
     */
    const savedShownCountedRef = useRef(new Set());
    const handleSavedTermsShown = useCallback(({ terms, unitKey } = {}) => {
        if (!currentBook || listenPlayingRef.current) {
            return;
        }
        const fresh = unseenShownTerms(savedShownCountedRef.current, currentBook, unitKey, terms);
        if (fresh.length === 0) {
            return;
        }
        onSavedWordsPassed({ surfaces: fresh, surfaceToWord: highlightSurfaceWordsRef.current });
    }, [currentBook, onSavedWordsPassed]);

    const processNativePageChange = useCallback(({ page, total, spineIndex, href, firstBlockId, savedHighlights } = {}) => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const pageIndex = Number.isInteger(page) ? page : null;
        const eventSpineIndex = Number.isInteger(spineIndex) ? spineIndex : null;
        const currentLoadedSpineIndex = currentSpineIndexRef.current;
        const resolvedSpineIndex = Number.isInteger(eventSpineIndex)
            ? eventSpineIndex
            : currentLoadedSpineIndex;
        const totalSpineItems = nativeReaderPackageRef.current?.spine?.length ?? nativeChapterTotal;
        const nextProgress = progressForBookPosition(resolvedSpineIndex, totalSpineItems, pageIndex, total);

        setReaderLocationInfo((prev) => {
            const next = {
            ...(prev || {}),
            page: (
                Number.isInteger(resolvedSpineIndex) && totalSpineItems > 0
                    ? resolvedSpineIndex + 1
                    : (prev?.page ?? null)
            ),
            total: totalSpineItems || prev?.total || null,
            percentage: nextProgress ?? prev?.percentage ?? null,
            href: typeof href === 'string' && href.length > 0 ? href : (prev?.href || ''),
            pageInChapter: Number.isInteger(page) ? page + 1 : null,
            pagesInChapter: Number.isInteger(total) ? total : null,
            };
            // Returning the same object lets React skip re-rendering the reader.
            return prev && shallowEqualObjects(prev, next) ? prev : next;
        });

        if (!currentBook || !Number.isInteger(pageIndex) || !Number.isInteger(resolvedSpineIndex)) {
            return;
        }

        // Native resends every saved word's context in the chapter on each page
        // change (each focus-mode step included). Record each (word, sentence)
        // once per book session instead of rewriting them all every time.
        const recordedContexts = recordedVocabContextsRef.current;
        if (recordedContexts.book !== currentBook) {
            recordedContexts.book = currentBook;
            recordedContexts.keys = new Set();
        }
        const newHighlights = Array.isArray(savedHighlights)
            ? savedHighlights.filter((highlight) => {
                const key = `${highlight?.text ?? ''}\u0000${highlight?.sentence ?? ''}`;
                if (recordedContexts.keys.has(key)) {
                    return false;
                }
                recordedContexts.keys.add(key);
                return true;
            })
            : [];
        if (newHighlights.length > 0) {
            Promise.all(newHighlights.map((highlight) => (
                recordVocabContextForSurface({
                    ownerId: activeOwnerId,
                    surface: typeof highlight?.text === 'string' ? highlight.text : '',
                    sentence: typeof highlight?.sentence === 'string' ? highlight.sentence : '',
                    sourceBookUri: currentBook,
                    sourceBookTitle: activeBook?.title ?? null,
                    language: activeBookLanguage,
                }).catch((error) => {
                    console.warn('[Read] Failed to record visible vocab context:', error?.message ?? error);
                    return false;
                })
            )))
                .then((contexts) => {
                    if (contexts.some(Boolean)) {
                        requestUserDataSync('reader-visible-vocab-context');
                    }
                });
        }

        const loadedSpineItem = nativeReaderPackageRef.current?.spine
            ?.find((item) => item?.index === resolvedSpineIndex)
            || nativeReaderPackageRef.current?.loadedSpineItem;
        const nextPosition = {
            spineIndex: resolvedSpineIndex,
            pageIndex,
            pagesInChapter: Number.isInteger(total) ? total : null,
            href: (
                typeof href === 'string' && href.length > 0
                    ? href
                    : (loadedSpineItem?.path || loadedSpineItem?.href || '')
            ),
            firstBlockId: (
                typeof firstBlockId === 'string' && firstBlockId.length > 0
                    ? firstBlockId
                    : null
            ),
        };
        const nextBookPatch = {
            nativePosition: nextPosition,
            location: nextPosition.href || null,
            progress: nextProgress ?? clampProgress(activeBook?.progress ?? 0),
        };

        if (activeBook?.cloudId) {
            scheduleCloudProgressSync({
                ...activeBook,
                ...nextBookPatch,
            });
        }

        updateNativeRestorePosition(nextPosition);
        setBooks((prevBooks) => {
            let changed = false;
            const nextBooks = prevBooks.map((book) => {
                if (book.uri !== currentBook) {
                    return book;
                }

                const previousPosition = book.nativePosition || {};
                const isUnchanged = (
                    previousPosition.spineIndex === nextPosition.spineIndex
                    && previousPosition.pageIndex === nextPosition.pageIndex
                    && previousPosition.pagesInChapter === nextPosition.pagesInChapter
                    && previousPosition.href === nextPosition.href
                    && previousPosition.firstBlockId === nextPosition.firstBlockId
                    && book.progress === nextBookPatch.progress
                );
                if (isUnchanged) {
                    return book;
                }
                changed = true;
                return {
                    ...book,
                    ...nextBookPatch,
                };
            });
            // Same array when nothing moved, so the whole app doesn't re-render.
            return changed ? nextBooks : prevBooks;
        });
    }, [
        activeBook,
        activeBookLanguage,
        activeOwnerId,
        currentBook,
        nativeChapterTotal,
        scheduleCloudProgressSync,
        setBooks,
        updateNativeRestorePosition,
    ]);

    const handleNativePageChange = useCallback((event = {}) => {
        if (!focusModeRef.current) {
            flushPendingFocusPageChange();
            processNativePageChange(event);
            return;
        }

        pendingFocusPageChangeRef.current = { event, process: processNativePageChange };
        if (focusPageChangeTimeoutRef.current) {
            clearTimeout(focusPageChangeTimeoutRef.current);
        }
        focusPageChangeTimeoutRef.current = setTimeout(() => {
            focusPageChangeTimeoutRef.current = null;
            flushPendingFocusPageChange();
        }, FOCUS_PAGE_CHANGE_DEBOUNCE_MS);
    }, [flushPendingFocusPageChange, processNativePageChange]);

    const handleNativeChapterCommit = useCallback(({
        spineIndex,
        href,
        path,
        pageIndex,
        pagesInChapter,
        firstBlockId,
    } = {}) => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const committedSpineIndex = Number.isInteger(spineIndex) ? spineIndex : null;
        if (!Number.isInteger(committedSpineIndex)) {
            return;
        }

        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);

        const committedPackage = parsedChapterCacheRef.current.get(committedSpineIndex);

        if (!committedPackage) {
            loadNativeReaderPackage(committedSpineIndex, {
                restorePosition: {
                    spineIndex: committedSpineIndex,
                    pageIndex: Number.isInteger(pageIndex) ? pageIndex : 0,
                    pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
                    href: path || href || '',
                    firstBlockId: firstBlockId || null,
                },
            });
            return;
        }

        const totalSpineItems = committedPackage.spine?.length ?? 0;
        const nextPosition = {
            spineIndex: committedSpineIndex,
            pageIndex: Number.isInteger(pageIndex) ? pageIndex : 0,
            pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
            href: path || href || committedPackage.loadedSpineItem?.path || committedPackage.loadedSpineItem?.href || '',
            firstBlockId: firstBlockId || null,
        };
        const committedPageIndex = Number.isInteger(pageIndex) ? pageIndex : 0;
        const committedPageCount = Number.isInteger(pagesInChapter) ? pagesInChapter : null;
        const nextProgress = progressForBookPosition(
            committedSpineIndex,
            totalSpineItems,
            committedPageIndex,
            committedPageCount
        ) ?? clampProgress(activeBook?.progress ?? 0);
        const nextBookPatch = {
            nativePosition: nextPosition,
            location: nextPosition.href || null,
            progress: nextProgress,
        };

        chapterLoadTokenRef.current += 1;
        setCurrentSpineIndex(committedSpineIndex);
        currentSpineIndexRef.current = committedSpineIndex;
        nativeReaderPackageRef.current = committedPackage;
        setNativeReaderPackage(committedPackage);
        updateNativeRestorePosition(nextPosition);
        if (currentBook) {
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? { ...book, ...nextBookPatch }
                    : book
            )));
        }
        if (activeBook?.cloudId) {
            scheduleCloudProgressSync({
                ...activeBook,
                ...nextBookPatch,
            });
        }
        setToc(Array.isArray(committedPackage.toc) ? committedPackage.toc : []);
        setChapterTransitionDirection((prev) => {
            const previousToken = Number(String(prev).split(':')[1]) || 0;
            return `none:${previousToken + 1}`;
        });
        setReaderLocationInfo({
            page: totalSpineItems > 0 ? committedSpineIndex + 1 : null,
            total: totalSpineItems || null,
            percentage: nextProgress,
            href: nextPosition.href,
            pageInChapter: Number.isInteger(pageIndex) ? pageIndex + 1 : null,
            pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
        });
        setBookLoadState('ready');
        setBookLoadError('');
        updateNativeChapterWindowForSpine(committedSpineIndex, committedPackage);
        prefetchAdjacentChapters(committedSpineIndex, totalSpineItems);
        startChapterPreprocessing(committedSpineIndex, totalSpineItems, committedPackage);
    }, [
        activeBook,
        currentBook,
        loadNativeReaderPackage,
        prefetchAdjacentChapters,
        scheduleCloudProgressSync,
        setBooks,
        startChapterPreprocessing,
        updateNativeRestorePosition,
        updateNativeChapterWindowForSpine,
    ]);

    const handleNativeChapterEnd = useCallback(() => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const loadedSpineIndex = currentSpineIndexRef.current;
        if (!Number.isInteger(loadedSpineIndex) || nativeChapterTotal <= 0) {
            return;
        }

        const nextSpineIndex = loadedSpineIndex + 1;
        if (nextSpineIndex < nativeChapterTotal) {
            loadNativeReaderPackage(nextSpineIndex, { animateChapterTransition: true });
            return;
        }

        bookCompletionInProgressRef.current = true;
        listenPauseRef.current?.({ keepActive: false });

        if (currentBook) {
            const previousPosition = nativeRestorePositionRef.current || activeBook?.nativePosition || {};
            const loadedSpineItem = nativeReaderPackageRef.current?.spine
                ?.find((item) => item?.index === loadedSpineIndex)
                || nativeReaderPackageRef.current?.loadedSpineItem;
            const finalPageCount = Number.isInteger(previousPosition?.pagesInChapter)
                ? previousPosition.pagesInChapter
                : null;
            const finalPageIndex = Number.isInteger(previousPosition?.pageIndex)
                ? previousPosition.pageIndex
                : (Number.isInteger(finalPageCount) ? Math.max(0, finalPageCount - 1) : 0);
            const finalPosition = {
                spineIndex: loadedSpineIndex,
                pageIndex: finalPageIndex,
                pagesInChapter: finalPageCount,
                href: previousPosition?.href || loadedSpineItem?.path || loadedSpineItem?.href || '',
                firstBlockId: previousPosition?.firstBlockId || null,
            };
            const nextBookPatch = {
                nativePosition: finalPosition,
                location: finalPosition.href || null,
                progress: 1,
            };

            updateNativeRestorePosition(null);
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? { ...book, ...nextBookPatch }
                    : book
            )));

            if (activeBook?.cloudId) {
                scheduleCloudProgressSync({
                    ...activeBook,
                    ...nextBookPatch,
                });
            }
        }

        setShowMenu(false);
        setShowToc(false);
        navigation?.navigate?.('Home');
    }, [
        activeBook,
        currentBook,
        loadNativeReaderPackage,
        nativeChapterTotal,
        navigation,
        scheduleCloudProgressSync,
        setBooks,
        updateNativeRestorePosition,
    ]);

    const handleNativeChapterStart = useCallback(() => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const loadedSpineIndex = currentSpineIndexRef.current;
        if (!Number.isInteger(loadedSpineIndex) || loadedSpineIndex <= 0) {
            return;
        }

        loadNativeReaderPackage(loadedSpineIndex - 1, { animateChapterTransition: true });
    }, [loadNativeReaderPackage]);

    // Focus mode always presents the lookup panel from the bottom so the
    // anchored sentence can lift above it.
    const shouldPlaceLookupAtTop = lookupPlacement === 'top' && !focusMode;
    const readerFontSize = Math.round(clampNumber(
        settings.fontSize,
        FONT_SIZE_MIN,
        FONT_SIZE_MAX,
        DEFAULT_READER_SETTINGS.fontSize
    ));
    const readerLineSpacing = clampNumber(
        settings.lineSpacing,
        LINE_SPACING_STEPS[0].value,
        LINE_SPACING_STEPS[LINE_SPACING_STEPS.length - 1].value,
        DEFAULT_READER_SETTINGS.lineSpacing
    );
    const readerBrightness = clampNumber(
        settings.brightness,
        BRIGHTNESS_MIN,
        BRIGHTNESS_MAX,
        DEFAULT_READER_SETTINGS.brightness
    );
    const readerBrightnessDelta = readerBrightness - DEFAULT_READER_SETTINGS.brightness;
    const readerBrightnessOverlayColor = readerBrightnessDelta < 0 ? '#000000' : '#ffffff';
    const readerBrightnessOverlayOpacity = readerBrightnessDelta < 0
        ? Math.min(0.28, (Math.abs(readerBrightnessDelta) / (DEFAULT_READER_SETTINGS.brightness - BRIGHTNESS_MIN)) * 0.28)
        : Math.min(0.08, (readerBrightnessDelta / (BRIGHTNESS_MAX - DEFAULT_READER_SETTINGS.brightness)) * 0.08);

    // ── Focus (sentence beam) mode wiring ────────────────────────────────────
    const focusSpan = Math.round(clampNumber(
        settings.focusSpan,
        FOCUS_SPAN_MIN,
        FOCUS_SPAN_MAX,
        DEFAULT_READER_SETTINGS.focusSpan
    ));
    const focusSwipe = !!settings.focusSwipe;
    const readingMode = READING_MODES.includes(settings.readingMode)
        ? settings.readingMode
        : DEFAULT_READER_SETTINGS.readingMode;
    // Switching the app language while a book is open: fetch the open book's
    // translations again in the new language. An in-flight run for the old
    // language is cancelled first, or it would win the in-flight check.
    const preprocessLanguageRef = useRef(interfaceLanguage);
    useEffect(() => {
        if (preprocessLanguageRef.current === interfaceLanguage) {
            return;
        }
        preprocessLanguageRef.current = interfaceLanguage;
        const spineIndex = currentSpineIndexRef.current;
        const totalSpineItems = nativeReaderPackageRef.current?.spine?.length ?? 0;
        if (!currentBook || !Number.isInteger(spineIndex) || totalSpineItems <= 0) {
            return;
        }
        chapterPreprocessTokenRef.current += 1;
        preprocessingInFlightRef.current = false;
        activeChapterPreprocessRef.current = { bookUri: null, centerSpineIndex: null };
        startChapterPreprocessing(spineIndex, totalSpineItems, null);
    }, [currentBook, interfaceLanguage, startChapterPreprocessing]);

    const isScrollMode = readingMode === 'scroll';
    const nativeRenderMode = focusMode ? 'focus' : (isScrollMode ? 'continuous' : 'paged');
    // 'off' hides the marks only; exposure/lookup evidence keeps flowing, since
    // the model should keep learning even when the marks are turned off.
    const levelMarkStyle = LEVEL_MARK_STYLES.includes(settings.levelMarkStyle)
        ? settings.levelMarkStyle
        : DEFAULT_READER_SETTINGS.levelMarkStyle;
    const levelMarksEnabled = levelMarkStyle !== 'off';
    // Pinyin / gloss for every word in the book, while word annotations are on.
    const annotationsWanted = (
        (activeBookLanguage === 'zh' && Boolean(settings.pinyinAnnotations))
        || Boolean(settings.glossAnnotations)
    );
    useEffect(() => {
        // Not gated on the book being fully preprocessed: the rows that exist
        // (a partly processed long book, or one awaiting a dictionary refresh)
        // are worth showing now, and the effect re-runs as processing progresses.
        if (!annotationsWanted || !currentBook) {
            setAnnotationRows([]);
            return undefined;
        }
        let isActive = true;
        lookupBookAnnotationSurfaces(activeOwnerId, currentBook, { language: activeBookLanguage })
            .then((rows) => {
                if (isActive) setAnnotationRows(rows || []);
            })
            .catch((error) => {
                console.error('[Read] Failed to load word annotations:', error);
                if (isActive) setAnnotationRows([]);
            });
        return () => {
            isActive = false;
        };
    }, [
        activeBook?.preprocessed,
        activeBookLanguage,
        activeOwnerId,
        annotationsWanted,
        currentBook,
        preprocessStatus,
    ]);

    // Word annotations ride on the level-term list: underlined words carry their
    // pinyin / gloss, and the "all words" scope adds the rest as annotation-only.
    const readerShowPinyin = activeBookLanguage === 'zh' && Boolean(settings.pinyinAnnotations);
    const readerShowGloss = Boolean(settings.glossAnnotations);
    const hideSavedAnnotations = settings.hideSavedAnnotations !== false;
    // Settings saved before the scopes were split carried one `annotationScope`.
    const legacyScope = ANNOTATION_SCOPES.includes(settings.annotationScope) ? settings.annotationScope : null;
    const pinyinScope = ANNOTATION_SCOPES.includes(settings.pinyinScope)
        ? settings.pinyinScope
        : (legacyScope || DEFAULT_READER_SETTINGS.pinyinScope);
    const glossScope = ANNOTATION_SCOPES.includes(settings.glossScope)
        ? settings.glossScope
        : (legacyScope || DEFAULT_READER_SETTINGS.glossScope);
    // The marks slider: words below the chosen difficulty are not marked (and
    // count as plain words for the "underlined" annotation scope).
    const levelMarkThreshold = Number.isFinite(Number(settings.levelMarkThreshold))
        ? Math.min(1, Math.max(0, Number(settings.levelMarkThreshold)))
        : 0;
    const thresholdLevelTerms = useMemo(
        () => (levelMarkThreshold > 0
            ? levelUnderlineTerms.filter((term) => Number(term?.weight ?? 0) >= levelMarkThreshold)
            : levelUnderlineTerms),
        [levelUnderlineTerms, levelMarkThreshold]
    );
    const readerLevelTerms = useMemo(
        () => {
            if (!readerShowPinyin && !readerShowGloss) {
                return levelMarksEnabled ? thresholdLevelTerms : EMPTY_LEVEL_TERMS;
            }
            return buildAnnotatedLevelTerms({
                levelTerms: thresholdLevelTerms,
                annotationRows,
                marksEnabled: levelMarksEnabled,
                pinyin: readerShowPinyin,
                gloss: readerShowGloss,
                pinyinScope,
                glossScope,
                interfaceLanguage,
                hiddenSurfaces: hideSavedAnnotations ? savedSurfacesRef.current : null,
            });
        },
        [
            annotationRows,
            hideSavedAnnotations,
            readerHighlightTerms,
            pinyinScope,
            glossScope,
            interfaceLanguage,
            levelMarksEnabled,
            thresholdLevelTerms,
            readerShowGloss,
            readerShowPinyin,
        ]
    );
    // Rows above the settings tabs in the sheet: Checkpoints stays one tap away.
    const settingsSheetActions = useMemo(() => [{
        key: 'checkpoints',
        label: t('read.checkpoints'),
        icon: <MaterialIcons name="bookmark-border" size={21} color={themeColors.readerBodyInk} />,
        onPress: openNotesLog,
    }], [openNotesLog, t, themeColors.readerBodyInk]);
    const focusPanelOpen = focusMode && !!highlightedWord;
    // Total height the lookup panel occupies from the bottom of the screen;
    // the native reading surface lifts by exactly this much.
    const focusPanelTotalHeight = focusPanelOpen
        ? Math.max(0, Math.round(lookupPanelHeight))
        : 0;
    const focusControlsBaseBottom = insets.bottom + 28;
    // The position pill rides at the top of the reading surface rather than the
    // bottom: the lit sentence rests low in the viewport, so anything anchored
    // to the bottom sits on top of it. FOCUS_SPAN_TOP_MARGIN_DP in the native
    // module reserves the matching strip of reading surface, so a sentence too
    // tall to fit still stops short of the pill instead of running under it.
    const focusPillTop = (isFullscreen ? insets.top : insets.top + spacing.xs + 52) + 12;
    // Arrow controls ride 12dp above the open panel, mirroring the 28 → panel+12
    // bottom shift in the design.
    const focusControlsLiftTarget = focusPanelOpen
        ? Math.max(0, focusPanelTotalHeight + 12 - focusControlsBaseBottom)
        : 0;
    const focusSwipeTrackColor = focusSwipeKnobAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['#d2d0d0', themeColors.inkSlate],
    });
    const focusSwipeKnobLeft = focusSwipeKnobAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [3, 21],
    });

    useEffect(() => {
        Animated.timing(focusControlsTranslate, {
            toValue: -focusControlsLiftTarget,
            duration: 450,
            easing: Easing.bezier(0.22, 0.61, 0.36, 1),
            useNativeDriver: true,
        }).start();
    }, [focusControlsLiftTarget, focusControlsTranslate]);

    useEffect(() => {
        Animated.timing(focusSwipeKnobAnim, {
            toValue: focusSwipe ? 1 : 0,
            duration: 250,
            useNativeDriver: false,
        }).start();
    }, [focusSwipe, focusSwipeKnobAnim]);

    const handleFocusSentenceChange = useCallback((event = {}) => {
        publishFocusInfo({
            index: Number.isInteger(event.index) ? event.index : 0,
            count: Number.isInteger(event.count) && event.count > 0 ? event.count : 1,
            total: Number.isInteger(event.total) ? event.total : 0,
        });
        // While listening, stepping goes through the focusNav command and its
        // result (see stepOn); events matter for a new chapter or a jump
        // forward. Events for earlier sentences are the queue flushing after
        // the screen comes back on (view events wait for a frame) and must
        // not replay them.
        const previous = listenFocusRef.current;
        const sameChapter = previous?.spineIndex === currentSpineIndexRef.current;
        const behind = sameChapter && Number.isInteger(previous?.index) && event.index <= previous.index;
        if (!behind) {
            listenFocusRef.current = { ...event, spineIndex: currentSpineIndexRef.current };
        }
        rememberListenNext(event);
        const key = `${currentSpineIndexRef.current}:${event.index}:${cleanListenText(event.text)}`;
        if (listenPlayingRef.current && !behind && key !== listenSpokenKeyRef.current) {
            listenSpeakRef.current?.(event, key);
        }
    }, [publishFocusInfo]);

    const sendFocusNav = useCallback((direction) => {
        // Preferred path: call straight into the native view. Routing through
        // the focusNavToken prop re-renders the entire reader screen before
        // the beam can move, which made arrow navigation feel sluggish.
        if (supportsImperativeFocusNav) {
            const viewTag = findNodeHandle(nativeReaderViewRef.current);
            if (viewTag != null) {
                // Resolves with the step's result (the new sentence, or the
                // chapter edge); listen mode reads it, the arrows ignore it.
                return sendFocusNavCommand(viewTag, direction).catch((error) => {
                    console.warn('[Read] Focus nav failed:', error?.message ?? error);
                    return null;
                });
            }
        }

        focusNavCounterRef.current += 1;
        setFocusNavToken(`${direction}:${focusNavCounterRef.current}`);
        return Promise.resolve(null);
    }, []);

    const toggleFocusMode = useCallback(() => {
        // Persist any coalesced sentence-step position now, before the mode
        // switch emits page events in the other mode's geometry.
        flushPendingFocusPageChange();
        setShowMenu(false);
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);
        setFocusMode((current) => !current);
    }, [flushPendingFocusPageChange]);

    useEffect(() => {
        if (!currentBook || bookLoadState !== 'ready' || !hasVocabSizeGrid(activeBookLanguage)) {
            return undefined;
        }
        let cancelled = false;
        const promptKey = `vocabLevelPrompt:${activeOwnerId}:${activeBookLanguage}`;
        (async () => {
            try {
                if (await AsyncStorage.getItem(promptKey)) return;
                // Onboarding's level step already asked.
                if ((await AsyncStorage.getItem(ONBOARDING_FLOW_SEEN_KEY)) === '1') return;
                const ability = await getProfileAbility({ ownerId: activeOwnerId, language: activeBookLanguage });
                const cold = !ability
                    || (Number(ability.event_count ?? ability.eventCount ?? 0) === 0
                        && ability.self_report_rank == null && ability.selfReportRank == null);
                if (!cancelled && cold) {
                    await AsyncStorage.setItem(promptKey, '1');
                    setShowVocabLevelPrompt(true);
                }
            } catch {
                // Nothing to ask without the ability row; reading proceeds.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [currentBook, bookLoadState, activeBookLanguage, activeOwnerId]);

    // ── Listen mode ─────────────────────────────────────────────────────────
    sendFocusNavRef.current = sendFocusNav;
    listenChapterEndRef.current = handleNativeChapterEnd;
    const listenGlossIndex = useMemo(
        () => annotationsBySurface(annotationRows, interfaceLanguage),
        [annotationRows, interfaceLanguage]
    );
    const listenTargetLocale = voiceLocaleFor(activeBookLanguage);
    listenCtxRef.current = {
        targetLocale: listenTargetLocale,
        interfaceLocale: voiceLocaleFor(interfaceLanguage),
        language: activeBookLanguage,
        interfaceLanguage,
        glossIndex: listenGlossIndex,
        unavailableNotice: t('read.listenUnavailable'),
    };

    const getListenPlayer = useCallback(() => {
        if (!listenPlayerRef.current) {
            listenPlayerRef.current = createListenPlayer();
        }
        return listenPlayerRef.current;
    }, []);

    const setSpokenWord = useCallback((word) => {
        if (!supportsSpokenWord) return;
        const viewTag = findNodeHandle(nativeReaderViewRef.current);
        if (viewTag == null) return;
        sendSpokenWord(viewTag, word).catch(() => {});
    }, []);

    const pauseListening = useCallback(({ keepActive = true } = {}) => {
        listenRunRef.current += 1;
        listenPlayingRef.current = false;
        listenSpokenKeyRef.current = '';
        listenPlayerRef.current?.stop();
        setSpokenWord(null);
        setListenPlaying(false);
        if (!keepActive) {
            setListenActive(false);
        }
    }, [setSpokenWord]);
    listenPauseRef.current = pauseListening;

    // Read the focused sentence, then (study mode) each underlined word in it
    // with its meaning, then step the beam on. Every await re-checks that this
    // run is still the current one, so pause, a tap or a newer sentence stops
    // it between utterances.
    const speakFocusedSentence = useCallback(async (event, key, prepared = {}) => {
        const text = cleanListenText(event?.text);
        if (!text) return;
        const run = ++listenRunRef.current;
        listenSpokenKeyRef.current = key;
        const player = getListenPlayer();
        const ctx = listenCtxRef.current;
        const prefs = listenPrefsRef.current;
        const mine = () => run === listenRunRef.current && listenPlayingRef.current;

        // The sentence after this one, as the reader reported it: on this
        // sentence's own payload, or on the step result that moved the beam
        // here (it may still be in flight; see nextSentence below).
        const knownNext = () => (
            event?.next
            || (listenNextRef.current.index === event?.index ? listenNextRef.current.next : null)
        );
        const earlyNext = knownNext();
        const earlyNextText = earlyNext?.moved ? cleanListenText(earlyNext.text) : '';
        const nextTranslation = prefs.translateSentences && earlyNextText
            ? translateText({ query: earlyNextText, source: ctx.language, target: ctx.interfaceLanguage }).catch(() => '')
            : null;
        // One utterance the engine refuses (a lone "*", an odd symbol) is
        // skipped; only a run of failures means there is no usable voice.
        const failed = () => {
            listenErrorsRef.current += 1;
            if (listenErrorsRef.current >= LISTEN_MAX_CONSECUTIVE_ERRORS) {
                pauseListening();
                ToastAndroid.show(ctx.unavailableNotice, ToastAndroid.SHORT);
                return false;
            }
            return true;
        };
        // Step the beam and read the result straight from the command. The
        // onFocusSentenceChange event for the same sentence arrives too (when
        // the screen is on) and is ignored by its key; with the screen off it
        // never would, which is why the command's result is what drives this.
        const stepOn = async () => {
            listenSpokenKeyRef.current = '';
            const result = await sendFocusNavRef.current?.('next');
            rememberListenNext(result);
            if (!listenPlayingRef.current || !result || typeof result !== 'object') return;
            if (result.atEnd) {
                listenChapterEndRef.current?.();
                return;
            }
            if (!result.moved || !cleanListenText(result.text)) return;
            listenFocusRef.current = { ...result, spineIndex: currentSpineIndexRef.current };
            const nextKey = `${currentSpineIndexRef.current}:${result.index}:${cleanListenText(result.text)}`;
            if (nextKey !== listenSpokenKeyRef.current) {
                listenSpeakRef.current?.(result, nextKey);
            }
        };

        // The translation request runs while the sentence is being read
        // (or was already fetched while the previous sentence played).
        const translation = prefs.translateSentences
            ? (prepared.translation || translateText({ query: text, source: ctx.language, target: ctx.interfaceLanguage }).catch(() => ''))
            : null;

        let outcome = await player.speakSequence([{ text, ...listenVoiceFor(prefs, ctx.targetLocale) }]);
        if (!mine()) return;
        if (outcome === 'error') {
            if (failed()) stepOn();
            return;
        }
        listenErrorsRef.current = 0;

        if (translation) {
            const translated = cleanListenText(await translation);
            if (!mine()) return;
            if (translated) {
                outcome = await player.speakSequence([{ text: translated, ...listenVoiceFor(prefs, ctx.interfaceLocale) }]);
                if (!mine()) return;
            }
        }

        if (prefs.explainWords) {
            const words = Array.isArray(event.levelWords) ? event.levelWords : [];
            for (const word of words) {
                const wordText = cleanListenText(word?.text);
                if (!wordText) continue;
                const gloss = ctx.glossIndex.get(wordText)?.gloss || cleanListenText(word?.gloss);
                const parts = [{
                    text: wordText,
                    ...listenVoiceFor(prefs, ctx.targetLocale),
                    before: () => setSpokenWord(word),
                }];
                if (gloss) {
                    parts.push({ text: gloss, ...listenVoiceFor(prefs, ctx.interfaceLocale) });
                }
                outcome = await player.speakSequence(parts);
                if (!mine()) return;
                if (outcome === 'error' && !failed()) return;
            }
            setSpokenWord(null);
        }

        if (!mine()) return;
        // Usually known by now; if the step that brought the beam here has not
        // reported yet, wait for it rather than starting a slow step of our own.
        let peek = knownNext();
        if (!peek && listenMovingRef.current) {
            await listenMovingRef.current.catch(() => null);
            if (!mine()) return;
            peek = knownNext();
        }
        if (peek?.atEnd) {
            listenChapterEndRef.current?.();
            return;
        }
        const peekText = peek?.moved ? cleanListenText(peek.text) : '';
        if (!peekText) {
            stepOn();
            return;
        }
        // Read the next sentence straight away and move the beam alongside;
        // the step's result carries the sentence after that, and re-syncs
        // the voice if the move lands somewhere else (the reader stepped).
        const nextKey = `${currentSpineIndexRef.current}:${peek.index}:${peekText}`;
        listenFocusRef.current = { ...peek, spineIndex: currentSpineIndexRef.current };
        const moving = Promise.resolve(sendFocusNavRef.current?.('next'));
        listenMovingRef.current = moving;
        listenSpeakRef.current?.(peek, nextKey, {
            translation: earlyNextText === peekText ? nextTranslation : null,
        });
        moving.then((result) => {
            if (listenMovingRef.current === moving) listenMovingRef.current = null;
            rememberListenNext(result);
            if (!listenPlayingRef.current || !result || typeof result !== 'object') return;
            if (result.atEnd) {
                listenChapterEndRef.current?.();
                return;
            }
            if (!result.moved || result.index === peek.index) return;
            const resultKey = `${currentSpineIndexRef.current}:${result.index}:${cleanListenText(result.text)}`;
            if (resultKey !== listenSpokenKeyRef.current && cleanListenText(result.text)) {
                listenFocusRef.current = { ...result, spineIndex: currentSpineIndexRef.current };
                listenSpeakRef.current?.(result, resultKey);
            }
        }).catch(() => {});
    }, [getListenPlayer, pauseListening, setSpokenWord]);
    listenSpeakRef.current = speakFocusedSentence;

    const resumeListening = useCallback(() => {
        // The notification player needs this on Android 13+; asked once.
        if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
            PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
        }
        setListenActive(true);
        setListenPlaying(true);
        listenPlayingRef.current = true;
        listenErrorsRef.current = 0;
        if (!focusModeRef.current) {
            // Entering focus mode sends the first sentence; that starts the voice.
            toggleFocusMode();
            return;
        }
        const current = listenFocusRef.current;
        if (current?.text) {
            const key = `${currentSpineIndexRef.current}:${current.index}:${cleanListenText(current.text)}`;
            speakFocusedSentence(current, key);
        }
    }, [speakFocusedSentence, toggleFocusMode]);

    // Previous / next from the listen bar or the notification: step the beam
    // and, while playing, read the sentence the command hands back.
    const listenNav = useCallback(async (direction) => {
        const result = await sendFocusNavRef.current?.(direction);
        rememberListenNext(result);
        if (!listenPlayingRef.current || !result || typeof result !== 'object') return;
        if (result.atEnd) {
            listenChapterEndRef.current?.();
            return;
        }
        if (!result.moved || !cleanListenText(result.text)) return;
        listenFocusRef.current = { ...result, spineIndex: currentSpineIndexRef.current };
        const key = `${currentSpineIndexRef.current}:${result.index}:${cleanListenText(result.text)}`;
        if (key !== listenSpokenKeyRef.current) {
            listenSpeakRef.current?.(result, key);
        }
    }, []);
    const listenNavRef = useRef(null);
    listenNavRef.current = listenNav;

    const toggleListenPlay = useCallback(() => {
        if (listenPlayingRef.current) {
            pauseListening();
        } else {
            resumeListening();
        }
    }, [pauseListening, resumeListening]);

    const updateListenPrefs = useCallback((patch) => {
        const next = { ...listenPrefsRef.current, ...patch };
        listenPrefsRef.current = next;
        setListenPrefs(next);
        AsyncStorage.setItem(LISTEN_PREFS_KEY, JSON.stringify(next)).catch(() => {});
    }, []);

    // The voice sheet: opening it pauses the reading so samples can play, and
    // closing it picks the reading back up with the new settings.
    const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
    const [previewingVoice, setPreviewingVoice] = useState(undefined);
    const resumeAfterVoiceSheetRef = useRef(false);
    const openVoiceSheet = useCallback(() => {
        resumeAfterVoiceSheetRef.current = listenPlayingRef.current;
        if (listenPlayingRef.current) pauseListening();
        setVoiceSheetOpen(true);
    }, [pauseListening]);
    const closeVoiceSheet = useCallback(() => {
        setVoiceSheetOpen(false);
        listenPlayerRef.current?.stop();
        setPreviewingVoice(undefined);
        if (resumeAfterVoiceSheetRef.current) {
            resumeAfterVoiceSheetRef.current = false;
            resumeListening();
        }
    }, [resumeListening]);
    const previewListenVoice = useCallback(async (voiceId, patch = {}) => {
        const locale = listenCtxRef.current.targetLocale;
        const prefs = { ...listenPrefsRef.current, ...patch };
        setPreviewingVoice(voiceId);
        await getListenPlayer().speakSequence([{
            text: voiceSampleFor(locale),
            ...listenVoiceFor({ ...prefs, voices: { ...prefs.voices, [locale]: voiceId } }, locale),
        }]);
        setPreviewingVoice((current) => (current === voiceId ? undefined : current));
    }, [getListenPlayer]);
    const currentListenVoice = () => listenPrefsRef.current.voices?.[listenCtxRef.current.targetLocale] || null;
    const selectListenVoice = useCallback((voiceId) => {
        const locale = listenCtxRef.current.targetLocale;
        updateListenPrefs({ voices: { ...listenPrefsRef.current.voices, [locale]: voiceId || undefined } });
        previewListenVoice(voiceId);
    }, [previewListenVoice, updateListenPrefs]);
    const changeListenRate = useCallback((rate) => {
        updateListenPrefs({ rate });
        previewListenVoice(currentListenVoice());
    }, [previewListenVoice, updateListenPrefs]);
    const changeListenPitch = useCallback((pitch) => {
        updateListenPrefs({ pitch });
        previewListenVoice(currentListenVoice());
    }, [previewListenVoice, updateListenPrefs]);

    useEffect(() => {
        let cancelled = false;
        AsyncStorage.getItem(LISTEN_PREFS_KEY)
            .then((raw) => {
                if (cancelled || !raw) return;
                const parsed = JSON.parse(raw);
                const voices = parsed?.voices && typeof parsed.voices === 'object' ? parsed.voices : {};
                const next = {
                    rate: LISTEN_RATES.includes(parsed?.rate) ? parsed.rate : 1,
                    pitch: LISTEN_PITCHES.includes(parsed?.pitch) ? parsed.pitch : 1,
                    voices: Object.fromEntries(
                        Object.entries(voices).filter(([, id]) => typeof id === 'string' && id)
                    ),
                    explainWords: !!parsed?.explainWords,
                    translateSentences: !!parsed?.translateSentences,
                };
                listenPrefsRef.current = next;
                setListenPrefs(next);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // Leaving focus mode or switching books ends the session; unmount frees
    // the engine listeners.
    useEffect(() => {
        if (!focusMode && listenActive) {
            pauseListening({ keepActive: false });
        }
    }, [focusMode, listenActive, pauseListening]);
    useEffect(() => {
        pauseListening({ keepActive: false });
    }, [currentBook?.id, pauseListening]);
    useEffect(() => () => {
        listenPlayerRef.current?.destroy();
        listenPlayerRef.current = null;
    }, []);

    // The foreground service behind the session: keeps the process alive
    // while the voice reads in the background, and shows a player with the
    // book's title on the notification shade and lock screen.
    const listenSessionSubtitle = stripStoredPlaceholder(activeBook?.author)
        || activeChapterTitle
        || '';
    useEffect(() => {
        if (!listenActive) {
            stopListenSession();
            return;
        }
        updateListenSession({
            title: headerBookTitle,
            subtitle: listenSessionSubtitle,
            playing: listenPlaying,
            // The book's cover becomes the player's art ('' = none).
            cover: typeof activeBook?.cover === 'string' ? activeBook.cover.trim() : '',
        });
    }, [listenActive, listenPlaying, headerBookTitle, listenSessionSubtitle, activeBook?.cover]);
    useEffect(() => () => stopListenSession(), []);

    const listenResumeRef = useRef(null);
    listenResumeRef.current = resumeListening;
    useEffect(() => {
        const subscription = addListenControlListener(({ action } = {}) => {
            switch (action) {
                case 'play':
                    listenResumeRef.current?.();
                    break;
                case 'pause':
                    listenPauseRef.current?.();
                    break;
                case 'toggle':
                    if (listenPlayingRef.current) {
                        listenPauseRef.current?.();
                    } else {
                        listenResumeRef.current?.();
                    }
                    break;
                case 'next':
                    listenNavRef.current?.('next');
                    break;
                case 'previous':
                    listenNavRef.current?.('prev');
                    break;
                case 'stop':
                    listenPauseRef.current?.({ keepActive: false });
                    break;
                default:
                    break;
            }
        });
        return () => subscription.remove();
    }, []);


    return (
        <View style={styles.container}>
            {/* With no book open, the bookmark, focus, progress and menu
                controls have nothing to act on, so hide the header. */}
            {!isFullscreen && currentBook ? (
                <ReaderHeaderBar styles={chrome} topInset={insets.top}>
                    <ReaderBackButton
                        styles={chrome}
                        themeColors={themeColors}
                        onPress={goBackFromReader}
                        accessibilityLabel={t('home.backToLibrary')}
                    />
                    <ReaderCheckpointButton
                        styles={chrome}
                        themeColors={themeColors}
                        active={!!activeBookmark}
                        onPress={toggleBookmark}
                        onLongPress={openBeforeYouGo}
                        accessibilityLabel={activeBookmark ? t('read.removeBookmark') : t('read.addBookmark')}
                    />
                    <ReaderSavedWordsButton
                        styles={chrome}
                        themeColors={themeColors}
                        count={bookSavedWords.length}
                        onPress={() => openSavedPanel('saved')}
                        accessibilityLabel={t('read.savedTab', { count: bookSavedWords.length })}
                    />
                    <ReaderFocusModeButton
                        styles={chrome}
                        themeColors={themeColors}
                        style={chrome.headerGroupGap}
                        active={focusMode}
                        onPress={toggleFocusMode}
                        accessibilityLabel={t('read.focusMode')}
                    />
                    <ReaderListenButton
                        styles={chrome}
                        themeColors={themeColors}
                        style={chrome.headerGroupGap}
                        active={listenActive}
                        onPress={() => (listenActive ? pauseListening({ keepActive: false }) : resumeListening())}
                        accessibilityLabel={listenActive ? t('read.listenStop') : t('read.listen')}
                    />
                    <ReaderProgressButton
                        styles={chrome}
                        fillWidth={progressFillWidth}
                        label={progressLabel}
                        disabled={toc.length === 0}
                        onPress={() => setShowToc(true)}
                        accessibilityLabel={`${t('read.contents')}, ${progressLabel}`}
                    />
                    <ReaderFullscreenButton
                        styles={chrome}
                        themeColors={themeColors}
                        onPress={() => setIsFullscreen(true)}
                        accessibilityLabel={t('read.enterFullscreen')}
                    />
                    <ReaderMenuButton
                        styles={chrome}
                        themeColors={themeColors}
                        open={showMenu}
                        onPress={() => setShowMenu((prev) => !prev)}
                        accessibilityLabel={t('read.bookSettings')}
                    />
                </ReaderHeaderBar>
            ) : null}

            <View style={styles.reader}>
                {bookLoadState === 'error' ? (
                    <View style={styles.readerErrorState}>
                        <Text style={styles.readerErrorTitle}>{t('read.openErrorTitle')}</Text>
                        <Text style={styles.readerErrorBody}>{bookLoadError}</Text>
                        {typeof activeBookSizeMb === 'number' ? (
                            <Text style={styles.readerErrorMeta}>
                                {t('common.fileSize', { size: formatNumber(activeBookSizeMb, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                            </Text>
                        ) : null}
                        <TouchableOpacity style={styles.retryButton} onPress={retryBookLoad}>
                            <Text style={styles.retryButtonText}>{t('common.tryAgain')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : !currentBook ? (
                    <View style={styles.readerLoadingState}>
                        <MaterialIcons name="menu-book" size={28} color={themeColors.readerMutedInk} />
                        <Text style={styles.readerLoadingTitle}>{t('read.noBook')}</Text>
                        <Text style={styles.readerLoadingBody}>{t('read.noBookBody')}</Text>
                        <TouchableOpacity
                            style={styles.retryButton}
                            onPress={() => navigation?.navigate?.('Home')}
                            accessibilityRole="button"
                        >
                            <Text style={styles.retryButtonText}>{t('read.noBookAction')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : isReaderWaitingForHighlights ? (
                    <View style={styles.readerLoadingState}>
                        <ActivityIndicator size="small" color={themeColors.accentStrong} />
                        <Text style={styles.readerLoadingTitle}>{t('read.preparingHighlights')}</Text>
                        <Text style={styles.readerLoadingBody}>
                            {t('read.preparingHighlightsBody')}
                        </Text>
                    </View>
                ) : bookLoadState === 'loading' || !nativeReaderPackage ? (
                    <View style={styles.readerLoadingState}>
                        <ActivityIndicator size="small" color={themeColors.accentStrong} />
                        <Text style={styles.readerLoadingTitle}>{t('read.openingReader')}</Text>
                        <Text style={styles.readerLoadingBody}>
                            {t('read.openingReaderBody')}
                        </Text>
                    </View>
                ) : (
                    <NativeEpubReaderView
                        ref={nativeReaderViewRef}
                        key={`${currentBook}-${readerRetryKey}`}
                        style={styles.nativeReaderView}
                        bookManifest={nativeBookManifest}
                        chapterBlocks={nativeChapterBlocks}
                        chapterResources={nativeChapterResources}
                        chapterWindow={nativeChapterWindow}
                        restorePosition={nativeRestorePosition}
                        chapterTransitionDirection={chapterTransitionDirection}
                        fontSize={readerFontSize}
                        lineHeight={readerLineSpacing}
                        theme={isDarkMode ? 'dark' : 'light'}
                        themeTokens={nativeReaderThemeTokens}
                        renderMode={nativeRenderMode}
                        readerEdgeStateEnabled={false}
                        highlightTerms={readerHighlightTerms}
                        highlightStrengths={highlightStrengths}
                        levelTerms={readerLevelTerms}
                        showPinyin={readerShowPinyin}
                        showGloss={readerShowGloss}
                        tappedTerms={tappedTerms}
                        keepScreenOn={listenPlaying}
                        clearSelectionToken={clearSelectionToken}
                        focusSentenceCount={focusSpan}
                        focusSwipeEnabled={focusSwipe}
                        focusNavToken={focusNavToken}
                        focusPanelHeight={focusMode ? focusPanelTotalHeight : 0}
                        onPageChange={handleNativePageChange}
                        onChapterEnd={handleNativeChapterEnd}
                        onChapterStart={handleNativeChapterStart}
                        onChapterCommit={handleNativeChapterCommit}
                        onWordSelected={handleNativeWordSelected}
                        onTextSelected={handleNativeTextSelected}
                        onSelectionCleared={handleNativeSelectionCleared}
                        onFocusSentenceChange={handleFocusSentenceChange}
                        onExposure={handleNativeExposure}
                        onSavedTermsShown={handleSavedTermsShown}
                    />
                )}
                {readerBrightnessOverlayOpacity > 0 ? (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.readerBrightnessOverlay,
                            {
                                backgroundColor: readerBrightnessOverlayColor,
                                opacity: readerBrightnessOverlayOpacity,
                            },
                        ]}
                    />
                ) : null}
            </View>

            <TocDrawer
                visible={showToc}
                toc={toc}
                currentSpineIndex={activeSpineIndex}
                totalSpineItems={nativeChapterTotal}
                bookProgress={bookProgress}
                isDarkMode={isDarkMode}
                onClose={() => setShowToc(false)}
                onSelect={(item) => {
                    if (!Number.isInteger(item?.spineIndex)) {
                        return;
                    }

                    setShowToc(false);
                    // Same path as a checkpoint jump: it carries a seek token and
                    // sends an explicit seek for the chapter already on screen,
                    // which a bare restore-position update can't do in scroll mode.
                    handleSelectBookmark({
                        spineIndex: item.spineIndex,
                        pageIndex: 0,
                        pagesInChapter: null,
                        href: item.path || item.href || '',
                        firstBlockId: null,
                    });
                }}
            />

            {focusMode && bookLoadState === 'ready' && nativeReaderPackage ? (
                <FocusControls
                    subscribe={subscribeFocusInfo}
                    focusSpan={focusSpan}
                    focusSwipe={focusSwipe}
                    hideArrows={listenActive}
                    sendFocusNav={sendFocusNav}
                    focusControlsTranslate={focusControlsTranslate}
                    focusControlsBaseBottom={focusControlsBaseBottom}
                    focusPillTop={focusPillTop}
                    styles={chrome}
                    themeColors={themeColors}
                />
            ) : null}

            {listenActive && focusMode && bookLoadState === 'ready' && nativeReaderPackage ? (
                <ListenBar
                    playing={listenPlaying}
                    rate={listenPrefs.rate}
                    explainWords={listenPrefs.explainWords}
                    translateSentences={listenPrefs.translateSentences}
                    onTogglePlay={toggleListenPlay}
                    onPrevious={() => listenNav('prev')}
                    onNext={() => listenNav('next')}
                    onOpenVoice={openVoiceSheet}
                    onToggleExplain={() => updateListenPrefs({ explainWords: !listenPrefsRef.current.explainWords })}
                    onToggleTranslate={() => updateListenPrefs({ translateSentences: !listenPrefsRef.current.translateSentences })}
                    onClose={() => pauseListening({ keepActive: false })}
                    bottom={focusControlsBaseBottom}
                    translateY={focusControlsTranslate}
                    styles={chrome}
                    themeColors={themeColors}
                />
            ) : null}

            <ListenVoiceSheet
                visible={voiceSheetOpen}
                onClose={closeVoiceSheet}
                colors={themeColors}
                insets={insets}
                locale={listenTargetLocale}
                rate={listenPrefs.rate}
                pitch={listenPrefs.pitch}
                voiceId={listenPrefs.voices?.[listenTargetLocale] || null}
                previewingId={previewingVoice}
                onChangeRate={changeListenRate}
                onChangePitch={changeListenPitch}
                onSelectVoice={selectListenVoice}
                onPreviewVoice={previewListenVoice}
            />

            <View
                style={[
                    styles.lookupLayer,
                    shouldPlaceLookupAtTop ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    shouldPlaceLookupAtTop
                        ? { paddingTop: isFullscreen ? 0 : insets.top + spacing.xs + 52 }
                        // Focus mode anchors the panel flush to the bottom edge; in
                        // regular reading the reader content already ends at the tab
                        // bar's top edge, so the panel sits flush against that. The
                        // safe-area gap is only needed in fullscreen, where neither
                        // the tab bar nor the focus panel is anchoring the bottom.
                        : { paddingBottom: isFullscreen && !focusMode ? insets.bottom + 6 : 0 },
                ]}
                pointerEvents="box-none"
            >
                <View
                    onLayout={(event) => {
                        setLookupPanelHeight(event?.nativeEvent?.layout?.height ?? 0);
                    }}
                    {...(shouldPlaceLookupAtTop ? {} : lookupPanResponder.panHandlers)}
                >
                    <TopSection
                        highlightedWord={highlightedWord}
                        sourceSentence={highlightedWordContext?.sentence ?? ''}
                        isNativeSelection={isNativeSelection}
                        onExtendSelection={supportsExtendSelection ? handleExtendSelection : undefined}
                        placement={shouldPlaceLookupAtTop ? 'top' : 'bottom'}
                        bottomInset={focusMode ? 0 : insets.bottom}
                        isDarkMode={isDarkMode}
                        onClose={dismissLookup}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        onSavedWordsChanged={refreshBookSavedWords}
                        currentBook={currentBook}
                        sourceBook={activeBook}
                        savedWords={savedWordsList}
                        translationVisualState={translationBannerVisualState}
                    />
                </View>
            </View>

            {/* First-run tip. Floats above the bottom edge so it never covers
                the book title or the header (in fullscreen the header is gone
                and the top of the page is the title). Focus mode has its own
                position pill and controls, so the tip stays out of the way
                there. */}
            {currentBook && !highlightedWord && !focusMode && (showLookupHint || currentChapterPreparing) ? (
                <View
                    pointerEvents="box-none"
                    style={[styles.hintLayer, { bottom: insets.bottom + 16 }]}
                >
                    {currentChapterPreparing ? (
                        <View
                            style={[styles.hintCard, styles.preparingCard]}
                            accessibilityLiveRegion="polite"
                            accessibilityRole="progressbar"
                        >
                            <ActivityIndicator size="small" color={themeColors.textTertiary} style={styles.hintIcon} />
                            <View style={styles.hintTextStack}>
                                <Text style={styles.hintText}>{t('read.preparingWords')}</Text>
                                <Text style={styles.hintSubtext}>{t('read.preparingWordsDetail')}</Text>
                            </View>
                        </View>
                    ) : null}
                    {showLookupHint ? (
                        <View style={styles.hintCard}>
                            <Feather name="info" size={16} color={themeColors.textTertiary} style={styles.hintIcon} />
                            <View style={styles.hintTextStack}>
                                <Text style={styles.hintText}>
                                    {t('read.tapHint')}
                                </Text>
                                <Text style={styles.hintSubtext}>
                                    {t('read.longPressHint')}
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={dismissLookupHint}
                                style={styles.hintCloseButton}
                                accessibilityRole="button"
                                accessibilityLabel={t('common.close')}
                            >
                                <Feather name="x" size={16} color={themeColors.textTertiary} />
                            </TouchableOpacity>
                        </View>
                    ) : null}
                </View>
            ) : null}

            <ReaderSettingsSheet
                visible={showMenu && !isFullscreen}
                onClose={() => setShowMenu(false)}
                colors={themeColors}
                insets={insets}
                title={t('read.bookSettings')}
                language={activeBookLanguage}
                settings={settings}
                onSettingChange={handleSettingChange}
                onResetTextSettings={resetBookSettings}
                onResetWordSettings={resetWordSettings}
                onResetFocusSettings={resetFocusSettings}
                actions={settingsSheetActions}
            />

            <SavedWordsPanel
                visible={showSavedPanel}
                colors={themeColors}
                insets={insets}
                initialTab={savedPanelTab}
                savedWords={bookSavedWords}
                candidates={panelCandidates}
                candidatesLoading={panelCandidatesLoading}
                savedStems={panelSavedStems}
                onSaveCandidate={handleSaveCandidate}
                onClose={() => setShowSavedPanel(false)}
            />

            <VocabLevelModal visible={showVocabLevelPrompt} onClose={() => setShowVocabLevelPrompt(false)} />

            <BeforeYouGoSheet
                visible={showBeforeYouGo}
                colors={themeColors}
                insets={insets}
                onSaveNote={handleSaveNote}
                onClose={() => setShowBeforeYouGo(false)}
            />

            <NotesLogSheet
                visible={showNotesLog}
                colors={themeColors}
                insets={insets}
                bookmarks={bookBookmarks}
                notes={bookNotes}
                onSelectBookmark={handleSelectBookmark}
                onDeleteBookmark={handleDeleteBookmark}
                onDelete={handleDeleteNote}
                onClose={() => setShowNotesLog(false)}
            />

        </View>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    reader: {
        flex: 1,
        position: 'relative',
    },
    nativeReaderView: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    readerBrightnessOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000000',
    },
    readerErrorState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.md,
    },
    readerErrorTitle: {
        ...textStyles.title,
        color: themeColors.readerBodyInk,
        textAlign: 'center',
    },
    readerErrorBody: {
        ...textStyles.bodyMuted,
        color: themeColors.readerMutedInk,
        textAlign: 'center',
    },
    readerErrorMeta: {
        ...textStyles.caption,
        color: themeColors.readerSubtleInk,
        textAlign: 'center',
    },
    readerLoadingState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.sm,
    },
    readerLoadingTitle: {
        ...textStyles.label,
        textAlign: 'center',
        color: themeColors.readerBodyInk,
    },
    readerLoadingBody: {
        ...textStyles.caption,
        textAlign: 'center',
        color: themeColors.readerMutedInk,
        maxWidth: 280,
    },
    retryButton: {
        minWidth: 132,
        minHeight: 44,
        borderRadius: radii.pill,
        backgroundColor: themeColors.readerSavedChipBg,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        marginTop: spacing.sm,
    },
    retryButtonText: {
        ...textStyles.body,
        color: themeColors.readerSavedChipText,
    },
    lookupLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
    lookupLayerTop: {
        justifyContent: 'flex-start',
    },
    lookupLayerBottom: {
        justifyContent: 'flex-end',
    },
    hintLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        paddingHorizontal: 16,
    },
    hintCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        borderRadius: 14,
        backgroundColor: themeColors.surface,
        borderWidth: 1,
        borderColor: themeColors.divider,
        paddingLeft: 14,
        paddingRight: 4,
        paddingVertical: 4,
        shadowColor: 'rgba(27, 28, 28, 0.08)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 3,
    },
    hintIcon: {
        marginTop: 12,
    },
    preparingCard: {
        // No close button: leave the same room on the right as the text's left.
        paddingRight: 14,
        marginBottom: 8,
    },
    hintTextStack: {
        flex: 1,
        minWidth: 0,
        gap: 2,
        paddingVertical: 9,
    },
    hintText: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 14,
        lineHeight: 19,
        color: themeColors.text,
    },
    hintSubtext: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: themeColors.textTertiary,
    },
    hintCloseButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default Read;
