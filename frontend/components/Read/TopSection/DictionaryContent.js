import React, { useState, useEffect, useMemo } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import koreanDictionary from '../../../services/api/koreanDictionary';
import stemWord from '../../../services/api/stemWord';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../../services/api/client';
import { useAppContext } from '../../../contexts/AppContext';
import { useTranslation } from '../../../hooks/useTranslation';
import { useLocalOwner } from '../../../contexts/LocalOwnerContext';
import {
    insertData,
    removeData,
    recordVocabContext,
    vocabEntryExists,
    lookupBookIndexBySurface,
    lookupCacheByStems,
    insertCacheEntries,
} from '../../../services/Database';
import {
    softDeleteUserVocabContextsForWord,
    softDeleteRelatedKnownWordsForMainWord,
    softDeleteUserVocabEntry,
    supabase,
    upsertUserVocabContext,
    upsertUserVocabEntry,
} from '../../../services/supabase';
import HanjaDetails from './HanjaDetails';
import { isCurrentSyncGeneration } from '../../../services/localOwnerCoordinator';
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
const getHanjaCharacters = (value) => cleanValue(value).split('').filter((char) => HANJA_RE.test(char));

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
    onTranslatePress,
    onExpandedStateChange,
    onContentHeightChange,
    currentBook,
    sourceBook,
    savedWords = [],
}) => {
    const { interfaceLanguage } = useAppContext();
    const { t } = useTranslation();
    const { activeOwnerId, syncGeneration } = useLocalOwner();
    const palette = isDarkMode
        ? {
            text: '#f7efe5',
            mutedText: '#b9ad9d',
            secondaryText: '#ded2c1',
            emptyText: '#9e9183',
            surface: '#1d1915',
            border: 'rgba(239, 225, 203, 0.18)',
            action: colors.accent,
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
            action: colors.accent,
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
    const [activeWordIndex, setActiveWordIndex] = useState(0);
    const [dictionaryViewportHeight, setDictionaryViewportHeight] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const handleHanjaPress = (hanja, sourceWord = null, options = {}) => {
        if (!hanja) {
            setCurrentHanja(null);
            return;
        }

        const optionCharacters = Array.isArray(options.characters)
            ? options.characters.map(cleanValue).filter(hasHanja)
            : [];
        const characters = optionCharacters.length > 0 ? optionCharacters : getHanjaCharacters(hanja);
        const fallbackCharacters = characters.length > 0 ? characters : [cleanValue(hanja)];
        const requestedIndex = Number.isInteger(options.index)
            ? options.index
            : fallbackCharacters.indexOf(cleanValue(hanja));
        const activeIndex = requestedIndex >= 0
            ? Math.min(requestedIndex, fallbackCharacters.length - 1)
            : 0;

        setCurrentHanja({
            character: fallbackCharacters[activeIndex],
            characters: fallbackCharacters,
            activeIndex,
            sourceWord: cleanValue(sourceWord) || null,
            sourceWordDetails: options.sourceWordDetails ?? {},
        });
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
        setActiveWordIndex(0);

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
                const indexRows = await lookupBookIndexBySurface(
                    activeOwnerId,
                    currentBook,
                    normalizedSurface,
                    interfaceLanguage
                );
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
                    setCachedResults(indexHits);
                    setNeedsLiveFetch(false);
                    onContentLoaded?.();
                    return;
                }
            }

            const directCacheRows = await lookupCacheByStems([normalizedSurface], interfaceLanguage);
            if (isCancelled) {
                return;
            }

            const uniqueDirectCacheRows = directCacheRows.filter((row, rowIndex, rows) =>
                rows.findIndex((candidate) => candidate.stem === row.stem) === rowIndex
            );

            if (uniqueDirectCacheRows.length > 0) {
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
    }, [activeOwnerId, currentBook, highlightedWord, interfaceLanguage, onContentLoaded]);

    useEffect(() => {
        if (stemWordList.length === 0) return;

        const checkCache = async () => {
            const raw = await lookupCacheByStems(stemWordList, interfaceLanguage);
            const seen = new Set();
            const hits = raw.filter(row => {
                if (seen.has(row.stem)) return false;
                seen.add(row.stem);
                return true;
            });

            if (hits.length >= stemWordList.length) {
                setCachedResults(hits);
                setNeedsLiveFetch(false);
                onContentLoaded?.();
            } else if (hits.length > 0) {
                setCachedResults(hits);
                setNeedsLiveFetch(true);
            } else {
                setCachedResults([]);
                setNeedsLiveFetch(true);
            }
        };
        checkCache();
    }, [interfaceLanguage, stemWordList, onContentLoaded]);

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
                const response = await api.get('/romanize/', {
                    params: { text: term },
                    timeout: 6000,
                });
                return [term, cleanValue(response.data?.romanization)];
            } catch (error) {
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
            insertCacheEntries(entries, interfaceLanguage);
        }

        onContentLoaded?.();
    }, [dictionaryData, interfaceLanguage, needsLiveFetch, onContentLoaded, stemWordList]);

    const prefetchExtra = async (stem) => {
        setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
        try {
            const response = await api.post('/krdict_search/', {
                queries: [stem],
                language: interfaceLanguage,
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

    const lookupItems = useMemo(() => {
        const itemsByStem = new Map();

        stemWordList.forEach((stem, index) => {
            if (!cleanValue(stem)) {
                return;
            }

            itemsByStem.set(stem, {
                key: `live-${stem}-${index}`,
                stem,
                liveEntries: dictionaryData[index] || [],
            });
        });

        (cachedResults || []).forEach((entry, index) => {
            const stem = cleanValue(entry?.stem) || getEntryWord(entry, highlightedWord) || `cached-${index}`;
            const existing = itemsByStem.get(stem) || {
                key: `cached-${stem}-${index}`,
                stem,
                liveEntries: [],
            };

            itemsByStem.set(stem, {
                ...existing,
                cachedEntry: entry,
            });
        });

        const hasLiveSettled = !needsLiveFetch || dictionaryData.length > 0 || liveError;

        return [...itemsByStem.values()].filter((item) => (
            item.cachedEntry
            || item.liveEntries?.[0]
            || (hasLiveSettled && cleanValue(item.stem))
        ));
    }, [cachedResults, dictionaryData, highlightedWord, liveError, needsLiveFetch, stemWordList]);

    const lookupItemCount = lookupItems.length;
    const currentLookupIndex = lookupItemCount > 0
        ? Math.min(activeWordIndex, lookupItemCount - 1)
        : 0;
    const activeLookupItem = lookupItems[currentLookupIndex] || null;
    const hasWordNavigation = lookupItemCount > 1;
    const isDictionaryScrollable = dictionaryViewportHeight > 0
        && dictionaryContentHeight > dictionaryViewportHeight + 2;

    useEffect(() => {
        setActiveWordIndex((currentIndex) => {
            if (lookupItemCount <= 0) {
                return 0;
            }

            return Math.min(currentIndex, lookupItemCount - 1);
        });
    }, [lookupItemCount]);

    useEffect(() => {
        const entry = activeLookupItem?.cachedEntry;
        if (!entry?.definition || extraDefs[entry.stem] !== undefined) {
            return;
        }

        prefetchExtra(entry.stem);
    }, [activeLookupItem, extraDefs]);

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

    const buildSourceWordDetails = ({ hanja, definition }) => ({
        hanja: cleanValue(hanja) || null,
        definition: cleanValue(definition) || null,
        level: 'unorganized',
        sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
        sourceBookTitle: sourceBook?.title ?? null,
        contextSentence: contextSentence || null,
        language: sourceBook?.language ?? 'ko',
    });

    const buildCloudVocabPayload = ({
        word,
        hanja,
        definition,
        createdAt = new Date().toISOString(),
        relatedKnownWords = [],
    }) => ({
        word,
        hanja: hanja ?? null,
        definition: definition ?? null,
        level: 'unorganized',
        status: 'unorganized',
        sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
        sourceBookTitle: sourceBook?.title ?? null,
        contextSentence: contextSentence || null,
        isFavorite: false,
        priority: 'normal',
        createdAt,
        updatedAt: createdAt,
        lastReviewedAt: null,
        nextReviewAt: null,
        correctCount: 0,
        wrongCount: 0,
        language: sourceBook?.language ?? 'ko',
        relatedKnownWords,
    });

    const handleSourceWordAutoSaved = async (word, details = {}) => {
        const normalizedWord = cleanValue(word);
        if (!normalizedWord) {
            return;
        }

        onWordSave?.(normalizedWord, { includeSurface: false });
        const ownerId = activeOwnerId;
        const generation = syncGeneration;

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user || ownerId !== user.id || !isCurrentSyncGeneration(generation)) {
            return;
        }

        try {
            await upsertUserVocabEntry({
                user,
                ownerId,
                generation,
                entry: {
                    ...buildCloudVocabPayload({
                        word: normalizedWord,
                        hanja: details.hanja ?? null,
                        definition: details.definition ?? null,
                    }),
                    level: details.level ?? 'unorganized',
                    status: details.level ?? 'unorganized',
                },
            });
        } catch (error) {
            console.warn('[DictionaryContent] cloud auto-save failed:', error.message);
        }
    };

    const toggleSave = async (word, origin, definition, options = {}) => {
        onWordSave?.(word, options);
        const createdAt = new Date().toISOString();
        const relatedKnownWords = relatedKnownByWord[word] ?? [];
        const ownerId = activeOwnerId;
        const generation = syncGeneration;
        const cloudPayload = buildCloudVocabPayload({
            word,
            hanja: origin,
            definition,
            createdAt,
            relatedKnownWords,
        });
        const alreadySaved = await vocabEntryExists(word, origin, definition, sourceBook?.language ?? 'ko', {
            ownerId: activeOwnerId,
        });
        if (!alreadySaved) {
            await insertData(word, origin, definition, {
                ownerId: activeOwnerId,
                level: 'unorganized',
                sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
                sourceBookTitle: sourceBook?.title ?? null,
                contextSentence: contextSentence || null,
                createdAt,
                updatedAt: createdAt,
                language: sourceBook?.language ?? 'ko',
                relatedKnownWords,
            });
        }
        const recordedContext = await recordVocabContext({
            ownerId: activeOwnerId,
            word,
            hanja: origin,
            definition,
            sentence: contextSentence,
            sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
            sourceBookTitle: sourceBook?.title ?? null,
            language: sourceBook?.language ?? 'ko',
        });

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user || ownerId !== user.id || !isCurrentSyncGeneration(generation)) {
            return;
        }

        try {
            await upsertUserVocabEntry({
                user,
                ownerId,
                generation,
                entry: cloudPayload,
            });
            if (recordedContext) {
                upsertUserVocabContext({
                    user,
                    ownerId,
                    generation,
                    context: recordedContext,
                }).catch((error) => {
                    console.warn('[DictionaryContent] cloud context save failed:', error.message);
                });
            }
        } catch (error) {
            console.warn('[DictionaryContent] cloud save failed:', error.message);
        }
    };

    const toggleUnSave = async (word, origin, definition, options = {}) => {
        onWordUnsave?.(word, options);
        const ownerId = activeOwnerId;
        const generation = syncGeneration;
        await removeData(word, origin, definition, sourceBook?.language ?? 'ko', {
            ownerId,
        });

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user || ownerId !== user.id || !isCurrentSyncGeneration(generation)) {
            return;
        }

        try {
            const cloudEntry = {
                word,
                hanja: origin,
                definition,
                language: sourceBook?.language ?? 'ko',
            };
            await softDeleteUserVocabEntry({ user, ownerId, generation, entry: cloudEntry });
            await softDeleteUserVocabContextsForWord({ user, ownerId, generation, entry: cloudEntry });
            await softDeleteRelatedKnownWordsForMainWord({ user, ownerId, generation, entry: cloudEntry });
        } catch (error) {
            console.warn('[DictionaryContent] cloud remove failed:', error.message);
        }
    };

    const isWordSaved = (word) => savedWords.includes(word);

    const goToPreviousWord = () => {
        if (lookupItemCount <= 1) {
            return;
        }

        setExpandedCached({});
        setExpandedWords([]);
        onExpandedStateChange?.(0);
        setActiveWordIndex((currentIndex) => (
            currentIndex <= 0 ? lookupItemCount - 1 : currentIndex - 1
        ));
        handleHanjaPress(null);
    };

    const goToNextWord = () => {
        if (lookupItemCount <= 1) {
            return;
        }

        setExpandedCached({});
        setExpandedWords([]);
        onExpandedStateChange?.(0);
        setActiveWordIndex((currentIndex) => (
            currentIndex >= lookupItemCount - 1 ? 0 : currentIndex + 1
        ));
        handleHanjaPress(null);
    };

    const renderWordSideNavigation = () => {
        if (!hasWordNavigation) {
            return null;
        }

        return (
            <View pointerEvents="box-none" style={styles.wordSideNavigation}>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('lookup.previousDetectedWord')}
                    activeOpacity={0.78}
                    onPress={goToPreviousWord}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    style={[styles.wordSideNavButton, styles.wordSideNavButtonLeft]}
                >
                    <MaterialIcons name="chevron-left" size={24} color={palette.secondaryButtonText} />
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('lookup.nextDetectedWord')}
                    activeOpacity={0.78}
                    onPress={goToNextWord}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    style={[styles.wordSideNavButton, styles.wordSideNavButtonRight]}
                >
                    <MaterialIcons name="chevron-right" size={24} color={palette.secondaryButtonText} />
                </TouchableOpacity>
            </View>
        );
    };

    const renderDictionaryPanel = (children) => (
        <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
            <ScrollView
                style={styles.dictionaryScroll}
                contentContainerStyle={[
                    styles.dictionaryScrollContent,
                    hasWordNavigation && styles.dictionaryScrollContentWithNav,
                ]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={isDictionaryScrollable}
                scrollEnabled={isDictionaryScrollable}
                showsVerticalScrollIndicator={isDictionaryScrollable}
                bounces={isDictionaryScrollable}
                onLayout={(event) => {
                    setDictionaryViewportHeight(event.nativeEvent.layout.height);
                }}
                onContentSizeChange={(_, height) => {
                    setDictionaryContentHeight(height);
                    onContentHeightChange?.(height);
                }}
            >
                {children}
            </ScrollView>
            {renderWordSideNavigation()}
        </View>
    );

    const renderHanja = (hanja, variant = 'entry', sourceWord = null, sourceWordDetails = {}) => {
        if (!hasHanja(hanja)) {
            return null;
        }

        const isEntry = variant === 'entry';
        const hanjaStyle = [
            isEntry ? styles.entryHanja : styles.extraHanja,
            { color: isEntry ? palette.action : palette.mutedText },
        ];
        const dotColor = isEntry ? palette.action : palette.mutedText;
        const hanjaCharacters = getHanjaCharacters(hanja);
        let hanjaTokenIndex = -1;

        return (
            <View style={[styles.hanjaGroup, isEntry ? styles.entryHanjaGroup : styles.extraHanjaGroup]}>
                <Text style={hanjaStyle}>(</Text>
                {cleanValue(hanja).split('').map((char, index) => {
                    if (!HANJA_RE.test(char)) {
                        return <Text key={`${char}-${index}`} style={hanjaStyle}>{char}</Text>;
                    }

                    hanjaTokenIndex += 1;
                    const selectedHanjaIndex = hanjaTokenIndex;

                    return (
                        <TouchableOpacity
                            key={`${char}-${index}`}
                            activeOpacity={0.7}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                            onPress={() => handleHanjaPress(char, sourceWord, {
                                characters: hanjaCharacters,
                                index: selectedHanjaIndex,
                                sourceWordDetails,
                            })}
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
                accessibilityLabel={saved
                    ? t('lookup.removeWord', { word })
                    : t('lookup.saveWord', { word })}
                activeOpacity={0.8}
                onPress={() =>
                    saved
                        ? toggleUnSave(word, hanja, definition)
                        : toggleSave(word, hanja, definition)
                }
                style={[
                    styles.bookmarkButton,
                    {
                        backgroundColor: 'transparent',
                        borderColor: 'transparent',
                    },
                ]}
            >
                <MaterialIcons
                    name={saved ? 'bookmark' : 'bookmark-border'}
                    size={25}
                    color={saved ? palette.action : palette.mutedText}
                />
            </TouchableOpacity>
        );
    };

    const renderTranslateButton = () => (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('lookup.translateWord', { word: highlightedWord })}
            activeOpacity={0.8}
            onPress={() => onTranslatePress?.(cleanValue(highlightedWord) || tappedSurface)}
            style={styles.translateButton}
        >
            <MaterialIcons
                name="translate"
                size={21}
                color={palette.mutedText}
            />
        </TouchableOpacity>
    );

    const renderEntryHeading = ({ word, hanja, definition, pos, romanization }) => {
        const posLabel = formatPos(pos);
        const sourceWordDetails = buildSourceWordDetails({ hanja, definition });
        const hanjaElement = renderHanja(hanja, 'entry', word, sourceWordDetails);
        const romanizationText = cleanValue(romanization);
        const bookmarkButton = renderBookmarkButton(word, hanja, definition);
        const translateButton = renderTranslateButton();

        return (
            <View style={styles.entryHeading}>
                <View style={styles.entryHeadingTopRow}>
                    <View style={styles.entryTitleColumn}>
                        <View style={styles.wordLine}>
                            <Text selectable style={[styles.entryWord, { color: palette.text }]}>
                                {word}
                            </Text>
                            {hanjaElement}
                        </View>
                    </View>
                    {(translateButton || bookmarkButton || posLabel) ? (
                        <View style={styles.headerActions}>
                            {posLabel ? (
                                <View style={[styles.posBadge, { backgroundColor: isDarkMode ? 'rgba(255,250,242,0.1)' : '#eee8db' }]}>
                                    <Text style={[styles.posBadgeText, { color: palette.secondaryButtonText }]}>{posLabel}</Text>
                                </View>
                            ) : null}
                            {translateButton}
                            {bookmarkButton}
                        </View>
                    ) : null}
                </View>
                {(romanizationText || (tappedSurface && tappedSurface !== word)) ? (
                    <Text selectable style={[styles.entryMeta, { color: palette.mutedText }]}>
                        {romanizationText}
                        {romanizationText && tappedSurface && tappedSurface !== word ? ' · ' : ''}
                        {tappedSurface && tappedSurface !== word ? t('lookup.fromSurface', { surface: tappedSurface }) : ''}
                    </Text>
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
                accessibilityLabel={showLess ? t('lookup.hideAlternates') : t('lookup.showAlternates')}
                activeOpacity={0.8}
                onPress={showLess ? onLess : onMore}
                style={[
                    styles.moreArrowButton,
                    showMore && styles.moreArrowButtonCollapsed,
                    showLess && styles.moreArrowButtonExpanded,
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
                    const sourceWordDetails = buildSourceWordDetails({ hanja, definition });
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
                                    {renderHanja(hanja, 'extra', word, sourceWordDetails)}
                                </View>
                                <Text selectable style={[styles.extraDefinition, { color: palette.secondaryText }]}>
                                    {definition || t('lookup.noEnglishDefinition')}
                                </Text>
                            </View>
                            {hasSavableDefinition(definition) ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={saved
                                        ? t('lookup.removeWord', { word })
                                        : t('lookup.saveWord', { word })}
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
                    {t('lookup.noDictionaryEntry')}
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
                <Text style={[styles.stateText, { color: palette.mutedText }]}>{t('lookup.lookingUp')}</Text>
            </View>
        );
    }

    if (cachedResults.length === 0 && !needsLiveFetch && lookupItemCount === 0) {
        return (
            <View style={[styles.panelContent, styles.emptyState, { backgroundColor: palette.surface }]}>
                <Text style={[styles.emptyStateText, { color: palette.emptyText }]}>{t('lookup.noLookup')}</Text>
            </View>
        );
    }

    if (needsLiveFetch && !liveError && (isLiveLoading || (dictionaryData.length === 0 && lookupItemCount === 0))) {
        return (
            <View style={[styles.panelContent, styles.stateRow, { backgroundColor: palette.surface }]}>
                <ActivityIndicator size="small" color={palette.mutedText} />
                <Text style={[styles.stateText, { color: palette.mutedText }]}>{t('lookup.fetchingDefinitions')}</Text>
            </View>
        );
    }

    if (!activeLookupItem) {
        return (
            <View style={[styles.panelContent, styles.emptyState, { backgroundColor: palette.surface }]}>
                <Text style={[styles.emptyStateText, { color: palette.emptyText }]}>{t('lookup.noLookup')}</Text>
            </View>
        );
    }

    const cachedEntry = activeLookupItem.cachedEntry;
    const liveEntries = activeLookupItem.liveEntries || [];
    const firstLiveEntry = liveEntries[0];

    if (cachedEntry) {
        const stem = getEntryWord(cachedEntry, activeLookupItem.stem || highlightedWord);
        const liveMeta = liveEntryMeta[cachedEntry.stem] || firstLiveEntry || {};
        const extra = extraDefs[cachedEntry.stem];
        const isExpanded = !!expandedCached[cachedEntry.stem];
        const showMore = Array.isArray(extra) && extra.length > 0 && !isExpanded;
        const showLess = isExpanded && Array.isArray(extra) && extra.length > 0;

        return (
            renderDictionaryPanel(
                <>
                {renderPrimaryEntry({
                    key: `${stem}-${cachedEntry.hanja ?? ''}`,
                    word: stem,
                    hanja: getEntryHanja(cachedEntry),
                    definition: getEntryDefinition(cachedEntry),
                    pos: getEntryPos(cachedEntry) || getEntryPos(liveMeta),
                    romanization: romanizations[stem] || getEntryRomanization(liveMeta),
                    showMore,
                    showLess,
                    onMore: () => setExpandedCached(prev => ({ ...prev, [cachedEntry.stem]: true })),
                    onLess: () => setExpandedCached(prev => ({ ...prev, [cachedEntry.stem]: false })),
                    extraEntries: extra,
                    separated: false,
                })}

                <HanjaDetails
                    hanja={currentHanja?.character ?? null}
                    hanjaCharacters={currentHanja?.characters ?? []}
                    initialHanjaIndex={currentHanja?.activeIndex ?? 0}
                    sourceWord={currentHanja?.sourceWord ?? stem}
                    sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
                    handleHanjaPress={handleHanjaPress}
                    onKnownWordMarked={handleRelatedKnownWordMarked}
                    onKnownWordRemoved={handleRelatedKnownWordRemoved}
                    onSourceWordAutoSaved={handleSourceWordAutoSaved}
                    isDarkMode={isDarkMode}
                />
                </>
            )
        );
    }

    const word = activeLookupItem.stem || highlightedWord;
    const first = firstLiveEntry;
    const isExpanded = expandedWords.includes(word);
    const extraEntries = first ? uniqueEntriesByWord(liveEntries.slice(1), first?.word || word) : [];

    return renderDictionaryPanel(
        <>
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
                hanjaCharacters={currentHanja?.characters ?? []}
                initialHanjaIndex={currentHanja?.activeIndex ?? 0}
                sourceWord={currentHanja?.sourceWord ?? word}
                sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
                handleHanjaPress={handleHanjaPress}
                onKnownWordMarked={handleRelatedKnownWordMarked}
                onKnownWordRemoved={handleRelatedKnownWordRemoved}
                onSourceWordAutoSaved={handleSourceWordAutoSaved}
                isDarkMode={isDarkMode}
            />
        </>
    );
};

const styles = StyleSheet.create({
    panelContent: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
    },
    dictionaryPanelContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        position: 'relative',
    },
    dictionaryScroll: {
        flex: 1,
        minHeight: 0,
    },
    dictionaryScrollContent: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 7,
    },
    dictionaryScrollContentWithNav: {
        paddingHorizontal: 30,
    },
    primaryEntry: {
        gap: 5,
        paddingBottom: 0,
    },
    entryHeading: {
        gap: 0,
    },
    entryHeadingTopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    entryTitleColumn: {
        flex: 1,
        minWidth: 0,
    },
    wordLine: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        paddingTop: 0,
    },
    entryWord: {
        fontFamily: fontFamilies.krSerifBold,
        fontSize: 21,
        lineHeight: 28,
        letterSpacing: 0,
        paddingTop: 0,
        includeFontPadding: true,
    },
    entryHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 17,
        lineHeight: 23,
    },
    entryMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 17,
        marginTop: -4,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexShrink: 0,
        gap: 2,
        paddingTop: 0,
        marginRight: -4,
    },
    posBadge: {
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 3,
    },
    posBadgeText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0,
    },
    wordSideNavigation: {
        ...StyleSheet.absoluteFillObject,
    },
    wordSideNavButton: {
        position: 'absolute',
        top: '50%',
        width: 24,
        height: 34,
        marginTop: -17,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    wordSideNavButtonLeft: {
        left: 0,
    },
    wordSideNavButtonRight: {
        right: 0,
    },
    definitionText: {
        ...textStyles.sectionTitle,
        fontSize: 18,
        lineHeight: 23,
        letterSpacing: 0,
    },
    emptyDefinition: {
        ...textStyles.body,
        fontStyle: 'italic',
    },
    bookmarkButton: {
        width: 30,
        height: 34,
        borderRadius: 17,
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    translateButton: {
        width: 30,
        height: 34,
        borderRadius: 17,
        borderWidth: 0,
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
    moreArrowButtonCollapsed: {
        marginTop: -3,
        marginBottom: 0,
    },
    moreArrowButtonExpanded: {
        marginTop: 0,
        marginBottom: 0,
    },
    extraList: {
        flexGrow: 0,
        maxHeight: 160,
        marginTop: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    extraListContent: {
        paddingTop: 2,
        paddingBottom: 0,
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
        fontSize: 11,
        lineHeight: 16,
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
        marginTop: 2,
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
