import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Pressable, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';

import TopSection from '../components/Read/TopSection/TopSection';
import TocDrawer from '../components/Read/TocDrawer';
import NativeEpubReaderView from '../modules/native-epub-reader/src/NativeEpubReaderView';
import {
    getSavedVocabForHighlights,
    isBookPreprocessed,
    insertCacheEntries,
    insertBookIndexEntries,
    lookupBookHighlightSurfaces,
    lookupCacheByStems,
    logDatabaseSnapshot,
    recordImplicitReadingReview,
    recordVocabEncounterBatch,
} from '../services/Database';
import preprocessBook from '../services/api/preprocessBook';
import { addReadingMillis } from '../services/dailyProgress';
import { readEpubPackageXml } from '../services/epubMetadata';
import { colors, radii, spacing, textStyles } from '../theme';

const LOOKUP_HINT_DISMISSED_KEY = 'lookupHintDismissed';
const DEFAULT_READER_SETTINGS = {
    fontSize: 18,
    isDarkMode: false,
    lineSpacing: 1.5,
};

const uniqTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

const highlightItemKey = (item) => {
    if (typeof item === 'string') {
        return `term:${item.trim()}`;
    }

    if (!item || typeof item !== 'object') {
        return '';
    }

    const term = typeof item.term === 'string' ? item.term.trim() : '';
    const vocabId = Number(item.vocabId);
    return Number.isInteger(vocabId) && vocabId > 0
        ? `id:${vocabId}:${term}`
        : `term:${term}`;
};

const dedupeHighlightItems = (items) => {
    const seen = new Set();
    const nextItems = [];

    (items || []).forEach((item) => {
        const key = highlightItemKey(item);
        if (!key || seen.has(key)) {
            return;
        }

        seen.add(key);
        nextItems.push(item);
    });

    return nextItems;
};

const vocabRowToHighlightItem = (row) => ({
    vocabId: row.id,
    term: row.word,
    maturity: row.maturity,
    highlightTone: row.highlightTone,
    encounterCount: row.encounter_count,
});

const isVisibleHighlightRow = (row) => row?.word && row.highlightTone !== 'hidden';

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
        blocks,
        resources: chapterResourcesForReaderPackage(readerPackage),
    };
};

