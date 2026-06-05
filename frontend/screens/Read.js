import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Pressable, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';

import TopSection from '../components/Read/TopSection/TopSection';
import TocDrawer from '../components/Read/TocDrawer';
import NativeEpubReaderView from '../modules/native-epub-reader/src/NativeEpubReaderView';
import {
    PREPROCESS_VERSION,
    getBookPreprocessChapter,
    getSavedWords,
    insertCacheEntries,
    insertBookIndexEntries,
    lookupBookHighlightSurfaces,
    lookupCacheByStems,
    markBookPreprocessChapter,
    markBookPreprocessMeta,
    recordVocabContextForSurface,
} from '../services/Database';
import preprocessChapter from '../services/api/preprocessChapter';
import { updateUserBookProgress } from '../services/bookCloudSync';
import { addReadingMillis } from '../services/dailyProgress';
import { readEpubPackageXml } from '../services/epubMetadata';
import {
    isPublicDomainBookUri,
    readPublicDomainTextPackage,
} from '../services/publicDomainBooks';
import {
    fetchUserPreferences,
    getTimestampMs,
    updateUserPreferenceFields,
} from '../services/preferencesCloudSync';
import { upsertUserVocabContext } from '../services/supabase';
import { colors, radii, spacing, textStyles } from '../theme';

const LOOKUP_HINT_DISMISSED_KEY = 'lookupHintDismissed';
const READER_SETTINGS_KEY = 'readerSettings';
const READER_SETTINGS_UPDATED_AT_KEY = 'readerSettingsUpdatedAt';
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
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
);

const buildChapterPreprocessOrder = (centerSpineIndex, totalSpineItems) => {
    if (!Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
        return [];
    }

    const order = [centerSpineIndex];
    for (let spineIndex = centerSpineIndex + 1; spineIndex < totalSpineItems; spineIndex += 1) {
        order.push(spineIndex);
    }
    for (let spineIndex = centerSpineIndex - 1; spineIndex >= 0; spineIndex -= 1) {
        order.push(spineIndex);
    }

    return [...new Set(order)];
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
        blocks,
        resources: chapterResourcesForReaderPackage(readerPackage),
    };
};

