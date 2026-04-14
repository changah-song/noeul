import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import axios from 'axios';
import { KOREAN_DICTIONARY_CLIENT_ID } from '@env';
import koreanDictionary from '../../../services/api/koreanDictionary';
import stemWord from '../../../services/api/stemWord';
import { AntDesign } from '@expo/vector-icons';
import { insertData, removeData, lookupCacheByStems, insertCacheEntries } from '../../../services/Database';
import HanjaDetails from './HanjaDetails';

// Stems that are too generic / grammatically functional to be worth looking up.
// Uncomment entries once confirmed with the user.
const STOP_STEMS = new Set([
    '하다',   // to do — confirmed
    '되다',  // to become — auxiliary/passive marker
    '있다',  // to exist/have — pure function word
    '없다',  // to not exist/not have — pure function word
    '이다',  // copula "to be"
    '아니다', // "to not be"
    '같다',  // "to be like" — used as hedge (것 같다)
    '보다',  // "to see" / comparison auxiliary
]);

/**
 * DictionaryContent
 *
 * Cache-first lookup flow:
 *   1. Stem the tapped word via the Python backend (stemWord API)
 *   2. Query local dictionary_cache for all returned stems in one SQL call
 *   3a. Cache hit  → display instantly, no KRDICT network call needed
 *   3b. Cache miss → show loading shimmer, fall back to live koreanDictionary API
 *
 * "More" button (cached path): fires a live KRDICT call on demand to fetch
 * additional definitions beyond the single entry stored in the local cache.
 * Results are shown inline but not persisted locally (too much data).
 */
