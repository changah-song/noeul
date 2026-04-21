import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    lookupCacheByStems,
    logDatabaseSnapshot,
} from '../services/Database';
import preprocessBook from '../services/api/preprocessBook';

const Read = ({ books, setBooks, currentBook, preprocessOnOpen, onPreprocessComplete }) => {
    const [highlightedWord, setHighlightedWord] = useState('');
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded

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

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        setPreprocessStatus('idle');
        setPreprocessMessage('');
        setPreprocessDetail('');
        extractedTextRef.current = null;
        preprocessingInFlightRef.current = false;
    }, [currentBook]);

    const handleWordSave = (word) => {
        setSavedWords(prev => prev.includes(word) ? prev : [...prev, word]);
    };

    const handleWordUnsave = (word) => {
        setSavedWords(prev => prev.filter(w => w !== word));
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

        console.log(`[Read] Starting preprocessing (${text.length.toLocaleString()} chars)...`);
        setPreprocessStatus('checking');
        setPreprocessMessage('Checking local cache...');
        setPreprocessDetail('');

        try {
            const alreadyDone = await isBookPreprocessed(currentBook);
            if (alreadyDone) {
                console.log('[Read] Book already preprocessed — skipping backend call');
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
                logDatabaseSnapshot(currentBook);
                return;
            }

            if (!results || results.length === 0) {
                console.warn('[Read] Preprocessing returned no results — backend error');
                setPreprocessStatus('error');
                setPreprocessMessage('Preprocessing failed');
                setPreprocessDetail(errorMessage ?? 'The backend did not return results.');
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
            logDatabaseSnapshot(currentBook);
            onPreprocessComplete?.(currentBook);

        } catch (err) {
            console.error('[Read] Preprocessing pipeline failed:', err);
            setPreprocessStatus('error');
            setPreprocessMessage('Preprocessing failed');
            setPreprocessDetail(err.message ?? 'Unknown error');
        } finally {
            preprocessingInFlightRef.current = false;
        }
    }, [currentBook, onPreprocessComplete]);

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
        if (preprocessOnOpen) {
            runPreprocessing(text);
        }
    }, [preprocessOnOpen, runPreprocessing]);

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

    return (
        <View style={{ flex: 1 }}>
            <View style={[styles.entireTop, { paddingTop: insets.top }]}>
                <View style={styles.topSection}>
                    <AppProvider>
                        <TopSection
                            highlightedWord={highlightedWord}
                            onWordSave={handleWordSave}
                            onWordUnsave={handleWordUnsave}
                            currentBook={currentBook}
                            savedWords={savedWords ?? []}
                        />
                    </AppProvider>
                </View>
            </View>

            <View style={styles.reader}>
                <ReaderProvider>
                    <BottomSection
                        books={books}
                        setBooks={setBooks}
                        currentBook={currentBook}
                        setHighlightedWord={setHighlightedWord}
                        settings={settings}
                        savedWords={savedWords}
                        onBookTextExtracted={handleBookTextExtracted}
                    />
                </ReaderProvider>
            </View>

            {/* Preprocessing status indicator */}
            {(['checking', 'queued', 'preprocessing'].includes(preprocessStatus)) && (
                <View style={styles.preprocessBanner}>
                    <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>
                            {preprocessMessage || (preprocessStatus === 'checking' ? 'Checking cache...' : 'Caching vocabulary...')}
                        </Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}
            {preprocessStatus === 'error' && (
                <View style={[styles.preprocessBanner, { backgroundColor: 'rgba(180,40,40,0.75)' }]}>
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>{preprocessMessage || 'Caching failed — words will look up live'}</Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}
            {preprocessStatus === 'done' && (
                <View style={[styles.preprocessBanner, { backgroundColor: 'rgba(46,125,50,0.82)' }]}>
                    <View style={styles.preprocessCopy}>
                        <Text style={styles.preprocessBannerText}>{preprocessMessage || 'Vocabulary cached'}</Text>
                        {preprocessDetail ? (
                            <Text style={styles.preprocessBannerSubtext}>{preprocessDetail}</Text>
                        ) : null}
                    </View>
                </View>
            )}

            {/* Settings Button */}
            <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => setShowSettings(true)}
            >
                <Text style={styles.settingsButtonText}>⚙️</Text>
            </TouchableOpacity>

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
    entireTop: {
        flex: 0.18,
        backgroundColor: '#85929E',
        borderBottomRightRadius: 5,
        borderBottomLeftRadius: 5
    },
    topSection: {
        height: '50%',
    },
    reader: {
        flex: 0.82,
    },
    // Small banner shown in the bottom-left while preprocessing runs in background
    preprocessBanner: {
        position: 'absolute',
        bottom: 100,
        left: 16,
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
        position: 'absolute',
        bottom: 30,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#3b82f6',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    settingsButtonText: {
        fontSize: 24,
    }
});

export default Read;
