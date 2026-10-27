import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../../services/api/client';
import { logTiming } from '../../../services/appTelemetry';
import { useAppContext } from '../../../contexts/AppContext';
import { useTranslation } from '../../../hooks/useTranslation';
import { getUserFacingErrorMessage } from '../../../i18n/userFacing';
import { useLocalOwner } from '../../../contexts/LocalOwnerContext';
import {
    getCachedPKnown,
    insertData,
    logInteractionEvent,
    lookupCacheByStems,
    removeData,
    recordVocabContext,
    updateCacheRomanizations,
    vocabEntryExists,
} from '../../../services/Database';
import HanjaDetails from './HanjaDetails';
import LookupLoadingSkeleton from './LookupLoadingSkeleton';
import { normalizeBookLanguage } from '../../../constants/languages';
import { fontFamilies, radii, spacing, textStyles, useTheme } from '../../../theme';
import { playEnglishPronunciation } from '../../../services/pronunciationAudio';
import { getRuntimeChineseScript } from '../../../services/interfaceLanguage';
import { requestUserDataSync } from '../../../services/userDataSyncQueue';
import {
    getEntryFallbackLanguage,
    normalizeSurfaceWordForLanguage,
    resolveDictionaryLookup,
} from '../../../services/dictionaryLookup';

const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const LATIN_RE = /[A-Za-z]/;
const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
const CJK_RE = /[\u4E00-\u9FFF]/;
const KANA_RE = /[\u3040-\u30FF]/;
// Maps raw POS strings (English or Korean, as the dictionaries emit them) to
// pos.* translation keys. Empty string = deliberately show no badge.
const POS_KEYS = {
    Noun: 'pos.noun',
    Verb: 'pos.verb',
    Adverb: 'pos.adverb',
    Adjective: 'pos.adjective',
    Modifier: 'pos.modifier',
    Determiner: 'pos.determiner',
    // English dictionary entries (en_learner.db) use lowercase names.
    noun: 'pos.noun',
    verb: 'pos.verb',
    adverb: 'pos.adverb',
    adjective: 'pos.adjective',
    pronoun: 'pos.pronoun',
    determiner: 'pos.determiner',
    interjection: 'pos.interjection',
    numeral: 'pos.numeral',
    particle: 'pos.particle',
    preposition: 'pos.preposition',
    conjunction: 'pos.conjunction',
    article: 'pos.article',
    name: 'pos.properNoun',
    명사: 'pos.noun',
    동사: 'pos.verb',
    형용사: 'pos.adjective',
    부사: 'pos.adverb',
    관형사: 'pos.determiner',
    감탄사: 'pos.interjection',
    대명사: 'pos.pronoun',
    수사: 'pos.numeral',
    조사: 'pos.particle',
    접사: 'pos.affix',
    어미: 'pos.ending',
    '보조 동사': 'pos.auxiliaryVerb',
    보조동사: 'pos.auxiliaryVerb',
    '보조 형용사': 'pos.auxiliaryAdjective',
    보조형용사: 'pos.auxiliaryAdjective',
    의존명사: 'pos.dependentNoun',
    '의존 명사': 'pos.dependentNoun',
    품사없음: '',
    '품사 없음': '',
};

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
const getEntryGloss = (entry) => cleanValue(entry?.gloss);
const getEntryPos = (entry) => cleanValue(entry?.pos);
const getEntryRomanization = (entry) => cleanValue(entry?.romanization);
const getEntryIpa = (entry) => cleanValue(entry?.ipa);
const getEntryPinyin = (entry) => cleanValue(entry?.pinyin) || getEntryIpa(entry);
const getEntrySimplified = (entry) => cleanValue(entry?.simplified);
const getEntryTraditional = (entry) => cleanValue(entry?.traditional);

// CC-CEDICT packs a reading's senses into one string joined by "; ". Split them so
// the panel can number multiple meanings.
const splitZhSenses = (definition) => cleanValue(definition)
    .split(/\s*;\s*/)
    .map((sense) => sense.trim())
    .filter(Boolean);