const DictionaryContent = ({ highlightedWord, onContentLoaded, onWordSave, onWordUnsave }) => {

    const [expandedWords, setExpandedWords] = useState([]);
    const [savedWords, setSavedWords] = useState({});
    const [stemWordList, setStemWordList] = useState([]);

    // ── Cache-first state ────────────────────────────────────────────────────
    // null  = still loading
    // []    = stems found but none in cache (fall back to live API)
    // [...] = cached results ready to display
    const [cachedResults, setCachedResults] = useState(null);
    const [needsLiveFetch, setNeedsLiveFetch] = useState(false);

    // ── "More" state for cached path ─────────────────────────────────────────
    // extraDefs[stem]:
    //   undefined       — prefetch not yet started
    //   'prefetching'   — silent background fetch in progress (no UI indicator)
    //   []              — only one definition exists → hide "more"
    //   [{...}...]      — extra entries pre-loaded → show "more"
    const [extraDefs, setExtraDefs] = useState({});
    const [expandedCached, setExpandedCached] = useState({});

    // Hanja modal
    const [currentHanja, setCurrentHanja] = useState(null);
    const handleHanjaPress = (hanja) => setCurrentHanja(hanja);

    // ── Step 1: Stem the tapped word ─────────────────────────────────────────
    useEffect(() => {
        setCachedResults(null);
        setNeedsLiveFetch(false);
        setStemWordList([]);
        setExtraDefs({});
        setExpandedCached({});

        if (!highlightedWord) return;

        // Skip API call for non-Korean input (numbers, Latin, punctuation)
        const hasKorean = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(highlightedWord);
        if (!hasKorean) {
            setCachedResults([]);
            onContentLoaded?.();
            return;
        }

        const fetchStems = async () => {
            const result = await stemWord({ query: highlightedWord });
            const filtered = result.filter(stem => !STOP_STEMS.has(stem));
            setStemWordList(filtered);
            if (filtered.length === 0) {
                setCachedResults([]);
                onContentLoaded?.();
            }
        };
        fetchStems();
    }, [highlightedWord]);

    // ── Step 2: Cache lookup ──────────────────────────────────────────────────
    useEffect(() => {
        if (stemWordList.length === 0) return;

        const checkCache = async () => {
            const hits = await lookupCacheByStems(stemWordList);

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
                console.log(`[DictionaryContent] Cache miss — falling back to live KRDICT`);
                setCachedResults([]);
                setNeedsLiveFetch(true);
            }
        };
        checkCache();
    }, [stemWordList]);

    // ── Step 3b: Live KRDICT fetch (cache miss fallback) ─────────────────────
    const { dictionaryData } = koreanDictionary({ query: needsLiveFetch ? stemWordList : [] });

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
                    pos: null,
                    domain: null,
                };
            })
            .filter(Boolean);

        if (entries.length > 0) {
            console.log(`[DictionaryContent] Writing ${entries.length} live result(s) back to cache`);
            insertCacheEntries(entries);
        }

        onContentLoaded?.();
    }, [dictionaryData, needsLiveFetch]);

    // ── Background prefetch for cached path ──────────────────────────────────
    // Silently fetches all KRDICT entries when a cached result is displayed so
    // we know upfront whether "more" should show. No loading indicator is shown.
    const prefetchExtra = async (stem) => {
        setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
        try {
            const response = await axios.get('https://krdict.korean.go.kr/api/search', {
                params: {
                    key: KOREAN_DICTIONARY_CLIENT_ID,
                    q: stem,
                    sort: 'popular',
                    translated: 'y',
                    trans_lang: '1',
                },
                timeout: 10000,
            });
            const XMLParser = require('react-xml-parser');
            const xml = new XMLParser().parseFromString(response.data);
            const items = xml.getElementsByTagName('item');
            const entries = items.map(item => ({
                word: item.getElementsByTagName('word')[0].value,
                origin: item.getElementsByTagName('origin')[0]?.value || 'N/A',
                transWord: (item.getElementsByTagName('trans_word')[0]?.value || 'N/A').replace(/[\^>]+$/, '').trim(),
            }));
            setExtraDefs(prev => ({ ...prev, [stem]: entries.slice(1) }));
        } catch {
            // Silent failure — hide "more" if we can't reach KRDICT
            setExtraDefs(prev => ({ ...prev, [stem]: [] }));
        }
    };

    // Trigger a prefetch for each cached entry with a definition as soon as results arrive
    useEffect(() => {
        if (!cachedResults || cachedResults.length === 0) return;
        cachedResults.forEach(entry => {
            if (entry.definition && extraDefs[entry.stem] === undefined) {
                prefetchExtra(entry.stem);
            }
        });
    }, [cachedResults]);

    // Tapping "more" just expands — data is already pre-loaded
    const handleMorePress = (stem) => {
        setExpandedCached(prev => ({ ...prev, [stem]: true }));
    };

    // ── User interaction handlers ─────────────────────────────────────────────
    const toggleSave = async (word, origin, definition) => {
        const key = `${word}|${origin}|${definition}`;
        setSavedWords(prev => ({ ...prev, [key]: true }));
        insertData(word, origin, definition, "unorganized");
        onWordSave?.(word);
    };

    const toggleUnSave = async (word, origin, definition) => {
        const key = `${word}|${origin}|${definition}`;
        setSavedWords(prev => { const u = { ...prev }; delete u[key]; return u; });
        removeData(word, origin, definition);
        onWordUnsave?.(word);
    };

    const isWordSaved = (word, origin, definition) =>
        savedWords[`${word}|${origin}|${definition}`] === true;

    // ── Loading shimmer ───────────────────────────────────────────────────────
    if (cachedResults === null) {
        return (
            <View style={styles.shimmerContainer}>
                <ActivityIndicator size="small" color="#888" />
                <Text style={styles.shimmerText}>Looking up...</Text>
            </View>
        );
    }

    // ── No lookup available ───────────────────────────────────────────────────
    if (cachedResults.length === 0 && !needsLiveFetch) {
        return (
            <View style={styles.noLookupContainer}>
                <Text style={styles.noLookupText}>no lookup available</Text>
            </View>
        );
    }

    // ── Cached results ────────────────────────────────────────────────────────
    if (cachedResults.length > 0) {
        return (
            <ScrollView>
                {cachedResults.map((entry, index) => {
                    const extra = extraDefs[entry.stem];
                    const isExpanded = !!expandedCached[entry.stem];
                    // Show "more" only once we've confirmed extra entries exist and aren't expanded
                    const showMore = Array.isArray(extra) && extra.length > 0 && !isExpanded;
                    const showLess = isExpanded && Array.isArray(extra) && extra.length > 0;

                    return (
                        <View key={index}>
                            <TouchableOpacity
                                onPress={() =>
                                    isWordSaved(entry.stem, entry.hanja, entry.definition)
                                        ? toggleUnSave(entry.stem, entry.hanja, entry.definition)
                                        : toggleSave(entry.stem, entry.hanja, entry.definition)
                                }
                                style={styles.save}
                            >
                                <AntDesign
                                    name={isWordSaved(entry.stem, entry.hanja, entry.definition)
                                        ? "checksquare" : "checksquareo"}
                                    size={15} color="black"
                                />
                            </TouchableOpacity>

                            {/* Primary definition row — more/less/loading inline at the end */}
                            <View style={styles.content}>
                                {entry.definition ? (
                                    <>
                                        <Text style={{ fontWeight: 'bold' }}>{entry.stem}</Text>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <Text style={{ marginHorizontal: 5 }}>(</Text>
                                            {(entry.hanja && entry.hanja !== 'N/A'
                                                ? entry.hanja.split('')
                                                : []
                                            ).map((hanja, i) => (
                                                <TouchableOpacity key={i} onPress={() => handleHanjaPress(hanja)}>
                                                    <Text>{hanja}</Text>
                                                </TouchableOpacity>
                                            ))}
                                            <Text style={{ marginHorizontal: 5 }}>)</Text>
                                            <Text>{entry.definition}</Text>
                                            {showLess ? (
                                                <TouchableOpacity onPress={() => setExpandedCached(prev => ({ ...prev, [entry.stem]: false }))}>
                                                    <Text style={styles.moreLink}>less</Text>
                                                </TouchableOpacity>
                                            ) : showMore ? (
                                                <TouchableOpacity onPress={() => handleMorePress(entry.stem)}>
                                                    <Text style={styles.moreLink}>more</Text>
                                                </TouchableOpacity>
                                            ) : null}
                                        </View>
                                    </>
                                ) : (
                                    <Text style={{ color: '#494949' }}>
                                        <Text style={{ fontWeight: 'bold', color: 'black' }}>{entry.stem}</Text> [ no dictionary entry ]
                                    </Text>
                                )}
                            </View>

                            {/* Expanded extra definitions — each on its own row */}
                            {isExpanded && Array.isArray(extra) && extra.map((e, i) => (
                                <View key={i} style={styles.extraRow}>
                                    <TouchableOpacity
                                        onPress={() =>
                                            isWordSaved(e.word, e.origin, e.transWord)
                                                ? toggleUnSave(e.word, e.origin, e.transWord)
                                                : toggleSave(e.word, e.origin, e.transWord)
                                        }
                                        style={styles.saveExtra}
                                    >
                                        <AntDesign
                                            name={isWordSaved(e.word, e.origin, e.transWord) ? "checksquare" : "checksquareo"}
                                            size={13} color="black" style={{ opacity: 0.5 }}
                                        />
                                    </TouchableOpacity>
                                    <View style={styles.extraContent}>
                                        <Text style={{ color: '#333' }}>{e.word}</Text>
                                        <Text style={{ marginHorizontal: 4 }}>(</Text>
                                        {(e.origin && e.origin !== 'N/A' ? e.origin.split('') : []).map((h, j) => (
                                            <TouchableOpacity key={j} onPress={() => handleHanjaPress(h)}>
                                                <Text>{h}</Text>
                                            </TouchableOpacity>
                                        ))}
                                        <Text style={{ marginHorizontal: 4 }}>)</Text>
                                        <Text style={{ color: '#333' }}>{e.transWord}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    );
                })}

                <HanjaDetails hanja={currentHanja} handleHanjaPress={handleHanjaPress} />
            </ScrollView>
        );
    }

    // ── Live KRDICT fallback ──────────────────────────────────────────────────
    return (
        <ScrollView>
            {stemWordList.map((word, index) => (
                <View key={index}>
                    {dictionaryData[index] && dictionaryData[index].length > 0 ? (
                        <>
                            <TouchableOpacity
                                onPress={() =>
                                    isWordSaved(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord)
                                        ? toggleUnSave(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord)
                                        : toggleSave(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord)
                                }
                                style={styles.save}
                            >
                                <AntDesign
                                    name={isWordSaved(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord)
                                        ? "checksquare" : "checksquareo"}
                                    size={15} color="black"
                                />
                            </TouchableOpacity>

                            <View style={styles.content}>
                                <Text style={{ fontWeight: 'bold' }}>{word}</Text>
                                <View style={{ flexDirection: 'row' }}>
                                    <Text style={{ marginHorizontal: 5 }}>(</Text>
                                    {dictionaryData[index][0].origin.split('').map((hanja, i) => (
                                        <TouchableOpacity key={i} onPress={() => handleHanjaPress(hanja)}>
                                            <Text>{hanja}</Text>
                                        </TouchableOpacity>
                                    ))}
                                    <Text style={{ marginHorizontal: 5 }}>)</Text>
                                    <Text>{dictionaryData[index][0].transWord}</Text>
                                </View>
                                {dictionaryData[index].length > 1 ? (
                                    <TouchableOpacity onPress={() =>
                                        setExpandedWords(prev =>
                                            prev.includes(word) ? prev.filter(w => w !== word) : [...prev, word]
                                        )
                                    }>
                                        <Text style={styles.moreLink}>
                                            {expandedWords.includes(word) ? 'less' : 'more'}
                                        </Text>
                                    </TouchableOpacity>
                                ) : null}
                            </View>

                            {expandedWords.includes(word) &&
                                dictionaryData[index].slice(1).map((entry, i) => (
                                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                        <TouchableOpacity
                                            onPress={() =>
                                                isWordSaved(entry.word, entry.origin, entry.transWord)
                                                    ? toggleUnSave(entry.word, entry.origin, entry.transWord)
                                                    : toggleSave(entry.word, entry.origin, entry.transWord)
                                            }
                                            style={styles.saveExtra}
                                        >
                                            <AntDesign
                                                name={isWordSaved(entry.word, entry.origin, entry.transWord)
                                                    ? "checksquare" : "checksquareo"}
                                                size={13} color="black" style={{ opacity: 0.5 }}
                                            />
                                        </TouchableOpacity>
                                        <View style={styles.extraContent}>
                                            <Text>{entry.word}</Text>
                                            <Text style={{ marginHorizontal: 4 }}>(</Text>
                                            {entry.origin.split('').map((hanja, i) => (
                                                <TouchableOpacity key={i} onPress={() => handleHanjaPress(hanja)}>
                                                    <Text>{hanja}</Text>
                                                </TouchableOpacity>
                                            ))}
                                            <Text style={{ marginHorizontal: 4 }}>)</Text>
                                            <Text>{entry.transWord}</Text>
                                        </View>
                                    </View>
                                ))
                            }
                        </>
                    ) : (
                        <Text style={{ color: '#494949' }}>
                            <Text style={{ fontWeight: 'bold', color: 'black' }}>{word}</Text> [ no dictionary entry ]
                        </Text>
                    )}
                </View>
            ))}

            <HanjaDetails hanja={currentHanja} handleHanjaPress={handleHanjaPress} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    shimmerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 10,
        paddingTop: 4,
    },
    shimmerText: {
        marginLeft: 8,
        color: '#888',
        fontSize: 14,
    },
    noLookupContainer: {
        paddingLeft: 10,
        paddingTop: 6,
    },
    noLookupText: {
        color: '#aaa',
        fontStyle: 'italic',
        fontSize: 13,
    },
    moreLink: {
        color: '#3D62A2',
        textDecorationLine: 'underline',
        marginLeft: 5,
        fontSize: 13,
    },
    offlineText: {
        color: '#aaa',
        fontStyle: 'italic',
        fontSize: 12,
        marginLeft: 5,
        marginTop: 2,
    },
    save: {
        position: 'absolute',
        top: 3,
        left: 5,
        justifyContent: 'center',
        alignItems: 'center',
    },
    saveExtra: {
        marginRight: 4,
    },
    content: {
        left: 25,
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    extraContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        flex: 1,
    },
    moreRow: {
        left: 25,
        marginTop: 2,
        marginBottom: 2,
    },
    extraRow: {
        flexDirection: 'row',
        alignItems: 'center',
        left: 35,
        marginTop: 3,
        paddingRight: 35,
    },
});

export default DictionaryContent;