const Read = ({ books, setBooks, currentBook, onPreprocessComplete, setIsReaderFocusMode, user }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    const [showLookupHint, setShowLookupHint] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
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
    const chapterLoadTokenRef = useRef(0);
    const nativeReaderPackageRef = useRef(null);
    const currentSpineIndexRef = useRef(null);
    const parsedChapterCacheRef = useRef(new Map());
    const parsedChapterInflightRef = useRef(new Map());
    const chapterPrefetchTokenRef = useRef(0);
    const cloudProgressSyncTimeoutRef = useRef(null);
    const cloudReaderSettingsSyncTimeoutRef = useRef(null);
    const readerSettingsCloudUserRef = useRef(null);
    const readerSettingsUpdatedAtRef = useRef(null);
    const readerSettingsRef = useRef(DEFAULT_READER_SETTINGS);
    const loadNativeReaderPackageRef = useRef(null);
    const activeBook = books.find(book => book.uri === currentBook) ?? null;
    const activeBookLanguage = activeBook?.language ?? 'ko';
    const shouldUseHeuristicHighlights = !activeBook?.preprocessed;

    // Load saved words for highlighting on mount
    useEffect(() => {
        getSavedWords()
            .then(words => {
                setSavedWords(words);
            })
            .catch(err => {
                console.error('[Read] Failed to load saved words:', err);
                setSavedWords([]);
            });
    }, []);

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
                const surfaceRows = await lookupBookHighlightSurfaces(currentBook, savedWords);
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
    }, [currentBook, preprocessStatus, savedWords, shouldUseHeuristicHighlights]);

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        const elapsed = Date.now() - readingSessionStartedAtRef.current;
        if (elapsed >= 5000) {
            addReadingMillis(elapsed);
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
            const elapsed = Date.now() - readingSessionStartedAtRef.current;
            if (elapsed >= 5000) {
                addReadingMillis(elapsed);
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
        if (!user?.id || !book?.cloudId) {
            return;
        }

        if (cloudProgressSyncTimeoutRef.current) {
            clearTimeout(cloudProgressSyncTimeoutRef.current);
        }

        cloudProgressSyncTimeoutRef.current = setTimeout(() => {
            updateUserBookProgress(user.id, book).catch((error) => {
                console.warn('[Read] Cloud progress sync failed:', error);
            });
        }, 3000);
    }, [user?.id]);

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
            surface: text,
            sentence,
            sourceBookUri: currentBook,
            sourceBookTitle: activeBook?.title ?? null,
            language: activeBookLanguage,
        }).then((context) => {
            if (user?.id && context) {
                upsertUserVocabContext(user.id, context).catch((error) => {
                    console.warn('[Read] Failed to sync vocab context:', error?.message ?? error);
                });
            }
        }).catch((error) => {
            console.warn('[Read] Failed to record vocab context:', error?.message ?? error);
        });
    }, [activeBook?.title, activeBookLanguage, currentBook, user?.id]);

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
        if (!user?.id) {
            return;
        }

        if (cloudReaderSettingsSyncTimeoutRef.current) {
            clearTimeout(cloudReaderSettingsSyncTimeoutRef.current);
        }

        cloudReaderSettingsSyncTimeoutRef.current = setTimeout(() => {
            updateUserPreferenceFields(user.id, {
                reader_settings: {
                    ...nextSettings,
                    updatedAt,
                },
                updated_at: updatedAt,
            }).catch((error) => {
                console.warn('[Read] Failed to sync reader settings:', error?.message ?? error);
            });
        }, 2500);
    }, [user?.id]);

    const loadSettings = async () => {
        try {
            const [savedSettings, savedUpdatedAt] = await Promise.all([
                AsyncStorage.getItem(READER_SETTINGS_KEY),
                AsyncStorage.getItem(READER_SETTINGS_UPDATED_AT_KEY),
            ]);
            if (savedSettings) {
                const nextSettings = { ...DEFAULT_READER_SETTINGS, ...JSON.parse(savedSettings) };
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

        if (readerSettingsCloudUserRef.current === user.id) {
            return;
        }

        let isMounted = true;
        readerSettingsCloudUserRef.current = user.id;

        const mergeCloudReaderSettings = async () => {
            try {
                const cloudPreferences = await fetchUserPreferences(user.id);
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

                    if (!isMounted) {
                        return;
                    }

                    readerSettingsRef.current = nextSettings;
                    setSettings(nextSettings);
                    await saveSettings(nextSettings, cloudUpdatedAt, { syncCloud: false });
                    return;
                }

                const updatedAt = localUpdatedAt ?? new Date().toISOString();
                await updateUserPreferenceFields(user.id, {
                    reader_settings: {
                        ...readerSettingsRef.current,
                        updatedAt,
                    },
                    updated_at: updatedAt,
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
    }, [readerSettingsLoaded, saveSettings, user?.id]);

    const handleSettingChange = (key, value) => {
        const newSettings = { ...settings, [key]: value };
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((current) => current + 1);
        setSettings(newSettings);
        readerSettingsRef.current = newSettings;
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
        const packageLoader = isPublicDomainBookUri(currentBook)
            ? readPublicDomainTextPackage(currentBook, loadOptions)
            : readEpubPackageXml(
                currentBook,
                activeBook?.title || currentBook.split('/').pop() || 'Untitled',
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

    const persistChapterPreprocessResults = useCallback(async ({
        bookUri,
        results = [],
        surfaceIndex = [],
    }) => {
        const cacheEntries = (results || []).filter((entry) => entry?.stem);
        await insertCacheEntries(cacheEntries);

        const stems = [...new Set(cacheEntries.map((entry) => entry.stem).filter(Boolean))];
        if (stems.length === 0) {
            return 0;
        }

        const cachedRows = await lookupCacheByStems(stems);
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

        await insertBookIndexEntries(bookUri, bookIndexEntries);
        return bookIndexEntries.length;
    }, []);

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

        try {
            await markBookPreprocessMeta({
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
                    currentBook,
                    spineIndex,
                    PREPROCESS_VERSION
                );
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                if (existingChapter?.status === 'complete') {
                    completedChapters += 1;
                    totalSurfaceCount += Number(existingChapter.surface_count) || 0;
                    if (isCurrentChapter) {
                        setPreprocessStatus('done');
                    }
                    continue;
                }

                await markBookPreprocessChapter({
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
                    const {
                        results = [],
                        surface_index: surfaceIndex = [],
                    } = await preprocessChapter({
                        bookUri: currentBook,
                        spineIndex,
                        text: chapterText,
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    const surfaceCount = await persistChapterPreprocessResults({
                        bookUri: currentBook,
                        results,
                        surfaceIndex,
                    });

                    await markBookPreprocessChapter({
                        bookUri: currentBook,
                        spineIndex,
                        status: 'complete',
                        surfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
                        completedAt: new Date().toISOString(),
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    completedChapters += 1;
                    totalSurfaceCount += surfaceCount;
                    await markBookPreprocessMeta({
                        bookUri: currentBook,
                        status: 'partial',
                        surfaceCount: totalSurfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
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

            const finalStatus = failedChapters === 0
                ? 'complete'
                : (completedChapters > 0 ? 'partial' : 'failed');
            await markBookPreprocessMeta({
                bookUri: currentBook,
                status: finalStatus,
                surfaceCount: totalSurfaceCount,
                preprocessVersion: PREPROCESS_VERSION,
                completedAt: finalStatus === 'complete' ? new Date().toISOString() : null,
            });

            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? { ...book, preprocessed: finalStatus === 'complete', preprocessing: false }
                    : book
            )));

            if (finalStatus === 'complete') {
                setPreprocessStatus('done');
                onPreprocessComplete?.(currentBook);
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
        loadParsedChapterPackage,
        onPreprocessComplete,
        persistChapterPreprocessResults,
        setBooks,
    ]);

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
            startChapterPreprocessing(loadedSpineIndex, totalSpineItems, parsedPackage);
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
        startChapterPreprocessing,
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

        if (!currentBook || !Number.isInteger(pageIndex) || !Number.isInteger(resolvedSpineIndex)) {
            return;
        }

        if (Array.isArray(savedHighlights) && savedHighlights.length > 0) {
            savedHighlights.forEach((highlight) => {
                recordVocabContextForSurface({
                    surface: typeof highlight?.text === 'string' ? highlight.text : '',
                    sentence: typeof highlight?.sentence === 'string' ? highlight.sentence : '',
                    sourceBookUri: currentBook,
                    sourceBookTitle: activeBook?.title ?? null,
                    language: activeBookLanguage,
                }).then((context) => {
                    if (user?.id && context) {
                        upsertUserVocabContext(user.id, context).catch((error) => {
                            console.warn('[Read] Failed to sync visible vocab context:', error?.message ?? error);
                        });
                    }
                }).catch((error) => {
                    console.warn('[Read] Failed to record visible vocab context:', error?.message ?? error);
                });
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
        const chapterPageProgress = (
            Number.isInteger(pageIndex) && Number.isInteger(total) && total > 0
                ? pageIndex / total
                : 0
        );
        const nextProgress = totalSpineItems > 0
            ? Math.min(Math.max((resolvedSpineIndex + chapterPageProgress) / totalSpineItems, 0), 1)
            : (activeBook?.progress ?? 0);
        const nextBookPatch = {
            nativePosition: nextPosition,
            location: nextPosition.href || null,
            progress: nextProgress,
        };

        if (activeBook?.cloudId) {
            scheduleCloudProgressSync({
                ...activeBook,
                ...nextBookPatch,
            });
        }

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
                : { ...book, ...nextBookPatch };
        }));
    }, [
        activeBook,
        activeBookLanguage,
        currentBook,
        nativeChapterTotal,
        scheduleCloudProgressSync,
        setBooks,
        user?.id,
    ]);

    const handleNativeChapterCommit = useCallback(({
        spineIndex,
        href,
        path,
        pageIndex,
        pagesInChapter,
        firstBlockId,
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
        const chapterPageProgress = committedPageCount && committedPageCount > 0
            ? committedPageIndex / committedPageCount
            : 0;
        const nextProgress = totalSpineItems > 0
            ? Math.min(Math.max((committedSpineIndex + chapterPageProgress) / totalSpineItems, 0), 1)
            : (activeBook?.progress ?? 0);
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
        setNativeRestorePosition(nextPosition);
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
            percentage: totalSpineItems > 0 ? committedSpineIndex / totalSpineItems : null,
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
                            Loading the first readable section.
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
                            <View style={styles.hintTextStack}>
                                <Text style={styles.hintText}>
                                    Tap a word to look it up.
                                </Text>
                                <Text style={styles.hintSubtext}>
                                    Long press to translate longer sections.
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={dismissLookupHint} style={styles.hintCloseButton}>
                            <Feather name="x" size={14} color={colors.textSubtle} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

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
    hintTextStack: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    hintSubtext: {
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