const Read = ({ books, setBooks, currentBook, preprocessOnOpen, onPreprocessComplete, setIsReaderFocusMode }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    const [showLookupHint, setShowLookupHint] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    const [savedVocabRows, setSavedVocabRows] = useState(null);
    const [highlightTerms, setHighlightTerms] = useState(null);
    const [optimisticHighlightTerms, setOptimisticHighlightTerms] = useState([]);
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
    // 'retrying'     — network error, waiting to retry (banner stays visible)
    // 'done'         — book is fully preprocessed and cached locally
    // 'error'        — failed after all retries (non-fatal, live API still works)
    const [preprocessStatus, setPreprocessStatus] = useState('idle');
    const [preprocessMessage, setPreprocessMessage] = useState('');
    const [preprocessDetail, setPreprocessDetail] = useState('');

    // Stores the last extracted text so we can (re-)trigger preprocessing
    // if the user presses Download while the book is already open
    const extractedTextRef = useRef(null);
    const preprocessingInFlightRef = useRef(false);
    const readingSessionStartedAtRef = useRef(Date.now());
    const chapterLoadTokenRef = useRef(0);
    const nativeReaderPackageRef = useRef(null);
    const currentSpineIndexRef = useRef(null);
    const parsedChapterCacheRef = useRef(new Map());
    const parsedChapterInflightRef = useRef(new Map());
    const chapterPrefetchTokenRef = useRef(0);
    const encounterTimerRef = useRef(null);
    const lastEncounterPageKeyRef = useRef('');
    const activeBook = books.find(book => book.uri === currentBook) ?? null;
    const shouldUseHeuristicHighlights = !activeBook?.preprocessed;

    const refreshSavedVocabRows = useCallback(async () => {
        const rows = await getSavedVocabForHighlights();
        console.log(`[Read] Loaded ${rows.length} saved vocab row(s) for highlighting`);
        setSavedVocabRows(rows);
        setSavedWords(rows.map((row) => row.word).filter(Boolean));
        return rows;
    }, []);

    // Load saved words for highlighting on mount
    useEffect(() => {
        refreshSavedVocabRows()
            .catch(err => {
                console.error('[Read] Failed to load saved vocab rows:', err);
                setSavedVocabRows([]);
                setSavedWords([]);
            });
    }, [refreshSavedVocabRows]);

    useEffect(() => {
        if (savedVocabRows === null) {
            setHighlightTermsReady(false);
            return;
        }

        const nativeHighlightItems = savedVocabRows
            .filter(isVisibleHighlightRow)
            .map(vocabRowToHighlightItem);

        if (!currentBook || shouldUseHeuristicHighlights) {
            setHighlightTerms(nativeHighlightItems);
            setHighlightTermsReady(true);
            return;
        }

        let isActive = true;

        const loadHighlightTerms = async () => {
            try {
                const visibleSavedRows = savedVocabRows.filter(isVisibleHighlightRow);
                const savedStemWords = visibleSavedRows.map((row) => row.word).filter(Boolean);
                const savedRowByWord = new Map(visibleSavedRows.map((row) => [row.word, row]));
                const surfaceRows = await lookupBookHighlightSurfaces(currentBook, savedStemWords);
                if (!isActive) {
                    return;
                }

                const bookSurfaceItems = surfaceRows
                    .map((surfaceRow) => {
                        const matchingSavedRow = savedRowByWord.get(surfaceRow.stem);
                        if (!matchingSavedRow) {
                            return surfaceRow.surface;
                        }

                        return {
                            ...vocabRowToHighlightItem(matchingSavedRow),
                            term: surfaceRow.surface,
                            stem: surfaceRow.stem,
                        };
                    })
                    .filter((item) => (
                        typeof item === 'string'
                            ? item.trim()
                            : item?.term
                    ));

                const mergedTerms = dedupeHighlightItems([
                    ...nativeHighlightItems,
                    ...bookSurfaceItems,
                ]);

                console.log(
                    `[Read] Loaded ${mergedTerms.length} highlight term(s) (${surfaceRows.length} book-specific surfaces)`
                );
                setHighlightTerms(mergedTerms);
                setHighlightTermsReady(true);
            } catch (error) {
                console.error('[Read] Failed to load book highlight surfaces:', error);
                if (isActive) {
                    setHighlightTerms(nativeHighlightItems);
                    setHighlightTermsReady(true);
                }
            }
        };

        loadHighlightTerms();

        return () => {
            isActive = false;
        };
    }, [currentBook, preprocessStatus, savedVocabRows, shouldUseHeuristicHighlights]);

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        if (encounterTimerRef.current) {
            clearTimeout(encounterTimerRef.current);
            encounterTimerRef.current = null;
        }
        lastEncounterPageKeyRef.current = '';

        const elapsed = Date.now() - readingSessionStartedAtRef.current;
        if (elapsed >= 5000) {
            addReadingMillis(elapsed);
        }

        setPreprocessStatus('idle');
        setPreprocessMessage('');
        setPreprocessDetail('');
        extractedTextRef.current = null;
        preprocessingInFlightRef.current = false;
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
        setIsFullscreen(false);
        setReaderRetryKey(0);
        setNativeReaderPackage(null);
        setNativeChapterWindow([]);
        setNativeRestorePosition(null);
        nativeReaderPackageRef.current = null;
        setCurrentSpineIndex(null);
        currentSpineIndexRef.current = null;
        setChapterTransitionDirection('none:0');
        chapterLoadTokenRef.current += 1;
        chapterPrefetchTokenRef.current += 1;
        parsedChapterCacheRef.current = new Map();
        parsedChapterInflightRef.current = new Map();
        setToc([]);
        setShowToc(false);
    }, [currentBook]);

    useEffect(() => {
        return () => {
            if (encounterTimerRef.current) {
                clearTimeout(encounterTimerRef.current);
                encounterTimerRef.current = null;
            }
            lastEncounterPageKeyRef.current = '';

            const elapsed = Date.now() - readingSessionStartedAtRef.current;
            if (elapsed >= 5000) {
                addReadingMillis(elapsed);
            }
        };
    }, []);

    const handleWordSave = (word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        setSavedWords(prev => uniqTerms([...(prev ?? []), word]));
        setOptimisticHighlightTerms((prev) => {
            const next = uniqTerms([
                ...prev,
                word,
                ...(surface ? [surface] : []),
            ]);
            console.log(
                `[Read] optimistic save highlight: word="${word}" surface="${surface || ''}" optimisticTerms=${next.length}`
            );
            return next;
        });
        setClearSelectionToken((value) => value + 1);
    };

    const handleWordUnsave = (word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        setSavedWords(prev => (prev ?? []).filter(w => w !== word));
        setSavedVocabRows(prev => (prev ?? []).filter(row => row.word !== word));
        setOptimisticHighlightTerms(prev => prev.filter(term => term !== word && term !== surface));
    };

    const handleNativeWordSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        setIsNativeSelection(false);
        setHighlightedWord(text);
        setHighlightedWordContext({
            sentence: typeof event.sentence === 'string' ? event.sentence.trim() : '',
        });
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');
    }, []);

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

    // ── Core preprocessing pipeline ──────────────────────────────────────────
    // Separated from the text-extraction callback so it can be triggered both
    // when text first arrives AND when the user presses Download on an already-open book.
    const runPreprocessing = useCallback(async (text) => {
        if (!currentBook || !text) return;
        if (preprocessingInFlightRef.current) {
            console.log('[Read] Preprocessing already in progress — ignoring duplicate trigger');
            return;
        }

        preprocessingInFlightRef.current = true;
        setBooks((prevBooks) => prevBooks.map((book) => (
            book.uri === currentBook ? { ...book, preprocessing: true } : book
        )));

        console.log(`[Read] Starting preprocessing (${text.length.toLocaleString()} chars)...`);
        setPreprocessStatus('checking');
        setPreprocessMessage('Checking local cache...');
        setPreprocessDetail('');

        try {
            const alreadyDone = await isBookPreprocessed(currentBook);
            if (alreadyDone) {
                console.log('[Read] Book already preprocessed — skipping backend call');
                setBooks((prevBooks) => prevBooks.map((book) => (
                    book.uri === currentBook ? { ...book, preprocessed: true, preprocessing: false } : book
                )));
                setPreprocessStatus('done');
                setPreprocessMessage('Vocabulary already cached');
                setPreprocessDetail('');
                logDatabaseSnapshot(currentBook);
                onPreprocessComplete?.(currentBook);
                return;
            }

            setPreprocessStatus('preprocessing');
            setPreprocessMessage('Starting preprocessing job...');
            setPreprocessDetail('');
            const { results, stats, surface_index = [], networkError, errorMessage } = await preprocessBook({
                text,
                onStatus: (job) => {
                    if (job.status === 'queued') {
                        setPreprocessStatus('queued');
                        setPreprocessMessage(job.message || 'Job queued');
                        setPreprocessDetail('');
                        return;
                    }

                    if (job.status === 'running') {
                        setPreprocessStatus('preprocessing');
                        setPreprocessMessage(job.message || 'Preprocessing book...');

                        if (job.stage === 'fetching_krdict' && job.stats?.missing_stems) {
                            setPreprocessDetail(
                                `${job.stats.fetched_stems ?? 0}/${job.stats.missing_stems} dictionary entries fetched`
                            );
                        } else if (job.stats?.total_stems) {
                            setPreprocessDetail(`${job.stats.total_stems} stems discovered`);
                        } else {
                            setPreprocessDetail('');
                        }
                    }
                },
            });

            if (networkError) {
                // preprocessBook retried internally — all attempts exhausted
                console.warn('[Read] Preprocessing failed after retries — network unreachable');
                setPreprocessStatus('error');
                setPreprocessMessage('Preprocessing lost connection');
                setPreprocessDetail(errorMessage ?? 'Try again when the network is stable.');
                setBooks((prevBooks) => prevBooks.map((book) => (
                    book.uri === currentBook ? { ...book, preprocessing: false } : book
                )));
                logDatabaseSnapshot(currentBook);
                return;
            }

            if (!results || results.length === 0) {
                console.warn('[Read] Preprocessing returned no results — backend error');
                setPreprocessStatus('error');
                setPreprocessMessage('Preprocessing failed');
                setPreprocessDetail(errorMessage ?? 'The backend did not return results.');
                setBooks((prevBooks) => prevBooks.map((book) => (
                    book.uri === currentBook ? { ...book, preprocessing: false } : book
                )));
                logDatabaseSnapshot(currentBook);
                return;
            }

            console.log(`[Read] Preprocessing complete: ${results.length} stems | stats:`, stats);

            await insertCacheEntries(results);

            const stems = results.map(r => r.stem);
            const cachedRows = await lookupCacheByStems(stems);
            const stemToId = {};
            cachedRows.forEach(row => { stemToId[row.stem] = row.id; });

            const bookIndexEntries = surface_index
                .filter(entry => stemToId[entry.stem] != null)
                .map(entry => ({ surface: entry.surface, stem_id: stemToId[entry.stem] }));

            await insertBookIndexEntries(currentBook, bookIndexEntries);
            console.log(`[Read] Book index saved: ${bookIndexEntries.length} entries`);

            setPreprocessStatus('done');
            setPreprocessMessage('Vocabulary cached');
            setPreprocessDetail(`${bookIndexEntries.length} book index entries ready`);
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook ? { ...book, preprocessed: true, preprocessing: false } : book
            )));
            logDatabaseSnapshot(currentBook);
            onPreprocessComplete?.(currentBook);

        } catch (err) {
            console.error('[Read] Preprocessing pipeline failed:', err);
            setPreprocessStatus('error');
            setPreprocessMessage('Preprocessing failed');
            setPreprocessDetail(err.message ?? 'Unknown error');
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook ? { ...book, preprocessing: false } : book
            )));
        } finally {
            preprocessingInFlightRef.current = false;
        }
    }, [currentBook, onPreprocessComplete, setBooks]);

    // ── Book text extraction callback ────────────────────────────────────────
    // Always stores the text so it's available if the user requests preprocessing later.
    // Only runs the pipeline immediately if the user already pressed Download.
    const handleBookTextExtracted = useCallback((text) => {
        if (!text) {
            console.warn('[Read] Received empty book text — extraction may have failed');
            return;
        }
        console.log(`[Read] Book text received (${text.length.toLocaleString()} chars)`);
        extractedTextRef.current = text;
        if (preprocessOnOpen || (currentBook && !activeBook?.preprocessed && !activeBook?.preprocessing)) {
            runPreprocessing(text);
        }
    }, [activeBook?.preprocessed, activeBook?.preprocessing, currentBook, preprocessOnOpen, runPreprocessing]);

    // ── Trigger preprocessing if Download was pressed while book was already open ─
    useEffect(() => {
        if (preprocessOnOpen && extractedTextRef.current) {
            runPreprocessing(extractedTextRef.current);
        }
    }, [preprocessOnOpen, runPreprocessing]);

    useEffect(() => {
        if (preprocessStatus !== 'done') {
            return undefined;
        }

        const timeout = setTimeout(() => {
            setPreprocessStatus('idle');
            setPreprocessMessage('');
            setPreprocessDetail('');
        }, 4000);

        return () => clearTimeout(timeout);
    }, [preprocessStatus]);

    // ── Settings ─────────────────────────────────────────────────────────────
    const [settings, setSettings] = useState(DEFAULT_READER_SETTINGS);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        loadSettings();
    }, []);

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

    const loadSettings = async () => {
        try {
            const savedSettings = await AsyncStorage.getItem('readerSettings');
            if (savedSettings) {
                setSettings({ ...DEFAULT_READER_SETTINGS, ...JSON.parse(savedSettings) });
                console.log('[Read] Settings loaded from AsyncStorage');
            }
        } catch (error) {
            console.error('[Read] Error loading settings:', error);
        }
    };

    const saveSettings = async (newSettings) => {
        try {
            await AsyncStorage.setItem('readerSettings', JSON.stringify(newSettings));
        } catch (error) {
            console.error('[Read] Error saving settings:', error);
        }
    };

    const handleSettingChange = (key, value) => {
        const newSettings = { ...settings, [key]: value };
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((current) => current + 1);
        setSettings(newSettings);
        saveSettings(newSettings);
    };

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
    const fallbackHighlightTerms = useMemo(() => {
        if (savedVocabRows !== null) {
            return savedVocabRows
                .filter(isVisibleHighlightRow)
                .map(vocabRowToHighlightItem);
        }

        return savedWords ?? [];
    }, [savedVocabRows, savedWords]);
    const dbReaderHighlightTerms = highlightTerms ?? fallbackHighlightTerms;
    const readerHighlightTerms = useMemo(() => (
        dedupeHighlightItems([
            ...dbReaderHighlightTerms,
            ...optimisticHighlightTerms,
        ])
    ), [dbReaderHighlightTerms, optimisticHighlightTerms]);
    const isReaderWaitingForHighlights = !!currentBook && !shouldUseHeuristicHighlights && !highlightTermsReady;
    const nativeChapterBlocks = chapterBlocksForReaderPackage(nativeReaderPackage);
    const nativeChapterResources = chapterResourcesForReaderPackage(nativeReaderPackage);
    const nativeChapterTotal = nativeReaderPackage?.spine?.length ?? 0;
    useEffect(() => {
        console.log(
            `[Read] reader highlight terms: total=${readerHighlightTerms.length} optimistic=${optimisticHighlightTerms.length}`
        );
    }, [optimisticHighlightTerms.length, readerHighlightTerms.length]);

    const progressLabel = (() => {
        if (readerLocationInfo?.pageInChapter && readerLocationInfo?.pagesInChapter) {
            const chapterLabel = readerLocationInfo?.page && readerLocationInfo?.total
                ? `${readerLocationInfo.page}/${readerLocationInfo.total}`
                : 'Chapter';
            return `${chapterLabel} · ${readerLocationInfo.pageInChapter}/${readerLocationInfo.pagesInChapter}`;
        }
        if (readerLocationInfo?.page && readerLocationInfo?.total) {
            return `${readerLocationInfo.page}/${readerLocationInfo.total}`;
        }
        if (typeof readerLocationInfo?.percentage === 'number') {
            return `${Math.round(readerLocationInfo.percentage * 100)}%`;
        }
        return 'Start';
    })();
    useEffect(() => {
        setIsReaderFocusMode?.(isFullscreen);
        return () => {
            setIsReaderFocusMode?.(false);
        };
    }, [isFullscreen, setIsReaderFocusMode]);

    useEffect(() => {
        if (!currentBook || !activeBook || activeBook.preprocessed || activeBook.preprocessing) {
            return;
        }

        if (extractedTextRef.current) {
            runPreprocessing(extractedTextRef.current);
        }
    }, [activeBook, currentBook, runPreprocessing]);

    const handleBookLoadError = useCallback((reason) => {
        const lowerReason = String(reason || '').toLowerCase();
        const likelyTooLarge = lowerReason.includes('readasdataurl')
            || lowerReason.includes('outofmemory')
            || (typeof activeBookSizeMb === 'number' && activeBookSizeMb >= 25);

        setBookLoadState('error');
        setBookLoadError(
            likelyTooLarge
                ? 'This EPUB appears too large for the current reader on this device. Please try a smaller file and try again.'
                : 'This book could not be opened. Please try again.'
        );
    }, [activeBookSizeMb]);

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
        console.log(
            `[Read] Native chapter window updated: center=${centerSpineIndex} ` +
            `chapters=${entries.map((entry) => `${entry.role}:${entry.spineIndex}`).join(',') || 'none'}`
        );

        return entries;
    }, [cacheParsedChapterPackage, pruneParsedChapterCache]);

    const loadParsedChapterPackage = useCallback(async (requestedSpineIndex = null, reason = 'load') => {
        if (!currentBook) {
            return null;
        }

        const cacheKey = Number.isInteger(requestedSpineIndex) ? requestedSpineIndex : 'auto';
        if (Number.isInteger(requestedSpineIndex) && parsedChapterCacheRef.current.has(requestedSpineIndex)) {
            console.log(`[Read] JS chapter load cache hit: reason=${reason} spine=${requestedSpineIndex}`);
            return parsedChapterCacheRef.current.get(requestedSpineIndex);
        }

        if (parsedChapterInflightRef.current.has(cacheKey)) {
            console.log(`[Read] JS chapter load join: reason=${reason} spine=${cacheKey}`);
            return parsedChapterInflightRef.current.get(cacheKey);
        }

        const startedAt = Date.now();
        console.log(`[Read] JS chapter load start: reason=${reason} spine=${cacheKey}`);

        const loadPromise = readEpubPackageXml(
            currentBook,
            activeBook?.title || currentBook.split('/').pop() || 'Untitled',
            Number.isInteger(requestedSpineIndex) ? { spineIndex: requestedSpineIndex } : {}
        ).then((parsedPackage) => {
            const loadedSpineIndex = cacheParsedChapterPackage(parsedPackage);
            console.log(
                `[Read] JS chapter load end: reason=${reason} requested=${cacheKey} ` +
                `loaded=${loadedSpineIndex ?? 'unknown'} elapsedMs=${Date.now() - startedAt}`
            );
            return parsedPackage;
        }).finally(() => {
            parsedChapterInflightRef.current.delete(cacheKey);
        });

        parsedChapterInflightRef.current.set(cacheKey, loadPromise);
        return loadPromise;
    }, [activeBook?.title, cacheParsedChapterPackage, currentBook]);

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

    const loadNativeReaderPackage = useCallback(async (
        requestedSpineIndex = null,
        { animateChapterTransition = false, restorePosition = null } = {}
    ) => {
        if (!currentBook) {
            setNativeReaderPackage(null);
            setNativeChapterWindow([]);
            setNativeRestorePosition(null);
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
            setNativeRestorePosition(null);
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
            setNativeRestorePosition(nextRestorePosition);
            setToc(Array.isArray(parsedPackage.toc) ? parsedPackage.toc : []);
            setChapterTransitionDirection((prev) => {
                const previousToken = Number(String(prev).split(':')[1]) || 0;
                const direction = canKeepCurrentReader && animateChapterTransition ? nextTransitionDirection : 'none';
                return `${direction}:${previousToken + 1}`;
            });
            setNativeReaderPackage(parsedPackage);
            updateNativeChapterWindowForSpine(loadedSpineIndex, parsedPackage);
            prefetchAdjacentChapters(loadedSpineIndex, totalSpineItems);
            setReaderLocationInfo({
                page: totalSpineItems > 0 ? loadedSpineIndex + 1 : null,
                total: totalSpineItems || null,
                percentage: totalSpineItems > 0 ? loadedSpineIndex / totalSpineItems : null,
                href: parsedPackage.loadedSpineItem?.path || '',
                pageInChapter: null,
                pagesInChapter: null,
            });
            setBookLoadState('ready');
            setBookLoadError('');
        } catch (error) {
            if (chapterLoadTokenRef.current !== loadToken) {
                return;
            }

            console.error('[Read] Native EPUB load failed:', error);
            if (canKeepCurrentReader && nativeReaderPackageRef.current) {
                setBookLoadState('ready');
                setBookLoadError(error?.message || 'This chapter could not be opened by the native reader yet.');
                setChapterTransitionDirection('none:0');
                return;
            }

            setBookLoadState('error');
            setBookLoadError(error?.message || 'This book could not be opened by the native reader yet.');
            setChapterTransitionDirection('none:0');
        }
    }, [
        currentBook,
        loadParsedChapterPackage,
        prefetchAdjacentChapters,
        updateNativeChapterWindowForSpine,
    ]);

    useEffect(() => {
        const savedNativePosition = activeBook?.nativePosition || null;
        const savedSpineIndex = Number.isInteger(savedNativePosition?.spineIndex)
            ? savedNativePosition.spineIndex
            : null;

        loadNativeReaderPackage(savedSpineIndex, { restorePosition: savedNativePosition });

        return () => {
            chapterLoadTokenRef.current += 1;
            chapterPrefetchTokenRef.current += 1;
        };
    }, [loadNativeReaderPackage, readerRetryKey]);

    const handleNativePageChange = useCallback(({
        page,
        total,
        spineIndex,
        href,
        firstBlockId,
        visibleSavedWords = [],
    } = {}) => {
        const pageIndex = Number.isInteger(page) ? page : null;
        const eventSpineIndex = Number.isInteger(spineIndex) ? spineIndex : null;
        const currentLoadedSpineIndex = currentSpineIndexRef.current;
        const resolvedSpineIndex = Number.isInteger(eventSpineIndex)
            ? eventSpineIndex
            : currentLoadedSpineIndex;
        const totalSpineItems = nativeReaderPackageRef.current?.spine?.length ?? nativeChapterTotal;

        setReaderLocationInfo((prev) => ({
            ...(prev || {}),
            page: (
                Number.isInteger(resolvedSpineIndex) && totalSpineItems > 0
                    ? resolvedSpineIndex + 1
                    : (prev?.page ?? null)
            ),
            total: totalSpineItems || prev?.total || null,
            percentage: (
                Number.isInteger(resolvedSpineIndex) && totalSpineItems > 0
                    ? resolvedSpineIndex / totalSpineItems
                    : (prev?.percentage ?? null)
            ),
            href: typeof href === 'string' && href.length > 0 ? href : (prev?.href || ''),
            pageInChapter: Number.isInteger(page) ? page + 1 : null,
            pagesInChapter: Number.isInteger(total) ? total : null,
        }));

        if (encounterTimerRef.current) {
            clearTimeout(encounterTimerRef.current);
            encounterTimerRef.current = null;
        }
        lastEncounterPageKeyRef.current = '';

        if (!currentBook || !Number.isInteger(pageIndex) || !Number.isInteger(resolvedSpineIndex)) {
            return;
        }

        const loadedSpineItem = nativeReaderPackageRef.current?.spine
            ?.find((item) => item?.index === resolvedSpineIndex)
            || nativeReaderPackageRef.current?.loadedSpineItem;
        const resolvedFirstBlockId = (
            typeof firstBlockId === 'string' && firstBlockId.length > 0
                ? firstBlockId
                : null
        );
        const nextPosition = {
            spineIndex: resolvedSpineIndex,
            pageIndex,
            pagesInChapter: Number.isInteger(total) ? total : null,
            href: (
                typeof href === 'string' && href.length > 0
                    ? href
                    : (loadedSpineItem?.path || loadedSpineItem?.href || '')
            ),
            firstBlockId: resolvedFirstBlockId,
        };

        setNativeRestorePosition(nextPosition);
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
                : { ...book, nativePosition: nextPosition };
        }));

        const visibleVocabItems = Array.isArray(visibleSavedWords)
            ? visibleSavedWords.filter((item) => (
                Number.isInteger(Number(item?.vocabId)) && Number(item?.vocabId) > 0
            ))
            : [];

        if (visibleVocabItems.length === 0) {
            return;
        }

        const locationKey = `${resolvedSpineIndex}:${pageIndex}:${resolvedFirstBlockId ?? ''}`;
        lastEncounterPageKeyRef.current = locationKey;
        encounterTimerRef.current = setTimeout(async () => {
            if (lastEncounterPageKeyRef.current !== locationKey) {
                return;
            }
            encounterTimerRef.current = null;

            const uniqueVisibleItems = [];
            const seenVocabIds = new Set();
            visibleVocabItems.forEach((item) => {
                const vocabId = Number(item.vocabId);
                if (seenVocabIds.has(vocabId)) {
                    return;
                }

                seenVocabIds.add(vocabId);
                uniqueVisibleItems.push({ ...item, vocabId });
            });

            const payload = uniqueVisibleItems.map((item) => ({
                vocabId: item.vocabId,
                sourceType: 'book',
                sourceUri: currentBook,
                sourceTitle: activeBook?.title ?? null,
                locationKey,
            }));

            try {
                const result = await recordVocabEncounterBatch(payload);
                const reviewIds = Array.isArray(result?.affectedVocabIds) && result.affectedVocabIds.length > 0
                    ? result.affectedVocabIds
                    : uniqueVisibleItems.map((item) => item.vocabId);

                await Promise.all(reviewIds.map((vocabId) => recordImplicitReadingReview(vocabId)));

                if (result?.insertedCount > 0) {
                    await refreshSavedVocabRows();
                }
            } catch (error) {
                console.error('[Read] Failed to record visible saved-word encounters:', error);
            }
        }, 2000);
    }, [activeBook?.title, currentBook, nativeChapterTotal, refreshSavedVocabRows, setBooks]);

    const handleNativeChapterCommit = useCallback(({
        spineIndex,
        href,
        path,
        pageIndex,
        pagesInChapter,
        firstBlockId,
        direction,
    } = {}) => {
        const committedSpineIndex = Number.isInteger(spineIndex) ? spineIndex : null;
        if (!Number.isInteger(committedSpineIndex)) {
            return;
        }

        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);

        const committedPackage = parsedChapterCacheRef.current.get(committedSpineIndex);
        console.log(
            `[Read] Native chapter commit: direction=${direction || 'none'} ` +
            `spine=${committedSpineIndex} cached=${!!committedPackage}`
        );

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

        chapterLoadTokenRef.current += 1;
        setCurrentSpineIndex(committedSpineIndex);
        currentSpineIndexRef.current = committedSpineIndex;
        nativeReaderPackageRef.current = committedPackage;
        setNativeReaderPackage(committedPackage);
        setNativeRestorePosition(nextPosition);
        if (currentBook) {
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? { ...book, nativePosition: nextPosition }
                    : book
            )));
        }
        setToc(Array.isArray(committedPackage.toc) ? committedPackage.toc : []);
        setChapterTransitionDirection((prev) => {
            const previousToken = Number(String(prev).split(':')[1]) || 0;
            return `none:${previousToken + 1}`;
        });
        setReaderLocationInfo({
            page: totalSpineItems > 0 ? committedSpineIndex + 1 : null,
            total: totalSpineItems || null,
            percentage: totalSpineItems > 0 ? committedSpineIndex / totalSpineItems : null,
            href: nextPosition.href,
            pageInChapter: Number.isInteger(pageIndex) ? pageIndex + 1 : null,
            pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
        });
        setBookLoadState('ready');
        setBookLoadError('');
        updateNativeChapterWindowForSpine(committedSpineIndex, committedPackage);
        prefetchAdjacentChapters(committedSpineIndex, totalSpineItems);
    }, [
        currentBook,
        loadNativeReaderPackage,
        prefetchAdjacentChapters,
        setBooks,
        updateNativeChapterWindowForSpine,
    ]);

    const handleNativeChapterEnd = useCallback(() => {
        const loadedSpineIndex = currentSpineIndexRef.current;
        if (!Number.isInteger(loadedSpineIndex) || nativeChapterTotal <= 0) {
            return;
        }

        const nextSpineIndex = loadedSpineIndex + 1;
        if (nextSpineIndex < nativeChapterTotal) {
            loadNativeReaderPackage(nextSpineIndex, { animateChapterTransition: true });
        }
    }, [loadNativeReaderPackage, nativeChapterTotal]);

    const handleNativeChapterStart = useCallback(() => {
        const loadedSpineIndex = currentSpineIndexRef.current;
        if (!Number.isInteger(loadedSpineIndex) || loadedSpineIndex <= 0) {
            return;
        }

        loadNativeReaderPackage(loadedSpineIndex - 1, { animateChapterTransition: true });
    }, [loadNativeReaderPackage]);

    const fullscreenReaderChromeColor = settings.isDarkMode ? '#1f2937' : '#f9f7f2';

    return (
        <View style={styles.container}>
            {isFullscreen ? (
                <View
                    style={[
                        styles.fullscreenExitBar,
                        {
                            paddingTop: insets.top + 4,
                            backgroundColor: fullscreenReaderChromeColor,
                        },
                    ]}
                >
                    <TouchableOpacity
                        style={styles.fullscreenExitButton}
                        onPress={() => setIsFullscreen(false)}
                    >
                        <Feather name="minimize-2" size={16} color={settings.isDarkMode ? '#d1d5db' : colors.text} />
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={[styles.headerBar, { paddingTop: insets.top + spacing.xs }]}>
                    <View style={styles.headerLeft}>
                        <Text numberOfLines={1} style={styles.headerBookTitle}>
                            {activeBook?.title || 'Reading'}
                        </Text>
                        <Text numberOfLines={1} style={styles.headerBookMeta}>
                            {activeBook?.author || 'Tap any word for lookup'}
                        </Text>
                    </View>

                    <View style={styles.headerControls}>
                        <View style={styles.controlPill}>
                            <Text style={styles.controlLabel}>{progressLabel}</Text>
                        </View>
                        {toc.length > 0 ? (
                            <TouchableOpacity
                                style={styles.settingsButton}
                                onPress={() => setShowToc(true)}
                            >
                                <Feather name="list" size={18} color={colors.text} />
                            </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                            style={styles.settingsButton}
                            onPress={() => setIsFullscreen(true)}
                        >
                            <Feather name="maximize-2" size={17} color={colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.settingsButton}
                            onPress={() => setShowSettings((prev) => !prev)}
                        >
                            <Feather name="more-vertical" size={18} color={colors.text} />
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            <View style={styles.reader}>
                {bookLoadState === 'error' ? (
                    <View style={styles.readerErrorState}>
                        <Text style={styles.readerErrorTitle}>Couldn’t open this book</Text>
                        <Text style={styles.readerErrorBody}>{bookLoadError}</Text>
                        {typeof activeBookSizeMb === 'number' ? (
                            <Text style={styles.readerErrorMeta}>
                                File size: {activeBookSizeMb.toFixed(1)} MB
                            </Text>
                        ) : null}
                        <TouchableOpacity style={styles.retryButton} onPress={retryBookLoad}>
                            <Text style={styles.retryButtonText}>Try again</Text>
                        </TouchableOpacity>
                    </View>
                ) : !currentBook ? (
                    <View style={styles.readerLoadingState}>
                        <Text style={styles.readerLoadingTitle}>No book selected</Text>
                    </View>
                ) : isReaderWaitingForHighlights ? (
                    <View style={styles.readerLoadingState}>
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                        <Text style={styles.readerLoadingTitle}>Preparing smart highlights</Text>
                        <Text style={styles.readerLoadingBody}>
                            Loading this book&apos;s saved-word surfaces before the first native render.
                        </Text>
                    </View>
                ) : bookLoadState === 'loading' || !nativeReaderPackage ? (
                    <View style={styles.readerLoadingState}>
                        <ActivityIndicator size="small" color={colors.accentStrong} />
                        <Text style={styles.readerLoadingTitle}>Opening native reader</Text>
                        <Text style={styles.readerLoadingBody}>
                            Parsing the EPUB package and loading the first readable spine item.
                        </Text>
                    </View>
                ) : (
                    <NativeEpubReaderView
                        key={`${currentBook}-${readerRetryKey}`}
                        style={styles.nativeReaderView}
                        bookManifest={{
                            ...nativeReaderPackage.bookManifest,
                            chapterTransitionDirection,
                        }}
                        chapterBlocks={nativeChapterBlocks}
                        chapterResources={nativeChapterResources}
                        chapterWindow={nativeChapterWindow}
                        restorePosition={nativeRestorePosition}
                        chapterTransitionDirection={chapterTransitionDirection}
                        fontSize={settings.fontSize}
                        lineHeight={settings.lineSpacing}
                        theme={settings.isDarkMode ? 'dark' : 'light'}
                        highlightTerms={readerHighlightTerms}
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
            </View>

            <TocDrawer
                visible={showToc}
                toc={toc}
                currentSpineIndex={currentSpineIndex}
                totalSpineItems={nativeChapterTotal}
                isDarkMode={settings.isDarkMode}
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

                    if (item.spineIndex !== currentSpineIndex) {
                        loadNativeReaderPackage(item.spineIndex, {
                            restorePosition: firstPagePosition,
                            animateChapterTransition: false,
                        });
                    } else {
                        setNativeRestorePosition(firstPagePosition);
                    }
                }}
            />

            <View
                style={[
                    styles.lookupLayer,
                    isFullscreen || lookupPlacement === 'top' ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    isFullscreen || lookupPlacement === 'top'
                        ? { paddingTop: isFullscreen ? insets.top + 18 : insets.top + 80 }
                        : { paddingBottom: insets.bottom + 6 },
                ]}
                pointerEvents="box-none"
            >
                {highlightedWord ? (
                    <Pressable
                        style={styles.lookupDismissZone}
                        onPress={() => {
                            setHighlightedWord('');
                            setHighlightedWordContext(null);
                            setIsNativeSelection(false);
                            setClearSelectionToken((value) => value + 1);
                        }}
                    />
                ) : null}

                <TopSection
                    highlightedWord={highlightedWord}
                    sourceSentence={highlightedWordContext?.sentence ?? ''}
                    isNativeSelection={isNativeSelection}
                    isDarkMode={settings.isDarkMode}
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
                />
            </View>

            {!highlightedWord && showLookupHint ? (
                <View
                    pointerEvents="box-none"
                    style={[styles.hintLayer, { paddingBottom: insets.bottom + 8 }]}
                >
                    <View style={styles.hintCard}>
                        <View style={styles.hintCopy}>
                            <Feather name="corner-down-left" size={16} color={colors.textSubtle} />
                            <Text style={styles.hintText}>
                                Tap a word to look it up.
                            </Text>
                        </View>
                        <TouchableOpacity onPress={dismissLookupHint} style={styles.hintCloseButton}>
                            <Feather name="x" size={14} color={colors.textSubtle} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

            {/* Preprocessing status indicator */}
            {(['checking', 'queued', 'preprocessing'].includes(preprocessStatus)) && (
                <View style={[styles.preprocessBanner, { bottom: insets.bottom + 68 }]}>
                    <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>
                            {preprocessMessage || (preprocessStatus === 'checking' ? 'Checking cache...' : 'Preparing smart highlights...')}
                        </Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}
            {preprocessStatus === 'error' && (
                <View style={[styles.preprocessBanner, { bottom: insets.bottom + 68, backgroundColor: 'rgba(180,40,40,0.75)' }]}>
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>{preprocessMessage || 'Caching failed — words will look up live'}</Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}
            {preprocessStatus === 'done' && (
                <View style={[styles.preprocessBanner, { bottom: insets.bottom + 68, backgroundColor: 'rgba(46,125,50,0.82)' }]}>
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>{preprocessMessage || 'Vocabulary cached'}</Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}

            {showSettings && !isFullscreen ? (
                <View pointerEvents="box-none" style={styles.settingsOverlay}>
                    <Pressable style={styles.settingsBackdrop} onPress={() => setShowSettings(false)} />
                    <View style={[styles.settingsDropdown, { top: insets.top + 56, right: spacing.lg }]}>
                        <Text style={styles.settingsHeading}>Reader settings</Text>

                        <View style={styles.settingsSection}>
                            <View style={styles.settingsRow}>
                                <Text style={styles.settingsLabel}>Font size</Text>
                                <Text style={styles.settingsValue}>{settings.fontSize}</Text>
                            </View>
                            <Slider
                                value={settings.fontSize}
                                onValueChange={(value) => handleSettingChange('fontSize', Math.round(value))}
                                minimumValue={12}
                                maximumValue={30}
                                step={1}
                                allowTouchTrack
                                thumbTintColor={colors.accentStrong}
                                minimumTrackTintColor={colors.accentStrong}
                                maximumTrackTintColor={colors.border}
                                trackStyle={styles.dropdownSliderTrack}
                                thumbStyle={styles.dropdownSliderThumb}
                            />
                        </View>

                        <View style={styles.settingsSection}>
                            <View style={styles.settingsRow}>
                                <Text style={styles.settingsLabel}>Line spacing</Text>
                                <Text style={styles.settingsValue}>{settings.lineSpacing.toFixed(1)}</Text>
                            </View>
                            <View style={styles.stepperRow}>
                                <TouchableOpacity
                                    style={styles.stepperButton}
                                    onPress={() => handleSettingChange('lineSpacing', Math.max(1, Number((settings.lineSpacing - 0.1).toFixed(1))))}
                                >
                                    <Feather name="minus" size={16} color={colors.text} />
                                </TouchableOpacity>
                                <Text style={styles.stepperValue}>{settings.lineSpacing.toFixed(1)}</Text>
                                <TouchableOpacity
                                    style={styles.stepperButton}
                                    onPress={() => handleSettingChange('lineSpacing', Math.min(2.6, Number((settings.lineSpacing + 0.1).toFixed(1))))}
                                >
                                    <Feather name="plus" size={16} color={colors.text} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={[styles.settingsSection, styles.settingsSectionLast]}>
                            <View style={styles.settingsRow}>
                                <Text style={styles.settingsLabel}>Dark mode</Text>
                                <Switch
                                    value={settings.isDarkMode}
                                    onValueChange={(value) => handleSettingChange('isDarkMode', value)}
                                    trackColor={{ false: colors.border, true: colors.accentMuted }}
                                    thumbColor={settings.isDarkMode ? '#4f4031' : '#fffdf8'}
                                />
                            </View>
                        </View>
                    </View>
                </View>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.backgroundWarm,
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerLeft: {
        flex: 1,
        minWidth: 0,
    },
    headerBookTitle: {
        ...textStyles.sectionTitle,
        fontSize: 18,
    },
    headerBookMeta: {
        ...textStyles.caption,
        marginTop: 2,
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    fullscreenExitBar: {
        minHeight: 42,
        paddingHorizontal: spacing.sm,
        paddingBottom: 4,
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
    },
    fullscreenExitButton: {
        width: 36,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.pill,
    },
    controlPill: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 8,
        borderRadius: radii.pill,
        backgroundColor: colors.surfaceMuted,
    },
    controlLabel: {
        ...textStyles.caption,
        color: colors.text,
    },
    reader: {
        flex: 1,
    },
    nativeReaderView: {
        flex: 1,
        backgroundColor: colors.surface,
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
        textAlign: 'center',
    },
    readerErrorBody: {
        ...textStyles.bodyMuted,
        textAlign: 'center',
    },
    readerErrorMeta: {
        ...textStyles.caption,
        color: colors.textSubtle,
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
        color: colors.text,
    },
    readerLoadingBody: {
        ...textStyles.caption,
        textAlign: 'center',
        color: colors.textMuted,
        maxWidth: 280,
    },
    retryButton: {
        minWidth: 132,
        minHeight: 44,
        borderRadius: radii.pill,
        backgroundColor: colors.accentSoft,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        marginTop: spacing.sm,
    },
    retryButtonText: {
        ...textStyles.body,
        color: colors.accentStrong,
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
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
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
        color: colors.textSubtle,
        flexShrink: 1,
    },
    hintCloseButton: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    preprocessBanner: {
        position: 'absolute',
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.65)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    preprocessBannerText: {
        color: '#ffffff',
        fontSize: 13,
    },
    preprocessCopy: {
        flexShrink: 1,
    },
    preprocessBannerSubtext: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11,
        marginTop: 2,
    },
    settingsButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: colors.surfaceMuted,
        justifyContent: 'center',
        alignItems: 'center',
    },
    settingsOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 25,
    },
    settingsBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    settingsDropdown: {
        position: 'absolute',
        width: 260,
        borderRadius: radii.lg,
        backgroundColor: 'rgba(255, 252, 246, 0.98)',
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        gap: spacing.md,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
    },
    settingsHeading: {
        ...textStyles.label,
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
        color: colors.textSubtle,
    },
    settingsSection: {
        gap: spacing.sm,
    },
    settingsSectionLast: {
        marginBottom: 0,
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    settingsLabel: {
        ...textStyles.body,
        color: colors.text,
    },
    settingsValue: {
        ...textStyles.caption,
        color: colors.textSubtle,
    },
    dropdownSliderTrack: {
        height: 4,
        borderRadius: 999,
    },
    dropdownSliderThumb: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: colors.accentStrong,
    },
    stepperRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    stepperButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stepperValue: {
        ...textStyles.body,
        color: colors.text,
        minWidth: 36,
        textAlign: 'center',
    },
});

export default Read;
