import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';

import { ReaderProvider } from '@epubjs-react-native/core';

import TopSection from '../components/Read/TopSection/TopSection';
import BottomSection from '../components/Read/BottomSection';
import SettingsMenu from '../components/Read/SettingsMenu';
import { AppProvider } from '../contexts/AppContext';
import {
    getSavedWords,
    isBookPreprocessed,
    insertCacheEntries,
    insertBookIndexEntries,
    lookupBookHighlightSurfaces,
    lookupCacheByStems,
    logDatabaseSnapshot,
} from '../services/Database';
import preprocessBook from '../services/api/preprocessBook';
import { addReadingMillis } from '../services/dailyProgress';
import { colors, radii, spacing, textStyles } from '../theme';

const Read = ({ books, setBooks, currentBook, preprocessOnOpen, onPreprocessComplete }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    const [highlightTerms, setHighlightTerms] = useState(null);
    const [highlightTermsReady, setHighlightTermsReady] = useState(false);
    const [readerLocationInfo, setReaderLocationInfo] = useState(null);
    const [bookLoadState, setBookLoadState] = useState('idle');
    const [bookLoadError, setBookLoadError] = useState('');
    const [readerRetryKey, setReaderRetryKey] = useState(0);

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
    const activeBook = books.find(book => book.uri === currentBook) ?? null;
    const shouldUseHeuristicHighlights = !activeBook?.preprocessed;

    // Load saved words for highlighting on mount
    useEffect(() => {
        getSavedWords()
            .then(words => {
                console.log(`[Read] Loaded ${words.length} saved word(s) for highlighting`);
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

                console.log(
                    `[Read] Loaded ${mergedTerms.length} highlight term(s) (${surfaceRows.length} book-specific surfaces)`
                );
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
        setPreprocessMessage('');
        setPreprocessDetail('');
        extractedTextRef.current = null;
        preprocessingInFlightRef.current = false;
        readingSessionStartedAtRef.current = Date.now();
        setHighlightTerms(null);
        setHighlightTermsReady(savedWords !== null && !currentBook);
        setBookLoadState(currentBook ? 'loading' : 'idle');
        setBookLoadError('');
        setReaderRetryKey(0);
    }, [currentBook]);

    useEffect(() => {
        return () => {
            const elapsed = Date.now() - readingSessionStartedAtRef.current;
            if (elapsed >= 5000) {
                addReadingMillis(elapsed);
            }
        };
    }, []);

    const handleWordSave = (word) => {
        setSavedWords(prev => (prev ?? []).includes(word) ? prev : [...(prev ?? []), word]);
    };

    const handleWordUnsave = (word) => {
        setSavedWords(prev => (prev ?? []).filter(w => w !== word));
    };

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
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState({
        fontSize: 18,
        isDarkMode: false,
        lineSpacing: 1.5
    });
    const insets = useSafeAreaInsets();

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const savedSettings = await AsyncStorage.getItem('readerSettings');
            if (savedSettings) {
                setSettings(JSON.parse(savedSettings));
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
        setSettings(newSettings);
        saveSettings(newSettings);
    };

    const activeBookSizeMb = typeof activeBook?.size === 'number'
        ? activeBook.size / (1024 * 1024)
        : null;
    const readerHighlightTerms = shouldUseHeuristicHighlights
        ? (savedWords ?? [])
        : (highlightTerms ?? savedWords ?? []);
    const isReaderWaitingForHighlights = !!currentBook && !shouldUseHeuristicHighlights && !highlightTermsReady;
    const progressLabel = (() => {
        if (readerLocationInfo?.page && readerLocationInfo?.total) {
            return `${readerLocationInfo.page}/${readerLocationInfo.total}`;
        }
        if (typeof readerLocationInfo?.percentage === 'number') {
            return `${Math.round(readerLocationInfo.percentage * 100)}%`;
        }
        return 'Start';
    })();

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
        setReaderRetryKey((prev) => prev + 1);
    }, []);

    return (
        <View style={styles.container}>
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
                        <Text style={styles.controlLabel}>Aa {settings.fontSize}</Text>
                    </View>
                    <View style={styles.controlPill}>
                        <Text style={styles.controlLabel}>{progressLabel}</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.settingsButton}
                        onPress={() => setShowSettings(true)}
                    >
                        <Feather name="sliders" size={18} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.reader}>
                <ReaderProvider>
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
                    ) : (
                        isReaderWaitingForHighlights ? (
                            <View style={styles.readerLoadingState}>
                                <ActivityIndicator size="small" color={colors.accentStrong} />
                                <Text style={styles.readerLoadingTitle}>Preparing smart highlights</Text>
                                <Text style={styles.readerLoadingBody}>
                                    Loading this book&apos;s saved-word surfaces before the first page render.
                                </Text>
                            </View>
                        ) : (
                            <BottomSection
                                key={`${currentBook}-${readerRetryKey}`}
                                books={books}
                                setBooks={setBooks}
                                currentBook={currentBook}
                                setHighlightedWord={setHighlightedWord}
                                settings={settings}
                                savedWords={readerHighlightTerms}
                                useHeuristicHighlighting={shouldUseHeuristicHighlights}
                                onBookTextExtracted={handleBookTextExtracted}
                                onLocationInfoChange={setReaderLocationInfo}
                                onDismissSelection={() => setHighlightedWord('')}
                                onBookLoadStarted={() => {
                                    setBookLoadState('loading');
                                    setBookLoadError('');
                                }}
                                onBookReady={() => {
                                    setBookLoadState('ready');
                                    setBookLoadError('');
                                }}
                                onBookLoadError={handleBookLoadError}
                            />
                        )
                    )}
                </ReaderProvider>
            </View>

            <View style={styles.lookupLayer} pointerEvents="box-none">
                {highlightedWord ? (
                    <Pressable
                        style={styles.lookupDismissZone}
                        onPress={() => setHighlightedWord('')}
                    />
                ) : null}

                <AppProvider>
                    <TopSection
                        highlightedWord={highlightedWord}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        currentBook={currentBook}
                        sourceBook={activeBook}
                        savedWords={savedWords ?? []}
                    />
                </AppProvider>
            </View>

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

            {/* Settings Menu */}
            <SettingsMenu
                visible={showSettings}
                onClose={() => setShowSettings(false)}
                settings={settings}
                onSettingChange={handleSettingChange}
            />
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
        justifyContent: 'flex-end',
    },
    lookupDismissZone: {
        ...StyleSheet.absoluteFillObject,
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
    }
});

export default Read;
