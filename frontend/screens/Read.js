import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';

import TopSection from '../components/Read/TopSection/TopSection';
import TocDrawer from '../components/Read/TocDrawer';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import NativeEpubReaderView from '../modules/native-epub-reader/src/NativeEpubReaderView';
import {
    PREPROCESS_VERSION,
    getBookPreprocessChapter,
    getSavedWords,
    insertCacheEntries,
    insertBookIndexEntries,
    lookupBookHighlightSurfaces,
    lookupBookLevelSurfaces,
    lookupCacheByStems,
    markBookPreprocessChapter,
    markBookPreprocessMeta,
    recordVocabContextForSurface,
} from '../services/Database';
import preprocessChapter from '../services/api/preprocessChapter';
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
import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../constants/languages';
import { getProficiencyLevelForLanguage } from '../constants/proficiencyLevels';
import { createNativeReaderThemeTokens, radii, spacing, textStyles, useTheme } from '../theme';

const LOOKUP_HINT_DISMISSED_KEY = 'lookupHintDismissed';
const READER_SETTINGS_KEY = 'readerSettings';
const READER_SETTINGS_UPDATED_AT_KEY = 'readerSettingsUpdatedAt';
const DEFAULT_READER_SETTINGS = {
    fontSize: 18,
    isDarkMode: false,
    lineSpacing: 2.05,
    brightness: 0.62,
};
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 30;
const LINE_SPACING_STEPS = [
    { value: 1.4, label: 'Compact' },
    { value: 1.65, label: 'Regular' },
    { value: 1.85, label: 'Open' },
    { value: 2.05, label: 'Relaxed' },
    { value: 2.3, label: 'Airy' },
    { value: 2.6, label: 'Wide' },
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

const splitLevelUnderlineTerms = (rows, userRank) => {
    const normalizedUserRank = Number(userRank);
    if (!Number.isFinite(normalizedUserRank)) {
        return { same: [], above: [] };
    }

    const surfaceRanks = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        const rank = Number(row?.level_rank ?? row?.proficiency_rank);
        if (!surface || !Number.isFinite(rank)) {
            return;
        }

        const previousRank = surfaceRanks.get(surface);
        if (!Number.isFinite(previousRank) || rank > previousRank) {
            surfaceRanks.set(surface, rank);
        }
    });

    const same = [];
    const above = [];
    surfaceRanks.forEach((rank, surface) => {
        if (rank === normalizedUserRank) {
            same.push(surface);
        } else if (rank > normalizedUserRank) {
            above.push(surface);
        }
    });

    return {
        same: uniqTerms(same),
        above: uniqTerms(above),
    };
};

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

const nearestLineSpacingIndex = (value) => {
    const spacing = Number(value);
    if (!Number.isFinite(spacing)) {
        return LINE_SPACING_STEPS.findIndex((step) => step.value === DEFAULT_READER_SETTINGS.lineSpacing);
    }

    return LINE_SPACING_STEPS.reduce((closestIndex, step, index) => {
        const closestDelta = Math.abs(LINE_SPACING_STEPS[closestIndex].value - spacing);
        const currentDelta = Math.abs(step.value - spacing);
        return currentDelta < closestDelta ? index : closestIndex;
    }, 0);
};

const lineSpacingLabel = (value) => (
    LINE_SPACING_STEPS[nearestLineSpacingIndex(value)]?.label
    ?? LINE_SPACING_STEPS[nearestLineSpacingIndex(DEFAULT_READER_SETTINGS.lineSpacing)].label
);

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

