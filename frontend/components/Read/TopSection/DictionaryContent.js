import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import axios from 'axios';
import koreanDictionary from '../../../services/api/koreanDictionary';
import stemWord from '../../../services/api/stemWord';
import { MaterialIcons } from '@expo/vector-icons';
import {
    insertData,
    removeData,
    vocabEntryExists,
    lookupBookIndexBySurface,
    lookupCacheByStems,
    insertCacheEntries,
} from '../../../services/Database';
import { deleteUserVocabEntry, supabase, upsertUserVocabEntry } from '../../../services/supabase';
import HanjaDetails from './HanjaDetails';
import { BASE_URL } from '../../../config';
import { colors, fontFamilies, radii, spacing, textStyles } from '../../../theme';

const STOP_STEMS = new Set([
    '하다',
    '되다',
    '있다',
    '없다',
    '이다',
    '아니다',
    '같다',
    '보다',
]);

const KOREAN_RE = /[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g;
const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const POS_LABELS = {
    Noun: 'NOUN',
    Verb: 'VERB',
    Adverb: 'ADVERB',
    Adjective: 'ADJECTIVE',
    Modifier: 'MODIFIER',
    Determiner: 'DETERMINER',
    명사: 'NOUN',
    동사: 'VERB',
    형용사: 'ADJECTIVE',
    부사: 'ADVERB',
    관형사: 'DETERMINER',
    감탄사: 'INTERJECTION',
    대명사: 'PRONOUN',
    수사: 'NUMERAL',
    조사: 'PARTICLE',
    접사: 'AFFIX',
    어미: 'ENDING',
    '보조 동사': 'AUXILIARY VERB',
    보조동사: 'AUXILIARY VERB',
    '보조 형용사': 'AUXILIARY ADJECTIVE',
    보조형용사: 'AUXILIARY ADJECTIVE',
    의존명사: 'DEPENDENT NOUN',
    '의존 명사': 'DEPENDENT NOUN',
    품사없음: '',
    '품사 없음': '',
};

const normalizeSurfaceWord = (word) => (word ?? '').replace(KOREAN_RE, '');

const cleanValue = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed === 'N/A' || trimmed === 'Unknown' ? '' : trimmed;
};

const hasSavableDefinition = (definition) => {
    const normalized = cleanValue(definition);
    return normalized.length > 0;
};

const hasHanja = (value) => HANJA_RE.test(cleanValue(value));

const getEntryWord = (entry, fallback) => cleanValue(entry?.stem) || cleanValue(entry?.word) || fallback;
const getEntryHanja = (entry) => cleanValue(entry?.hanja) || cleanValue(entry?.origin);
const getEntryDefinition = (entry) => cleanValue(entry?.definition) || cleanValue(entry?.transWord);
const getEntryPos = (entry) => cleanValue(entry?.pos);
const getEntryRomanization = (entry) => cleanValue(entry?.romanization);
const getRelatedKnownWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const formatPos = (pos) => {
    const normalized = cleanValue(pos).replace(/\s+/g, ' ');
    if (!normalized) {
        return '';
    }

    const compact = normalized.replace(/\s+/g, '');
    if (POS_LABELS[normalized] !== undefined) {
        return POS_LABELS[normalized];
    }
    if (POS_LABELS[compact] !== undefined) {
        return POS_LABELS[compact];
    }

    const koreanLabel = Object.keys(POS_LABELS)
        .filter((label) => /[\uAC00-\uD7A3]/.test(label))
        .sort((a, b) => b.length - a.length)
        .find((label) => normalized.includes(label));
    if (koreanLabel) {
        return POS_LABELS[koreanLabel];
    }

    return /[\uAC00-\uD7A3]/.test(normalized) ? '' : normalized.replace(/_/g, ' ').toUpperCase();
};

