import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { Animated, AppState, BackHandler, Easing, PanResponder, View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, findNodeHandle, ToastAndroid } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import TopSection from '../components/Read/TopSection/TopSection';
import SentenceTranslationPopup from '../components/Read/SentenceTranslationPopup';
import SelectionExplainPanel from '../components/Read/SelectionExplainPanel';
import { chapterTranslations } from '../services/chapterTranslations';
import TocDrawer from '../components/Read/TocDrawer';
import FocusControls from '../components/Read/FocusControls';
import {
    ReaderBackButton,
    ReaderCheckpointButton,
    ReaderHeaderBar,
    ReaderMenuButton,
    ReaderProgressButton,
} from '../components/Read/ReaderHeaderBar';
import { navigationButtonsInset } from '../hooks/useNavigationButtonsInset';
import usePresence from '../hooks/usePresence';
import useReduceMotion from '../hooks/useReduceMotion';
import { isLocationJump, isNearPosition, pageInLayout } from '../services/locationJump';
import { readerBackLayer } from '../services/readerBackLayer';
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
    sendSpokenRange,
    supportsSpokenRange,
    updateListenSession,
    stopListenSession,
    addListenControlListener,
} from '../modules/native-epub-reader/src/NativeEpubReaderView';
import { ensureNotificationPermission } from '../services/notificationPermission';
import {
    claimListenSession,
    mayUseListenSession,
    ownsListenSession,
    releaseListenSession,
} from '../services/listenOwner';
import ListenBar from '../components/Read/ListenBar';
import ListenVoiceSheet from '../components/Read/ListenVoiceSheet';
import VocabLevelModal from '../components/shared/VocabLevelModal';
import { hasVocabSizeGrid } from '../services/vocabSizeLevels';
import { createListenPlayer, voiceLocaleFor, voiceSampleFor, LISTEN_PITCHES, LISTEN_RATES } from '../services/listenPlayer';
import { remainingFrom, spokenRangeAt } from '../services/listenSpokenWord';
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
    onReaderLevelChanged,
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
import {
    donePiecesForLayout,
    pieceForPosition,
    piecesToPrepare,
    splitChapterForPreprocess,
    storedChapterProgress,
    storedProgressCoversNeighbor,
} from '../services/preprocessPieces';
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
import { loadLevelReaderTerms } from '../hooks/useLevelUnderlineTerms';
import useLookupDetail, { LOOKUP_ACTIONS } from '../hooks/useLookupDetail';
import { scheduleLevelRefit } from '../services/levelRefitScheduler';
import { bookIndexLanguages, tagPreprocessCacheEntries } from '../services/preprocessCacheEntries';
import { selectExposureCredits } from '../services/readerExposure';
import useSavedWordFades from '../hooks/useSavedWordFades';
import { ONBOARDING_FLOW_SEEN_KEY } from './Onboarding';
import { getSyncStatus, markSyncPending, subscribeSyncStatus } from '../services/syncStatus';
import { blockIdForAnchor, tocAnchorFromHref } from '../services/tocAnchors';
import {
    chapterMarks,
    positionForStoryProgress,
    storyBoundsForBook,
    storyProgress,
    storyRange,
    storyStartBlockId,
} from '../services/storyRange';
import PageScrubber, { PAGE_SCRUBBER_HEIGHT } from '../components/Read/PageScrubber';
import {
    noteReadingActivity,
    startReadingClock,
    stopReadingClock,
    subscribeGoalReached,
} from '../services/readingGoal';
import GoalCompleteModal from '../components/Goal/GoalCompleteModal';
import { endBookOpening, isBookOpening, subscribeBookOpening } from '../services/bookOpening';
import PreparingNotice from '../components/Read/PreparingNotice';
import LocationPrompt from '../components/Read/LocationPrompt';
import { publishReaderListen, registerReaderListenCommands } from '../services/readerListenState';
import { CommonActions, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { highlightStrengthsFor, unseenShownTerms } from '../services/savedWordFade';
import {
    ANNOTATION_SCOPES,
    annotationsBySurface,
    buildAnnotatedLevelTerms,
    withPhraseTapTerms,
} from '../services/readerAnnotations';
import { createNativeReaderThemeTokens, fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';

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
    // New readers start in scroll mode.
    readingMode: 'scroll',
    levelMarkStyle: 'underline',
    // 0..1: only words at least this hard on the green→red scale are marked
    // (0 = every graded word, 1 = only the hardest). New readers start in the
    // middle, so the page isn't underlined wall to wall.
    levelMarkThreshold: 0.5,
    // Chinese only: draw pinyin above words. Loosens line spacing when on, so
    // it re-paginates. Ignored for non-Chinese books.
    pinyinAnnotations: false,
    // Short translation under words (any language). Also re-paginates. On for
    // new readers, for the underlined words (glossScope).
    glossAnnotations: true,
    // Which words get pinyin / translations: 'underlined' (graded words) or
    // 'all' (every word in the book), chosen separately for each.
    pinyinScope: 'underlined',
    glossScope: 'underlined',
    // No pinyin / translation on saved (highlighted) words, so the reader can
    // try to recall a word they looked up before.
    hideSavedAnnotations: true,
};
const READING_MODES = ['paged', 'scroll'];
// A relayout's page events (the same spot, renumbered) arrive within this long.
const SEEK_SETTLE_MS = 1500;
// A jump the reader asked for lands within this long (another chapter has to
// be read in and laid out first).
const DELIBERATE_JUMP_MS = 6000;
// The play button over the bottom line's right end, and its gap above it.
const PLAY_BUTTON_SIZE = 44;
const PLAY_BUTTON_GAP = 12;
// The header and the scrubber slide away (full screen, focus mode) and back
// in this long, and the page slides with them.
const CHROME_SLIDE_MS = 260;
const CHROME_EASING = Easing.bezier(0.22, 0.61, 0.36, 1);

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
// Reading this long is a session worth refitting the level after.
const REFIT_SESSION_MS = 60 * 1000;
const EMPTY_LEVEL_TERMS = [];

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 30;
// Focus mode emits a page event on every sentence step; persisting each one
// (screen state + library patch + AsyncStorage write) is what made beam
// navigation feel sluggish, so steps coalesce to the trailing event.
const FOCUS_PAGE_CHANGE_DEBOUNCE_MS = 400;
// How long a book that is just opening holds back its neighbour prefetch and
// preprocessing: past the first page's paint and the opening screen's fade.
const OPENING_BACKGROUND_WORK_DELAY_MS = 400;
// The same stops as services/readerSettings.js READER_LINE_SPACING_STEPS.
const LINE_SPACING_STEPS = [
    { value: 1.2 },
    { value: 1.3 },
    { value: 1.4 },
    { value: 1.5 },
    { value: 1.65 },
    { value: 1.85 },
    { value: 2.05 },
    { value: 2.3 },
    { value: 2.6 },
];
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



// Cover pages at the front of the spine (a cover image wrapper): they hold no
// reading, so progress starts after them. Without this a short picture book
// with a cover and one story file read 50% on its first page.
const COVER_SPINE_RE = /(^|[^a-z])cover/i;
const leadingCoverCount = (spine = []) => {
    let count = 0;
    while (count < spine.length - 1) {
        const item = spine[count] || {};
        const label = `${item.idref || ''} ${item.href || ''} ${item.path || ''}`;
        if (!COVER_SPINE_RE.test(label)) break;
        count += 1;
    }
    return count;
};

// The part of a spine progress counts over. The library's public-domain books
// get the story's range (services/storyRange.js: first chapter to the end of
// the story); a reader's own books, whose make-up we don't know, everything
// after a leading cover. `bounds`: the library book's measured main content
// (storyBoundsForBook), which can start and end inside a file. Kept per spine
// array.
const storyRangeCache = new WeakMap();
const storyRangeForSpine = (spine, toc, curated = false, bounds = null) => {
    if (!Array.isArray(spine) || spine.length === 0) return null;
    const cached = storyRangeCache.get(spine);
    if (cached && cached.toc === toc && cached.curated === curated && cached.bounds === bounds) return cached.range;
    const range = curated
        ? storyRange(spine, Array.isArray(toc) ? toc : [], bounds)
        : { start: leadingCoverCount(spine), end: spine.length - 1 };
    storyRangeCache.set(spine, { toc, curated, bounds, range });
    return range;
};

// Public-domain books from the app's library (bundled or downloaded).
const isCuratedBook = (book) => Boolean(
    book?.publicDomain || book?.publicLibraryId || book?.publicLibraryStoragePath || book?.storagePath
);

// Progress through the book, weighted by chapter size: for the library's
// books 0% at the story's first chapter and 100% at its end.
const progressForBookPosition = (spineIndex, totalSpineItems, pageIndex = null, pagesInChapter = null, spine = null, toc = null, curated = false, bounds = null) => {
    if (!Number.isInteger(spineIndex) || totalSpineItems <= 0) {
        return null;
    }
    if (Array.isArray(spine) && spine.length === totalSpineItems) {
        return storyProgress(spine, storyRangeForSpine(spine, toc, curated, bounds), spineIndex, pageIndex, pagesInChapter);
    }
    const covers = Array.isArray(spine) ? leadingCoverCount(spine) : 0;
    if (covers > 0) {
        if (spineIndex < covers) return 0;
        return progressForBookPosition(spineIndex - covers, totalSpineItems - covers, pageIndex, pagesInChapter);
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

// Word help is prepared ahead of the reader: the open chapter, then the next
// two, then the one before (for a step back). Each only in the pieces near the
// reader (see services/preprocessPieces).
const CHAPTER_PREPROCESS_AHEAD = 2;
const CHAPTER_PREPROCESS_BEHIND = 1;

const buildChapterPreprocessOrder = (centerSpineIndex, totalSpineItems) => {
    if (!Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
        return [];
    }

    const order = [centerSpineIndex];
    for (let offset = 1; offset <= CHAPTER_PREPROCESS_AHEAD; offset += 1) {
        if (centerSpineIndex + offset < totalSpineItems) {
            order.push(centerSpineIndex + offset);
        }
    }
    for (let offset = 1; offset <= CHAPTER_PREPROCESS_BEHIND; offset += 1) {
        if (centerSpineIndex - offset >= 0) {
            order.push(centerSpineIndex - offset);
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
    // A long-press selection: { text, sentence, spineIndex, blockId, start,
    // end }. It opens the AI explanation in a bottom panel (in place of the
    // lookup panel).
    const [textSelection, setTextSelection] = useState(null);
    // Where the reader was before jumping to a bookmark from the notes log; a
    // pill offers the way back.
    // After a sudden jump, the spot the reader left ({ position, progress })
    // is held: not overwritten by where they are now until they confirm the
    // new spot (locationPrompt) or come back to it. The scrubber marks it.
    const [heldSpot, setHeldSpot] = useState(null);
    const heldSpotRef = useRef(null);
    heldSpotRef.current = heldSpot;
    const [locationPrompt, setLocationPrompt] = useState(false);
    const lastViewedSpotRef = useRef(null);
    // Set by a jump the reader asked for, until its page event arrives.
    const deliberateJumpRef = useRef(false);
    const lastPageEventRef = useRef(null);
    const stepsSincePromptRef = useRef(0);
    const processNativePageChangeRef = useRef(null);
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    // Temporary handoff QA toggles for the long-press translation banner.
    const [translationBannerLoadingPreview] = useState(false);
    const [translationBannerErrorPreview] = useState(false);
    const [translationBannerCopiedPreview] = useState(false);
    const [translationBannerTextPreview] = useState('');
    // The reader stays mounted behind other tabs.
    const readerFocused = useIsFocused();
    // Coming to the reader (opening a book, switching tabs) fades and lifts
    // the page in, rather than cutting to it.
    const enterAnim = useRef(new Animated.Value(1)).current;
    const enterShift = useMemo(() => enterAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [14, 0],
    }), [enterAnim]);
    useFocusEffect(useCallback(() => {
        enterAnim.setValue(0);
        Animated.timing(enterAnim, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [enterAnim]));
    // The open chapter's words (underlines, translations, levels) are still
    // being fetched: the reader shows a short "getting ready" note meanwhile.
    const [currentChapterPreparing, setCurrentChapterPreparing] = useState(false);
    // After the chapter itself is processed, its underlines, the translations
    // under words and the sentence translations still load; the "preparing"
    // notice stays until they are in (preparingNoticeVisible, below).
    const [levelTermsLoading, setLevelTermsLoading] = useState(false);
    const [annotationsLoading, setAnnotationsLoading] = useState(false);
    const [chapterTranslating, setChapterTranslating] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    // The settings tab to open on (Profile → "Underlines feel off?" opens Words).
    const [settingsTab, setSettingsTab] = useState('text');
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
    // Known words in the level sample: reported as read past, never drawn.
    const [levelExposureTerms, setLevelExposureTerms] = useState([]);
    // The book's phrases ("gave up"), underlined or not (see withPhraseTapTerms).
    const [levelPhraseSurfaces, setLevelPhraseSurfaces] = useState([]);
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

    // The book-opening screen Home put up (services/bookOpening.js) goes once
    // this book is laid out, or failed to load. Which book settled is noted on
    // the load state's own changes: right after a switch the state still says
    // the last book's "ready" for a render, and that must not count.
    const settledBookRef = useRef(null);
    useEffect(() => {
        settledBookRef.current = bookLoadState === 'ready' || bookLoadState === 'error' ? currentBook : null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookLoadState]);
    // Checked from a ref, not state: the opening screen coming and going must
    // not re-render the whole reader while it is laying the book out.
    const endBookOpeningIfSettledRef = useRef(null);
    endBookOpeningIfSettledRef.current = () => {
        if (!isBookOpening() || !readerFocused || !currentBook) return;
        if (settledBookRef.current === currentBook) endBookOpening();
    };
    useEffect(() => subscribeBookOpening(() => endBookOpeningIfSettledRef.current?.()), []);
    useEffect(() => {
        endBookOpeningIfSettledRef.current?.();
    }, [bookLoadState, currentBook, readerFocused]);

    // ── Focus (sentence beam) mode ───────────────────────────────────────────
    const [focusMode, setFocusMode] = useState(false);
    const [focusNavToken, setFocusNavToken] = useState('none:0');
    // Listen mode: the phone's text-to-speech reads the focused sentence and
    // steps the beam on; study mode stops on each underlined word first.
    // Cold start: a profile with no reading history yet is asked for its
    // vocabulary size once, the first time a book opens.
    const [showVocabLevelPrompt, setShowVocabLevelPrompt] = useState(false);
    const [listenActive, setListenActive] = useState(false);
    // Sentence of the last tapped word, for the translation popup at the top.
    // The popup shows it only while the word's lookup is open.
    const [pinnedSentence, setPinnedSentence] = useState('');
    const [listenPlaying, setListenPlaying] = useState(false);
    const [listenPrefs, setListenPrefs] = useState(DEFAULT_LISTEN_PREFS);
    const listenPrefsRef = useRef(DEFAULT_LISTEN_PREFS);
    const listenPlayingRef = useRef(false);
    const listenPlayerRef = useRef(null);
    const listenFocusRef = useRef(null);
    // Listening turned focus mode on (and should turn it off when it ends),
    // and is waiting for focus mode's first sentence to start reading.
    const listenEnteredFocusRef = useRef(false);
    const listenStartPendingRef = useRef(false);
    const listenSpokenKeyRef = useRef('');
    // How far the voice got in the sentence it is reading ({ key, offset },
    // offset into the cleaned text): play after a pause picks up there.
    const listenReachedRef = useRef(null);
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
    // The voice was stopped for a lookup panel and goes on when it closes.
    const resumeAfterPanelRef = useRef(false);
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
    // The open chapter's piece being prepared around, and a run asked for
    // while one was going (the reader reached a new piece): it goes next.
    const preprocessWindowRef = useRef({ bookUri: null, spineIndex: null, piece: null });
    const pendingChapterPreprocessRef = useRef(null);
    const startChapterPreprocessingRef = useRef(null);
    // The open chapter's pieces, worked out once per chapter for page turns.
    const preprocessLayoutRef = useRef({ readerPackage: null, layout: null });
    const readingSessionStartedAtRef = useRef(Date.now());
    const readingSessionOwnerIdRef = useRef(activeOwnerId);
    // The language of the book being read, for the level refit when it closes.
    const readingSessionLanguageRef = useRef(null);
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
    const glossedSurfacesRef = useRef(new Set());
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
    const lastSeekAtRef = useRef(0);
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
    // The library's books get the story-range treatment (see isCuratedBook).
    const curatedBook = isCuratedBook(activeBook);
    const curatedBookRef = useRef(curatedBook);
    curatedBookRef.current = curatedBook;
    // Where a library book's main content starts and ends (past the preface,
    // the notes to teachers, before the word list), measured offline.
    const storyBounds = useMemo(() => storyBoundsForBook(activeBook), [activeBook?.publicLibraryId]);
    const storyBoundsRef = useRef(storyBounds);
    storyBoundsRef.current = storyBounds;
    const activeBookLanguage = activeBook ? selectedBookLanguage : targetLanguage;
    const noteLookupAction = useLookupDetail({
        word: highlightedWord,
        ownerId: activeOwnerId,
        language: activeBookLanguage,
        sourceBookUri: currentBook,
    });
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
    // A level picked in Profile or a word check re-shades the open book at
    // once (lookups don't: mid-read re-shading would be unsettling).
    const [levelVersion, setLevelVersion] = useState(0);
    useEffect(() => onReaderLevelChanged(() => setLevelVersion((value) => value + 1)), []);

    useEffect(() => {
        if (!currentBook) {
            setLevelUnderlineTerms([]);
            setLevelExposureTerms([]);
            setLevelPhraseSurfaces([]);
            setLevelTermsLoading(false);
            return;
        }

        let isActive = true;
        setLevelTermsLoading(true);

        const loadTerms = () => loadLevelReaderTerms({
            ownerId: activeOwnerId,
            bookUri: currentBook,
            language: activeBookLanguage,
        });

        loadTerms().then(({ terms, exposureTerms, phraseSurfaces = [] }) => {
            if (isActive) {
                setLevelUnderlineTerms(terms);
                setLevelExposureTerms(exposureTerms);
                setLevelPhraseSurfaces(phraseSurfaces);
            }
        }).catch((error) => {
            console.error('[Read] Failed to load book level underline surfaces:', error);
            if (isActive) {
                setLevelUnderlineTerms([]);
                setLevelExposureTerms([]);
                setLevelPhraseSurfaces([]);
            }
        }).finally(() => {
            if (isActive) setLevelTermsLoading(false);
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
        levelVersion,
        preprocessStatus,
    ]);

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        const elapsed = Date.now() - readingSessionStartedAtRef.current;
        const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
        if (elapsed >= 5000) {
            addReadingMillis(sessionOwnerId, elapsed);
        }
        if (elapsed >= REFIT_SESSION_MS && readingSessionLanguageRef.current) {
            scheduleLevelRefit({ ownerId: sessionOwnerId, language: readingSessionLanguageRef.current, afterSession: true });
        }
        readingSessionLanguageRef.current = currentBook ? activeBookLanguage : null;

        // A coalesced focus-mode step captured its own processor (closing over
        // the previous book), so flushing here still records the position the
        // reader left off at before the switch resets everything below.
        flushPendingFocusPageChange();

        setPreprocessStatus('idle');
        setCurrentChapterPreparing(false);
        extractedTextRef.current = null;
        preprocessingInFlightRef.current = false;
        activeChapterPreprocessRef.current = { bookUri: null, centerSpineIndex: null };
        preprocessWindowRef.current = { bookUri: null, spineIndex: null, piece: null };
        pendingChapterPreprocessRef.current = null;
        chapterPreprocessTokenRef.current += 1;
        readingSessionStartedAtRef.current = Date.now();
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
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
        // Opening the app: refit the level from everything read so far, once
        // the database has had a moment to open.
        const timer = setTimeout(() => {
            scheduleLevelRefit({ ownerId: activeOwnerId, language: activeBookLanguage });
        }, 5000);
        return () => {
            clearTimeout(timer);
            const elapsed = Date.now() - readingSessionStartedAtRef.current;
            const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
            if (elapsed >= 5000) {
                addReadingMillis(sessionOwnerId, elapsed);
            }
            if (elapsed >= REFIT_SESSION_MS && readingSessionLanguageRef.current) {
                scheduleLevelRefit({ ownerId: sessionOwnerId, language: readingSessionLanguageRef.current, afterSession: true });
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
            }).then(() => {
                failedProgressBookRef.current = null;
            }).catch((error) => {
                // Offline, most likely: Profile shows "not synced yet", and the
                // push runs again when the network is back (below).
                failedProgressBookRef.current = book;
                markSyncPending();
                console.warn('[Read] Cloud progress sync failed:', error);
            });
        }, 3000);
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

    const failedProgressBookRef = useRef(null);
    const scheduleCloudProgressSyncRef = useRef(scheduleCloudProgressSync);
    scheduleCloudProgressSyncRef.current = scheduleCloudProgressSync;
    useEffect(() => {
        let wasOnline = getSyncStatus().online;
        return subscribeSyncStatus((status) => {
            const cameBack = status.online && !wasOnline;
            wasOnline = status.online;
            if (cameBack && failedProgressBookRef.current) {
                scheduleCloudProgressSyncRef.current(failedProgressBookRef.current);
            }
        });
    }, []);

    const handleWordSave = useCallback((word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        noteLookupAction(LOOKUP_ACTIONS.saved);
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
    }, [highlightedWord, noteLookupAction]);

    const handleWordUnsave = useCallback((word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        // A gentler tick for the undo — lighter than the save on purpose.
        tapUndo();
        setSavedWords(prev => (prev ?? []).filter(w => w !== word));
        setOptimisticHighlightTerms(prev => prev.filter(term => term !== word && term !== surface));
    }, [highlightedWord]);

    // A ref lets the native selection callbacks read the latest focus state
    // without being re-created (which would churn the native view's props).
    const focusModeRef = useRef(false);
    useEffect(() => {
        focusModeRef.current = focusMode;
    }, [focusMode]);
    // A lookup panel is up: the dictionary, or the AI explanation (only ever
    // one of them).
    const lookupOpen = Boolean(highlightedWord) || Boolean(textSelection);
    const lookupOpenRef = useRef(lookupOpen);
    lookupOpenRef.current = lookupOpen;
    // Listen mode's "wait while a panel is up" (see holdListeningForPanel).
    const holdListeningForPanelRef = useRef(null);

    const handleNativeWordSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        // A word tap with the panel already open looks the new word up (the
        // panel stays and changes); a tap on blank space closes it through
        // onSelectionCleared. A light tick so the lookup feels physical.
        tapSelect();
        // Straight away, not after the panel renders: the voice stops on the tap.
        holdListeningForPanelRef.current?.();

        const sentence = typeof event.sentence === 'string' ? event.sentence.trim() : '';
        // A tap inside a marked phrase ("gave up"): text is the phrase, this is
        // the word tapped in it, which the phrase's card offers as a chip.
        const phraseWord = typeof event.phraseWord === 'string' ? event.phraseWord.trim() : '';

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
        // The dictionary takes the AI explanation's place: one panel at a time.
        setTextSelection(null);
        setHighlightedWord(text);
        setHighlightedWordContext({
            sentence,
            phraseWord: phraseWord && phraseWord !== text ? phraseWord : '',
        });
        setPinnedSentence(sentence || text);

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

    // `fromTap`: the page itself was tapped on blank space. With nothing open
    // that brings the controls back from full screen (reading on hides them).
    const handleNativeSelectionCleared = useCallback((event = {}) => {
        if (event?.fromTap && !lookupOpenRef.current) {
            setIsFullscreen(false);
        }
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setTextSelection(null);
    }, []);

    const handleNativeTextSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        holdListeningForPanelRef.current?.();
        setIsNativeSelection(true);
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setTextSelection({
            text,
            sentence: typeof event.sentence === 'string' ? event.sentence.trim() : '',
            spineIndex: Number.isInteger(event.spineIndex) ? event.spineIndex : null,
            blockId: typeof event.blockId === 'string' ? event.blockId : null,
            start: Number.isInteger(event.sourceStartOffset) ? event.sourceStartOffset : null,
            end: Number.isInteger(event.sourceEndOffset) ? event.sourceEndOffset : null,
        });
        extendingSelectionRef.current = false;
        // The explanation always opens at the bottom, like a sheet.
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

    // Focus mode (where a "page" is a sentence) and the reader settings lay
    // the chapter out again; the page events that follow are the same spot,
    // renumbered, not a jump (see processNativePageChange). Full screen
    // doesn't: the controls lie over the page. A layout effect, so it's
    // stamped before the native view reports.
    const layoutChangedAtRef = useRef(0);
    useLayoutEffect(() => {
        layoutChangedAtRef.current = Date.now();
    }, [focusMode, settings]);

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

    // `keepSelection`: a setting that doesn't change the page (the translation
    // card's collapsed state) leaves the open lookup alone.
    const updateSettings = (patch, { keepSelection = false } = {}) => {
        if ('isDarkMode' in patch) {
            setIsDarkMode(patch.isDarkMode);
        }
        const newSettings = {
            ...settings,
            isDarkMode,
            ...patch,
        };
        if (!keepSelection) {
            setHighlightedWord('');
            setHighlightedWordContext(null);
            setIsNativeSelection(false);
            setTextSelection(null);
            setClearSelectionToken((current) => current + 1);
        }
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

    // The reader has no tab bar, so back (the header's chevron or the
    // hardware button) is the way out: to the tab the reader came from, else
    // Home. Either way the book leaves the tab history. Navigating to Home
    // instead would leave it there, and back on Home would reopen the book,
    // round and round.
    const goBackFromReader = useCallback(() => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
            return;
        }
        const state = navigation?.getState?.();
        const home = state?.routes?.find((route) => route.name === 'Home');
        if (!home) {
            navigation?.navigate?.('Home');
            return;
        }
        navigation.dispatch(CommonActions.reset({
            ...state,
            index: state.routes.indexOf(home),
            history: [{ type: 'route', key: home.key }],
        }));
    }, [navigation]);

    const dismissLookup = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setTextSelection(null);
        setClearSelectionToken((value) => value + 1);
    }, []);

    // ── The long-press AI explanation ────────────────────────────────────────
    const renderSelectionExplain = () => (
        <SelectionExplainPanel
            text={textSelection.text}
            sentence={textSelection.sentence}
            language={activeBookLanguage}
            interfaceLanguage={interfaceLanguage}
            bottomInset={focusMode ? navigationButtonsInset(insets.bottom) : insets.bottom}
            ownerId={activeOwnerId}
            bookUri={currentBook}
            bookTitle={activeBook?.title ?? null}
        />
    );

    // Save a phrase from the AI explanation as a vocab card, with its short
    // meaning as the definition (like saving a word from the lookup panel).
    // Hardware back steps out of transient reader chrome one layer at a time:
    // the options dropdown, then the open lookup panel (the dictionary card or
    // the long-press AI explanation, see readerBackLayer), then fullscreen. Focus
    // mode is deliberately NOT unwound here — from focus mode back leaves the
    // reader like any other read view, and when focus mode is also fullscreen
    // back only drops fullscreen (leaving focus mode intact). Only registers
    // when one of those layers is active so normal back behaviour is untouched
    // otherwise.
    useEffect(() => {
        const layer = readerBackLayer({ showMenu, lookupOpen, isFullscreen });
        if (!layer) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (layer === 'menu') {
                setShowMenu(false);
            } else if (layer === 'lookup') {
                // Also clears the native selection highlight.
                dismissLookup();
            } else {
                setIsFullscreen(false);
            }
            return true;
        });
        return () => subscription.remove();
    }, [showMenu, isFullscreen, lookupOpen, dismissLookup]);

    // Last resort while the reader is on screen: back leaves the book like the
    // header's chevron, rather than closing the app (the history can hold only
    // this screen when Android restores the app into a book). Registered on
    // focus, so the layer handler above (added later) runs first.
    useFocusEffect(useCallback(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            goBackFromReader();
            return true;
        });
        return () => subscription.remove();
    }, [goBackFromReader]));

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
    // What a tapped word was to the level model (recorded on the lookup):
    // 1 underlined (drawn or not), 2 a sampled known word, 0 neither, 3 shown
    // with a translation (not evidence: see glossedSurfacesRef).
    const levelMarkSets = useMemo(() => ({
        underlined: new Set(levelUnderlineTerms.map((term) => term.text)),
        sampled: new Set(levelExposureTerms.map((term) => term.text)),
    }), [levelUnderlineTerms, levelExposureTerms]);
    const levelMarkFor = useCallback((surface) => {
        const text = typeof surface === 'string' ? surface.trim() : '';
        if (glossedSurfacesRef.current.has(text)) return 3;
        if (levelMarkSets.underlined.has(text)) return 1;
        if (levelMarkSets.sampled.has(text)) return 2;
        return 0;
    }, [levelMarkSets]);
    levelUnderlineStemsRef.current = useMemo(
        () => new Map([...levelUnderlineTerms, ...levelExposureTerms]
            .filter((term) => term.stem)
            .map(({ text, stem }) => [text, stem])),
        [levelUnderlineTerms, levelExposureTerms]
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
    // The scrubber shows progress through the whole book, the same number Home
    // and the book page show. (It used to show progress through the current
    // chapter, so a short first chapter read "100%" while Home said 50%.)
    const bookProgress = clampProgress(
        typeof readerLocationInfo?.percentage === 'number'
            ? readerLocationInfo.percentage
            : activeBook?.progress
    );
    const headerProgressPercent = Math.round(bookProgress * 100);
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
        lastSeekAtRef.current = Date.now();
        deliberateJumpRef.current = true;
        const position = {
            spineIndex: bookmark.spineIndex,
            pageIndex: Number.isInteger(bookmark.pageIndex) ? bookmark.pageIndex : 0,
            pagesInChapter: Number.isInteger(bookmark.pagesInChapter) ? bookmark.pagesInChapter : null,
            href: bookmark.href || '',
            firstBlockId: bookmark.firstBlockId || null,
            // The scrubber's point in the chapter (0..1), when that's all it knows.
            ...(Number.isFinite(bookmark.chapterFraction) ? { chapterFraction: bookmark.chapterFraction } : {}),
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

    // A jump from the notes log is like any other: the reader is asked
    // whether it's their new spot (see processNativePageChange).
    const jumpFromNotesLog = (target) => {
        handleSelectBookmark(target);
    };
    const locationPromptRef = useRef(false);
    locationPromptRef.current = locationPrompt;
    // Yes: this is the spot now; save it at once.
    const confirmNewSpot = useCallback(() => {
        heldSpotRef.current = null;
        setHeldSpot(null);
        setLocationPrompt(false);
        const event = lastPageEventRef.current;
        if (event) processNativePageChangeRef.current?.(event);
    }, []);
    // No: keep the old spot (the scrubber's black dot) to go back to.
    const declineNewSpot = useCallback(() => {
        setLocationPrompt(false);
    }, []);
    const returnToHeldSpot = useCallback(() => {
        const held = heldSpotRef.current;
        setLocationPrompt(false);
        if (held?.position) handleSelectBookmark(held.position);
    }, [handleSelectBookmark]);
    // Another book starts fresh.
    useEffect(() => {
        heldSpotRef.current = null;
        setHeldSpot(null);
        setLocationPrompt(false);
        lastViewedSpotRef.current = null;
        lastPageEventRef.current = null;
    }, [currentBook]);

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
        currentPackage = null,
        // The reader's spot in the open chapter (a page change's, which can be
        // ahead of the restore position while focus mode holds it back);
        // withinChapter: they reached a new piece of the chapter being read.
        { position = null, withinChapter = false } = {}
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
            // Same chapter, further on: the run going may be partway through
            // the very piece they need, so let it finish and go again after.
            if (withinChapter) {
                pendingChapterPreprocessRef.current = {
                    bookUri: currentBook,
                    centerSpineIndex,
                    totalSpineItems,
                    position,
                };
            }
            return;
        }

        const preprocessToken = chapterPreprocessTokenRef.current + 1;
        chapterPreprocessTokenRef.current = preprocessToken;
        preprocessingInFlightRef.current = true;
        activeChapterPreprocessRef.current = { bookUri: currentBook, centerSpineIndex };
        pendingChapterPreprocessRef.current = null;
        const readingPosition = position || nativeRestorePositionRef.current;

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
        // Every chapter in the window prepared to the end (not just near the
        // reader): only then is a one-window book done.
        let allChaptersComplete = true;
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

                // The chapter's needed pieces are done already: nothing to send.
                const settleChapter = (complete) => {
                    addStoredBookLevelToAccumulator(bookLevelAccumulator, existingChapter);
                    completedChapters += 1;
                    totalSurfaceCount += Number(existingChapter?.surface_count) || 0;
                    if (!complete) allChaptersComplete = false;
                    if (isCurrentChapter) {
                        setPreprocessStatus('done');
                        setCurrentChapterPreparing(false);
                    }
                };

                if (existingChapter?.status === 'complete') {
                    settleChapter(true);
                    continue;
                }

                // A chapter ahead or behind needs one known piece, so what's
                // stored says whether it's done without opening the chapter.
                const storedProgress = storedChapterProgress(existingChapter);
                if (storedProgressCoversNeighbor({ spineIndex, centerSpineIndex, progress: storedProgress })) {
                    settleChapter(false);
                    continue;
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

                    totalWordCount += countReadableTextWords(chapterTextForReaderPackage(chapterPackage));
                    countedWordChapters += 1;

                    const layout = splitChapterForPreprocess(chapterBlocksForReaderPackage(chapterPackage));
                    const pieceCount = layout.pieces.length;
                    // Pieces done before, unless the chapter splits differently now.
                    const donePieces = new Set(donePiecesForLayout(storedProgress, pieceCount));
                    const readingPiece = (
                        isCurrentChapter && readingPosition?.spineIndex === spineIndex
                            ? pieceForPosition(layout, readingPosition)
                            : 0
                    );
                    if (isCurrentChapter) {
                        preprocessWindowRef.current = { bookUri: currentBook, spineIndex, piece: readingPiece };
                    }
                    const piecesToSend = piecesToPrepare({
                        spineIndex,
                        centerSpineIndex,
                        pieceCount,
                        readingPiece,
                    }).filter((piece) => !donePieces.has(piece));

                    if (pieceCount > 0 && piecesToSend.length === 0) {
                        settleChapter(donePieces.size >= pieceCount);
                        continue;
                    }

                    let surfaceCount = Number(existingChapter?.surface_count) || 0;
                    await markBookPreprocessChapter({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        spineIndex,
                        status: 'processing',
                        surfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
                    });
                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    setPreprocessStatus('preprocessing');
                    // The notice is for the page in front of them; the piece
                    // after it is got ready quietly.
                    if (isCurrentChapter && piecesToSend.includes(readingPiece)) {
                        setCurrentChapterPreparing(true);
                    }

                    // Each piece is saved as it comes, so a run cut short (the
                    // reader turned to another chapter) keeps what it got.
                    let chapterBookLevel = null;
                    for (const piece of piecesToSend) {
                        const {
                            results = [],
                            surface_index: surfaceIndex = [],
                            stats = {},
                        } = await preprocessChapter({
                            bookUri: currentBook,
                            spineIndex,
                            text: layout.pieces[piece],
                            language: activeBookLanguage,
                            interfaceLanguage,
                        });
                        if (chapterPreprocessTokenRef.current !== preprocessToken) {
                            return;
                        }
                        if (stats?.book_level) {
                            chapterBookLevel = chapterBookLevel ?? stats.book_level;
                            addBookLevelScoreToAccumulator(bookLevelAccumulator, stats.book_level);
                        }

                        surfaceCount += await persistChapterPreprocessResults({
                            bookUri: currentBook,
                            results,
                            surfaceIndex,
                            language: activeBookLanguage,
                        });
                        donePieces.add(piece);
                        await markBookPreprocessChapter({
                            ownerId: activeOwnerId,
                            bookUri: currentBook,
                            spineIndex,
                            status: donePieces.size >= pieceCount ? 'complete' : 'partial',
                            surfaceCount,
                            preprocessVersion: PREPROCESS_VERSION,
                            bookLevel: chapterBookLevel,
                            pieceProgress: {
                                count: pieceCount,
                                done: [...donePieces].sort((a, b) => a - b),
                            },
                            completedAt: new Date().toISOString(),
                        });
                        if (chapterPreprocessTokenRef.current !== preprocessToken) {
                            return;
                        }
                        if (isCurrentChapter && piece === readingPiece) {
                            setPreprocessStatus('done');
                            setCurrentChapterPreparing(false);
                        }
                    }

                    // A chapter with no text has nothing to send.
                    if (pieceCount === 0) {
                        await markBookPreprocessChapter({
                            ownerId: activeOwnerId,
                            bookUri: currentBook,
                            spineIndex,
                            status: 'complete',
                            surfaceCount: 0,
                            preprocessVersion: PREPROCESS_VERSION,
                            pieceProgress: { count: 0, done: [] },
                            completedAt: new Date().toISOString(),
                        });
                        if (chapterPreprocessTokenRef.current !== preprocessToken) {
                            return;
                        }
                    }

                    completedChapters += 1;
                    totalSurfaceCount += surfaceCount;
                    if (donePieces.size < pieceCount) {
                        allChaptersComplete = false;
                    }
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
                    allChaptersComplete = false;
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
                : (fullBookWindow && allChaptersComplete ? 'complete' : 'partial');
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

            // A library book keeps the catalog's level, measured on its main
            // content only; this one counts every chapter, front matter too.
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? {
                        ...book,
                        preprocessed: fullBookWindow && finalStatus === 'complete',
                        preprocessing: false,
                        ...(completedWordCount != null
                            ? { wordCount: completedWordCount }
                            : {}),
                        ...(completedBookLevel?.level && !curatedBookRef.current
                            ? { difficulty: completedBookLevel.level, bookLevel: completedBookLevel }
                            : {}),
                    }
                    : book
            )));

            if (completedWordCount != null && activeBook?.cloudId) {
                scheduleCloudProgressSync({
                    ...activeBook,
                    wordCount: completedWordCount,
                    ...(completedBookLevel?.level && !curatedBookRef.current
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
                // The reader reached a new piece while this ran: prepare there.
                const pending = pendingChapterPreprocessRef.current;
                pendingChapterPreprocessRef.current = null;
                if (pending && pending.bookUri === currentBook) {
                    startChapterPreprocessingRef.current?.(
                        pending.centerSpineIndex,
                        pending.totalSpineItems,
                        null,
                        { position: pending.position, withinChapter: true }
                    );
                }
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
    startChapterPreprocessingRef.current = startChapterPreprocessing;

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

            // A book opened for the first time starts where its main content
            // does, past the cover, title page, preface and notes to teachers
            // (still in the contents), even partway into a file. The percent
            // counts from there too.
            if (!isChapterNavigation && !requestedRestorePosition && curatedBookRef.current) {
                const range = storyRangeForSpine(parsedPackage.spine, parsedPackage.toc, true, storyBoundsRef.current);
                const autoSpineIndex = spineIndexForReaderPackage(parsedPackage);
                if (range && Number.isInteger(range.start)) {
                    let firstBlockId = null;
                    if (range.startFraction > 0) {
                        try {
                            const startPackage = range.start === autoSpineIndex
                                ? parsedPackage
                                : await loadParsedChapterPackage(range.start, 'story-start');
                            if (chapterLoadTokenRef.current !== loadToken) return;
                            firstBlockId = storyStartBlockId(chapterBlocksForReaderPackage(startPackage), range);
                        } catch {
                            firstBlockId = null;
                        }
                    }
                    if (range.start !== autoSpineIndex || firstBlockId) {
                        // A jump, not reading on: it mustn't send the page full screen.
                        seekTokenRef.current += 1;
                        lastSeekAtRef.current = Date.now();
                        loadNativeReaderPackageRef.current?.(range.start, firstBlockId ? {
                            restorePosition: {
                                spineIndex: range.start,
                                pageIndex: null,
                                pagesInChapter: null,
                                href: parsedPackage.spine?.[range.start]?.path || '',
                                firstBlockId,
                                seekToken: `seek:${seekTokenRef.current}`,
                            },
                        } : {});
                        return;
                    }
                }
            }

            // A chapter with nothing to show (a cover page whose only image
            // was dropped) left a blank page with nothing to turn: go on to the
            // next one, or back to the one before when paging backwards.
            const parsedSpineIndex = spineIndexForReaderPackage(parsedPackage);
            const parsedBlocks = chapterBlocksForReaderPackage(parsedPackage);
            if (Number.isInteger(parsedSpineIndex) && Array.isArray(parsedBlocks) && parsedBlocks.length === 0) {
                const goingBack = isChapterNavigation
                    && Number.isInteger(previousSpineIndex)
                    && parsedSpineIndex < previousSpineIndex;
                const spineLength = parsedPackage.spine?.length ?? 0;
                let skipTo = parsedSpineIndex + (goingBack ? -1 : 1);
                // Nothing before it (an empty cover first): stay where you were.
                if (goingBack && skipTo < 0) skipTo = parsedSpineIndex + 1;
                if (skipTo >= 0 && skipTo < spineLength) {
                    loadNativeReaderPackageRef.current?.(skipTo, { animateChapterTransition, restorePosition });
                    return;
                }
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
                    restorePagesInChapter,
                    parsedPackage.spine,
                    parsedPackage.toc,
                    curatedBookRef.current,
                    storyBoundsRef.current
                ),
                href: parsedPackage.loadedSpineItem?.path || '',
                pageInChapter: Number.isInteger(restorePageIndex) ? restorePageIndex + 1 : null,
                pagesInChapter: restorePagesInChapter,
            });
            // The neighbours' parsing and the chapter's preprocessing run on the
            // JS thread. When the book is just opening they wait until the
            // first page is up (and the opening screen fading), so the page
            // isn't held back behind them.
            const startBackgroundWork = () => {
                if (chapterLoadTokenRef.current !== loadToken) return;
                prefetchAdjacentChapters(loadedSpineIndex, totalSpineItems);
                startChapterPreprocessing(loadedSpineIndex, totalSpineItems, parsedPackage);
            };
            if (canKeepCurrentReader) {
                startBackgroundWork();
            } else {
                setTimeout(startBackgroundWork, OPENING_BACKGROUND_WORK_DELAY_MS);
            }
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
            glossed: glossedSurfacesRef.current,
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
        const nextProgress = progressForBookPosition(
            resolvedSpineIndex,
            totalSpineItems,
            pageIndex,
            total,
            nativeReaderPackageRef.current?.spine,
            nativeReaderPackageRef.current?.toc,
            curatedBookRef.current,
            storyBoundsRef.current
        );

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

        // A sudden jump holds the spot the reader left (and asks); until it
        // is confirmed or they're back there, where they are isn't saved.
        lastPageEventRef.current = { page, total, spineIndex, href, firstBlockId };
        const previousSpot = lastViewedSpotRef.current;
        lastViewedSpotRef.current = {
            position: nextPosition,
            progress: nextBookPatch.progress,
            focus: focusModeRef.current,
        };
        // Just after a relayout (full screen, focus mode, settings) the spot
        // is only being renumbered, unless the reader has since jumped on
        // purpose. Focus mode counts sentences, not pages: its spots never
        // compare with the page's.
        const relayout = (
            Date.now() - layoutChangedAtRef.current < SEEK_SETTLE_MS
            && lastSeekAtRef.current < layoutChangedAtRef.current
        ) || Boolean(previousSpot && previousSpot.focus !== focusModeRef.current);
        // A jump the reader asked for (scrubber, contents, a bookmark) counts
        // by distance in scroll mode too, where reading alone can cover many
        // screens of one chapter. Taken by the first event that moved.
        const moved = !previousSpot || !isNearPosition(previousSpot.position, nextPosition);
        const deliberate = deliberateJumpRef.current
            && Date.now() - lastSeekAtRef.current < DELIBERATE_JUMP_MS;
        if (moved || !deliberate) deliberateJumpRef.current = false;
        const held = heldSpotRef.current;
        if (held) {
            if (isNearPosition(held.position, nextPosition)) {
                heldSpotRef.current = null;
                setHeldSpot(null);
                setLocationPrompt(false);
            } else {
                // Reading on from the new spot without answering counts as yes.
                const readOn = !relayout && previousSpot && !isLocationJump(previousSpot.position, nextPosition)
                    && (nextPosition.spineIndex > previousSpot.position.spineIndex
                        || nextPosition.pageIndex > pageInLayout(previousSpot.position, nextPosition.pagesInChapter));
                stepsSincePromptRef.current = readOn ? stepsSincePromptRef.current + 1 : stepsSincePromptRef.current;
                if (!(locationPromptRef.current && stepsSincePromptRef.current >= 3)) {
                    updateNativeRestorePosition(nextPosition);
                    return;
                }
                heldSpotRef.current = null;
                setHeldSpot(null);
                setLocationPrompt(false);
            }
        } else if (
            previousSpot
            && !focusModeRef.current
            && !relayout
            && isLocationJump(previousSpot.position, nextPosition, {
                pagedWithinChapter: deliberate || readerSettingsRef.current?.readingMode !== 'scroll',
            })
        ) {
            const spot = { position: previousSpot.position, progress: previousSpot.progress };
            heldSpotRef.current = spot;
            setHeldSpot(spot);
            stepsSincePromptRef.current = 0;
            setLocationPrompt(true);
            updateNativeRestorePosition(nextPosition);
            return;
        }

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
    processNativePageChangeRef.current = processNativePageChange;

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
            committedPageCount,
            committedPackage.spine,
            committedPackage.toc,
            curatedBookRef.current,
            storyBoundsRef.current
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

    // The lookup panel always comes up from the bottom (in focus mode the
    // anchored sentence lifts above it as needed).
    const shouldPlaceLookupAtTop = false;
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
    // ── Focus (sentence beam) mode wiring ────────────────────────────────────
    // One sentence at a time, moved by swiping; neither is a setting.
    const focusSpan = 1;
    const focusSwipe = true;
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

    // The popup's sentence belongs to the chapter it came from.
    useEffect(() => {
        setPinnedSentence('');
    }, [activeSpineIndex, currentBook]);

    // Translate the open chapter's sentences in a few requests, ahead of time,
    // while something will read them: the sentence translation popup, or listen
    // mode's translation mode (which also takes the next chapter, so the turn
    // between chapters doesn't wait). Each chapter is fetched once per language
    // and kept on the phone (services/chapterTranslations.js).
    const listenTranslating = listenActive && Boolean(listenPrefs.translateSentences);
    // Any word tap can open the translation popup, so the open chapter is
    // always translated ahead and the popup shows at once.
    const chapterTranslationsWanted = true;
    useEffect(() => {
        if (
            !chapterTranslationsWanted
            || !currentBook
            || !Number.isInteger(currentSpineIndex)
            // Same language (or just another script of it): nothing to translate.
            || normalizeBookLanguage(activeBookLanguage) === String(interfaceLanguage || '').split('-')[0]
        ) {
            setChapterTranslating(false);
            return undefined;
        }
        let active = true;
        setChapterTranslating(true);
        const prefetch = async (spineIndex) => {
            const chapterPackage = await loadParsedChapterPackage(spineIndex, `translate:${spineIndex}`);
            if (!active || !chapterPackage) return;
            const paragraphs = chapterBlocksForReaderPackage(chapterPackage)
                .filter((block) => !block?.excludeFromText)
                .map((block) => (typeof block?.text === 'string' ? block.text : ''))
                .filter(Boolean);
            await chapterTranslations.prefetchChapter({
                key: `${currentBook}#${spineIndex}`,
                paragraphs,
                source: activeBookLanguage,
                target: interfaceLanguage,
            });
        };
        const totalSpineItems = nativeReaderPackageRef.current?.spine?.length ?? 0;
        prefetch(currentSpineIndex)
            .finally(() => {
                // The open chapter is what the notice waits for, not the next.
                if (active) setChapterTranslating(false);
            })
            .then(() => {
                if (active && listenTranslating && currentSpineIndex + 1 < totalSpineItems) {
                    return prefetch(currentSpineIndex + 1);
                }
                return null;
            })
            .catch((error) => {
                console.warn('[Read] Could not translate the chapter ahead:', error?.message ?? error);
            });
        return () => {
            active = false;
        };
    }, [
        activeBookLanguage,
        chapterTranslationsWanted,
        currentBook,
        currentSpineIndex,
        interfaceLanguage,
        listenTranslating,
        loadParsedChapterPackage,
    ]);

    const isScrollMode = readingMode === 'scroll';
    // Listening (focus mode) reads in the beam in scroll mode; in paged mode
    // it stays on the page, which lights the sentence and turns with the voice.
    const nativeRenderMode = isScrollMode ? (focusMode ? 'focus' : 'continuous') : 'paged';
    const pagedListening = focusMode && nativeRenderMode === 'paged';
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
            setAnnotationsLoading(false);
            return undefined;
        }
        let isActive = true;
        setAnnotationsLoading(true);
        lookupBookAnnotationSurfaces(activeOwnerId, currentBook, { language: activeBookLanguage })
            .then((rows) => {
                if (isActive) setAnnotationRows(rows || []);
            })
            .catch((error) => {
                console.error('[Read] Failed to load word annotations:', error);
                if (isActive) setAnnotationRows([]);
            })
            .finally(() => {
                if (isActive) setAnnotationsLoading(false);
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
                return withPhraseTapTerms(
                    levelMarksEnabled ? thresholdLevelTerms : EMPTY_LEVEL_TERMS,
                    levelPhraseSurfaces
                );
            }
            return withPhraseTapTerms(buildAnnotatedLevelTerms({
                levelTerms: thresholdLevelTerms,
                annotationRows,
                marksEnabled: levelMarksEnabled,
                pinyin: readerShowPinyin,
                gloss: readerShowGloss,
                pinyinScope,
                glossScope,
                interfaceLanguage,
                hiddenSurfaces: hideSavedAnnotations ? savedSurfacesRef.current : null,
            }), levelPhraseSurfaces);
        },
        [
            annotationRows,
            hideSavedAnnotations,
            levelPhraseSurfaces,
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
    // Words drawn with a translation under them. Reading past one doesn't
    // mean the reader knew it, and tapping one means they wanted more than
    // the translation: neither is evidence about their level.
    glossedSurfacesRef.current = useMemo(
        () => new Set(readerLevelTerms.filter((term) => term.gloss).map((term) => term.text)),
        [readerLevelTerms]
    );
    // Words reported as read past without being drawn: the known words in the
    // level sample, plus any underlined word the reader isn't shown right now
    // (marks off, or below the marks threshold). Every word whose lookup can
    // move the level must have its reading past logged too.
    const readerExposureTerms = useMemo(() => {
        const drawn = new Set(readerLevelTerms.filter((term) => !term.annotationOnly).map((term) => term.text));
        const out = new Set(levelExposureTerms.map((term) => term.text));
        levelUnderlineTerms.forEach((term) => {
            if (!drawn.has(term.text)) out.add(term.text);
        });
        return [...out];
    }, [readerLevelTerms, levelUnderlineTerms, levelExposureTerms]);
    // Rows above the settings tabs in the sheet: saved words and Checkpoints.
    // The contents open from the progress in the header; full screen comes on
    // by itself as the reader reads on.
    const settingsSheetActions = useMemo(() => [{
        key: 'saved',
        label: t('read.savedTab', { count: bookSavedWords.length }),
        icon: <MaterialCommunityIcons name="cards-outline" size={21} color={themeColors.readerBodyInk} />,
        onPress: () => {
            setShowMenu(false);
            openSavedPanel('saved');
        },
    }, {
        key: 'checkpoints',
        label: t('read.checkpoints'),
        icon: <MaterialIcons name="bookmark-border" size={21} color={themeColors.readerBodyInk} />,
        onPress: openNotesLog,
    }], [bookSavedWords.length, openNotesLog, openSavedPanel, t, themeColors.readerBodyInk]);

    // ─── Page scrubber ───────────────────────────────────────────────────────
    // The line along the bottom: where you are in the story, its chapters and
    // bookmarks; dragging previews and releasing goes there.
    // Listening (focus mode) is full screen too: only its own bar is up.
    const chromeHidden = isFullscreen || focusMode;
    const scrubberShown = Boolean(currentBook) && bookLoadState === 'ready' && !chromeHidden;
    const scrubberSpace = scrubberShown ? PAGE_SCRUBBER_HEIGHT + insets.bottom : 0;
    // Listening starts from a play button resting over the line's right end;
    // it goes with the rest of the controls in full screen, rises above an
    // open panel or a notice, and turns into the listen bar.
    const playButtonShown = scrubberShown && !listenActive;
    // Cards at the bottom of the screen sit just above the scrubber (the play
    // button rises over them).
    const bottomOverlayBase = scrubberShown ? scrubberSpace : insets.bottom;
    // The page runs from the status bar to the navigation buttons (on phones
    // that have them) whether the controls are up or not; they lie over it.
    const readerBottomInset = navigationButtonsInset(insets.bottom);
    const readerSpine = nativeReaderPackage?.spine;
    const scrubberRange = useMemo(
        () => storyRangeForSpine(readerSpine, toc, curatedBook, storyBounds),
        [curatedBook, readerSpine, storyBounds, toc]
    );
    const scrubberChapters = useMemo(
        () => chapterMarks(readerSpine, scrubberRange, toc),
        [readerSpine, scrubberRange, toc]
    );
    const scrubberBookmarks = useMemo(() => (Array.isArray(readerSpine) ? bookBookmarks : [])
        .filter((bookmark) => Number.isInteger(bookmark?.spineIndex))
        .map((bookmark) => ({
            id: bookmark.id,
            at: storyProgress(readerSpine, scrubberRange, bookmark.spineIndex, bookmark.pageIndex, bookmark.pagesInChapter) ?? 0,
            where: [
                localizeGeneratedSectionLabel(bookmark.chapterLabel, t),
                Number.isInteger(bookmark.pageIndex) ? t('read.pageNumber', { page: formatNumber(bookmark.pageIndex + 1) }) : '',
            ].filter(Boolean).join(' · '),
            // The page's first words, when that chapter has been read in.
            snippet: (() => {
                const chapterPackage = parsedChapterCacheRef.current.get(bookmark.spineIndex);
                if (!chapterPackage || !bookmark.firstBlockId) return '';
                const block = chapterBlocksForReaderPackage(chapterPackage)
                    .find((candidate) => candidate?.id === bookmark.firstBlockId);
                return typeof block?.text === 'string' ? block.text.trim().slice(0, 120) : '';
            })(),
            bookmark,
        })), [bookBookmarks, readerSpine, scrubberRange, t]);
    // The preview: the contents title there and the start of that chapter
    // (once it's been read in; dragging over a chapter starts that).
    const describeScrubberPoint = useCallback((fraction) => {
        const position = positionForStoryProgress(readerSpine, scrubberRange, fraction);
        if (!position) return null;
        const tocItem = flattenedToc.reduce((found, item) => (
            Number.isInteger(item?.spineIndex) && item.spineIndex <= position.spineIndex ? item : found
        ), null);
        const chapterPackage = parsedChapterCacheRef.current.get(position.spineIndex);
        const text = chapterPackage
            ? chapterBlocksForReaderPackage(chapterPackage)
                .filter((block) => !block?.excludeFromText && typeof block?.text === 'string')
                .map((block) => block.text.trim())
                .filter(Boolean)
                .join(' ')
                .slice(0, 420)
            : '';
        const title = localizeGeneratedSectionLabel(titleForTocItem(tocItem), t);
        return { title, text, chapter: title };
    }, [flattenedToc, readerSpine, scrubberRange, t]);
    const scrubberTargetRef = useRef(null);
    const pendingScrubSeekRef = useRef(null);
    const handleSelectBookmarkRef = useRef(handleSelectBookmark);
    handleSelectBookmarkRef.current = handleSelectBookmark;
    const handleScrubberTarget = useCallback((fraction) => {
        const position = positionForStoryProgress(readerSpine, scrubberRange, fraction);
        if (!position || scrubberTargetRef.current === position.spineIndex) return;
        scrubberTargetRef.current = position.spineIndex;
        if (!parsedChapterCacheRef.current.has(position.spineIndex)) {
            loadParsedChapterPackage(position.spineIndex, 'scrubber').catch(() => {});
        }
    }, [loadParsedChapterPackage, readerSpine, scrubberRange]);
    const handleScrubberSeek = useCallback((fraction) => {
        scrubberTargetRef.current = null;
        const position = positionForStoryProgress(readerSpine, scrubberRange, fraction);
        if (!position) return;
        const target = {
            spineIndex: position.spineIndex,
            pageIndex: null,
            pagesInChapter: null,
            href: '',
            firstBlockId: null,
            chapterFraction: position.chapterFraction,
        };
        // Another chapter opens at its top first; the point inside it is a
        // second, in-chapter seek once it's on screen (handleReadingPageChange).
        if (position.spineIndex !== activeSpineIndex) pendingScrubSeekRef.current = target;
        handleSelectBookmark(target);
    }, [activeSpineIndex, handleSelectBookmark, readerSpine, scrubberRange]);
    // The AI explanation counts as much as the dictionary: the listen bar and
    // the lit sentence lift above either.
    const focusPanelOpen = focusMode && lookupOpen;
    // Total height the lookup panel occupies from the bottom of the screen;
    // the native reading surface lifts only as far as the focused sentence
    // needs to end above it (often not at all: it rests in the top half).
    const focusPanelTotalHeight = focusPanelOpen
        ? Math.max(0, Math.round(lookupPanelHeight))
        : 0;
    // Paged listening has no arrows to clear: the listen bar sits low, over
    // the page's bottom margin.
    const focusControlsBaseBottom = insets.bottom + (pagedListening ? 8 : 28);
    // The tapped word's sentence, translated in a popup over the top of the
    // page. It lives as long as the lookup does: reading on (a page turn, a
    // tap elsewhere, a new chapter) closes both.
    const showTranslationPopup = Boolean(currentBook);
    const translationPopupSentence = showTranslationPopup && highlightedWord ? pinnedSentence : '';

    // Arrow controls ride 12dp above the open panel, mirroring the 28 → panel+12
    // bottom shift in the design.
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
        // Listening just turned focus mode on: this is where it starts.
        const starting = listenStartPendingRef.current && listenPlayingRef.current;
        if (starting) listenStartPendingRef.current = false;
        // A jump (the reader turned the page while listening) is taken up
        // wherever it lands.
        const behind = !starting
            && !event.jump
            && sameChapter
            && Number.isInteger(previous?.index)
            && event.index <= previous.index;
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

    // The word the voice is reading, lit light blue; it stays lit while
    // paused, marking where play picks up.
    const setSpokenRange = useCallback((range) => {
        if (!supportsSpokenRange) return;
        const viewTag = findNodeHandle(nativeReaderViewRef.current);
        if (viewTag == null) return;
        sendSpokenRange(viewTag, range).catch(() => {});
    }, []);

    const pauseListening = useCallback(({ keepActive = true } = {}) => {
        // Any pause but the panel's own (which sets it again after) means the
        // panel closing must not start the voice.
        resumeAfterPanelRef.current = false;
        listenRunRef.current += 1;
        listenPlayingRef.current = false;
        listenSpokenKeyRef.current = '';
        listenPlayerRef.current?.stop();
        setSpokenWord(null);
        setListenPlaying(false);
        if (!keepActive) {
            setSpokenRange(null);
            setListenActive(false);
        }
    }, [setSpokenRange, setSpokenWord]);
    listenPauseRef.current = pauseListening;

    // Read the focused sentence, then (study mode) each underlined word in it
    // with its meaning, then step the beam on. Every await re-checks that this
    // run is still the current one, so pause, a tap or a newer sentence stops
    // it between utterances. `prepared.from` resumes the sentence partway in
    // (where a pause left it).
    const speakFocusedSentence = useCallback(async (event, key, prepared = {}) => {
        const rawText = typeof event?.text === 'string' ? event.text : '';
        const text = cleanListenText(rawText);
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
            ? chapterTranslations.translate(earlyNextText, ctx.language, ctx.interfaceLanguage).catch(() => '')
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
            ? (prepared.translation || chapterTranslations.translate(text, ctx.language, ctx.interfaceLanguage).catch(() => ''))
            : null;

        // Follow the voice word by word: light the word it reaches and
        // remember it, so play after a pause starts from that word. Offsets
        // from the engine are into `rest`; the view's segments index the
        // uncleaned text.
        const rest = remainingFrom(text, prepared.from);
        const leading = rawText.length - rawText.trimStart().length;
        listenReachedRef.current = { key, offset: rest.base };
        setSpokenRange(null);
        const followWord = ({ start, end }) => {
            if (!mine()) return;
            const offset = rest.base + start;
            listenReachedRef.current = { key, offset };
            setSpokenRange(spokenRangeAt(event.segments, leading + offset, leading + rest.base + end));
        };

        let outcome = await player.speakSequence([{
            text: rest.text,
            ...listenVoiceFor(prefs, ctx.targetLocale),
            onProgress: followWord,
        }]);
        if (!mine()) return;
        setSpokenRange(null);
        if (outcome === 'error') {
            if (failed()) stepOn();
            return;
        }
        listenErrorsRef.current = 0;
        // The sentence itself is done; a pause from here on replays only the
        // translation and the word meanings.
        listenReachedRef.current = { key, offset: text.length };

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
    }, [getListenPlayer, pauseListening, setSpokenRange, setSpokenWord]);
    listenSpeakRef.current = speakFocusedSentence;

    const resumeListening = useCallback(async () => {
        resumeAfterPanelRef.current = false;
        // The notification player needs this on Android 13+; the dialog is
        // answered before the voice starts, so it never cuts into a sentence.
        await ensureNotificationPermission();
        // The voice and the notification player are shared with the Learn
        // tab's audio review; taking them over stops it (and it stops us).
        claimListenSession('reader', () => listenPauseRef.current?.({ keepActive: false }));
        // Listening reads in focus mode. Turn it on BEFORE marking listening
        // active: after the await above, state updates aren't batched, and a
        // render with listening on but focus off makes the guard below stop
        // listening again. Leaving listening turns focus back off (it was
        // listening's doing), and the first sentence focus sends is read
        // however far the reader got before (listenStartPendingRef).
        const enteringFocus = !focusModeRef.current;
        if (enteringFocus) {
            listenEnteredFocusRef.current = true;
            listenStartPendingRef.current = true;
            toggleFocusMode();
        }
        setListenActive(true);
        setListenPlaying(true);
        listenPlayingRef.current = true;
        listenErrorsRef.current = 0;
        if (enteringFocus) {
            // Entering focus mode sends the first sentence; that starts the voice.
            return;
        }
        const current = listenFocusRef.current;
        if (current?.text) {
            const key = `${currentSpineIndexRef.current}:${current.index}:${cleanListenText(current.text)}`;
            // Same sentence as the pause: carry on from the word it reached.
            const reached = listenReachedRef.current;
            speakFocusedSentence(current, key, { from: reached?.key === key ? reached.offset : 0 });
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

    // While a lookup panel is up the voice waits, so the word (or the AI's
    // explanation) can be taken in without the sentence running on; once
    // the panel is down it picks up again at the lit sentence (the tapped
    // word's, after a tap). A pause or play of the reader's own in between
    // wins.
    const holdListeningForPanel = useCallback(() => {
        if (!listenPlayingRef.current) return;
        pauseListening();
        resumeAfterPanelRef.current = true;
    }, [pauseListening]);
    holdListeningForPanelRef.current = holdListeningForPanel;
    useEffect(() => {
        if (lookupOpen) {
            holdListeningForPanel();
            return;
        }
        if (!resumeAfterPanelRef.current) return;
        resumeAfterPanelRef.current = false;
        resumeListening();
    }, [holdListeningForPanel, lookupOpen, resumeListening]);

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
    // `which`: 'book' (the book's language) or 'translation' (the app's
    // language, for translations and meanings); each has its own voice.
    const listenLocaleFor = (which) => (
        which === 'translation' ? listenCtxRef.current.interfaceLocale : listenCtxRef.current.targetLocale
    );
    const previewListenVoice = useCallback(async (voiceId, patch = {}, which = 'book') => {
        const locale = listenLocaleFor(which);
        const prefs = { ...listenPrefsRef.current, ...patch };
        const previewKey = `${which}:${voiceId}`;
        setPreviewingVoice(previewKey);
        await getListenPlayer().speakSequence([{
            text: voiceSampleFor(locale),
            ...listenVoiceFor({ ...prefs, voices: { ...prefs.voices, [locale]: voiceId } }, locale),
        }]);
        setPreviewingVoice((current) => (current === previewKey ? undefined : current));
    }, [getListenPlayer]);
    const currentListenVoice = () => listenPrefsRef.current.voices?.[listenCtxRef.current.targetLocale] || null;
    const selectListenVoice = useCallback((voiceId, which = 'book') => {
        const locale = listenLocaleFor(which);
        updateListenPrefs({ voices: { ...listenPrefsRef.current.voices, [locale]: voiceId || undefined } });
        previewListenVoice(voiceId, {}, which);
    }, [previewListenVoice, updateListenPrefs]);
    const selectTranslationVoice = useCallback((voiceId) => selectListenVoice(voiceId, 'translation'), [selectListenVoice]);
    const previewTranslationVoice = useCallback((voiceId) => previewListenVoice(voiceId, {}, 'translation'), [previewListenVoice]);
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
    // Listening ended (closed, stopped, another book): back to normal reading
    // if it was listening that turned focus mode on. A reader who was already
    // in focus mode stays there.
    const wasListenActiveRef = useRef(false);
    useEffect(() => {
        const was = wasListenActiveRef.current;
        wasListenActiveRef.current = listenActive;
        if (!was || listenActive) return;
        listenStartPendingRef.current = false;
        if (listenEnteredFocusRef.current) {
            listenEnteredFocusRef.current = false;
            if (focusModeRef.current) toggleFocusMode();
        }
    }, [listenActive, toggleFocusMode]);
    // Another book stops the voice (currentBook is the book's uri).
    useEffect(() => {
        pauseListening({ keepActive: false });
    }, [currentBook, pauseListening]);
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
            // Only tear the player down when it is ours (audio review may own it).
            if (mayUseListenSession('reader')) stopListenSession();
            releaseListenSession('reader');
            return;
        }
        if (!ownsListenSession('reader')) return;
        updateListenSession({
            title: headerBookTitle,
            subtitle: listenSessionSubtitle,
            playing: listenPlaying,
            // The book's cover becomes the player's art ('' = none).
            cover: typeof activeBook?.cover === 'string' ? activeBook.cover.trim() : '',
        });
    }, [listenActive, listenPlaying, headerBookTitle, listenSessionSubtitle, activeBook?.cover]);
    useEffect(() => () => {
        if (mayUseListenSession('reader')) stopListenSession();
        releaseListenSession('reader');
    }, []);

    const listenResumeRef = useRef(null);
    listenResumeRef.current = resumeListening;

    // Home's mini player and the route-change pause (services/readerListenState.js).
    useEffect(() => {
        publishReaderListen({
            active: listenActive,
            playing: listenPlaying,
            title: headerBookTitle || '',
            subtitle: listenSessionSubtitle || '',
        });
    }, [headerBookTitle, listenActive, listenPlaying, listenSessionSubtitle]);
    useEffect(() => registerReaderListenCommands({
        toggle: () => (listenPlayingRef.current ? listenPauseRef.current?.() : listenResumeRef.current?.()),
        pause: () => listenPauseRef.current?.(),
        next: () => listenNavRef.current?.('next'),
        previous: () => listenNavRef.current?.('prev'),
        stop: () => listenPauseRef.current?.({ keepActive: false }),
    }), []);
    useEffect(() => () => publishReaderListen({ active: false, playing: false }), []);
    useEffect(() => {
        const subscription = addListenControlListener(({ action } = {}) => {
            // The lock-screen buttons belong to whoever owns the session.
            if (!ownsListenSession('reader')) return;
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


    // The daily reading goal's clock runs while a book is in front of the
    // reader (this screen, the app in the foreground), and only counts real
    // reading: turning or scrolling pages, looking words up, the voice
    // reading aloud (services/readingGoal.js stops counting when idle).
    const [appActive, setAppActive] = useState(AppState.currentState === 'active');
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
        return () => subscription.remove();
    }, []);
    const readingClockOn = readerFocused && appActive && Boolean(currentBook);
    useEffect(() => {
        if (!readingClockOn) {
            stopReadingClock();
            return undefined;
        }
        startReadingClock(activeOwnerId);
        return () => stopReadingClock();
    }, [activeOwnerId, readingClockOn]);
    useEffect(() => {
        if (!readingClockOn || !listenPlaying) return undefined;
        noteReadingActivity();
        const timer = setInterval(noteReadingActivity, 30 * 1000);
        return () => clearInterval(timer);
    }, [listenPlaying, readingClockOn]);
    // A page event counts only when the page actually changed: the reader
    // also reports where it is on opening and after relayouts.
    const lastReadingPageRef = useRef('');
    const handleReadingPageChange = useCallback((event) => {
        const data = event?.nativeEvent ?? event ?? {};
        const pageKey = `${data.spineIndex ?? ''}:${data.page ?? ''}:${data.firstBlockId ?? ''}`;
        if (lastReadingPageRef.current && pageKey !== lastReadingPageRef.current) {
            noteReadingActivity();
        }
        lastReadingPageRef.current = pageKey;
        // The scrubber opened another chapter: now that it's on screen, go to
        // the point in it that was asked for.
        const pendingScrub = pendingScrubSeekRef.current;
        if (pendingScrub && data.spineIndex === pendingScrub.spineIndex) {
            pendingScrubSeekRef.current = null;
            setTimeout(() => handleSelectBookmarkRef.current?.(pendingScrub), 120);
        }
        // A long chapter's word help is prepared a piece at a time around the
        // reader: on reaching a new piece, prepare it and the one after.
        const readerPackage = nativeReaderPackageRef.current;
        const preprocessWindow = preprocessWindowRef.current;
        if (
            currentBook
            && preprocessWindow.bookUri === currentBook
            && Number.isInteger(data.spineIndex)
            && data.spineIndex === preprocessWindow.spineIndex
            && spineIndexForReaderPackage(readerPackage) === data.spineIndex
        ) {
            if (preprocessLayoutRef.current.readerPackage !== readerPackage) {
                preprocessLayoutRef.current = {
                    readerPackage,
                    layout: splitChapterForPreprocess(chapterBlocksForReaderPackage(readerPackage)),
                };
            }
            const position = {
                spineIndex: data.spineIndex,
                pageIndex: Number.isInteger(data.page) ? data.page : null,
                pagesInChapter: Number.isInteger(data.total) ? data.total : null,
                firstBlockId: data.firstBlockId || null,
            };
            const piece = pieceForPosition(preprocessLayoutRef.current.layout, position);
            if (piece !== preprocessWindow.piece) {
                preprocessWindowRef.current = { ...preprocessWindow, piece };
                startChapterPreprocessing(
                    data.spineIndex,
                    readerPackage.spine?.length ?? 0,
                    readerPackage,
                    { position, withinChapter: true }
                );
            }
        }
        return handleNativePageChange(event);
    }, [currentBook, handleNativePageChange, startChapterPreprocessing]);
    useEffect(() => {
        lastReadingPageRef.current = '';
    }, [currentBook]);
    // Native reader events (lookups, focus steps) are reading: the book's own
    // view takes its touches, so the container never sees them.
    const readingActivityWrappers = useRef(new WeakMap()).current;
    const withReadingActivity = (handler) => {
        let wrapped = readingActivityWrappers.get(handler);
        if (!wrapped) {
            wrapped = (event) => {
                noteReadingActivity();
                return handler?.(event);
            };
            readingActivityWrappers.set(handler, wrapped);
        }
        return wrapped;
    };
    const [goalEvent, setGoalEvent] = useState(null);
    useEffect(() => subscribeGoalReached(setGoalEvent), []);

    // Profile's "Underlines feel off?" → this book's underline settings.
    const openSettingsParam = route?.params?.openSettings;
    useEffect(() => {
        if (!openSettingsParam) return;
        navigation?.setParams?.({ openSettings: undefined });
        if (!currentBook) {
            ToastAndroid.show(t('level.openBookFirst'), ToastAndroid.SHORT);
            return;
        }
        setIsFullscreen(false);
        setSettingsTab(openSettingsParam);
        setShowMenu(true);
    }, [currentBook, navigation, openSettingsParam, t]);

    // ── "Getting this chapter's word help ready" ─────────────────────────────
    // Only when the page in front of the reader is really being processed
    // (they jumped somewhere not prepared ahead). A chapter reached by reading
    // on was prepared while they read the one before, so it says nothing. Once
    // up, it stays while the underlines, the translations under words and the
    // sentence translations load, so when it goes a tap's definition and
    // translation are instant and the underlines are on the page; then a
    // check and "word help is ready" for a moment.
    const wordHelpLoading = bookLoadState === 'ready'
        && (levelTermsLoading || annotationsLoading || chapterTranslating);
    const [preparingNoticeVisible, setPreparingNoticeVisible] = useState(false);
    const [wordHelpDone, setWordHelpDone] = useState(false);
    const chapterWasPreparedRef = useRef(false);
    useEffect(() => {
        if (currentChapterPreparing) {
            chapterWasPreparedRef.current = true;
            setWordHelpDone(false);
            setPreparingNoticeVisible(true);
            return undefined;
        }
        // Nothing was processed: the follow-up loads alone don't bring it up.
        if (!chapterWasPreparedRef.current) {
            return undefined;
        }
        const timer = setTimeout(() => {
            if (wordHelpLoading) {
                setPreparingNoticeVisible(true);
                return;
            }
            if (chapterWasPreparedRef.current) {
                chapterWasPreparedRef.current = false;
                setWordHelpDone(true);
                setPreparingNoticeVisible(true);
                return;
            }
            setPreparingNoticeVisible(false);
        }, wordHelpLoading ? 300 : 200);
        return () => clearTimeout(timer);
    }, [currentChapterPreparing, wordHelpLoading]);
    useEffect(() => {
        if (!wordHelpDone) return undefined;
        const timer = setTimeout(() => {
            setWordHelpDone(false);
            setPreparingNoticeVisible(false);
        }, 2600);
        return () => clearTimeout(timer);
    }, [wordHelpDone]);
    // Another book starts over.
    useEffect(() => {
        chapterWasPreparedRef.current = false;
        setWordHelpDone(false);
        setPreparingNoticeVisible(false);
    }, [currentBook]);

    // ── The controls coming and going ────────────────────────────────────────
    // They go the moment the reader reads on (drags or flings the text on,
    // turns a page forward) and come back the moment they go back, even a
    // little, or tap the page. Jumps don't count: the reader reports only
    // its own gestures. Listening (focus mode) keeps its own controls.
    const handleReadingDirection = useCallback((event) => {
        if (focusModeRef.current) return;
        if (event?.direction === 'forward') {
            setIsFullscreen(true);
        } else if (event?.direction === 'back') {
            setIsFullscreen(false);
        }
    }, []);

    // The header slides up and away, the scrubber down, and back, over the
    // page. The page itself never changes size, so nothing is laid out again
    // and a page turn under way carries on: paged mode lays its pages out
    // between the two, and scroll mode lets the text pass under them.
    const reduceMotion = useReduceMotion();
    const [headerHeight, setHeaderHeight] = useState(0);
    const headerPresence = usePresence(!chromeHidden, { duration: CHROME_SLIDE_MS, easing: CHROME_EASING, reduceMotion });
    const headerSlide = useMemo(() => headerPresence.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-headerHeight, 0],
    }), [headerHeight, headerPresence.progress]);
    // The room the controls take over the page: the header below the status
    // bar, the scrubber above the navigation buttons.
    const chromeInsets = useMemo(() => ({
        top: Math.max(0, headerHeight - insets.top),
        bottom: Math.max(0, PAGE_SCRUBBER_HEIGHT + insets.bottom - navigationButtonsInset(insets.bottom)),
    }), [headerHeight, insets.bottom, insets.top]);
    const scrubberPresence = usePresence(scrubberShown, { duration: CHROME_SLIDE_MS, easing: CHROME_EASING, reduceMotion });
    const scrubberSlide = useMemo(() => scrubberPresence.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [PAGE_SCRUBBER_HEIGHT + insets.bottom, 0],
    }), [insets.bottom, scrubberPresence.progress]);

    // ── The play button ──────────────────────────────────────────────────────
    // It rests over the scrubber's right end and rises above whatever comes
    // up at the bottom: the dictionary or AI panel, or a notice.
    const preparingNoticeShown = Boolean(currentBook) && !highlightedWord && !textSelection
        && !focusMode && preparingNoticeVisible;
    const locationPromptShown = locationPrompt && Boolean(currentBook) && !highlightedWord && !textSelection;
    const [preparingNoticeHeight, setPreparingNoticeHeight] = useState(0);
    const [locationPromptHeight, setLocationPromptHeight] = useState(0);
    const noticeHeight = Math.max(
        preparingNoticeShown ? preparingNoticeHeight : 0,
        locationPromptShown ? locationPromptHeight : 0
    );
    const playButtonRest = PAGE_SCRUBBER_HEIGHT + insets.bottom + PLAY_BUTTON_GAP;
    let playButtonLiftTarget = 0;
    if (lookupOpen && !shouldPlaceLookupAtTop) {
        playButtonLiftTarget = Math.max(0, lookupPanelHeight + PLAY_BUTTON_GAP - playButtonRest);
    } else if (noticeHeight > 0) {
        // The notice sits 16 above the scrubber; the button a gap above it.
        playButtonLiftTarget = 16 + noticeHeight;
    }
    const playButtonLift = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(playButtonLift, {
            toValue: -playButtonLiftTarget,
            duration: reduceMotion ? 0 : 280,
            easing: CHROME_EASING,
            useNativeDriver: true,
        }).start();
    }, [playButtonLift, playButtonLiftTarget, reduceMotion]);
    const playPresence = usePresence(playButtonShown, { duration: 200, reduceMotion });
    const playButtonScale = useMemo(() => playPresence.progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.6, 1],
    }), [playPresence.progress]);

    // ── The listen bar ───────────────────────────────────────────────────────
    // Tapping play grows the bar out of the button at once, before listening
    // has started (the notification permission may still be asked first);
    // closing it shrinks it back into the button when the button returns
    // (listening had turned focus mode on). Started anywhere else, it fades.
    const [listenLaunching, setListenLaunching] = useState(false);
    const [listenFromButton, setListenFromButton] = useState(false);
    const listenBarWanted = Boolean(currentBook) && ((listenActive && focusMode) || listenLaunching);
    const [listenBarMounted, setListenBarMounted] = useState(false);
    useEffect(() => {
        if (listenBarWanted) setListenBarMounted(true);
    }, [listenBarWanted]);
    const handleListenBarExited = useCallback(() => {
        setListenBarMounted(false);
        setListenFromButton(false);
    }, []);
    const listenFromPlayButton = useCallback(() => {
        setListenFromButton(true);
        setListenLaunching(true);
        resumeListening().finally(() => setListenLaunching(false));
    }, [resumeListening]);
    const listenBarOriginBottom = playButtonRest + playButtonLiftTarget;
    const listenBarOrigin = useMemo(() => (listenFromButton ? {
        bottom: listenBarOriginBottom,
        right: 16,
        size: PLAY_BUTTON_SIZE,
    } : null), [listenBarOriginBottom, listenFromButton]);

    return (
        <Animated.View
            collapsable={false}
            style={[styles.container, { opacity: enterAnim, transform: [{ translateY: enterShift }] }]}
        >
            {/* With no book open, the bookmark, progress and menu controls
                have nothing to act on, so hide the header. Listening starts
                from the play button over the bottom line. Kept mounted while
                hidden in full screen, so coming back is only a slide. */}
            {currentBook ? (
                <Animated.View
                    collapsable={false}
                    pointerEvents={chromeHidden ? 'none' : 'auto'}
                    onLayout={(event) => {
                        const height = Math.round(event?.nativeEvent?.layout?.height ?? 0);
                        if (height > 0) setHeaderHeight(height);
                    }}
                    style={[styles.headerLayer, { transform: [{ translateY: headerSlide }] }]}
                >
                    <ReaderHeaderBar styles={chrome} topInset={insets.top}>
                        <ReaderBackButton
                            styles={chrome}
                            themeColors={themeColors}
                            onPress={goBackFromReader}
                            accessibilityLabel={t('home.backToLibrary')}
                        />
                        {/* Where you are in the book (tap: the contents, its only
                            door). Saved and suggested words are in the menu; full
                            screen comes on as you read on. */}
                        <ReaderProgressButton
                            styles={chrome}
                            fillWidth={`${headerProgressPercent}%`}
                            label={t('common.percent', { value: headerProgressPercent })}
                            disabled={toc.length === 0}
                            onPress={() => setShowToc(true)}
                            accessibilityLabel={`${t('read.contents')}, ${t('common.percent', { value: headerProgressPercent })}`}
                        />
                        <ReaderCheckpointButton
                            styles={chrome}
                            themeColors={themeColors}
                            active={!!activeBookmark}
                            onPress={toggleBookmark}
                            onLongPress={openBeforeYouGo}
                            accessibilityLabel={activeBookmark ? t('read.removeBookmark') : t('read.addBookmark')}
                        />
                        <ReaderMenuButton
                            styles={chrome}
                            themeColors={themeColors}
                            open={showMenu}
                            onPress={() => {
                                setSettingsTab('text');
                                setShowMenu((prev) => !prev);
                            }}
                            accessibilityLabel={t('read.bookSettings')}
                        />
                    </ReaderHeaderBar>
                </Animated.View>
            ) : null}

            <View style={styles.page}>
                <View
                    style={[
                        styles.reader,
                        { paddingTop: insets.top },
                        readerBottomInset > 0 ? { paddingBottom: readerBottomInset } : null,
                    ]}
                >
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
                            style={[
                                styles.nativeReaderView,
                                nativeRenderMode === 'paged' ? { marginTop: chromeInsets.top } : null,
                            ]}
                            // Scroll mode pads the text with both; paged mode
                            // (top room given above) keeps the bottom one below
                            // its pages, where its progress thumb runs in full
                            // screen. Passed in every mode, so switching doesn't
                            // change it.
                            chromeInsets={chromeInsets}
                            fullscreen={chromeHidden}
                            pagedFocus={pagedListening}
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
                            exposureTerms={readerExposureTerms}
                            showPinyin={readerShowPinyin}
                            showGloss={readerShowGloss}
                            reduceMotion={reduceMotion}
                            tappedTerms={tappedTerms}
                            keepScreenOn={listenPlaying}
                        focusTapsInSpanOnly={listenActive}
                            clearSelectionToken={clearSelectionToken}
                            focusSentenceCount={focusSpan}
                            focusSwipeEnabled={focusSwipe}
                            focusNavToken={focusNavToken}
                            focusPanelHeight={focusMode ? focusPanelTotalHeight : 0}
                            onPageChange={handleReadingPageChange}
                            onReadingDirection={handleReadingDirection}
                            onChapterEnd={handleNativeChapterEnd}
                            onChapterStart={handleNativeChapterStart}
                            onChapterCommit={handleNativeChapterCommit}
                            onWordSelected={withReadingActivity(handleNativeWordSelected)}
                            onTextSelected={withReadingActivity(handleNativeTextSelected)}
                            onSelectionCleared={handleNativeSelectionCleared}
                            onFocusSentenceChange={withReadingActivity(handleFocusSentenceChange)}
                            onExposure={handleNativeExposure}
                            onSavedTermsShown={handleSavedTermsShown}
                            // The sentence whose translation the popup shows gets a faint mark.
                            showContextSentence={showTranslationPopup}
                        />
                    )}
                </View>

                {showTranslationPopup ? (
                    <SentenceTranslationPopup
                        sentence={translationPopupSentence}
                        sourceLanguage={activeBookLanguage}
                        targetLanguage={interfaceLanguage}
                        top={chromeHidden ? insets.top : headerHeight}
                    />
                ) : null}
            </View>

            {/* Kept mounted once the book is open, so coming back is only a slide. */}
            {(scrubberPresence.mounted || bookLoadState === 'ready') && currentBook ? (
                <Animated.View
                    pointerEvents={scrubberShown ? 'box-none' : 'none'}
                    style={[styles.scrubberLayer, { transform: [{ translateY: scrubberSlide }] }]}
                >
                    <PageScrubber
                        progress={bookProgress}
                        chapters={scrubberChapters}
                        bookmarks={scrubberBookmarks}
                        describe={describeScrubberPoint}
                        onDragTarget={handleScrubberTarget}
                        onSeek={handleScrubberSeek}
                        onSelectBookmark={(item) => handleSelectBookmark(item.bookmark)}
                        savedAt={heldSpot ? heldSpot.progress : null}
                        onReturnToSaved={returnToHeldSpot}
                        bottomInset={insets.bottom}
                    />
                </Animated.View>
            ) : null}

            {/* Hidden the moment the listen bar is up: the bar grows out of it,
                and shrinks back into it. */}
            {playPresence.mounted && !listenBarMounted ? (
                <Animated.View
                    pointerEvents={playButtonShown ? 'box-none' : 'none'}
                    style={[
                        styles.playButtonLayer,
                        {
                            bottom: playButtonRest,
                            opacity: playPresence.progress,
                            transform: [{ translateY: playButtonLift }, { scale: playButtonScale }],
                        },
                    ]}
                >
                    <TouchableOpacity
                        style={styles.playButton}
                        onPress={listenFromPlayButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('read.listen')}
                    >
                        <Feather name="play" size={20} color={themeColors.readerPaper} style={styles.playIcon} />
                    </TouchableOpacity>
                </Animated.View>
            ) : null}

            <TocDrawer
                visible={showToc}
                toc={toc}
                currentSpineIndex={activeSpineIndex}
                totalSpineItems={nativeChapterTotal}
                bookProgress={bookProgress}
                isDarkMode={isDarkMode}
                onClose={() => setShowToc(false)}
                onSelect={async (item) => {
                    if (!Number.isInteger(item?.spineIndex)) {
                        return;
                    }

                    setShowToc(false);
                    // An entry inside a chapter file (`fables.xhtml#the-fox`) goes
                    // to the block where that element starts, not the file's start.
                    let firstBlockId = null;
                    const anchor = tocAnchorFromHref(item.href);
                    if (anchor) {
                        try {
                            const chapterPackage = await loadParsedChapterPackage(item.spineIndex, 'toc');
                            firstBlockId = blockIdForAnchor(chapterBlocksForReaderPackage(chapterPackage), anchor);
                        } catch {
                            firstBlockId = null;
                        }
                    }
                    // Same path as a checkpoint jump: it carries a seek token and
                    // sends an explicit seek for the chapter already on screen,
                    // which a bare restore-position update can't do in scroll mode.
                    handleSelectBookmark({
                        spineIndex: item.spineIndex,
                        pageIndex: firstBlockId ? null : 0,
                        pagesInChapter: null,
                        href: item.path || item.href || '',
                        firstBlockId,
                    });
                }}
            />

            {nativeRenderMode === 'focus' && bookLoadState === 'ready' && nativeReaderPackage ? (
                <FocusControls
                    subscribe={subscribeFocusInfo}
                    focusSpan={focusSpan}
                    focusSwipe={focusSwipe}
                    hideArrows={listenActive}
                    sendFocusNav={sendFocusNav}
                    focusControlsTranslate={focusControlsTranslate}
                    focusControlsBaseBottom={focusControlsBaseBottom}
                    styles={chrome}
                    themeColors={themeColors}
                />
            ) : null}

            {/* Whenever the voice is on, its bar is too (a chapter loading
                in between included): it never reads with no player. */}
            {listenBarWanted || listenBarMounted ? (
                <ListenBar
                    open={listenBarWanted}
                    origin={listenBarOrigin}
                    onExited={handleListenBarExited}
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
                translationLocale={voiceLocaleFor(interfaceLanguage)}
                translationVoiceId={listenPrefs.voices?.[voiceLocaleFor(interfaceLanguage)] || null}
                onSelectTranslationVoice={selectTranslationVoice}
                onPreviewTranslationVoice={previewTranslationVoice}
            />


            <View
                style={[
                    styles.lookupLayer,
                    shouldPlaceLookupAtTop ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    shouldPlaceLookupAtTop
                        ? { paddingTop: chromeHidden ? insets.top : insets.top + spacing.xs + 52 }
                        // Flush to the bottom edge, full screen or not: the panel
                        // keeps clear of the navigation buttons itself (bottomInset).
                        : null,
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
                        phraseWord={highlightedWordContext?.phraseWord ?? ''}
                        isNativeSelection={isNativeSelection}
                        onExtendSelection={supportsExtendSelection ? handleExtendSelection : undefined}
                        placement={shouldPlaceLookupAtTop ? 'top' : 'bottom'}
                        bottomInset={focusMode ? navigationButtonsInset(insets.bottom) : insets.bottom}
                        isDarkMode={isDarkMode}
                        onClose={dismissLookup}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        onSavedWordsChanged={refreshBookSavedWords}
                        currentBook={currentBook}
                        sourceBook={activeBook}
                        savedWords={savedWordsList}
                        levelMarkFor={currentBook ? levelMarkFor : null}
                        translationVisualState={translationBannerVisualState}
                    />
                    {textSelection ? renderSelectionExplain() : null}
                </View>
            </View>

            <LocationPrompt
                visible={locationPromptShown}
                bottom={bottomOverlayBase + 16}
                onHeight={setLocationPromptHeight}
                onConfirm={confirmNewSpot}
                onDecline={declineNewSpot}
            />

            {/* "Getting this chapter's word help ready". Floats above the
                bottom edge so it never covers the book title or the header (in
                fullscreen the header is gone and the top of the page is the
                title). Focus mode has its own position pill and controls, so
                it stays out of the way there. */}
            {preparingNoticeShown ? (
                <View
                    pointerEvents="box-none"
                    style={[styles.hintLayer, { bottom: bottomOverlayBase + 16 }]}
                    onLayout={(event) => setPreparingNoticeHeight(Math.round(event?.nativeEvent?.layout?.height ?? 0))}
                >
                    <PreparingNotice done={wordHelpDone} />
                </View>
            ) : null}

            <GoalCompleteModal event={goalEvent} onClose={() => setGoalEvent(null)} />

            <ReaderSettingsSheet
                visible={showMenu && !chromeHidden}
                onClose={() => {
                    setShowMenu(false);
                    setSettingsTab('text');
                }}
                colors={themeColors}
                insets={insets}
                title={t('read.bookSettings')}
                language={activeBookLanguage}
                settings={settings}
                initialTab={settingsTab}
                onSettingChange={handleSettingChange}
                onResetTextSettings={resetBookSettings}
                onResetWordSettings={resetWordSettings}
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
                onSelectBookmark={jumpFromNotesLog}
                onDeleteBookmark={handleDeleteBookmark}
                onDelete={handleDeleteNote}
                onClose={() => setShowNotesLog(false)}
            />

        </Animated.View>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    // Laid over the page, which never makes room for it.
    headerLayer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 3,
    },
    page: {
        flex: 1,
    },
    reader: {
        flex: 1,
        position: 'relative',
    },
    scrubberLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
    },
    nativeReaderView: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
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
    // Quiet, on the page's own surface: it's there when wanted, not a call
    // to action over the text.
    playButtonLayer: {
        position: 'absolute',
        right: 16,
        zIndex: 12,
    },
    playButton: {
        width: PLAY_BUTTON_SIZE,
        height: PLAY_BUTTON_SIZE,
        borderRadius: PLAY_BUTTON_SIZE / 2,
        // The ink's colour: dark on a light page, light on a dark one.
        backgroundColor: themeColors.readerBodyInk,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.10)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 12,
        elevation: 3,
    },
    // The triangle's weight sits left of its box: nudge it to look centred.
    playIcon: {
        marginLeft: 2,
    },
    returnLayer: {
        alignItems: 'center',
        zIndex: 30,
        elevation: 30,
    },
    returnPill: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 22,
        backgroundColor: themeColors.text,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
    },
    returnButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
        paddingLeft: 16,
        paddingRight: 8,
    },
    returnText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        color: themeColors.surface,
    },
    returnClose: {
        height: 44,
        paddingLeft: 6,
        paddingRight: 14,
        justifyContent: 'center',
    },
});

export default Read;