const progressForChapterPosition = ({
    pageInChapter = null,
    pagesInChapter = null,
    activeSpineIndex = null,
    nativePosition = null,
    bookProgress = null,
    totalSpineItems = null,
}) => {
    if (
        Number.isInteger(pageInChapter)
        && Number.isInteger(pagesInChapter)
        && pagesInChapter > 0
    ) {
        return clampProgress(pageInChapter / pagesInChapter);
    }

    if (
        Number.isInteger(nativePosition?.pageIndex)
        && Number.isInteger(nativePosition?.pagesInChapter)
        && nativePosition.pagesInChapter > 0
        && (
            !Number.isInteger(nativePosition?.spineIndex)
            || !Number.isInteger(activeSpineIndex)
            || nativePosition.spineIndex === activeSpineIndex
        )
    ) {
        return clampProgress((nativePosition.pageIndex + 1) / nativePosition.pagesInChapter);
    }

    if (
        Number.isInteger(activeSpineIndex)
        && totalSpineItems > 0
        && typeof bookProgress === 'number'
    ) {
        const inferredChapterProgress = (bookProgress * totalSpineItems) - activeSpineIndex;
        if (inferredChapterProgress >= 0 && inferredChapterProgress <= 1) {
            return clampProgress(inferredChapterProgress);
        }
    }

    return 0;
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
    setIsReaderFocusMode,
    user,
    navigation,
    route,
}) => {
    const { t, language: interfaceLanguage } = useTranslation();
    const { targetLanguage, levelsByLanguage, isDarkMode, setIsDarkMode } = useAppContext();
    const { colors: themeColors } = useTheme();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
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
    const [showSettings, setShowSettings] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    const [highlightTerms, setHighlightTerms] = useState(null);
    const [optimisticHighlightTerms, setOptimisticHighlightTerms] = useState([]);
    const [levelUnderlineTerms, setLevelUnderlineTerms] = useState({ same: [], above: [] });
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
    const updateNativeRestorePosition = useCallback((position) => {
        nativeRestorePositionRef.current = position;
        setNativeRestorePosition(position);
    }, []);
    const selectedBook = books.find(book => book.uri === selectedCurrentBook) ?? null;
    const selectedBookLanguage = normalizeBookLanguage(selectedBook?.language ?? 'ko');
    const activeBook = selectedBook && selectedBookLanguage === targetLanguage ? selectedBook : null;
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
        getSavedWords({ ownerId: activeOwnerId, language: activeBookLanguage })
            .then(words => {
                setSavedWords(words);
            })
            .catch(err => {
                console.error('[Read] Failed to load saved words:', err);
                setSavedWords([]);
            });
    }, [activeBookLanguage, activeOwnerId]);

    useEffect(() => {
        if (savedWords === null) {
            setHighlightTermsReady(false);
            return;
        }

        if (!currentBook || shouldUseHeuristicHighlights) {
            setHighlightTerms(savedWords);
            setHighlightTermsReady(true);
            return;
        }

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

    useEffect(() => {
        if (!currentBook) {
            setLevelUnderlineTerms({ same: [], above: [] });
            return;
        }

        const selectedLevel = getProficiencyLevelForLanguage(activeBookLanguage, levelsByLanguage);
        const userRank = Number(selectedLevel?.rank);
        if (!Number.isFinite(userRank)) {
            setLevelUnderlineTerms({ same: [], above: [] });
            return;
        }

        let isActive = true;

        lookupBookLevelSurfaces(activeOwnerId, currentBook, userRank, {
            language: activeBookLanguage,
        }).then((rows) => {
            if (!isActive) {
                return;
            }
            setLevelUnderlineTerms(splitLevelUnderlineTerms(rows, userRank));
        }).catch((error) => {
            console.error('[Read] Failed to load book level underline surfaces:', error);
            if (isActive) {
                setLevelUnderlineTerms({ same: [], above: [] });
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
        levelsByLanguage,
        preprocessStatus,
    ]);

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        const elapsed = Date.now() - readingSessionStartedAtRef.current;
        const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
        if (elapsed >= 5000) {
            addReadingMillis(sessionOwnerId, elapsed);
        }

        setPreprocessStatus('idle');
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
        setShowSettings(false);
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
    }, [activeOwnerId, currentBook, updateNativeRestorePosition]);

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

    const handleWordSave = (word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        setSavedWords(prev => uniqTerms([...(prev ?? []), word]));
        setOptimisticHighlightTerms((prev) => {
            return uniqTerms([
                ...prev,
                word,
                ...(surface ? [surface] : []),
            ]);
        });
        setClearSelectionToken((value) => value + 1);
    };

    const handleWordUnsave = (word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        setSavedWords(prev => (prev ?? []).filter(w => w !== word));
        setOptimisticHighlightTerms(prev => prev.filter(term => term !== word && term !== surface));
    };

    const handleNativeWordSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }
        const sentence = typeof event.sentence === 'string' ? event.sentence.trim() : '';

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

    const handleNativeTextSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        setIsNativeSelection(true);
        setHighlightedWord(text);
        setHighlightedWordContext(null);
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');
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

    const saveSettings = async (newSettings, updatedAt = new Date().toISOString(), options = {}) => {
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
    };

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
                    await saveSettings(nextSettings, cloudUpdatedAt, { syncCloud: false });
                    return;
                }

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
        };
    }, [activeOwnerId, isDarkMode, readerSettingsLoaded, saveSettings, setIsDarkMode, syncGeneration, syncPaused, user]);

    const handleSettingChange = (key, value) => {
        if (key === 'isDarkMode') {
            setIsDarkMode(value);
        }
        const newSettings = {
            ...settings,
            isDarkMode,
            [key]: value,
        };
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((current) => current + 1);
        setSettings(newSettings);
        readerSettingsRef.current = newSettings;
        saveSettings(newSettings);
    };

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
    const dbReaderHighlightTerms = shouldUseHeuristicHighlights
        ? (savedWords ?? [])
        : (highlightTerms ?? savedWords ?? []);
    const readerHighlightTerms = uniqTerms([
        ...dbReaderHighlightTerms,
        ...optimisticHighlightTerms,
    ]);
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
            ? `${t('read.chapter')} ${activeSpineIndex + 1}`
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
                return tocTitle;
            }
        }

        return titleForSpineItem(nativeReaderPackage?.loadedSpineItem) || fallbackTitle;
    }, [activeSpineIndex, flattenedToc, nativeReaderPackage?.loadedSpineItem, t]);
    const headerBookTitle = (
        activeBook?.title
        || nativeReaderPackage?.metadata?.title
        || nativeReaderPackage?.bookManifest?.title
        || t('read.defaultTitle')
    );
    const bookProgress = clampProgress(
        typeof readerLocationInfo?.percentage === 'number'
            ? readerLocationInfo.percentage
            : activeBook?.progress
    );
    const chapterProgress = progressForChapterPosition({
        pageInChapter: readerLocationInfo?.pageInChapter,
        pagesInChapter: readerLocationInfo?.pagesInChapter,
        activeSpineIndex,
        nativePosition: nativeRestorePosition || activeBook?.nativePosition,
        bookProgress,
        totalSpineItems: nativeChapterTotal,
    });
    const progressPercent = Math.round(chapterProgress * 100);
    const progressLabel = `${progressPercent}%`;
    const progressFillWidth = `${progressPercent}%`;
    const chapterIndexLabel = Number.isInteger(activeSpineIndex)
        ? `${t('read.chapter')} ${activeSpineIndex + 1}`
        : t('read.defaultTitle');
    const hasNamedChapterTitle = activeChapterTitle && activeChapterTitle !== chapterIndexLabel;
    const headerLine1 = hasNamedChapterTitle ? chapterIndexLabel : activeChapterTitle;
    const headerLine2 = hasNamedChapterTitle ? activeChapterTitle : null;
    const returnToScreen = route?.params?.returnTo === 'Learn' ? 'Learn' : 'Home';
    const handleHeaderBack = useCallback(() => {
        setShowSettings(false);
        setShowMenu(false);
        setShowToc(false);
        navigation?.navigate?.(returnToScreen);
    }, [navigation, returnToScreen]);

    useEffect(() => {
        const unsubscribeFocus = navigation?.addListener?.('focus', () => {
            bookCompletionInProgressRef.current = false;
            setIsReaderFocusMode?.(true);
        });
        const unsubscribeBlur = navigation?.addListener?.('blur', () => {
            setIsReaderFocusMode?.(false);
        });

        if (navigation?.isFocused?.()) {
            bookCompletionInProgressRef.current = false;
            setIsReaderFocusMode?.(true);
        }

        return () => {
            unsubscribeFocus?.();
            unsubscribeBlur?.();
            setIsReaderFocusMode?.(false);
        };
    }, [navigation, setIsReaderFocusMode]);

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
            || 'Untitled';
        const packageLoader = isPublicDomainBookUri(currentBook)
            ? readPublicDomainTextPackage(currentBook, loadOptions)
            : isPdfBook(activeBook, currentBook)
                ? readPdfPackageXml(currentBook, fallbackName, loadOptions)
                : readEpubPackageXml(
                    currentBook,
                    fallbackName,
                    loadOptions
                );

        const loadPromise = packageLoader.then((parsedPackage) => {
            cacheParsedChapterPackage(parsedPackage);
            return parsedPackage;
        }).finally(() => {
            parsedChapterInflightRef.current.delete(cacheKey);
        });

        parsedChapterInflightRef.current.set(cacheKey, loadPromise);
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
        const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
        const cacheEntries = (results || [])
            .filter((entry) => entry?.stem)
            .map((entry) => {
                const entryInterfaceLanguage = normalizeInterfaceLanguageCode(
                    entry.interfaceLanguage ?? entry.interface_language ?? normalizedInterfaceLanguage
                );

                if (
                    ['en', 'zh'].includes(normalizedLanguage)
                    && normalizedInterfaceLanguage !== 'en'
                    && entryInterfaceLanguage !== normalizedInterfaceLanguage
                ) {
                    return { ...entry, definition: null };
                }

                return entry;
            });
        await insertCacheEntries(cacheEntries, cacheScope);

        const stems = [...new Set(cacheEntries.map((entry) => entry.stem).filter(Boolean))];
        if (stems.length === 0) {
            return 0;
        }

        const cachedRows = await lookupCacheByStems(stems, cacheScope);
        const stemToId = {};
        cachedRows.forEach(row => { stemToId[row.stem] = row.id; });

        const seenSurfaceStem = new Set();
        const bookIndexEntries = (surfaceIndex || [])
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
                setBookLoadError(error?.message || t('read.nativeChapterUnsupported'));
                setChapterTransitionDirection('none:0');
                return;
            }

            setBookLoadState('error');
            setBookLoadError(error?.message || t('read.nativeUnsupported'));
            setChapterTransitionDirection('none:0');
        }
    }, [
        currentBook,
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

    const handleNativePageChange = useCallback(({ page, total, spineIndex, href, firstBlockId, savedHighlights } = {}) => {
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

        setReaderLocationInfo((prev) => ({
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
        }));

        if (!currentBook || !Number.isInteger(pageIndex) || !Number.isInteger(resolvedSpineIndex)) {
            return;
        }

        if (Array.isArray(savedHighlights) && savedHighlights.length > 0) {
            Promise.all(savedHighlights.map((highlight) => (
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
        setBooks((prevBooks) => prevBooks.map((book) => {
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
            );

            return isUnchanged
                ? book
                : { ...book, ...nextBookPatch };
        }));
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

        setShowSettings(false);
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

    const shouldPlaceLookupAtTop = lookupPlacement === 'top';
    const canShowFullscreenToggle = (
        bookLoadState === 'ready'
        && !!nativeReaderPackage
        && !highlightedWord
        && !showMenu
        && !showSettings
        && !showToc
    );
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
    const activeLineSpacingIndex = nearestLineSpacingIndex(readerLineSpacing);
    const activeLineSpacingLabel = lineSpacingLabel(readerLineSpacing);
    const handleFontSizeStep = (direction) => {
        handleSettingChange(
            'fontSize',
            Math.round(clampNumber(readerFontSize + direction, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_READER_SETTINGS.fontSize))
        );
    };
    const handleLineSpacingStep = (direction) => {
        const nextIndex = clampNumber(
            activeLineSpacingIndex + direction,
            0,
            LINE_SPACING_STEPS.length - 1,
            activeLineSpacingIndex
        );
        handleSettingChange('lineSpacing', LINE_SPACING_STEPS[nextIndex].value);
    };
    const handleBrightnessChange = (value) => {
        const nextBrightness = clampNumber(value, BRIGHTNESS_MIN, BRIGHTNESS_MAX, DEFAULT_READER_SETTINGS.brightness);
        handleSettingChange('brightness', Number(nextBrightness.toFixed(2)));
    };

    return (
        <View style={styles.container}>
            {!isFullscreen ? (
                <View style={[styles.headerBar, { paddingTop: insets.top + spacing.xs }]}>
                    <TouchableOpacity
                        style={styles.headerBackButton}
                        onPress={handleHeaderBack}
                        accessibilityRole="button"
                    >
                        <MaterialIcons name="arrow-back-ios" size={22} color={themeColors.text} />
                    </TouchableOpacity>

                    <View style={styles.headerTitleStack}>
                        <Text numberOfLines={1} style={styles.headerChapterTitle}>
                            {headerLine1}
                        </Text>
                        {headerLine2 ? (
                            <Text numberOfLines={1} style={styles.headerBookSubtitle}>
                                {headerLine2}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.headerControls}>
                        <Pressable
                            disabled={toc.length === 0}
                            onPress={() => setShowToc(true)}
                            accessibilityRole="button"
                            style={({ pressed }) => ([
                                styles.progressCluster,
                                toc.length === 0 && styles.progressClusterDisabled,
                                pressed && toc.length > 0 && styles.progressClusterPressed,
                            ])}
                        >
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: progressFillWidth }]} />
                            </View>
                            <Text numberOfLines={1} style={styles.controlLabel}>{progressLabel}</Text>
                        </Pressable>
                        <TouchableOpacity
                            style={styles.settingsButton}
                            onPress={() => setShowMenu((prev) => !prev)}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="more-horiz" size={20} color={showMenu ? themeColors.inkSlate : themeColors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

            <View style={styles.reader}>
                {bookLoadState === 'error' ? (
                    <View style={styles.readerErrorState}>
                        <Text style={styles.readerErrorTitle}>{t('read.openErrorTitle')}</Text>
                        <Text style={styles.readerErrorBody}>{bookLoadError}</Text>
                        {typeof activeBookSizeMb === 'number' ? (
                            <Text style={styles.readerErrorMeta}>
                                {t('common.fileSize', { size: activeBookSizeMb.toFixed(1) })}
                            </Text>
                        ) : null}
                        <TouchableOpacity style={styles.retryButton} onPress={retryBookLoad}>
                            <Text style={styles.retryButtonText}>{t('common.tryAgain')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : !currentBook ? (
                    <View style={styles.readerLoadingState}>
                        <Text style={styles.readerLoadingTitle}>{t('read.noBook')}</Text>
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
                        key={`${currentBook}-${readerRetryKey}`}
                        style={styles.nativeReaderView}
                        bookManifest={{
                            ...nativeReaderPackage.bookManifest,
                            chapterTransitionDirection,
                            currentChapterTitle: activeChapterTitle,
                            currentSpineTitle: activeChapterTitle,
                            currentBookTitle: headerBookTitle,
                        }}
                        chapterBlocks={nativeChapterBlocks}
                        chapterResources={nativeChapterResources}
                        chapterWindow={nativeChapterWindow}
                        restorePosition={nativeRestorePosition}
                        chapterTransitionDirection={chapterTransitionDirection}
                        fontSize={readerFontSize}
                        lineHeight={readerLineSpacing}
                        theme={isDarkMode ? 'dark' : 'light'}
                        themeTokens={nativeReaderThemeTokens}
                        highlightTerms={readerHighlightTerms}
                        sameLevelTerms={levelUnderlineTerms.same}
                        aboveLevelTerms={levelUnderlineTerms.above}
                        clearSelectionToken={clearSelectionToken}
                        onPageChange={handleNativePageChange}
                        onChapterEnd={handleNativeChapterEnd}
                        onChapterStart={handleNativeChapterStart}
                        onChapterCommit={handleNativeChapterCommit}
                        onWordSelected={handleNativeWordSelected}
                        onTextSelected={handleNativeTextSelected}
                        onSelectionCleared={handleNativeSelectionCleared}
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
                    const firstPagePosition = {
                        spineIndex: item.spineIndex,
                        pageIndex: 0,
                        pagesInChapter: null,
                        href: item.path || item.href || '',
                        firstBlockId: null,
                    };

                    if (item.spineIndex !== activeSpineIndex) {
                        loadNativeReaderPackage(item.spineIndex, {
                            restorePosition: firstPagePosition,
                            animateChapterTransition: false,
                        });
                    } else {
                        updateNativeRestorePosition(firstPagePosition);
                    }
                }}
            />

            <View
                style={[
                    styles.lookupLayer,
                    shouldPlaceLookupAtTop ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    shouldPlaceLookupAtTop
                        ? { paddingTop: isFullscreen ? 0 : insets.top + spacing.xs + 52 }
                        : { paddingBottom: insets.bottom + 6 },
                ]}
                pointerEvents="box-none"
            >
                <TopSection
                    highlightedWord={highlightedWord}
                    sourceSentence={highlightedWordContext?.sentence ?? ''}
                    isNativeSelection={isNativeSelection}
                    placement={shouldPlaceLookupAtTop ? 'top' : 'bottom'}
                    isDarkMode={isDarkMode}
                    onClose={() => {
                        setHighlightedWord('');
                        setHighlightedWordContext(null);
                        setIsNativeSelection(false);
                        setClearSelectionToken((value) => value + 1);
                    }}
                    onWordSave={handleWordSave}
                    onWordUnsave={handleWordUnsave}
                    currentBook={currentBook}
                    sourceBook={activeBook}
                    savedWords={savedWords ?? []}
                    translationVisualState={translationBannerVisualState}
                />
            </View>

            {!highlightedWord && showLookupHint ? (
                <View
                    pointerEvents="box-none"
                    style={[styles.hintLayer, { paddingBottom: insets.bottom + 8 }]}
                >
                    <View style={styles.hintCard}>
                        <View style={styles.hintCopy}>
                            <Feather name="corner-down-left" size={16} color={themeColors.textSubtle} />
                            <View style={styles.hintTextStack}>
                                <Text style={styles.hintText}>
                                    {t('read.tapHint')}
                                </Text>
                                <Text style={styles.hintSubtext}>
                                    {t('read.longPressHint')}
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={dismissLookupHint} style={styles.hintCloseButton}>
                            <Feather name="x" size={14} color={themeColors.textSubtle} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

            {canShowFullscreenToggle ? (
                <View
                    pointerEvents="box-none"
                    style={[
                        styles.fullscreenToggleLayer,
                        { bottom: insets.bottom + 18 },
                    ]}
                >
                    <TouchableOpacity
                        style={styles.fullscreenToggleButton}
                        onPress={() => setIsFullscreen((current) => !current)}
                        activeOpacity={0.72}
                        accessibilityRole="button"
                        accessibilityLabel={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
                    >
                        <Feather
                            name={isFullscreen ? 'minimize-2' : 'maximize-2'}
                            size={17}
                            color={themeColors.readerBodyInk}
                        />
                    </TouchableOpacity>
                </View>
            ) : null}

            {showMenu && !isFullscreen ? (
                <View pointerEvents="box-none" style={styles.settingsOverlay}>
                    <Pressable style={styles.settingsBackdrop} onPress={() => setShowMenu(false)} />
                    <View style={[styles.menuDropdown, { top: insets.top + 50, right: 14 }]}>
                        <TouchableOpacity
                            style={[styles.menuItem, styles.menuItemBorder]}
                            onPress={() => setShowMenu(false)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="bookmark-border" size={19} color={themeColors.textSecondary} />
                            <Text style={styles.menuItemLabel}>Bookmarks</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.menuItem, styles.menuItemBorder]}
                            onPress={() => setShowMenu(false)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="sticky-note-2" size={19} color={themeColors.textSecondary} />
                            <Text style={styles.menuItemLabel}>Notes</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.menuItem, styles.menuItemBorder]}
                            onPress={() => { setShowMenu(false); setShowSettings(true); }}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="text-fields" size={19} color={themeColors.textSecondary} />
                            <Text style={styles.menuItemLabel}>Font settings</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.menuItem}
                            onPress={() => setShowMenu(false)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="ios-share" size={19} color={themeColors.textSecondary} />
                            <Text style={styles.menuItemLabel}>Share</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

            {showSettings && !isFullscreen ? (
                <View pointerEvents="box-none" style={styles.settingsOverlay}>
                    <Pressable style={styles.settingsBackdrop} onPress={() => setShowSettings(false)} />
                    <View
                        pointerEvents="box-none"
                        style={[styles.fontSettingsSheetFrame, { paddingBottom: insets.bottom + 8 }]}
                    >
                        <View style={styles.fontSettingsSheet}>
                            <View style={styles.fontSettingsHandleWrap}>
                                <View style={styles.fontSettingsHandle} />
                            </View>
                            <Text style={styles.fontSettingsTitle}>FONT SETTINGS</Text>

                            <View style={styles.fontSettingsRows}>
                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>Font Size</Text>
                                    <View style={styles.fontSettingsStepperGroup}>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleFontSizeStep(-1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel="Decrease font size"
                                        >
                                            <Feather name="minus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                        <Text style={styles.fontSettingsValue}>{readerFontSize}</Text>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleFontSizeStep(1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel="Increase font size"
                                        >
                                            <Feather name="plus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>Line Spacing</Text>
                                    <View style={styles.fontSettingsStepperGroup}>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleLineSpacingStep(-1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel="Decrease line spacing"
                                        >
                                            <Feather name="minus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                        <Text style={[styles.fontSettingsValue, styles.fontSettingsLineSpacingValue]}>
                                            {activeLineSpacingLabel}
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleLineSpacingStep(1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel="Increase line spacing"
                                        >
                                            <Feather name="plus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={[styles.fontSettingsRow, styles.fontSettingsLastRow]}>
                                    <Text style={styles.fontSettingsLabel}>Brightness</Text>
                                    <View style={styles.fontSettingsBrightnessGroup}>
                                        <MaterialIcons name="light-mode" size={18} color={themeColors.readerSubtleInk} />
                                        <Slider
                                            style={styles.fontSettingsBrightnessSlider}
                                            value={readerBrightness}
                                            onValueChange={handleBrightnessChange}
                                            minimumValue={BRIGHTNESS_MIN}
                                            maximumValue={BRIGHTNESS_MAX}
                                            step={0.01}
                                            allowTouchTrack
                                            thumbTintColor={themeColors.readerProgressFill}
                                            minimumTrackTintColor={themeColors.readerProgressFill}
                                            maximumTrackTintColor={themeColors.readerHairline}
                                            trackStyle={styles.fontSettingsSliderTrack}
                                            thumbStyle={styles.fontSettingsSliderThumb}
                                            accessibilityLabel="Reader brightness"
                                        />
                                    </View>
                                </View>
                            </View>
                        </View>
                    </View>
                </View>
            ) : null}
        </View>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: themeColors.readerPaper,
        borderBottomWidth: 1,
        borderBottomColor: themeColors.readerHairline,
    },
    headerBackButton: {
        width: 38,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.pill,
    },
    headerTitleStack: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerChapterTitle: {
        fontFamily: 'FFSans-SemiBold',
        fontSize: 15,
        lineHeight: 20,
        color: themeColors.readerBodyInk,
        textAlign: 'center',
    },
    headerBookSubtitle: {
        fontFamily: 'FFSans-Regular',
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.readerMutedInk,
        marginTop: 1,
        textAlign: 'center',
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    progressCluster: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 42,
        borderRadius: radii.pill,
    },
    progressClusterPressed: {
        opacity: 0.7,
    },
    progressClusterDisabled: {
        opacity: 1,
    },
    fullscreenToggleLayer: {
        position: 'absolute',
        right: spacing.lg,
    },
    fullscreenToggleButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
        backgroundColor: themeColors.transparent,
    },
    progressTrack: {
        width: 60,
        height: 3,
        borderRadius: 2,
        backgroundColor: themeColors.readerProgressTrack,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: themeColors.readerProgressFill,
    },
    controlLabel: {
        fontFamily: 'FFSans-Medium',
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.readerMutedInk,
        minWidth: 33,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
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
    lookupDismissZone: {
        ...StyleSheet.absoluteFillObject,
    },
    hintLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: spacing.md,
    },
    hintCard: {
        borderRadius: radii.pill,
        backgroundColor: themeColors.surfaceElevated,
        borderWidth: 1,
        borderColor: themeColors.border,
        paddingLeft: spacing.md,
        paddingRight: spacing.sm,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    hintCopy: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    hintText: {
        ...textStyles.caption,
        color: themeColors.textSubtle,
        flexShrink: 1,
    },
    hintTextStack: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    hintSubtext: {
        ...textStyles.caption,
        color: themeColors.textSubtle,
        flexShrink: 1,
    },
    hintCloseButton: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    settingsButton: {
        width: 20,
        height: 42,
        borderRadius: 0,
        backgroundColor: themeColors.transparent,
        justifyContent: 'center',
        alignItems: 'center',
    },
    menuDropdown: {
        position: 'absolute',
        width: 184,
        backgroundColor: themeColors.surface,
        borderWidth: 1,
        borderColor: themeColors.border,
        borderRadius: 4,
        overflow: 'hidden',
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 13,
        paddingHorizontal: 16,
    },
    menuItemBorder: {
        borderBottomWidth: 1,
        borderBottomColor: themeColors.divider,
    },
    menuItemLabel: {
        fontFamily: textStyles.body.fontFamily,
        fontSize: 14,
        color: themeColors.text,
    },
    settingsOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 25,
        elevation: 25,
    },
    settingsBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    fontSettingsSheetFrame: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingHorizontal: 14,
    },
    fontSettingsSheet: {
        width: '100%',
        maxWidth: 360,
        backgroundColor: themeColors.readerSurface,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        borderRadius: radii.xl,
        paddingTop: 14,
        paddingHorizontal: 24,
        paddingBottom: 26,
        shadowColor: 'rgba(27, 28, 28, 0.08)',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 8,
    },
    fontSettingsHandleWrap: {
        alignItems: 'center',
    },
    fontSettingsHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: themeColors.readerBorder,
    },
    fontSettingsTitle: {
        marginTop: 18,
        fontFamily: 'FFDisplay-Regular',
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 3,
        color: themeColors.textSecondary,
        textAlign: 'center',
    },
    fontSettingsRows: {
        marginTop: 16,
    },
    fontSettingsRow: {
        height: 48,
        borderTopWidth: 1,
        borderTopColor: themeColors.readerHairline,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    fontSettingsLastRow: {
        borderBottomWidth: 1,
        borderBottomColor: themeColors.readerHairline,
    },
    fontSettingsLabel: {
        fontFamily: 'FFSans-Regular',
        fontSize: 15,
        lineHeight: 20,
        color: themeColors.readerBodyInk,
        flexShrink: 0,
    },
    fontSettingsStepperGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    fontSettingsStepperButton: {
        width: 30,
        height: 30,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        borderRadius: radii.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.readerSurface,
    },
    fontSettingsValue: {
        minWidth: 22,
        fontFamily: 'FFSans-Regular',
        fontSize: 15,
        lineHeight: 20,
        color: themeColors.readerBodyInk,
        textAlign: 'center',
    },
    fontSettingsLineSpacingValue: {
        minWidth: 80,
    },
    fontSettingsBrightnessGroup: {
        width: 150,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    fontSettingsBrightnessSlider: {
        flex: 1,
        height: 30,
    },
    fontSettingsSliderTrack: {
        height: 3,
        borderRadius: 2,
    },
    fontSettingsSliderThumb: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: themeColors.readerSurface,
        backgroundColor: themeColors.readerProgressFill,
        shadowColor: themeColors.readerBorder,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 1,
        elevation: 2,
    },
});

export default Read;
