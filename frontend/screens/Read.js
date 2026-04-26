import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Pressable, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';

import { ReaderProvider } from '@epubjs-react-native/core';

import TopSection from '../components/Read/TopSection/TopSection';
import BottomSection from '../components/Read/BottomSection';
import { tabBarBaseStyle } from '../components/shared/TabBar';
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

const LOOKUP_HINT_DISMISSED_KEY = 'lookupHintDismissed';

const Read = ({ books, setBooks, currentBook, preprocessOnOpen, onPreprocessComplete, navigation }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [showLookupHint, setShowLookupHint] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
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
        setLookupPlacement('bottom');
        setHighlightTerms(null);
        setHighlightTermsReady(savedWords !== null && !currentBook);
        setBookLoadState(currentBook ? 'loading' : 'idle');
        setBookLoadError('');
        setShowSettings(false);
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

    const handleNativeTextSelected = useCallback((text) => {
        setIsNativeSelection(true);
        setHighlightedWord(text);
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
    const [settings, setSettings] = useState({
        fontSize: 18,
        isDarkMode: false,
        lineSpacing: 1.5
    });
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
        if (!navigation?.setOptions) {
            return undefined;
        }

        navigation.setOptions({
            tabBarStyle: isFullscreen ? { display: 'none' } : tabBarBaseStyle,
        });

        return () => {
            navigation.setOptions({ tabBarStyle: tabBarBaseStyle });
        };
    }, [isFullscreen, navigation]);

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
            {!isFullscreen ? (
                <>
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

                </>
            ) : null}

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
                                setHighlightedWord={(text) => {
                                    setIsNativeSelection(false);
                                    setHighlightedWord(text);
                                }}
                                settings={settings}
                                savedWords={readerHighlightTerms}
                                useHeuristicHighlighting={shouldUseHeuristicHighlights}
                                onLookupPlacementChange={setLookupPlacement}
                                onBookTextExtracted={handleBookTextExtracted}
                                onLocationInfoChange={setReaderLocationInfo}
                                onDismissSelection={() => {
                                    setHighlightedWord('');
                                    setIsNativeSelection(false);
                                }}
                                onBookLoadStarted={() => {
                                    setBookLoadState('loading');
                                    setBookLoadError('');
                                }}
                                onBookReady={() => {
                                    setBookLoadState('ready');
                                    setBookLoadError('');
                                }}
                                onBookLoadError={handleBookLoadError}
                                onNativeTextSelected={handleNativeTextSelected}
                            />
                        )
                    )}
                </ReaderProvider>
            </View>

            {isFullscreen ? (
                <View pointerEvents="box-none" style={styles.fullscreenControlLayer}>
                    <TouchableOpacity
                        style={[styles.fullscreenExitButton, { top: insets.top + 12 }]}
                        onPress={() => setIsFullscreen(false)}
                    >
                        <Feather name="minimize-2" size={16} color="rgba(31, 41, 55, 0.54)" />
                    </TouchableOpacity>
                </View>
            ) : null}

            <View
                style={[
                    styles.lookupLayer,
                    lookupPlacement === 'top' ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    lookupPlacement === 'top'
                        ? { paddingTop: isFullscreen ? insets.top + 52 : insets.top + 80 }
                        : { paddingBottom: isFullscreen ? insets.bottom + 6 : insets.bottom + 6 },
                ]}
                pointerEvents="box-none"
            >
                {highlightedWord ? (
                    <Pressable
                        style={styles.lookupDismissZone}
                        onPress={() => {
                            setHighlightedWord('');
                            setIsNativeSelection(false);
                        }}
                    />
                ) : null}

                <AppProvider>
                    <TopSection
                        highlightedWord={highlightedWord}
                        isNativeSelection={isNativeSelection}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        currentBook={currentBook}
                        sourceBook={activeBook}
                        savedWords={savedWords ?? []}
                    />
                </AppProvider>
            </View>

            {!highlightedWord && showLookupHint ? (
                <View
                    pointerEvents="box-none"
                    style={[styles.hintLayer, { paddingBottom: insets.bottom + (isFullscreen ? 8 : 8) }]}
                >
                    <View style={styles.hintCard}>
                        <View style={styles.hintCopy}>
                            <Feather name="corner-down-left" size={16} color={colors.textSubtle} />
                            <Text style={styles.hintText}>
                                Tap a word to look it up, or long-press to translate a selection.
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
                <View style={[styles.preprocessBanner, { bottom: insets.bottom + (isFullscreen ? 16 : 68) }]}>
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
                <View style={[styles.preprocessBanner, { bottom: insets.bottom + (isFullscreen ? 16 : 68), backgroundColor: 'rgba(180,40,40,0.75)' }]}>
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>{preprocessMessage || 'Caching failed — words will look up live'}</Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}
            {preprocessStatus === 'done' && (
                <View style={[styles.preprocessBanner, { bottom: insets.bottom + (isFullscreen ? 16 : 68), backgroundColor: 'rgba(46,125,50,0.82)' }]}>
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
        backgroundColor: 'rgba(255, 252, 246, 0.16)',
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
    fullscreenControlLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 20,
    },
    fullscreenExitButton: {
        position: 'absolute',
        right: spacing.md,
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
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