const uniqueEntriesByWord = (entries, excludedWord = '') => {
    const seen = new Set(cleanValue(excludedWord) ? [cleanValue(excludedWord)] : []);

    return (entries || []).filter((entry) => {
        const word = cleanValue(entry?.word) || cleanValue(entry?.stem);
        if (!word || seen.has(word)) {
            return false;
        }

        seen.add(word);
        return true;
    });
};

const DictionaryContent = ({
    highlightedWord,
    sourceSentence = '',
    isDarkMode,
    onContentLoaded,
    onWordSave,
    onWordUnsave,
    onExpandedStateChange,
    currentBook,
    sourceBook,
    savedWords = [],
}) => {
    const palette = isDarkMode
        ? {
            text: '#f7efe5',
            mutedText: '#b9ad9d',
            secondaryText: '#ded2c1',
            emptyText: '#9e9183',
            surface: '#1d1915',
            border: 'rgba(239, 225, 203, 0.18)',
            action: '#d48400',
            actionText: '#fffaf2',
            secondaryButtonBg: 'rgba(255, 250, 242, 0.04)',
            secondaryButtonText: '#d9cbb8',
            icon: '#fffaf2',
        }
        : {
            text: colors.text,
            mutedText: '#948875',
            secondaryText: '#5f554a',
            emptyText: colors.textSubtle,
            surface: colors.surfaceElevated,
            border: '#e5d7c2',
            action: '#d48400',
            actionText: '#fffdf8',
            secondaryButtonBg: '#fffdf8',
            secondaryButtonText: '#716657',
            icon: '#fffdf8',
        };

    const contextSentence = cleanValue(sourceSentence);
    const tappedSurface = cleanValue(normalizeSurfaceWord(highlightedWord)) || cleanValue(highlightedWord);
    const [expandedWords, setExpandedWords] = useState([]);
    const [stemWordList, setStemWordList] = useState([]);
    const [cachedResults, setCachedResults] = useState(null);
    const [needsLiveFetch, setNeedsLiveFetch] = useState(false);
    const [extraDefs, setExtraDefs] = useState({});
    const [liveEntryMeta, setLiveEntryMeta] = useState({});
    const [romanizations, setRomanizations] = useState({});
    const [expandedCached, setExpandedCached] = useState({});
    const [relatedKnownByWord, setRelatedKnownByWord] = useState({});
    const [currentHanja, setCurrentHanja] = useState(null);
    const handleHanjaPress = (hanja, sourceWord = null) => {
        setCurrentHanja(hanja ? { character: hanja, sourceWord: cleanValue(sourceWord) || null } : null);
    };

    useEffect(() => {
        setCachedResults(null);
        setNeedsLiveFetch(false);
        setStemWordList([]);
        setExtraDefs({});
        setLiveEntryMeta({});
        setRomanizations({});
        setExpandedCached({});
        setExpandedWords([]);
        setRelatedKnownByWord({});

        if (!highlightedWord) return;

        const normalizedSurface = normalizeSurfaceWord(highlightedWord);
        if (!normalizedSurface) {
            setCachedResults([]);
            onContentLoaded?.();
            return;
        }

        let isCancelled = false;

        const resolveLookup = async () => {
            if (currentBook) {
                console.log(
                    `[DictionaryContent] checking book_index for book="${currentBook}" surface="${normalizedSurface}"`
                );
                const indexRows = await lookupBookIndexBySurface(currentBook, normalizedSurface);
                if (isCancelled) {
                    return;
                }

                const seen = new Set();
                const indexHits = indexRows.filter(row => {
                    if (seen.has(row.stem)) return false;
                    seen.add(row.stem);
                    return true;
                });

                if (indexHits.length > 0) {
                    console.log(`[DictionaryContent] book_index hit (${indexHits.length}) for "${normalizedSurface}"`);
                    setCachedResults(indexHits);
                    setNeedsLiveFetch(false);
                    onContentLoaded?.();
                    return;
                }

                console.log(`[DictionaryContent] book_index miss for "${normalizedSurface}" - falling back to local cache/stemming`);
            }

            const directCacheRows = await lookupCacheByStems([normalizedSurface]);
            if (isCancelled) {
                return;
            }

            const uniqueDirectCacheRows = directCacheRows.filter((row, rowIndex, rows) =>
                rows.findIndex((candidate) => candidate.stem === row.stem) === rowIndex
            );

            if (uniqueDirectCacheRows.length > 0) {
                console.log(
                    `[DictionaryContent] direct dictionary_cache hit (${uniqueDirectCacheRows.length}) for "${normalizedSurface}" after book_index miss`
                );
                setCachedResults(uniqueDirectCacheRows);
                setNeedsLiveFetch(false);
                onContentLoaded?.();
                return;
            }

            const result = await stemWord({ query: highlightedWord });
            if (isCancelled) {
                return;
            }
            const filtered = [...new Set(result.filter(stem => !STOP_STEMS.has(stem)))];
            setStemWordList(filtered);
            if (filtered.length === 0) {
                setCachedResults([]);
                onContentLoaded?.();
            }
        };

        resolveLookup();

        return () => {
            isCancelled = true;
        };
    }, [currentBook, highlightedWord, onContentLoaded]);

    useEffect(() => {
        if (stemWordList.length === 0) return;

        const checkCache = async () => {
            const raw = await lookupCacheByStems(stemWordList);
            const seen = new Set();
            const hits = raw.filter(row => {
                if (seen.has(row.stem)) return false;
                seen.add(row.stem);
                return true;
            });

            if (hits.length >= stemWordList.length) {
                console.log(`[DictionaryContent] Full cache hit (${hits.length}/${stemWordList.length})`);
                setCachedResults(hits);
                setNeedsLiveFetch(false);
                onContentLoaded?.();
            } else if (hits.length > 0) {
                console.log(`[DictionaryContent] Partial cache hit (${hits.length}/${stemWordList.length})`);
                setCachedResults(hits);
                setNeedsLiveFetch(true);
            } else {
                console.log('[DictionaryContent] Cache miss - falling back to live KRDICT');
                setCachedResults([]);
                setNeedsLiveFetch(true);
            }
        };
        checkCache();
    }, [stemWordList, onContentLoaded]);

    const { dictionaryData, isLoading: isLiveLoading, error: liveError } = koreanDictionary({ query: needsLiveFetch ? stemWordList : [] });

    useEffect(() => {
        const expandedCachedCount = Object.entries(expandedCached).reduce((maxCount, [stem, isExpanded]) => {
            if (!isExpanded || !Array.isArray(extraDefs[stem])) {
                return maxCount;
            }

            return Math.max(maxCount, extraDefs[stem].length);
        }, 0);

        const expandedLiveCount = expandedWords.reduce((maxCount, word) => {
            const index = stemWordList.indexOf(word);
            const entries = index >= 0 ? (dictionaryData[index] || []) : [];
            const first = entries[0];
            if (!first) {
                return maxCount;
            }

            return Math.max(maxCount, uniqueEntriesByWord(entries.slice(1), first?.word || word).length);
        }, 0);

        onExpandedStateChange?.(Math.max(expandedCachedCount, expandedLiveCount));
    }, [dictionaryData, expandedCached, expandedWords, extraDefs, onExpandedStateChange, stemWordList]);

    const fetchRomanizations = async (terms) => {
        const missingTerms = [...new Set((terms || []).map(cleanValue).filter(Boolean))]
            .filter((term) => romanizations[term] === undefined);

        if (missingTerms.length === 0) {
            return;
        }

        const pairs = await Promise.all(missingTerms.map(async (term) => {
            try {
                const response = await axios.get(`${BASE_URL}/romanize/`, {
                    params: { text: term },
                    timeout: 6000,
                });
                return [term, cleanValue(response.data?.romanization)];
            } catch (error) {
                console.log(`[DictionaryContent] romanization failed for "${term}":`, error.message);
                return [term, ''];
            }
        }));

        setRomanizations(prev => {
            const next = { ...prev };
            pairs.forEach(([term, romanization]) => {
                next[term] = romanization;
            });
            return next;
        });
    };

    useEffect(() => {
        if (!cachedResults || cachedResults.length === 0) {
            return;
        }

        fetchRomanizations(cachedResults.map((entry) => getEntryWord(entry, highlightedWord)));
    }, [cachedResults]);

    useEffect(() => {
        if (stemWordList.length === 0) {
            return;
        }

        fetchRomanizations(stemWordList);
    }, [stemWordList]);

    useEffect(() => {
        if (!needsLiveFetch || !dictionaryData || dictionaryData.length === 0) return;

        const entries = stemWordList
            .map((stem, i) => {
                const results = dictionaryData[i];
                if (!results || results.length === 0) return null;
                const first = results[0];
                return {
                    stem,
                    definition: first.transWord !== 'N/A' ? first.transWord : null,
                    hanja: first.origin !== 'N/A' ? first.origin : null,
                    pos: first.pos ?? null,
                    domain: null,
                };
            })
            .filter(Boolean);

        if (entries.length > 0) {
            console.log(`[DictionaryContent] Writing ${entries.length} live result(s) back to cache`);
            insertCacheEntries(entries);
        }

        onContentLoaded?.();
    }, [dictionaryData, needsLiveFetch, onContentLoaded, stemWordList]);

    const prefetchExtra = async (stem) => {
        setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
        try {
            const response = await axios.post(`${BASE_URL}/krdict_search/`, {
                queries: [stem],
            }, {
                timeout: 10000,
            });
            const entries = response.data?.results?.[0] ?? [];
            if (entries[0]) {
                setLiveEntryMeta(prev => ({ ...prev, [stem]: entries[0] }));
            }
            setExtraDefs(prev => ({ ...prev, [stem]: uniqueEntriesByWord(entries.slice(1), entries[0]?.word) }));
        } catch {
            setExtraDefs(prev => ({ ...prev, [stem]: [] }));
        }
    };

    useEffect(() => {
        if (!cachedResults || cachedResults.length === 0) return;
        const entry = cachedResults[0];
        if (entry?.definition && extraDefs[entry.stem] === undefined) {
            prefetchExtra(entry.stem);
        }
    }, [cachedResults]);

    const handleRelatedKnownWordMarked = (sourceWord, relatedWord) => {
        const normalizedSource = cleanValue(sourceWord);
        if (!normalizedSource) {
            return;
        }

        setRelatedKnownByWord((previous) => {
            const current = previous[normalizedSource] ?? [];
            const key = getRelatedKnownWordKey(relatedWord);
            if (current.some((entry) => getRelatedKnownWordKey(entry) === key)) {
                return previous;
            }

            return {
                ...previous,
                [normalizedSource]: [...current, relatedWord],
            };
        });
    };

    const handleRelatedKnownWordRemoved = (sourceWord, relatedWord) => {
        const normalizedSource = cleanValue(sourceWord);
        if (!normalizedSource) {
            return;
        }

        setRelatedKnownByWord((previous) => {
            const current = previous[normalizedSource] ?? [];
            const next = current.filter(
                (entry) => getRelatedKnownWordKey(entry) !== getRelatedKnownWordKey(relatedWord)
            );

            return {
                ...previous,
                [normalizedSource]: next,
            };
        });
    };

    const toggleSave = async (word, origin, definition, options = {}) => {
        onWordSave?.(word, options);
        const alreadySaved = await vocabEntryExists(word, origin, definition);
        if (!alreadySaved) {
            await insertData(word, origin, definition, {
                level: 'unorganized',
                sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
                sourceBookTitle: sourceBook?.title ?? null,
                contextSentence: contextSentence || null,
                relatedKnownWords: relatedKnownByWord[word] ?? [],
            });
        }

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return;
        }

        try {
            await upsertUserVocabEntry(user.id, {
                word,
                hanja: origin,
                definition,
                level: 'unorganized',
            });
        } catch (error) {
            console.log('[DictionaryContent] cloud save failed:', error.message);
        }
    };

    const toggleUnSave = async (word, origin, definition, options = {}) => {
        onWordUnsave?.(word, options);
        await removeData(word, origin, definition);

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return;
        }

        try {
            await deleteUserVocabEntry(user.id, {
                word,
                hanja: origin,
                definition,
            });
        } catch (error) {
            console.log('[DictionaryContent] cloud remove failed:', error.message);
        }
    };

    const isWordSaved = (word) => savedWords.includes(word);

    const renderHanja = (hanja, variant = 'entry', sourceWord = null) => {
        if (!hasHanja(hanja)) {
            return null;
        }

        const isEntry = variant === 'entry';
        const hanjaStyle = [
            isEntry ? styles.entryHanja : styles.extraHanja,
            { color: isEntry ? palette.secondaryText : palette.mutedText },
        ];
        const dotColor = isEntry ? palette.secondaryText : palette.mutedText;

        return (
            <View style={[styles.hanjaGroup, isEntry ? styles.entryHanjaGroup : styles.extraHanjaGroup]}>
                <Text style={hanjaStyle}>(</Text>
                {cleanValue(hanja).split('').map((char, index) => {
                    if (!HANJA_RE.test(char)) {
                        return <Text key={`${char}-${index}`} style={hanjaStyle}>{char}</Text>;
                    }

                    return (
                        <TouchableOpacity
                            key={`${char}-${index}`}
                            activeOpacity={0.7}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                            onPress={() => handleHanjaPress(char, sourceWord)}
                            style={styles.hanjaToken}
                        >
                            <Text style={hanjaStyle}>{char}</Text>
                            <View pointerEvents="none" style={styles.hanjaDots}>
                                <View style={[styles.hanjaDot, { backgroundColor: dotColor }]} />
                                <View style={[styles.hanjaDot, { backgroundColor: dotColor }]} />
                                <View style={[styles.hanjaDot, { backgroundColor: dotColor }]} />
                            </View>
                        </TouchableOpacity>
                    );
                })}
                <Text style={hanjaStyle}>)</Text>
            </View>
        );
    };

    const renderBookmarkButton = (word, hanja, definition) => {
        if (!hasSavableDefinition(definition)) {
            return null;
        }

        const saved = isWordSaved(word);

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={saved ? `Remove ${word} from saved words` : `Save ${word}`}
                activeOpacity={0.8}
                onPress={() =>
                    saved
                        ? toggleUnSave(word, hanja, definition)
                        : toggleSave(word, hanja, definition)
                }
                style={[
                    styles.bookmarkButton,
                    {
                        backgroundColor: saved ? palette.action : palette.secondaryButtonBg,
                        borderColor: saved ? palette.action : palette.border,
                    },
                ]}
            >
                <MaterialIcons
                    name={saved ? 'bookmark' : 'bookmark-border'}
                    size={20}
                    color={saved ? palette.icon : palette.secondaryButtonText}
                />
            </TouchableOpacity>
        );
    };

    const renderEntryHeading = ({ word, hanja, definition, pos, romanization }) => {
        const posLabel = formatPos(pos);
        const hanjaElement = renderHanja(hanja, 'entry', word);
        const romanizationText = cleanValue(romanization);
        const bookmarkButton = renderBookmarkButton(word, hanja, definition);

        return (
            <View style={styles.entryHeading}>
                <View style={styles.entryTitleColumn}>
                    <View style={styles.wordLine}>
                        <Text selectable style={[styles.entryWord, { color: palette.text }]}>
                            {word}
                        </Text>
                        {hanjaElement}
                    </View>
                    {(romanizationText || (tappedSurface && tappedSurface !== word)) ? (
                        <Text selectable style={[styles.entryMeta, { color: palette.mutedText }]}>
                            {romanizationText}
                            {romanizationText && tappedSurface && tappedSurface !== word ? ' · ' : ''}
                            {tappedSurface && tappedSurface !== word ? `from ${tappedSurface}` : ''}
                        </Text>
                    ) : null}
                </View>
                {(bookmarkButton || posLabel) ? (
                    <View style={styles.headerActions}>
                        {posLabel ? (
                            <View style={[styles.posBadge, { backgroundColor: isDarkMode ? 'rgba(255,250,242,0.1)' : '#efe9df' }]}>
                                <Text style={[styles.posBadgeText, { color: palette.secondaryButtonText }]}>{posLabel}</Text>
                            </View>
                        ) : null}
                        {bookmarkButton}
                    </View>
                ) : null}
            </View>
        );
    };

    const renderMoreArrow = ({ showMore, showLess, onMore, onLess }) => {
        if (!showMore && !showLess) {
            return null;
        }

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={showLess ? 'Hide alternate definitions' : 'Show alternate definitions'}
                activeOpacity={0.8}
                onPress={showLess ? onLess : onMore}
                style={[
                    styles.moreArrowButton,
                    {
                        backgroundColor: palette.surface,
                    },
                ]}
            >
                <MaterialIcons
                    name={showLess ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={23}
                    color={palette.secondaryButtonText}
                />
            </TouchableOpacity>
        );
    };

    const renderExtraDefinitions = (entries) => {
        if (!Array.isArray(entries) || entries.length === 0) {
            return null;
        }

        return (
            <ScrollView
                style={[styles.extraList, { borderTopColor: palette.border }]}
                contentContainerStyle={styles.extraListContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
            >
                {entries.map((entry, index) => {
                    const word = cleanValue(entry.word) || highlightedWord;
                    const hanja = getEntryHanja(entry);
                    const definition = getEntryDefinition(entry);
                    const saved = isWordSaved(word);

                    return (
                        <View
                            key={`${word}-${hanja}-${definition}-${index}`}
                            style={[
                                styles.extraDefinitionRow,
                                index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
                            ]}
                        >
                            <View style={styles.extraDefinitionBody}>
                                <View style={styles.extraWordLine}>
                                    <Text selectable style={[styles.extraWord, { color: palette.text }]}>{word}</Text>
                                    {renderHanja(hanja, 'extra', word)}
                                </View>
                                <Text selectable style={[styles.extraDefinition, { color: palette.secondaryText }]}>
                                    {definition || 'No English definition available'}
                                </Text>
                            </View>
                            {hasSavableDefinition(definition) ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={saved ? `Remove ${word} from saved words` : `Save ${word}`}
                                    activeOpacity={0.85}
                                    style={[
                                        styles.extraSaveButton,
                                        {
                                            backgroundColor: saved ? palette.action : palette.secondaryButtonBg,
                                            borderColor: saved ? palette.action : palette.border,
                                        },
                                    ]}
                                    onPress={() =>
                                        saved
                                            ? toggleUnSave(word, hanja, definition, { includeSurface: false })
                                            : toggleSave(word, hanja, definition, { includeSurface: false })
                                    }
                                >
                                    <MaterialIcons
                                        name={saved ? 'check' : 'add'}
                                        size={18}
                                        color={saved ? palette.icon : palette.secondaryButtonText}
                                    />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    );
                })}
            </ScrollView>
        );
    };

    const renderPrimaryEntry = ({
        key,
        word,
        hanja,
        definition,
        pos,
        romanization,
        showMore,
        showLess,
        onMore,
        onLess,
        extraEntries,
        separated,
    }) => (
        <View key={key} style={[styles.primaryEntry, separated && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            {renderEntryHeading({ word, hanja, definition, pos, romanization })}
            {definition ? (
                <Text selectable style={[styles.definitionText, { color: palette.text }]}>
                    {definition}
                </Text>
            ) : (
                <Text selectable style={[styles.emptyDefinition, { color: palette.emptyText }]}>
                    No dictionary entry available
                </Text>
            )}
            {showLess ? renderExtraDefinitions(extraEntries) : null}
            {renderMoreArrow({ showMore, showLess, onMore, onLess })}
        </View>
    );

    if (cachedResults === null) {
        return (
            <View style={[styles.panelContent, styles.stateRow, { backgroundColor: palette.surface }]}>
                <ActivityIndicator size="small" color={palette.mutedText} />
                <Text style={[styles.stateText, { color: palette.mutedText }]}>Looking up...</Text>
            </View>
        );
    }

    if (cachedResults.length === 0 && !needsLiveFetch) {
        return (
            <View style={[styles.panelContent, styles.emptyState, { backgroundColor: palette.surface }]}>
                <Text style={[styles.emptyStateText, { color: palette.emptyText }]}>No lookup available</Text>
            </View>
        );
    }

    if (cachedResults.length > 0) {
        const entry = cachedResults[0];
        const stem = getEntryWord(entry, highlightedWord);
        const liveMeta = liveEntryMeta[entry.stem] || {};
        const extra = extraDefs[entry.stem];
        const isExpanded = !!expandedCached[entry.stem];
        const showMore = Array.isArray(extra) && extra.length > 0 && !isExpanded;
        const showLess = isExpanded && Array.isArray(extra) && extra.length > 0;

        return (
            <View style={[styles.panelContent, { backgroundColor: palette.surface }]}>
                {renderPrimaryEntry({
                    key: `${stem}-${entry.hanja ?? ''}`,
                    word: stem,
                    hanja: getEntryHanja(entry),
                    definition: getEntryDefinition(entry),
                    pos: getEntryPos(entry) || getEntryPos(liveMeta),
                    romanization: romanizations[stem] || getEntryRomanization(liveMeta),
                    showMore,
                    showLess,
                    onMore: () => setExpandedCached(prev => ({ ...prev, [entry.stem]: true })),
                    onLess: () => setExpandedCached(prev => ({ ...prev, [entry.stem]: false })),
                    extraEntries: extra,
                    separated: false,
                })}

                <HanjaDetails
                    hanja={currentHanja?.character ?? null}
                    sourceWord={currentHanja?.sourceWord ?? stem}
                    handleHanjaPress={handleHanjaPress}
                    onKnownWordMarked={handleRelatedKnownWordMarked}
                    onKnownWordRemoved={handleRelatedKnownWordRemoved}
                    isDarkMode={isDarkMode}
                />
            </View>
        );
    }

    if (needsLiveFetch && !liveError && (isLiveLoading || dictionaryData.length === 0)) {
        return (
            <View style={[styles.panelContent, styles.stateRow, { backgroundColor: palette.surface }]}>
                <ActivityIndicator size="small" color={palette.mutedText} />
                <Text style={[styles.stateText, { color: palette.mutedText }]}>Fetching definitions...</Text>
            </View>
        );
    }

    const firstLiveIndex = dictionaryData.findIndex((entries) => entries?.[0]);
    const entryIndex = firstLiveIndex >= 0 ? firstLiveIndex : 0;
    const word = stemWordList[entryIndex] || stemWordList[0] || highlightedWord;
    const entries = dictionaryData[entryIndex] || [];
    const first = entries[0];
    const isExpanded = expandedWords.includes(word);
    const extraEntries = first ? uniqueEntriesByWord(entries.slice(1), first?.word || word) : [];

    return (
        <View style={[styles.panelContent, { backgroundColor: palette.surface }]}>
            {first ? renderPrimaryEntry({
                key: `${word}-${first.origin ?? ''}`,
                word: cleanValue(first.word) || word,
                hanja: getEntryHanja(first),
                definition: getEntryDefinition(first),
                pos: getEntryPos(first),
                romanization: romanizations[word] || getEntryRomanization(first),
                showMore: extraEntries.length > 0 && !isExpanded,
                showLess: extraEntries.length > 0 && isExpanded,
                onMore: () => setExpandedWords(prev => [...prev, word]),
                onLess: () => setExpandedWords(prev => prev.filter(item => item !== word)),
                extraEntries,
                separated: false,
            }) : renderPrimaryEntry({
                key: `${word}-empty`,
                word,
                hanja: '',
                definition: '',
                pos: '',
                romanization: romanizations[word],
                showMore: false,
                showLess: false,
                separated: false,
            })}

            <HanjaDetails
                hanja={currentHanja?.character ?? null}
                sourceWord={currentHanja?.sourceWord ?? word}
                handleHanjaPress={handleHanjaPress}
                onKnownWordMarked={handleRelatedKnownWordMarked}
                onKnownWordRemoved={handleRelatedKnownWordRemoved}
                isDarkMode={isDarkMode}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    panelContent: {
        flex: 1,
        paddingHorizontal: spacing.md,
        paddingTop: 6,
        paddingBottom: 0,
    },
    primaryEntry: {
        flex: 1,
        gap: 4,
        paddingBottom: 0,
    },
    entryHeading: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
    },
    entryTitleColumn: {
        flex: 1,
        minWidth: 0,
    },
    wordLine: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: spacing.xs,
        paddingTop: 2,
    },
    entryWord: {
        fontFamily: fontFamilies.krSerifBold,
        fontSize: 24,
        lineHeight: 40,
        letterSpacing: 0,
        paddingTop: 5,
        includeFontPadding: true,
    },
    entryHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 15,
        lineHeight: 24,
    },
    entryMeta: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 0,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexShrink: 0,
        flexWrap: 'wrap',
        gap: 6,
        paddingTop: 8,
    },
    posBadge: {
        borderRadius: radii.xs,
        paddingHorizontal: spacing.xs,
        paddingVertical: 3,
    },
    posBadgeText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        letterSpacing: 0.4,
    },
    definitionText: {
        ...textStyles.sectionTitle,
        fontSize: 16,
        lineHeight: 22,
        letterSpacing: 0,
    },
    emptyDefinition: {
        ...textStyles.body,
        fontStyle: 'italic',
    },
    bookmarkButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    moreArrowButton: {
        width: 34,
        height: 20,
        borderRadius: 12,
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginTop: 0,
        marginBottom: 1,
    },
    extraList: {
        flexGrow: 0,
        maxHeight: 160,
        marginTop: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    extraListContent: {
        paddingVertical: 2,
    },
    extraDefinitionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
    },
    extraDefinitionBody: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    extraWordLine: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs,
        flexWrap: 'wrap',
    },
    extraWord: {
        ...textStyles.body,
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 19,
    },
    extraHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 12,
        lineHeight: 18,
    },
    extraDefinition: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 17,
    },
    extraSaveButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hanjaGroup: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
    },
    entryHanjaGroup: {
        marginTop: 13,
    },
    extraHanjaGroup: {
        marginTop: 1,
    },
    hanjaToken: {
        alignItems: 'center',
        paddingHorizontal: 1,
        marginHorizontal: 1,
    },
    hanjaDots: {
        flexDirection: 'row',
        gap: 3,
        marginTop: -1,
    },
    hanjaDot: {
        width: 1.8,
        height: 1.8,
        borderRadius: 0.9,
    },
    stateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    stateText: {
        ...textStyles.body,
    },
    emptyState: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyStateText: {
        ...textStyles.body,
        fontStyle: 'italic',
        textAlign: 'center',
    },
});

export default DictionaryContent;