// A sense that only points at another headword — "variant of 為|为[wei2]",
// "old variant of 五[wu3]", "see also 某人[…]" — carries no meaning of its own. Returns
// the referenced word (Simplified side when written Traditional|Simplified), else null.
const ZH_VARIANT_SENSE_RE = /^(?:[a-z]+ )*variant of ([^[\s;,()]+)|^see(?: also)? ([^[\s;,()]+)/i;
const getZhVariantReference = (sense) => {
    const match = ZH_VARIANT_SENSE_RE.exec(cleanValue(sense));
    if (!match) {
        return null;
    }
    let token = (match[1] || match[2] || '').trim();
    if (token.includes('|')) {
        token = token.split('|').pop().trim();
    }
    return token || null;
};

// Heteronyms come back as separate entries that share the same word but differ by
// pinyin. Dedupe by pinyin+definition (not word, which would collapse them all) and
// keep only readings that actually carry a definition.
const dedupeZhReadings = (entries) => {
    const seen = new Set();
    const readings = [];
    (entries || []).forEach((entry) => {
        const pinyin = getEntryPinyin(entry);
        const definition = getEntryDefinition(entry);
        if (!definition) {
            return;
        }
        const key = `${pinyin.toLowerCase()}|${definition.toLowerCase()}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        readings.push({
            word: cleanValue(entry?.word) || cleanValue(entry?.stem),
            pinyin,
            definition,
            senses: splitZhSenses(definition),
        });
    });
    return readings;
};
const getEntryAudioUs = (entry) => cleanValue(entry?.audio_us ?? entry?.audioUs);
const getEntryAudioUk = (entry) => cleanValue(entry?.audio_uk ?? entry?.audioUk);
const isLikelyUntranslatedEnglishDefinition = (definition, interfaceLanguage) => {
    const text = cleanValue(definition);

    if (!text || !LATIN_RE.test(text)) {
        return false;
    }

    if (interfaceLanguage === 'ko') {
        return !HANGUL_RE.test(text);
    }

    if (String(interfaceLanguage || '').startsWith('zh')) {
        return !CJK_RE.test(text);
    }

    if (interfaceLanguage === 'ja') {
        return !KANA_RE.test(text) && !CJK_RE.test(text);
    }

    return false;
};
const getRelatedKnownWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const formatPos = (pos, t) => {
    const normalized = cleanValue(pos).replace(/\s+/g, ' ');
    if (!normalized) {
        return '';
    }

    const toLabel = (key) => (key === '' ? '' : t(key));

    const compact = normalized.replace(/\s+/g, '');
    if (POS_KEYS[normalized] !== undefined) {
        return toLabel(POS_KEYS[normalized]);
    }
    if (POS_KEYS[compact] !== undefined) {
        return toLabel(POS_KEYS[compact]);
    }

    const koreanLabel = Object.keys(POS_KEYS)
        .filter((label) => /[\uAC00-\uD7A3]/.test(label))
        .sort((a, b) => b.length - a.length)
        .find((label) => normalized.includes(label));
    if (koreanLabel) {
        return toLabel(POS_KEYS[koreanLabel]);
    }

    return /[\uAC00-\uD7A3]/.test(normalized) ? '' : normalized.replace(/_/g, ' ').toLowerCase();
};

// Sentence case for labels that come from lowercase keys ("noun" -> "Noun").
// Scripts without letter case (Hangul, CJK, Arabic, Thai) are unaffected.
const toSentenceCase = (value) => {
    const text = typeof value === 'string' ? value : '';
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
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
    onSavedWordsChanged,
    onExpandedStateChange,
    onContentHeightChange,
    onCanExpandChange,
    onRequestExpand,
    isPanelExpanded = false,
    currentBook,
    sourceBook,
    savedWords = [],
}) => {
    const { interfaceLanguage } = useAppContext();
    const { t, language } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const { activeOwnerId } = useLocalOwner();
    const palette = useMemo(() => ({
        text: colors.readerBodyInk,
        mutedText: colors.readerMutedInk,
        secondaryText: colors.textSecondary,
        emptyText: colors.readerSubtleInk,
        surface: colors.readerSurface,
        border: colors.readerBorder,
        action: colors.readerTappedWordBg,
        actionText: colors.readerTappedWordText,
        secondaryButtonBg: colors.surfaceMuted,
        secondaryButtonText: colors.textMuted,
        icon: colors.readerTappedWordText,
    }), [colors]);

    const targetLanguage = normalizeBookLanguage(sourceBook?.language ?? 'ko');
    const isEnglishBook = targetLanguage === 'en';
    const isChineseBook = targetLanguage === 'zh';
    const isKoreanBook = targetLanguage === 'ko';
    const cacheScope = useMemo(() => ({
        language: targetLanguage,
        interfaceLanguage,
    }), [interfaceLanguage, targetLanguage]);
    const isUsableCachedEntry = useCallback((entry) => {
        if ((!isEnglishBook && !isChineseBook) || interfaceLanguage === 'en') {
            return true;
        }
        // English: the senses come in the learner's language. A name may have
        // no definition (just its transliterated gloss). A row cached before
        // definitions were translated still holds English senses: refetch it.
        if (isEnglishBook) {
            if (getEntryPos(entry) === 'name') {
                return Boolean(getEntryGloss(entry) || getEntryDefinition(entry));
            }
            const englishDefinition = getEntryDefinition(entry);
            return Boolean(englishDefinition)
                && !isLikelyUntranslatedEnglishDefinition(englishDefinition, interfaceLanguage);
        }

        const definition = getEntryDefinition(entry);
        return Boolean(definition)
            && !isLikelyUntranslatedEnglishDefinition(definition, interfaceLanguage);
    }, [interfaceLanguage, isChineseBook, isEnglishBook]);
    const contextSentence = cleanValue(sourceSentence);
    const [drilldownStack, setDrilldownStack] = useState([]);
    const lookupWord = drilldownStack.length > 0 ? drilldownStack[drilldownStack.length - 1] : highlightedWord;
    const rootLookupWord = cleanValue(normalizeSurfaceWordForLanguage(highlightedWord, targetLanguage)) || cleanValue(highlightedWord);
    const parentLookupWord = drilldownStack.length > 1
        ? drilldownStack[drilldownStack.length - 2]
        : rootLookupWord;
    const tappedSurface = cleanValue(normalizeSurfaceWordForLanguage(lookupWord, targetLanguage)) || cleanValue(lookupWord);
    const [expandedWords, setExpandedWords] = useState([]);
    const [stemWordList, setStemWordList] = useState([]);
    const [cachedResults, setCachedResults] = useState(null);
    const [needsLiveFetch, setNeedsLiveFetch] = useState(false);
    const [dictionaryData, setDictionaryData] = useState([]);
    const [isLiveLoading, setIsLiveLoading] = useState(false);
    const [liveError, setLiveError] = useState(null);
    const [extraDefs, setExtraDefs] = useState({});
    // All Chinese readings (heteronyms) for a tapped word, keyed by word:
    // 'loading' | Array<{ word, pinyin, definition }>. Fetched eagerly (not only on
    // expand) so the panel can lay out every pronunciation + sense at a glance.
    const [zhReadings, setZhReadings] = useState({});
    // Words we've already kicked off a /zh_dict_search/ for, so the eager + variant
    // effects never double-fetch. Cleared when the tapped word changes.
    const zhReadingsFetchRef = useRef(new Set());
    const [liveEntryMeta, setLiveEntryMeta] = useState({});
    const [romanizations, setRomanizations] = useState({});
    const romanizationsRef = useRef({});
    const [expandedCached, setExpandedCached] = useState({});
    const [relatedKnownByWord, setRelatedKnownByWord] = useState({});
    const [currentHanja, setCurrentHanja] = useState(null);
    const [activeWordIndex, setActiveWordIndex] = useState(0);
    const [dictionaryViewportHeight, setDictionaryViewportHeight] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const dictionaryScrollRef = useRef(null);
    useEffect(() => {
        romanizationsRef.current = romanizations;
    }, [romanizations]);

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
        setDrilldownStack([]);
    }, [highlightedWord, targetLanguage]);

    useEffect(() => {
        setCachedResults(null);
        setNeedsLiveFetch(false);
        setStemWordList([]);
        setDictionaryData([]);
        setLiveError(null);
        setIsLiveLoading(false);
        setExtraDefs({});
        setZhReadings({});
        zhReadingsFetchRef.current = new Set();
        setLiveEntryMeta({});
        romanizationsRef.current = {};
        setRomanizations({});
        setExpandedCached({});
        setExpandedWords([]);
        setRelatedKnownByWord({});
        setActiveWordIndex(0);

        if (!lookupWord) return;

        let isCancelled = false;

        const resolveLookup = async () => {
            setIsLiveLoading(true);
            const lookupStartedAt = Date.now();

            try {
                const result = await resolveDictionaryLookup({
                    surface: lookupWord,
                    currentBook,
                    ownerId: activeOwnerId,
                    interfaceLanguage,
                    targetLanguage,
                    usableCachedEntry: isUsableCachedEntry,
                });
                if (isCancelled) {
                    return;
                }

                logTiming('lookup_ready', Date.now() - lookupStartedAt, {
                    entries: (result.cachedResults?.length ?? 0) + (result.dictionaryData?.length ?? 0),
                    live: result.needsLiveFetch ? 'yes' : 'no',
                });
                setCachedResults(result.cachedResults);
                setStemWordList(result.stems);
                setNeedsLiveFetch(result.needsLiveFetch);
                setDictionaryData(result.dictionaryData);
                setLiveError(result.liveError);
            } catch (error) {
                if (isCancelled) {
                    return;
                }

                setCachedResults([]);
                setStemWordList([]);
                setNeedsLiveFetch(false);
                setDictionaryData([]);
                setLiveError(getUserFacingErrorMessage(error, t, 'lookup.dictionaryFailed', language));
            } finally {
                if (!isCancelled) {
                    setIsLiveLoading(false);
                    onContentLoaded?.();
                }
            }
        };

        resolveLookup();

        return () => {
            isCancelled = true;
        };
    }, [activeOwnerId, currentBook, interfaceLanguage, isUsableCachedEntry, lookupWord, onContentLoaded, targetLanguage]);

    useEffect(() => {
        if (!isPanelExpanded) {
            onExpandedStateChange?.(0);
            return;
        }

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
    }, [dictionaryData, expandedCached, expandedWords, extraDefs, isPanelExpanded, onExpandedStateChange, stemWordList]);

    const storeRomanizationPairs = useCallback((pairs) => {
        const normalizedPairs = (pairs || [])
            .map(([term, romanization]) => [cleanValue(term), cleanValue(romanization)])
            .filter(([term]) => Boolean(term));

        if (normalizedPairs.length === 0) {
            return;
        }

        setRomanizations(prev => {
            const next = { ...prev };
            normalizedPairs.forEach(([term, romanization]) => {
                next[term] = romanization;
            });
            romanizationsRef.current = next;
            return next;
        });
    }, []);

    const fetchRomanizations = useCallback(async (terms, seedEntries = []) => {
        if (!isKoreanBook) {
            return;
        }

        const seedPairs = (seedEntries || [])
            .map((entry) => [getEntryWord(entry, ''), getEntryRomanization(entry)])
            .filter(([term, romanization]) => cleanValue(term) && cleanValue(romanization));

        if (seedPairs.length > 0) {
            storeRomanizationPairs(seedPairs);
        }

        const missingTerms = [...new Set((terms || []).map(cleanValue).filter(Boolean))]
            .filter((term) => romanizationsRef.current[term] === undefined);

        if (missingTerms.length === 0) {
            return;
        }

        let cachedRows = [];
        try {
            cachedRows = await lookupCacheByStems(missingTerms, cacheScope);
        } catch (error) {
            console.warn('[DictionaryContent] Failed to read cached romanizations:', error?.message ?? error);
        }
        const cachedPairs = cachedRows
            .map((entry) => [getEntryWord(entry, ''), getEntryRomanization(entry)])
            .filter(([term, romanization]) => cleanValue(term) && cleanValue(romanization));

        if (cachedPairs.length > 0) {
            storeRomanizationPairs(cachedPairs);
        }

        const cachedTermSet = new Set(cachedPairs.map(([term]) => cleanValue(term)));
        const apiTerms = missingTerms.filter((term) => (
            !cachedTermSet.has(term) && romanizationsRef.current[term] === undefined
        ));

        if (apiTerms.length === 0) {
            return;
        }

        const pairs = await Promise.all(apiTerms.map(async (term) => {
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

        storeRomanizationPairs(pairs);
        updateCacheRomanizations(
            pairs
                .map(([stem, romanization]) => ({ stem, romanization: cleanValue(romanization) }))
                .filter(({ stem, romanization }) => cleanValue(stem) && romanization),
            cacheScope
        ).catch((error) => {
            console.warn('[DictionaryContent] Failed to cache romanizations:', error?.message ?? error);
        });
    }, [cacheScope, isKoreanBook, storeRomanizationPairs]);

    useEffect(() => {
        if (!cachedResults || cachedResults.length === 0) {
            return;
        }

        fetchRomanizations(cachedResults.map((entry) => getEntryWord(entry, lookupWord)), cachedResults);
    }, [cachedResults, fetchRomanizations, lookupWord]);

    useEffect(() => {
        if (stemWordList.length === 0) {
            return;
        }

        fetchRomanizations(stemWordList);
    }, [fetchRomanizations, stemWordList]);

    const prefetchExtra = async (stem) => {
        if (isEnglishBook) {
            setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
            try {
                const response = await api.get('/en_dict_search/', {
                    params: { stem, interface_language: interfaceLanguage },
                    timeout: 10000,
                });
                const entries = response.data?.results ?? [];
                if (entries[0]) {
                    setLiveEntryMeta(prev => ({ ...prev, [stem]: entries[0] }));
                }
                setExtraDefs(prev => ({ ...prev, [stem]: entries.slice(1) }));
            } catch {
                setExtraDefs(prev => ({ ...prev, [stem]: [] }));
            }
            return;
        }

        if (isChineseBook) {
            setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
            try {
                const response = await api.get('/zh_dict_search/', {
                    params: { stem, interface_language: interfaceLanguage },
                    timeout: 10000,
                });
                const entries = response.data?.results ?? [];
                if (entries[0]) {
                    setLiveEntryMeta(prev => ({ ...prev, [stem]: entries[0] }));
                }
                setExtraDefs(prev => ({ ...prev, [stem]: uniqueEntriesByWord(entries.slice(1), entries[0]?.word) }));
            } catch {
                setExtraDefs(prev => ({ ...prev, [stem]: [] }));
            }
            return;
        }

        setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
        try {
            const response = await api.post('/krdict_search/', {
                queries: [stem],
                language: interfaceLanguage,
            }, {
                timeout: 10000,
            });
            // The cached definition is in the interface language; while KRDICT
            // is unavailable the server answers with English fallback senses,
            // which would read as mismatched extra definitions under it.
            const entries = (response.data?.results?.[0] ?? [])
                .filter((entry) => !getEntryFallbackLanguage(entry, interfaceLanguage));
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
            const stem = cleanValue(entry?.stem) || getEntryWord(entry, lookupWord) || `cached-${index}`;
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

        const isAwaitingLive = needsLiveFetch && !liveError;

        return [...itemsByStem.values()].filter((item) => (
            item.cachedEntry
            || item.liveEntries?.[0]
            || (isAwaitingLive && cleanValue(item.stem))
        ));
    }, [cachedResults, dictionaryData, liveError, lookupWord, needsLiveFetch, stemWordList]);

    const lookupItemCount = lookupItems.length;
    const currentLookupIndex = lookupItemCount > 0
        ? Math.min(activeWordIndex, lookupItemCount - 1)
        : 0;
    const activeLookupItem = lookupItems[currentLookupIndex] || null;
    const hasWordNavigation = drilldownStack.length === 0 && lookupItemCount > 1;
    const isDictionaryScrollable = dictionaryViewportHeight > 0
        && dictionaryContentHeight > dictionaryViewportHeight + 2;
    const activeLookupDetails = useMemo(() => {
        const cachedEntry = activeLookupItem?.cachedEntry || null;
        const firstLiveEntry = activeLookupItem?.liveEntries?.[0] || null;
        const entry = cachedEntry || firstLiveEntry;
        const stem = cleanValue(activeLookupItem?.stem) || getEntryWord(entry, lookupWord);
        const liveMeta = cachedEntry
            ? (liveEntryMeta[cachedEntry.stem] || firstLiveEntry || {})
            : {};
        const word = getEntryWord(entry, stem || lookupWord);

        return {
            hanja: getEntryHanja(entry),
            word,
        };
    }, [activeLookupItem, liveEntryMeta, lookupWord]);
    const activeLookupHanja = activeLookupDetails.hanja;
    const canExpandCurrentLookup = (
        (isKoreanBook && hasHanja(activeLookupHanja))
        // English: expanding lists the word's other entries (bank: the river one).
        || (isEnglishBook && Boolean(activeLookupDetails.word))
        // Chinese: expanding loads the word's other pronunciations (heteronyms); the
        // collapsed panel already shows the primary reading from cache.
        || (isChineseBook && Boolean(activeLookupDetails.word))
    );

    useEffect(() => {
        onCanExpandChange?.(canExpandCurrentLookup);
        if (!canExpandCurrentLookup && isPanelExpanded) {
            onExpandedStateChange?.(0);
        }
    }, [canExpandCurrentLookup, isPanelExpanded, onCanExpandChange, onExpandedStateChange]);

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
        // Chinese has its own expand fetch (zhReadings) and renders from it, not from
        // extraDefs — so skip this one for zh to avoid a duplicate /zh_dict_search/.
        if (isChineseBook || !isPanelExpanded || !entry?.definition || extraDefs[entry.stem] !== undefined) {
            return;
        }

        prefetchExtra(entry.stem);
        setExpandedCached(prev => ({ ...prev, [entry.stem]: true }));
    }, [activeLookupItem, extraDefs, isChineseBook, isPanelExpanded]);

    // Fetch every reading of a Chinese word from /zh_dict_search/ (the cache only
    // holds the top one) into zhReadings, once per word.
    const fetchZhReadings = (rawWord) => {
        const word = cleanValue(rawWord);
        if (!word || zhReadingsFetchRef.current.has(word)) {
            return;
        }
        zhReadingsFetchRef.current.add(word);
        setZhReadings((prev) => ({ ...prev, [word]: 'loading' }));
        api.get('/zh_dict_search/', {
            params: {
                stem: word,
                interface_language: interfaceLanguage,
                script: getRuntimeChineseScript(),
            },
            timeout: 10000,
        })
            .then((response) => setZhReadings((prev) => ({ ...prev, [word]: response.data?.results ?? [] })))
            .catch(() => setZhReadings((prev) => ({ ...prev, [word]: [] })));
    };

    // Chinese: the cached entry already gives the primary reading + numbered senses
    // instantly (no network). Only when the user expands the panel do we hit
    // /zh_dict_search/ for the *other* pronunciations — so a normal tap stays as fast
    // as Korean instead of paying a round-trip every time.
    useEffect(() => {
        if (!isChineseBook || !isPanelExpanded) {
            return;
        }
        const entry = activeLookupItem?.cachedEntry;
        const word = entry
            ? getEntryWord(entry, activeLookupItem.stem || lookupWord)
            : (activeLookupItem?.stem || lookupWord);
        fetchZhReadings(word);
    }, [isChineseBook, isPanelExpanded, activeLookupItem, lookupWord]);

    // Expanding a multi-character Chinese word also fetches each individual
    // character so the breakdown ("view characters") can list per-glyph pinyin +
    // definition. Single-character words have nothing to break down, so we skip them.
    useEffect(() => {
        if (!isChineseBook || !isPanelExpanded) {
            return;
        }
        const entry = activeLookupItem?.cachedEntry;
        const word = cleanValue(entry
            ? getEntryWord(entry, activeLookupItem.stem || lookupWord)
            : (activeLookupItem?.stem || lookupWord));
        const chars = Array.from(word).filter((ch) => HANJA_RE.test(ch));
        if (chars.length < 2) {
            return;
        }
        chars.forEach((ch) => fetchZhReadings(ch));
    }, [isChineseBook, isPanelExpanded, activeLookupItem, lookupWord]);

    // Follow "variant of X" / "see X" references: fetch X so its real definition can
    // stand in for the bare pointer. Runs as readings arrive (backend may already have
    // resolved them, in which case no reference remains and this is a no-op).
    useEffect(() => {
        if (!isChineseBook) {
            return;
        }
        Object.values(zhReadings).forEach((value) => {
            if (!Array.isArray(value)) {
                return;
            }
            value.forEach((entry) => {
                splitZhSenses(getEntryDefinition(entry)).forEach((sense) => {
                    const reference = getZhVariantReference(sense);
                    if (reference) {
                        fetchZhReadings(reference);
                    }
                });
            });
        });
    }, [isChineseBook, zhReadings]);

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
        language: targetLanguage,
    });

    const handleSourceWordAutoSaved = async (word, details = {}) => {
        const normalizedWord = cleanValue(word);
        if (!normalizedWord) {
            return;
        }

        onWordSave?.(normalizedWord, { includeSurface: false });
        requestUserDataSync('reader-source-word-auto-save');
    };

    const toggleSave = async (word, origin, definition, options = {}) => {
        onWordSave?.(word, options);
        const createdAt = new Date().toISOString();
        const relatedKnownWords = relatedKnownByWord[word] ?? [];
        const alreadySaved = await vocabEntryExists(word, origin, definition, targetLanguage, {
            ownerId: activeOwnerId,
        });
        if (!alreadySaved) {
            // Phase 4.4: seed the new card's FSRS interval from its cached P(known).
            const pKnown = await getCachedPKnown({
                ownerId: activeOwnerId,
                language: targetLanguage,
                word,
            });
            await insertData(word, origin, definition, {
                ownerId: activeOwnerId,
                level: 'unorganized',
                sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
                sourceBookTitle: sourceBook?.title ?? null,
                contextSentence: contextSentence || null,
                createdAt,
                updatedAt: createdAt,
                language: targetLanguage,
                relatedKnownWords,
                pKnown,
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
            language: targetLanguage,
        });

        if (!alreadySaved || recordedContext) {
            requestUserDataSync('reader-vocab-save');
        }

        // The DB write has committed — let the parent re-read its book-scoped
        // saved list so the top-bar badge count reflects this save immediately
        // rather than only on the next time the saved panel is opened.
        onSavedWordsChanged?.();

        logInteractionEvent({
            ownerId: activeOwnerId,
            language: targetLanguage,
            word,
            hanja: origin,
            def: definition,
            eventType: 'save',
            sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
            sentence: contextSentence || null,
        }).catch((error) => {
            console.warn('[DictionaryContent] Failed to log save interaction event:', error);
        });
    };

    const toggleUnSave = async (word, origin, definition, options = {}) => {
        onWordUnsave?.(word, options);
        const ownerId = activeOwnerId;
        await removeData(word, origin, definition, targetLanguage, {
            ownerId,
        });
        requestUserDataSync('reader-vocab-unsave');

        // Commit landed — refresh the parent's badge count for this book.
        onSavedWordsChanged?.();

        logInteractionEvent({
            ownerId,
            language: targetLanguage,
            word,
            hanja: origin,
            def: definition,
            eventType: 'unsave',
            sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
        }).catch((error) => {
            console.warn('[DictionaryContent] Failed to log unsave interaction event:', error);
        });
    };

    const isWordSaved = (word) => savedWords.includes(word);

    const goBackFromDrilldown = () => {
        setCurrentHanja(null);
        setDrilldownStack(prev => prev.slice(0, -1));
    };

    // Chinese: look up one character of a longer word (先 of 先生), with a
    // back row to the word.
    const handleChineseCharacterPress = (character) => {
        const next = cleanValue(character);
        if (!next || next === cleanValue(lookupWord)) {
            return;
        }
        setCurrentHanja(null);
        setDrilldownStack(prev => [...prev, next]);
    };

    const chineseCharactersOf = (rawWord) => (
        isChineseBook ? Array.from(cleanValue(rawWord)).filter((ch) => HANJA_RE.test(ch)) : []
    );

    // A Chinese headword of 2+ characters: each character is its own button
    // (dotted underline) opening that character's entry, with a back row to
    // the word. Anything else renders as plain text.
    const renderHeadwordText = (text, textStyle) => {
        const value = cleanValue(text);
        if (chineseCharactersOf(value).length < 2) {
            return <Text selectable style={textStyle}>{text}</Text>;
        }
        return (
            <View style={styles.zhHeadwordChars}>
                {Array.from(value).map((ch, index) => (HANJA_RE.test(ch) ? (
                    <Pressable
                        key={`${ch}-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('lookup.characters')}: ${ch}`}
                        hitSlop={{ top: 6, bottom: 8, left: 1, right: 1 }}
                        onPress={() => handleChineseCharacterPress(ch)}
                        style={({ pressed }) => [styles.zhHeadwordChar, pressed && styles.zhHeadwordCharPressed]}
                    >
                        <Text style={textStyle}>{ch}</Text>
                        <View style={styles.headwordDots}>
                            {[0, 1, 2, 3, 4].map((dot) => (
                                <View key={dot} style={[styles.headwordDot, { backgroundColor: colors.textSubtle }]} />
                            ))}
                        </View>
                    </Pressable>
                ) : (
                    <Text key={`${ch}-${index}`} style={[textStyle, styles.zhHeadwordGap]}>{ch}</Text>
                )))}
            </View>
        );
    };

    const goToPreviousWord = () => {
        if (lookupItemCount <= 1 || currentLookupIndex <= 0) {
            return;
        }

        setExpandedCached({});
        setExpandedWords([]);
        onExpandedStateChange?.(0);
        setActiveWordIndex((currentIndex) => (
            Math.max(0, currentIndex - 1)
        ));
        handleHanjaPress(null);
    };

    const goToNextWord = () => {
        if (lookupItemCount <= 1 || currentLookupIndex >= lookupItemCount - 1) {
            return;
        }

        setExpandedCached({});
        setExpandedWords([]);
        onExpandedStateChange?.(0);
        setActiveWordIndex((currentIndex) => (
            Math.min(lookupItemCount - 1, currentIndex + 1)
        ));
        handleHanjaPress(null);
    };

    const scrollDictionaryToTop = useCallback(() => {
        dictionaryScrollRef.current?.scrollTo?.({ y: 0, animated: true });
    }, []);

    const renderDrilldownBackRow = () => {
        if (drilldownStack.length === 0) {
            return null;
        }

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('lookup.backToWord', { word: parentLookupWord })}
                activeOpacity={0.78}
                onPress={goBackFromDrilldown}
                style={[styles.drilldownBackRow, { borderBottomColor: palette.border }]}
            >
                <MaterialIcons name="chevron-left" size={18} color={palette.mutedText} />
                <Text style={[styles.drilldownBackText, { color: palette.mutedText }]}>
                    {parentLookupWord}
                </Text>
            </TouchableOpacity>
        );
    };

    const renderDictionaryPanel = (children, { word, hanja, definition } = {}) => (
        <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
            <ScrollView
                ref={dictionaryScrollRef}
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
                {renderDrilldownBackRow()}
                {children}
            </ScrollView>
            {word ? renderActionRow(word, hanja, definition) : null}
        </View>
    );

    const renderHanja = (hanja, variant = 'entry', sourceWord = null, sourceWordDetails = {}) => {
        if (!hasHanja(hanja)) {
            return null;
        }

        const isEntry = variant === 'entry';
        const hanjaStyle = [
            isEntry ? styles.entryHanja : styles.extraHanja,
            { color: isEntry ? colors.textMuted : palette.mutedText },
        ];
        const hanjaCharacters = getHanjaCharacters(hanja);
        let hanjaTokenIndex = -1;

        return (
            <View style={[styles.hanjaGroup, isEntry ? styles.entryHanjaGroup : styles.extraHanjaGroup]}>
                {!isEntry ? <Text style={hanjaStyle}>(</Text> : null}
                {cleanValue(hanja).split('').map((char, index) => {
                    if (!HANJA_RE.test(char)) {
                        return <Text key={`${char}-${index}`} style={hanjaStyle}>{char}</Text>;
                    }

                    hanjaTokenIndex += 1;
                    const selectedHanjaIndex = hanjaTokenIndex;

                    return (
                        <TouchableOpacity
                            key={`${char}-${index}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('hanja.rootCharacters')}: ${char}`}
                            activeOpacity={0.7}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                            onPress={() => {
                                handleHanjaPress(char, sourceWord, {
                                    characters: hanjaCharacters,
                                    index: selectedHanjaIndex,
                                    sourceWordDetails,
                                });
                                onRequestExpand?.();
                            }}
                            style={styles.hanjaToken}
                        >
                            <Text style={hanjaStyle}>{char}</Text>
                            {isEntry ? (
                                <View style={styles.headwordDots}>
                                    {[0, 1, 2, 3].map((dot) => (
                                        <View key={dot} style={[styles.headwordDot, { backgroundColor: colors.textSubtle }]} />
                                    ))}
                                </View>
                            ) : null}
                        </TouchableOpacity>
                    );
                })}
                {!isEntry ? <Text style={hanjaStyle}>)</Text> : null}
            </View>
        );
    };

    // An action-row button (Save).
    // `active` fills it with ink, like a pressed toggle.
    const renderActionButton = ({
        icon,
        label,
        onPress,
        active = false,
        disabled = false,
        accessibilityLabel,
        accessibilityState,
    }) => {
        const tint = active ? palette.actionText : palette.text;
        return (
            <TouchableOpacity
                style={[
                    styles.actionButton,
                    active && styles.actionButtonActive,
                    disabled && styles.actionButtonDisabled,
                ]}
                onPress={disabled ? undefined : onPress}
                activeOpacity={disabled ? 1 : 0.7}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel || label}
                accessibilityState={{ disabled, ...(accessibilityState || {}) }}
            >
                <MaterialIcons name={icon} size={16} color={tint} style={styles.actionButtonIcon} />
                <Text
                    style={[styles.actionLabel, { color: tint }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                >
                    {label}
                </Text>
            </TouchableOpacity>
        );
    };

    const renderActionRow = (word, hanja, definition) => {
        const canSave = hasSavableDefinition(definition);
        const saved = canSave && isWordSaved(word);

        return (
            <View style={styles.actionRow}>
                {renderActionButton({
                    icon: saved ? 'bookmark' : 'bookmark-border',
                    label: saved ? t('lookup.saved') : t('lookup.save'),
                    onPress: () => (saved ? toggleUnSave(word, hanja, definition) : toggleSave(word, hanja, definition)),
                    active: saved,
                    disabled: !canSave,
                    accessibilityState: { selected: saved },
                })}
            </View>
        );
    };

    const renderNotFoundActionRow = (word) => {
        const notFoundSaved = isWordSaved(word);

        return (
            <View style={styles.actionRow}>
                {renderActionButton({
                    icon: notFoundSaved ? 'bookmark' : 'bookmark-border',
                    label: notFoundSaved ? t('lookup.saved') : t('lookup.save'),
                    onPress: () => (notFoundSaved ? toggleUnSave(word, '', '') : toggleSave(word, '', '')),
                    active: notFoundSaved,
                    accessibilityState: { selected: notFoundSaved },
                })}
            </View>
        );
    };

    const handlePronunciationPress = async ({ word, audioUs, audioUk, preferredAccent }) => {
        try {
            await playEnglishPronunciation({
                word,
                audioUs,
                audioUk,
                preferredAccent,
            });
        } catch (error) {
            console.warn('[DictionaryContent] pronunciation playback failed:', error?.message || error);
        }
    };

    const renderPronunciationControls = ({ word, audioUs, audioUk }) => {
        if (!isEnglishBook || !cleanValue(word)) {
            return null;
        }

        return (
            <View style={styles.pronunciationControls}>
                {[
                    ['us', t('lookup.accentUs'), t('lookup.playUsPronunciation', { word })],
                    ['uk', t('lookup.accentUk'), t('lookup.playUkPronunciation', { word })],
                ].map(([accent, label, accessibilityLabel]) => (
                    <TouchableOpacity
                        key={accent}
                        accessibilityRole="button"
                        accessibilityLabel={accessibilityLabel}
                        activeOpacity={0.78}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => handlePronunciationPress({
                            word,
                            audioUs,
                            audioUk,
                            preferredAccent: accent,
                        })}
                        style={[
                            styles.pronunciationAccentButton,
                            {
                                borderColor: palette.border,
                                backgroundColor: palette.secondaryButtonBg,
                            },
                        ]}
                    >
                        <MaterialIcons name="volume-up" size={13} color={palette.mutedText} />
                        <Text style={[styles.pronunciationAccentText, { color: palette.mutedText }]}>
                            {label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        );
    };

    const renderHeadwordChevron = (direction) => {
        const isPrevious = direction === 'previous';
        const disabled = !hasWordNavigation
            || (isPrevious ? currentLookupIndex <= 0 : currentLookupIndex >= lookupItemCount - 1);

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={isPrevious ? t('lookup.previousDetectedWord') : t('lookup.nextDetectedWord')}
                activeOpacity={disabled ? 1 : 0.78}
                disabled={disabled}
                onPress={isPrevious ? goToPreviousWord : goToNextWord}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                style={styles.headwordChevronButton}
            >
                {hasWordNavigation ? (
                    <MaterialIcons
                        name={isPrevious ? 'chevron-left' : 'chevron-right'}
                        size={24}
                        color={disabled ? colors.frame : colors.textSecondary}
                    />
                ) : null}
            </TouchableOpacity>
        );
    };

    const renderEntryHeading = ({ word, hanja, definition, pos, romanization, ipa, pinyin, simplified, traditional, audioUs, audioUk }) => {
        const sourceWordDetails = buildSourceWordDetails({ hanja, definition });
        const hanjaElement = isKoreanBook ? renderHanja(hanja, 'entry', word, sourceWordDetails) : null;
        const romanizationText = cleanValue(romanization);
        const ipaText = cleanValue(ipa);
        const pinyinText = cleanValue(pinyin);
        const pronunciationText = isEnglishBook ? ipaText : (isChineseBook ? pinyinText : romanizationText);
        const pronunciationControls = renderPronunciationControls({ word, audioUs, audioUk });

        // Chinese shows BOTH headword forms so the reader sees the word in whichever
        // script they didn't tap. Only rendered when the two forms actually differ
        // (many words are identical across Simplified/Traditional).
        const simplifiedText = cleanValue(simplified);
        const traditionalText = cleanValue(traditional);
        const showBothScripts = isChineseBook
            && simplifiedText
            && traditionalText
            && simplifiedText !== traditionalText;
        // When a Chinese word differs across scripts, fold both forms into the
        // headword itself as "simplified / traditional" rather than a separate row.
        const headwordText = showBothScripts ? `${simplifiedText} / ${traditionalText}` : word;

        return (
            <View style={styles.entryHeading}>
                <View style={styles.headwordRow}>
                    {renderHeadwordChevron('previous')}
                    <View style={styles.wordLine}>
                        {renderHeadwordText(
                            headwordText,
                            [styles.entryWord, isChineseBook && styles.zhEntryWord, { color: palette.text }]
                        )}
                        {hanjaElement}
                        {pronunciationText && !isEnglishBook ? (
                            <Text
                                selectable
                                style={[
                                    styles.entryMeta,
                                    isChineseBook && styles.zhHeadingPinyin,
                                    { color: isChineseBook ? palette.text : colors.textTertiary },
                                ]}
                            >
                                {pronunciationText}
                            </Text>
                        ) : null}
                    </View>
                    {renderHeadwordChevron('next')}
                </View>
                {pronunciationControls || (isEnglishBook && pronunciationText) ? (
                    <View style={styles.entryMetaRow}>
                        {isEnglishBook && pronunciationText ? (
                            <Text selectable style={[styles.ipaText, { color: colors.textTertiary }]}>
                                {pronunciationText}
                            </Text>
                        ) : null}
                        {pronunciationControls}
                    </View>
                ) : null}
            </View>
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
                    const word = cleanValue(entry.word) || lookupWord;
                    const hanja = getEntryHanja(entry);
                    const definition = getEntryDefinition(entry);
                    const pinyin = getEntryPinyin(entry);
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
                                    {isKoreanBook ? renderHanja(hanja, 'extra', word, sourceWordDetails) : null}
                                </View>
                                {isChineseBook && pinyin ? (
                                    <Text selectable style={[styles.extraMeta, { color: palette.mutedText }]}>
                                        {pinyin}
                                    </Text>
                                ) : null}
                                {isEnglishBook && (getEntryPos(entry) || getEntryGloss(entry)) ? (
                                    <Text selectable style={[styles.extraMeta, { color: palette.mutedText }]}>
                                        {[toSentenceCase(formatPos(getEntryPos(entry), t)), getEntryGloss(entry)]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </Text>
                                ) : null}
                                {isEnglishBook && definition ? (
                                    renderEnglishSenses(definition, styles.extraDefinition, palette.secondaryText)
                                ) : (
                                    <Text selectable style={[styles.extraDefinition, { color: palette.secondaryText }]}>
                                        {definition || t('lookup.noEnglishDefinition')}
                                    </Text>
                                )}
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

    // A reading's senses, either as one line or a numbered list when there are many.
    const renderZhSenses = (senses, color) => {
        if (!Array.isArray(senses) || senses.length === 0) {
            return null;
        }
        if (senses.length === 1) {
            return (
                <Text selectable style={[styles.definitionText, { color }]}>
                    {senses[0]}
                </Text>
            );
        }
        return (
            <View style={styles.zhSenseList}>
                {senses.map((sense, index) => (
                    <View key={`${sense}-${index}`} style={styles.zhSenseItem}>
                        <Text style={[styles.zhSenseNumber, { color }]}>{`${index + 1}.`}</Text>
                        <Text selectable style={[styles.zhSenseText, { color }]}>{sense}</Text>
                    </View>
                ))}
            </View>
        );
    };

    // Replace a bare "variant of X" sense with X's actual senses (fetched into
    // zhReadings by the effect below), so a reference never shows up as the meaning.
    // Falls back to the raw sense if the target isn't resolved yet.
    const resolveZhVariantSenses = (senses) => (senses || []).flatMap((sense) => {
        const reference = getZhVariantReference(sense);
        if (!reference) {
            return [sense];
        }
        const target = Array.isArray(zhReadings[reference]) ? dedupeZhReadings(zhReadings[reference]) : null;
        if (target && target.length > 0 && target[0].senses.length > 0) {
            return target[0].senses.map((targetSense, index) => (
                index === 0 ? t('lookup.variantOf', { reference, sense: targetSense }) : targetSense
            ));
        }
        return [sense];
    });

    // Assemble the readings for a tapped Chinese word: all pronunciations (deduped by
    // pinyin), each with variant references resolved, plus flags describing how many
    // distinct readings/meanings there are so the caller can pick a layout.
    const getChineseReadingsData = (word, fallbackPinyin, fallbackDefinition) => {
        const loaded = Array.isArray(zhReadings[word]) ? dedupeZhReadings(zhReadings[word]) : [];
        const base = loaded.length > 0
            ? loaded
            : (cleanValue(fallbackDefinition)
                ? [{
                    word,
                    pinyin: cleanValue(fallbackPinyin),
                    definition: cleanValue(fallbackDefinition),
                    senses: splitZhSenses(fallbackDefinition),
                }]
                : []);
        const readings = base.map((reading) => ({
            ...reading,
            senses: resolveZhVariantSenses(reading.senses),
        }));
        const distinctPinyins = [...new Set(readings.map((reading) => reading.pinyin).filter(Boolean))];
        const distinctDefinitions = [...new Set(readings.map((reading) => reading.definition))];
        const rowLayout = readings.length > 1 && distinctPinyins.length > 1 && distinctDefinitions.length > 1;
        return { readings, distinctPinyins, distinctDefinitions, rowLayout };
    };

    // Chinese meaning body (pinyin lives in the heading now, alongside the character):
    //  · multiple readings + differing meanings → one row per reading (char · pinyin · senses)
    //  · otherwise → the numbered senses; the heading carries the pinyin(s).
    const renderChineseBody = ({ readings, distinctDefinitions, rowLayout }) => {
        if (readings.length === 0) {
            return (
                <Text selectable style={[styles.emptyDefinition, { color: palette.emptyText }]}>
                    {t('lookup.noDictionaryEntry')}
                </Text>
            );
        }

        if (rowLayout) {
            return (
                <View style={styles.zhReadingList}>
                    {readings.map((reading, index) => (
                        <View
                            key={`${reading.pinyin}-${index}`}
                            style={[
                                styles.zhReadingRow,
                                index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
                            ]}
                        >
                            <View style={styles.zhReadingLead}>
                                <Text selectable style={[styles.zhReadingChar, { color: palette.text }]}>
                                    {reading.word || ''}
                                </Text>
                                <Text selectable style={[styles.zhReadingPinyin, { color: palette.text }]}>
                                    {reading.pinyin}
                                </Text>
                            </View>
                            <View style={styles.zhReadingSenses}>
                                {renderZhSenses(reading.senses, palette.secondaryText)}
                            </View>
                        </View>
                    ))}
                </View>
            );
        }

        // One pronunciation (or several sharing one meaning): number the senses. When
        // several readings share a pronunciation, gather their senses together.
        const senses = distinctDefinitions.length === 1
            ? readings[0].senses
            : [...new Set(readings.flatMap((reading) => reading.senses))];
        return (
            <View style={styles.zhSingleReading}>
                {renderZhSenses(senses, palette.secondaryText)}
            </View>
        );
    };

    // Per-character breakdown shown when a multi-character Chinese word is expanded:
    // one row per glyph with its (primary) pinyin and definition, fetched into
    // zhReadings by the effect above.
    const renderChineseCharacterBreakdown = (rawWord) => {
        const chars = Array.from(cleanValue(rawWord)).filter((ch) => HANJA_RE.test(ch));
        if (chars.length < 2) {
            return null;
        }
        return (
            <View style={[styles.zhCharSection, { borderTopColor: palette.border }]}>
                <Text style={[styles.zhCharSectionTitle, { color: palette.mutedText }]}>
                    {t('lookup.characters')}
                </Text>
                {chars.map((ch, index) => {
                    const raw = zhReadings[ch];
                    const readings = Array.isArray(raw) ? dedupeZhReadings(raw) : [];
                    const primary = readings[0] || null;
                    const senses = primary ? resolveZhVariantSenses(primary.senses) : [];
                    const isLoading = raw === 'loading' || raw === undefined;
                    return (
                        <TouchableOpacity
                            key={`${ch}-${index}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('lookup.characters')}: ${ch}`}
                            activeOpacity={0.7}
                            onPress={() => handleChineseCharacterPress(ch)}
                            style={[
                                styles.zhCharRow,
                                index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
                            ]}
                        >
                            <View style={styles.zhCharLead}>
                                <Text selectable style={[styles.zhCharGlyph, { color: palette.text }]}>{ch}</Text>
                                {primary?.pinyin ? (
                                    <Text selectable style={[styles.zhCharPinyin, { color: palette.text }]}>
                                        {primary.pinyin}
                                    </Text>
                                ) : null}
                            </View>
                            <View style={styles.zhCharSenses}>
                                {senses.length > 0 ? (
                                    renderZhSenses(senses, palette.secondaryText)
                                ) : (
                                    <Text style={[styles.zhSenseText, { color: palette.emptyText }]}>
                                        {isLoading ? '…' : t('lookup.noDictionaryEntry')}
                                    </Text>
                                )}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </View>
        );
    };

    const renderPrimaryEntry = ({
        key,
        word,
        hanja,
        definition,
        gloss,
        pos,
        romanization,
        ipa,
        pinyin,
        simplified,
        traditional,
        audioUs,
        audioUk,
        showMore,
        showLess,
        onMore,
        onLess,
        extraEntries,
        separated,
        fallbackLanguage = null,
    }) => {
        const posLabel = toSentenceCase(formatPos(pos, t));

        // Chinese keeps pinyin in the heading (to the right of the character); when a
        // word has several readings with different meanings, each reading carries its
        // own pinyin in the body rows instead, so the heading shows none.
        const zhData = isChineseBook
            ? getChineseReadingsData(cleanValue(word), pinyin, definition)
            : null;
        const zhHeadingPinyin = zhData && !zhData.rowLayout
            ? (zhData.distinctPinyins.join(' / ') || null)
            : null;
        const headingPinyin = isChineseBook ? zhHeadingPinyin : pinyin;

        return (
            <View key={key} style={[styles.primaryEntry, separated && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                {renderEntryHeading({
                    word,
                    hanja,
                    definition,
                    pos,
                    romanization,
                    ipa,
                    pinyin: headingPinyin,
                    simplified,
                    traditional,
                    audioUs,
                    audioUk,
                })}
                {fallbackLanguage ? (
                    // KRDICT was unavailable for the interface language, so these
                    // are the bundled English senses (not cached; a later lookup
                    // fetches the real translation).
                    <Text
                        style={[styles.fallbackNotice, { color: palette.mutedText }]}
                        accessibilityRole="text"
                    >
                        {t('lookup.englishFallbackNotice')}
                    </Text>
                ) : null}
                {isChineseBook ? (
                        <View style={styles.zhBody}>
                            {renderChineseBody(zhData)}
                            {isPanelExpanded ? renderChineseCharacterBreakdown(cleanValue(word)) : null}
                        </View>
                    ) : (
                    isEnglishBook ? (
                        <>
                            <View style={[styles.definitionRow, !posLabel && styles.definitionRowSolo]}>
                                {posLabel ? (
                                    <View style={[styles.posBadge, { borderColor: colors.border }]}>
                                        <Text style={[styles.posBadgeText, { color: colors.textMuted }]}>
                                            {posLabel}
                                        </Text>
                                    </View>
                                ) : null}
                                {gloss ? (
                                    <Text selectable style={[styles.definitionText, { color: palette.text }]}>
                                        {gloss}
                                    </Text>
                                ) : null}
                            </View>
                            {definition ? renderEnglishSenses(definition) : (
                                // A name is complete with its transliteration.
                                cleanValue(pos) === 'name' && gloss ? null : (
                                    <Text selectable style={[styles.emptyDefinition, { color: palette.emptyText }]}>
                                        {t('lookup.noDictionaryEntry')}
                                    </Text>
                                )
                            )}
                            {isPanelExpanded && showLess ? renderExtraDefinitions(extraEntries) : null}
                        </>
                    ) : (
                    <>
                        <View style={[styles.definitionRow, !posLabel && styles.definitionRowSolo]}>
                            {posLabel ? (
                                <View style={[styles.posBadge, { borderColor: colors.border }]}>
                                    <Text style={[styles.posBadgeText, { color: colors.textMuted }]}>
                                        {posLabel}
                                    </Text>
                                </View>
                            ) : null}
                            {definition ? (
                                <Text selectable style={[styles.definitionText, { color: palette.text }]}>
                                    {definition}
                                </Text>
                            ) : (
                                <Text selectable style={[styles.emptyDefinition, { color: palette.emptyText }]}>
                                    {t('lookup.noDictionaryEntry')}
                                </Text>
                            )}
                        </View>
                        {isPanelExpanded && showLess ? renderExtraDefinitions(extraEntries) : null}
                    </>
                    ))}
            </View>
        );
    };

    // An English entry's senses arrive one per line; numbered when there are
    // several, like a learner's dictionary.
    const renderEnglishSenses = (definition, style = styles.englishSenseText, color = palette.secondaryText) => {
        const senses = String(definition).split('\n').map(cleanValue).filter(Boolean);
        if (senses.length <= 1) {
            return (
                <Text selectable style={[style, { color }]}>
                    {senses[0] || definition}
                </Text>
            );
        }
        return (
            <View style={styles.englishSenses}>
                {senses.map((sense, index) => (
                    <Text key={`${index}-${sense}`} selectable style={[style, { color }]}>
                        {`${index + 1}. ${sense}`}
                    </Text>
                ))}
            </View>
        );
    };

    const renderDefinitionLoadingPanel = () => {
        const loadingWord = cleanValue(lookupWord) || tappedSurface;

        return (
            <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
                <View style={styles.definitionLoadingContent}>
                    {loadingWord ? (
                        <View style={styles.definitionLoadingHeadword}>
                            <Text
                                selectable
                                style={[styles.entryWord, styles.definitionLoadingWord, { color: palette.text }]}
                            >
                                {loadingWord}
                            </Text>
                        </View>
                    ) : null}
                    <View style={styles.definitionLoadingArea}>
                        <LookupLoadingSkeleton
                            firstLineOffset={0}
                            secondLineOffset={10}
                            shortLineWidth="66%"
                        />
                    </View>
                </View>
                {/* Same height as the action row, so the panel doesn't jump when
                    the entry arrives. */}
                <View style={styles.actionRowPlaceholder} />
            </View>
        );
    };

    // Not-found panel. Mirrors renderDictionaryPanel's structure so the header
    // lives inside a ScrollView while the action row stays pinned below. Without this the content overflowed the fixed
    // sheet height, clipping the word header at the top with no way to scroll.
    const renderNotFoundPanel = () => (
        <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
            <ScrollView
                ref={dictionaryScrollRef}
                style={styles.dictionaryScroll}
                contentContainerStyle={[
                    styles.notFoundScrollContent,
                    styles.notFoundScrollContentCentered,
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
                {renderDrilldownBackRow()}
                {renderHeadwordText(lookupWord, [styles.entryWord, styles.notFoundWord, { color: palette.text }])}
                {/* A failed request is not the same as "no entry": say so. */}
                <Text style={[styles.notFoundSubtext, { color: colors.textSubtle }]}>
                    {liveError ? t('lookup.dictionaryFailed') : t('lookup.noDefinition')}
                </Text>
            </ScrollView>
            {renderNotFoundActionRow(lookupWord)}
        </View>
    );

    if (cachedResults === null) {
        return renderDefinitionLoadingPanel();
    }

    if (cachedResults.length === 0 && !needsLiveFetch && lookupItemCount === 0) {
        return renderNotFoundPanel();
    }

    if (needsLiveFetch && !liveError && (isLiveLoading || (dictionaryData.length === 0 && lookupItemCount === 0))) {
        return renderDefinitionLoadingPanel();
    }

    if (!activeLookupItem) {
        return renderNotFoundPanel();
    }

    const cachedEntry = activeLookupItem.cachedEntry;
    const liveEntries = activeLookupItem.liveEntries || [];
    const firstLiveEntry = liveEntries[0];

    if (cachedEntry) {
        const stem = getEntryWord(cachedEntry, activeLookupItem.stem || lookupWord);
        const liveMeta = liveEntryMeta[cachedEntry.stem] || firstLiveEntry || {};
        const extra = extraDefs[cachedEntry.stem];
        const isExpanded = !!expandedCached[cachedEntry.stem];
        const showMore = Array.isArray(extra) && extra.length > 0 && !isExpanded;
        const showLess = isExpanded && Array.isArray(extra) && extra.length > 0;
        const cachedHanja = getEntryHanja(cachedEntry);
        const cachedDefinition = getEntryDefinition(cachedEntry);

        return (
            renderDictionaryPanel(
                <>
                {renderPrimaryEntry({
                    key: `${stem}-${cachedEntry.hanja ?? ''}`,
                    word: stem,
                    hanja: cachedHanja,
                    definition: cachedDefinition,
                    gloss: getEntryGloss(cachedEntry) || getEntryGloss(liveMeta),
                    pos: getEntryPos(cachedEntry) || getEntryPos(liveMeta),
                    romanization: romanizations[stem] || getEntryRomanization(liveMeta),
                    ipa: getEntryIpa(cachedEntry) || getEntryIpa(liveMeta),
                    pinyin: getEntryPinyin(cachedEntry) || getEntryPinyin(liveMeta),
                    simplified: getEntrySimplified(cachedEntry) || getEntrySimplified(liveMeta),
                    traditional: getEntryTraditional(cachedEntry) || getEntryTraditional(liveMeta),
                    audioUs: getEntryAudioUs(cachedEntry) || getEntryAudioUs(liveMeta),
                    audioUk: getEntryAudioUk(cachedEntry) || getEntryAudioUk(liveMeta),
                    showMore,
                    showLess,
                    onMore: () => setExpandedCached(prev => ({ ...prev, [cachedEntry.stem]: true })),
                    onLess: () => setExpandedCached(prev => ({ ...prev, [cachedEntry.stem]: false })),
                    extraEntries: extra,
                    separated: false,
                })}

                {isKoreanBook && isPanelExpanded ? (
                <HanjaDetails
                    hanja={currentHanja?.character ?? getHanjaCharacters(cachedHanja)[0] ?? null}
                    hanjaCharacters={currentHanja?.characters?.length ? currentHanja.characters : getHanjaCharacters(cachedHanja)}
                    sourceWord={currentHanja?.sourceWord ?? stem}
                    sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
                    onKnownWordMarked={handleRelatedKnownWordMarked}
                    onKnownWordRemoved={handleRelatedKnownWordRemoved}
                    onSourceWordAutoSaved={handleSourceWordAutoSaved}
                    onCarouselIndexChange={scrollDictionaryToTop}
                    isDarkMode={isDarkMode}
                />
                ) : null}
                </>
                ,
                { word: stem, hanja: cachedHanja, definition: cachedDefinition }
            )
        );
    }

    const word = activeLookupItem.stem || lookupWord;
    const first = firstLiveEntry;
    const isExpanded = expandedWords.includes(word);
    const extraEntries = first ? uniqueEntriesByWord(liveEntries.slice(1), first?.word || word) : [];
    const liveHanja = getEntryHanja(first);
    const liveDefinition = getEntryDefinition(first);
    const liveWord = first ? (cleanValue(first.word) || word) : word;

    return renderDictionaryPanel(
        <>
            {first ? renderPrimaryEntry({
                key: `${word}-${first.origin ?? ''}`,
                word: cleanValue(first.word) || word,
                hanja: getEntryHanja(first),
                definition: getEntryDefinition(first),
                gloss: getEntryGloss(first),
                pos: getEntryPos(first),
                romanization: romanizations[word] || getEntryRomanization(first),
                ipa: getEntryIpa(first),
                pinyin: getEntryPinyin(first),
                simplified: getEntrySimplified(first),
                traditional: getEntryTraditional(first),
                audioUs: getEntryAudioUs(first),
                audioUk: getEntryAudioUk(first),
                showMore: extraEntries.length > 0 && !isExpanded,
                showLess: extraEntries.length > 0 && isExpanded,
                onMore: () => setExpandedWords(prev => [...prev, word]),
                onLess: () => setExpandedWords(prev => prev.filter(item => item !== word)),
                extraEntries,
                separated: false,
                fallbackLanguage: getEntryFallbackLanguage(first, interfaceLanguage),
            }) : renderPrimaryEntry({
                key: `${word}-empty`,
                word,
                hanja: '',
                definition: '',
                gloss: '',
                pos: '',
                romanization: romanizations[word],
                ipa: '',
                pinyin: '',
                audioUs: '',
                audioUk: '',
                showMore: false,
                showLess: false,
                separated: false,
            })}

            {isKoreanBook && isPanelExpanded ? (
            <HanjaDetails
                hanja={currentHanja?.character ?? getHanjaCharacters(liveHanja)[0] ?? null}
                hanjaCharacters={currentHanja?.characters?.length ? currentHanja.characters : getHanjaCharacters(liveHanja)}
                sourceWord={currentHanja?.sourceWord ?? word}
                sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
                onKnownWordMarked={handleRelatedKnownWordMarked}
                onKnownWordRemoved={handleRelatedKnownWordRemoved}
                onSourceWordAutoSaved={handleSourceWordAutoSaved}
                onCarouselIndexChange={scrollDictionaryToTop}
                isDarkMode={isDarkMode}
            />
            ) : null}
        </>
        ,
        { word: liveWord, hanja: liveHanja, definition: liveDefinition }
    );
};

const createStyles = (colors) => StyleSheet.create({
    panelContent: {
        // No flex: 1. The sheet has no fixed height, so the panel hugs its
        // content and only shrinks (the body then scrolls) at the sheet's ceiling.
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    dictionaryPanelContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        position: 'relative',
    },
    dictionaryScroll: {
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
    },
    dictionaryScrollContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    dictionaryScrollContentWithNav: {
        paddingHorizontal: 0,
    },
    primaryEntry: {
        gap: 8,
        paddingHorizontal: 22,
        paddingTop: 6,
        paddingBottom: 0,
    },
    entryHeading: {
        gap: 4,
    },
    headwordRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headwordChevronButton: {
        width: 24,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    entryHeadingTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    entryTitleColumn: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
    },
    wordLine: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'center',
        flexWrap: 'wrap',
        columnGap: 10,
        rowGap: 0,
        paddingTop: 0,
    },
    entryWord: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 30,
        lineHeight: 40,
        letterSpacing: 0,
        paddingTop: 0,
        includeFontPadding: true,
    },
    entryHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 18,
        lineHeight: 24,
    },
    entryMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontStyle: 'italic',
        fontSize: 14,
        lineHeight: 20,
        marginTop: 0,
        textAlign: 'left',
    },
    // Upright: IPA symbols (ˈ ɛ ɹ) fall back to another font, and Android
    // measures an italic fallback run too narrow and clips it.
    ipaText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        marginRight: 4,
    },
    entryMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        marginTop: 0,
        flexWrap: 'wrap',
    },
    pronunciationControls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    pronunciationAccentButton: {
        minWidth: 42,
        height: 22,
        borderRadius: 6,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 3,
        paddingHorizontal: 6,
    },
    pronunciationAccentText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 11,
        lineHeight: 13,
        letterSpacing: 0,
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
    actionRow: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 0,
    },
    actionButtonGroup: {
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        flex: 1,
        minWidth: 0,
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
        backgroundColor: colors.readerSurface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
    },
    actionButtonActive: {
        backgroundColor: colors.readerTappedWordBg,
        borderColor: colors.readerTappedWordBg,
    },
    actionButtonDisabled: {
        opacity: 0.5,
    },
    actionButtonIcon: {
        marginRight: 6,
    },
    actionLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 14,
        lineHeight: 18,
        letterSpacing: 0,
        flexShrink: 1,
    },
    actionRowPlaceholder: {
        height: 62,
    },
    definitionLoadingContent: {
        paddingHorizontal: 22,
        paddingTop: 6,
        gap: 12,
    },
    definitionLoadingHeadword: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    definitionLoadingWord: {
        textAlign: 'center',
    },
    definitionLoadingArea: {
        minHeight: 36,
    },
    posBadge: {
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.transparent,
    },
    posBadgeText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 12,
        lineHeight: 15,
        letterSpacing: 0,
    },
    definitionText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 17,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: 'center',
        // No flexShrink: when the definition can't share the badge's line it wraps
        // as a whole to the next row, then wraps internally within the full width.
        maxWidth: '100%',
    },
    definitionRow: {
        // A wrapping, centered row: the POS badge and definition sit side by side
        // when they fit; a definition too long to share the line wraps as a whole
        // to the next row under the badge (see definitionText.maxWidth).
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingHorizontal: 0,
        paddingVertical: 2,
    },
    definitionRowSolo: {
        justifyContent: 'center',
    },
    // --- Chinese readings body ---
    // Keep the characters intact (never break between them) so the pinyin, not the
    // word, is what wraps to a new line when space is tight.
    zhEntryWord: {
        flexShrink: 0,
    },
    // Pinyin sits inline to the right of the character in the heading: a clean sans
    // face, non-italic, sized to sit on the character's baseline.
    zhHeadingPinyin: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 24,
        fontStyle: 'normal',
        letterSpacing: 0.2,
        textAlign: 'left',
    },
    zhBody: {
        width: '100%',
        paddingTop: 4,
        paddingBottom: 2,
    },
    zhSingleReading: {
        width: '100%',
    },
    // Pinyin: a clean sans face (tone diacritics stay legible) at a comfortable size,
    // rather than the small display-italic used for Korean romanization.
    zhInlinePinyin: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 17,
        lineHeight: 24,
        letterSpacing: 0.2,
        textAlign: 'center',
        marginBottom: 8,
    },
    zhSenseList: {
        width: '100%',
        gap: 5,
    },
    zhSenseItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        paddingHorizontal: 4,
    },
    zhSenseNumber: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 22,
        minWidth: 16,
    },
    zhSenseText: {
        flex: 1,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 22,
        letterSpacing: 0,
    },
    // Row-per-reading layout for heteronyms with distinct meanings.
    zhReadingList: {
        width: '100%',
    },
    zhReadingRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 9,
    },
    zhReadingLead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
        minWidth: 78,
        flexShrink: 0,
    },
    zhReadingChar: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 20,
        lineHeight: 26,
    },
    zhReadingPinyin: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 15,
        lineHeight: 24,
        letterSpacing: 0.2,
    },
    zhReadingSenses: {
        flex: 1,
    },
    // Per-character breakdown revealed on expand: a titled section with one row per
    // glyph (character + pinyin on the left, senses on the right).
    zhCharSection: {
        width: '100%',
        gap: 4,
        paddingTop: spacing.sm,
        marginTop: spacing.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    zhCharSectionTitle: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 0,
        color: colors.textTertiary,
        marginBottom: 2,
    },
    zhHeadwordChars: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 3,
    },
    zhHeadwordChar: {
        alignItems: 'center',
    },
    zhHeadwordCharPressed: {
        opacity: 0.5,
    },
    zhHeadwordGap: {
        marginHorizontal: 2,
    },
    // A dotted underline under each tappable character (Android draws
    // textDecorationStyle 'dotted' solid, so the dots are views).
    headwordDots: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignSelf: 'stretch',
        marginHorizontal: 3,
        marginTop: -2,
    },
    headwordDot: {
        width: 2.5,
        height: 2.5,
        borderRadius: 1.25,
    },
    zhCharRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 9,
    },
    zhCharLead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
        minWidth: 78,
        flexShrink: 0,
    },
    zhCharGlyph: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 22,
        lineHeight: 28,
    },
    zhCharPinyin: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 15,
        lineHeight: 24,
        letterSpacing: 0.2,
    },
    zhCharSenses: {
        flex: 1,
    },
    drilldownBackRow: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingHorizontal: 8,
        paddingVertical: 5,
        marginBottom: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    drilldownBackText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
    },
    englishSenses: {
        alignSelf: 'stretch',
        gap: 4,
        marginTop: spacing.xs,
    },
    englishSenseText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 21,
        letterSpacing: 0,
        textAlign: 'left',
    },
    emptyDefinition: {
        ...textStyles.body,
        fontStyle: 'italic',
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
    extraMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15,
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
    notFoundScrollContent: {
        paddingHorizontal: 22,
        paddingTop: 6,
        gap: 6,
    },
    notFoundScrollContentCentered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    notFoundWord: {
        textAlign: 'center',
        alignSelf: 'stretch',
    },
    notFoundSubtext: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
    fallbackNotice: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 16,
        fontStyle: 'italic',
    },
});

export default React.memo(DictionaryContent);
