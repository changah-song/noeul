import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';

import BookWordSection from '../components/Learn/BookWordSection';
import Flashcard from '../components/Learn/Flashcard';
import { Card, Screen, SectionHeader } from '../components/ui';
import {
  removeData,
  clearVocabEncountersForEntry,
  recordReviewOutcome,
  updateVocabLearningState,
  updatePriority,
  updateFavorite,
  updateLevel,
  getVocabularyHomeData,
} from '../services/Database';
import { incrementWordsStudied } from '../services/dailyProgress';
import {
  deleteUserVocabEntry,
  supabase,
  updateUserVocabStatus,
  upsertUserVocabEntry,
} from '../services/supabase';
import { colors, radii, spacing, textStyles } from '../theme';

const STATUS_ORDER = ['unorganized', 'bad', 'mid', 'good'];
const PRIORITY_ORDER = ['low', 'normal', 'high'];
const DEFAULT_SORT_MODE = 'recently-seen';

const SORT_MODES = [
  { key: 'recently-seen', label: 'Recently seen' },
  { key: 'newest-saved', label: 'Newest saved' },
  { key: 'encounters-high', label: 'Most seen' },
  { key: 'encounters-low', label: 'Least seen' },
  { key: 'needs-exposure', label: 'Needs exposure' },
  { key: 'alphabetical', label: 'A-Z' },
];

const MATURITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'growing', label: 'Growing' },
  { key: 'familiar', label: 'Familiar' },
  { key: 'mature', label: 'Mature' },
  { key: 'graduated', label: 'Graduated' },
];

const cycleStatus = (currentStatus) => {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  if (currentIndex === -1) {
    return STATUS_ORDER[0];
  }

  return STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];
};

const cyclePriority = (currentPriority) => {
  const currentIndex = PRIORITY_ORDER.indexOf(currentPriority);
  if (currentIndex === -1) {
    return PRIORITY_ORDER[1];
  }

  return PRIORITY_ORDER[(currentIndex + 1) % PRIORITY_ORDER.length];
};

const getExposureProgress = (row) => {
  if (row.maturity === 'graduated' || row.maturity === 'mature') {
    return 1;
  }

  if (row.maturity === 'familiar') {
    return 0.72;
  }

  if (row.maturity === 'growing') {
    return 0.44;
  }

  return Math.min((Number(row.encounter_count) || 0) / 9, 0.28);
};

const getSectionProgress = (rows) => {
  if (!rows.length) {
    return 0;
  }

  return rows.reduce((total, row) => total + getExposureProgress(row), 0) / rows.length;
};

const dateValue = (value) => {
  const time = new Date(value ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

const numberValue = (value) => Number(value) || 0;

const sortVocabularyRows = (rows, sortMode = DEFAULT_SORT_MODE) =>
  [...rows].sort((a, b) => {
    if (sortMode === 'recently-seen') {
      const diff = dateValue(b.last_encountered_at) - dateValue(a.last_encountered_at);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'newest-saved') {
      const diff = dateValue(b.created_at) - dateValue(a.created_at);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'encounters-high') {
      const diff = numberValue(b.encounter_count) - numberValue(a.encounter_count);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'encounters-low') {
      const diff = numberValue(a.encounter_count) - numberValue(b.encounter_count);
      if (diff !== 0) return diff;
    }

    if (sortMode === 'needs-exposure') {
      const diff = Number(Boolean(b.isLongTail)) - Number(Boolean(a.isLongTail));
      if (diff !== 0) return diff;
    }

    if (sortMode === 'alphabetical') {
      return (a.word ?? '').localeCompare(b.word ?? '');
    }

    return (a.word ?? '').localeCompare(b.word ?? '');
  });

const buildVocabularySections = (rows) => {
  const needsExposureWords = rows.filter((row) => row.isLongTail);
  const growingWords = rows.filter((row) =>
    row.maturity === 'new' ||
    row.maturity === 'growing' ||
    row.maturity === 'familiar'
  );
  const matureWords = rows.filter((row) =>
    row.maturity === 'mature' ||
    row.maturity === 'graduated'
  );
  const allWords = rows;

  return [
    {
      key: 'needs-exposure',
      title: 'Needs exposure',
      meta: 'Words that have not shown up naturally lately',
      practiceLabel: 'Review',
      progress: getSectionProgress(needsExposureWords),
      words: needsExposureWords,
    },
    {
      key: 'growing',
      title: 'Growing',
      meta: 'Words gaining strength through reading',
      practiceLabel: 'Practice',
      progress: getSectionProgress(growingWords),
      words: growingWords,
    },
    {
      key: 'mature',
      title: 'Mature',
      meta: 'Words you have seen enough to trust',
      practiceLabel: 'Practice',
      progress: getSectionProgress(matureWords),
      words: matureWords,
    },
    {
      key: 'all-words',
      title: 'All saved words',
      meta: `${rows.length} saved words`,
      practiceLabel: 'Practice',
      progress: getSectionProgress(allWords),
      words: allWords,
    },
  ];
};

const pluralize = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const getSourceUri = (word) => word.last_encounter_source_uri || word.source_book_uri || '';
const getSourceTitle = (word) => word.last_encounter_source_title || word.source_book_title || '';
const hasActiveFilters = (searchQuery, maturityFilter, sourceFilter) =>
  searchQuery.trim().length > 0 || maturityFilter !== 'all' || sourceFilter !== 'all';
const matchesQuery = (value, query) => String(value ?? '').toLowerCase().includes(query);
const isNonGraduated = (row) => row.maturity !== 'graduated';
const makeWordKey = (word) => `${word?.word ?? ''}::${word?.hanja ?? ''}::${word?.def ?? word?.definition ?? ''}`;

const findMatchingWord = (rows, target) => rows.find((row) => makeWordKey(row) === makeWordKey(target));

const formatDetailDate = (dateValue) => {
  if (!dateValue) {
    return 'Never';
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return 'Never';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getDetailSourceTitle = (word) =>
  word.last_encounter_source_title ||
  word.source_book_title ||
  'No source recorded';

const getReviewSummary = (word) => {
  const correct = numberValue(word.correct_count);
  const wrong = numberValue(word.wrong_count);
  const implicit = numberValue(word.implicit_review_count);

  return `${correct} easy/okay · ${wrong} hard · ${implicit} reading clears`;
};

const buildLongTailDeck = (rows) =>
  rows.filter((row) => row.isLongTail && isNonGraduated(row));

const buildWeakDeck = (rows) =>
  rows.filter((row) =>
    isNonGraduated(row) &&
    (
      row.level === 'bad' ||
      numberValue(row.wrong_count) > numberValue(row.correct_count)
    )
  );

const buildNewDeck = (rows) =>
  rows.filter((row) => row.maturity === 'new');

const buildSourceDeck = (rows, sourceUri) =>
  rows.filter((row) =>
    sourceUri &&
    (
      row.source_book_uri === sourceUri ||
      row.last_encounter_source_uri === sourceUri
    )
  );

const buildDefaultPracticeDeck = (rows) => rows.filter(isNonGraduated);

const Learn = () => {
  const [words, setWords] = useState([]);
  const [expandedSections, setExpandedSections] = useState({
    'needs-exposure': true,
    growing: true,
    mature: false,
    'all-words': false,
  });
  const [practiceDeck, setPracticeDeck] = useState(null);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [maturityFilter, setMaturityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortMode, setSortMode] = useState(DEFAULT_SORT_MODE);
  const [selectedWord, setSelectedWord] = useState(null);

  const fetchWords = useCallback(async () => {
    try {
      const data = await getVocabularyHomeData();
      const normalizedRows = data.map((row) => ({
        ...row,
        priority: row.priority ?? 'normal',
      }));
      setWords(normalizedRows);
      return normalizedRows;
    } catch (error) {
      console.error('[Learn] Error fetching vocab home data:', error);
      return [];
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchWords();
    }, [fetchWords])
  );

  const sourceOptions = useMemo(() => {
    const sources = new Map();

    words.forEach((word) => {
      const uri = getSourceUri(word);
      const title = getSourceTitle(word);

      if (uri && title) {
        sources.set(uri, title);
      }
    });

    return [
      { key: 'all', label: 'All sources' },
      ...Array.from(sources.entries()).map(([key, label]) => ({ key, label })),
    ];
  }, [words]);

  const filteredWords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return words.filter((word) => {
      const matchesSearch =
        !query ||
        matchesQuery(word.word, query) ||
        matchesQuery(word.hanja, query) ||
        matchesQuery(word.def, query);

      const matchesMaturity = maturityFilter === 'all' || word.maturity === maturityFilter;
      const matchesSource = sourceFilter === 'all' || getSourceUri(word) === sourceFilter;

      return matchesSearch && matchesMaturity && matchesSource;
    });
  }, [words, searchQuery, maturityFilter, sourceFilter]);

  const visibleWords = useMemo(
    () => sortVocabularyRows(filteredWords, sortMode),
    [filteredWords, sortMode]
  );
  const filtersActive = hasActiveFilters(searchQuery, maturityFilter, sourceFilter);
  const sections = useMemo(() => buildVocabularySections(visibleWords), [visibleWords]);
  const favoriteCount = useMemo(() => words.filter((word) => word.is_favorite).length, [words]);
  const savedCount = words.length;
  const growingCount = useMemo(
    () => words.filter((word) => word.maturity === 'growing' || word.maturity === 'familiar').length,
    [words]
  );
  const matureCount = useMemo(
    () => words.filter((word) => word.maturity === 'mature' || word.maturity === 'graduated').length,
    [words]
  );
  const sortedAllWords = useMemo(() => sortVocabularyRows(words, sortMode), [words, sortMode]);
  const allLongTailDeck = useMemo(() => buildLongTailDeck(sortedAllWords), [sortedAllWords]);
  const practiceSourceRows = filtersActive ? visibleWords : sortedAllWords;
  const longTailDeck = useMemo(() => buildLongTailDeck(practiceSourceRows), [practiceSourceRows]);
  const weakDeck = useMemo(() => buildWeakDeck(practiceSourceRows), [practiceSourceRows]);
  const newDeck = useMemo(() => buildNewDeck(practiceSourceRows), [practiceSourceRows]);
  const defaultPracticeDeck = useMemo(() => buildDefaultPracticeDeck(practiceSourceRows), [practiceSourceRows]);
  const sourceDeck = useMemo(
    () => buildSourceDeck(visibleWords, sourceFilter).filter(isNonGraduated),
    [sourceFilter, visibleWords]
  );
  const allSavedDeck = practiceSourceRows;
  const needsExposureCount = allLongTailDeck.length;
  const primaryPracticeDeck = useMemo(() => {
    if (longTailDeck.length) {
      return {
        title: 'Needs exposure',
        buttonLabel: 'Review words not showing up',
        words: longTailDeck,
      };
    }

    if (weakDeck.length) {
      return {
        title: 'Tricky words',
        buttonLabel: 'Review tricky words',
        words: weakDeck,
      };
    }

    if (newDeck.length) {
      return {
        title: 'New saves',
        buttonLabel: 'Practice new saves',
        words: newDeck,
      };
    }

    return {
      title: 'Saved vocabulary',
      buttonLabel: 'Practice saved words',
      words: defaultPracticeDeck,
    };
  }, [defaultPracticeDeck, longTailDeck, newDeck, weakDeck]);
  const practiceModes = useMemo(() => {
    const modes = [
      {
        key: 'needs-exposure',
        title: 'Needs exposure',
        count: longTailDeck.length,
        words: longTailDeck,
        icon: 'sunrise',
      },
      {
        key: 'tricky',
        title: 'Tricky words',
        count: weakDeck.length,
        words: weakDeck,
        icon: 'alert-circle',
      },
      {
        key: 'new',
        title: 'New saves',
        count: newDeck.length,
        words: newDeck,
        icon: 'plus-circle',
      },
    ];

    if (sourceFilter !== 'all') {
      modes.push({
        key: 'source',
        title: 'From current source',
        count: sourceDeck.length,
        words: sourceDeck,
        icon: 'book-open',
      });
    }

    modes.push({
      key: 'all-saved',
      title: 'All saved',
      count: allSavedDeck.length,
      words: allSavedDeck,
      icon: 'layers',
    });

    return modes;
  }, [allSavedDeck, longTailDeck, newDeck, sourceDeck, sourceFilter, weakDeck]);
  const practiceButtonLabel = primaryPracticeDeck.buttonLabel;
  const practiceButtonDisabled = primaryPracticeDeck.words.length === 0;
  const nudgeText = needsExposureCount
    ? `${pluralize(needsExposureCount, 'word')} ${needsExposureCount === 1 ? 'has' : 'have'} not appeared in your reading lately.`
    : 'Your recent reading is keeping your vocabulary fresh.';
  const selectedMaturityLabel = selectedWord?.maturityMeta?.label ?? 'New';
  const selectedMaturityDescription = selectedWord?.maturityMeta?.description ?? 'Saved vocabulary';
  const selectedSourceTitle = selectedWord ? getDetailSourceTitle(selectedWord) : '';
  const selectedReviewSummary = selectedWord ? getReviewSummary(selectedWord) : '';

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setMaturityFilter('all');
    setSourceFilter('all');
    setSortMode(DEFAULT_SORT_MODE);
  }, []);

  const toggleExpand = useCallback((sectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  }, []);

  const syncEntryToCloud = useCallback(async (word, overrides = {}) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    try {
      await upsertUserVocabEntry(user.id, {
        ...word,
        ...overrides,
        definition: overrides.definition ?? word.def ?? word.definition,
      });
    } catch (error) {
      console.log('[Learn] cloud vocab sync failed:', error.message);
    }
  }, []);

  const syncStatusToCloud = useCallback(async (word, status) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    try {
      await updateUserVocabStatus(user.id, {
        ...word,
        definition: word.def ?? word.definition,
      }, status);
    } catch (error) {
      console.log('[Learn] cloud status sync failed:', error.message);
    }
  }, []);

  const handleCycleStatus = useCallback(async (word, explicitStatus = null) => {
    const nextStatus = explicitStatus ?? cycleStatus(word.level);
    await updateLevel(word.word, word.hanja, word.def, nextStatus);
    const updatedRows = await fetchWords();
    const updatedWord = findMatchingWord(updatedRows, word) ?? {
      ...word,
      level: nextStatus,
    };
    await syncStatusToCloud(updatedWord, nextStatus);
    setSelectedWord((current) => (current && makeWordKey(current) === makeWordKey(word) ? updatedWord : current));
  }, [fetchWords, syncStatusToCloud]);

  const handleToggleFavorite = useCallback(async (word) => {
    await updateFavorite(word.word, word.hanja, word.def, !word.is_favorite);
    const updatedRows = await fetchWords();
    const updatedWord = findMatchingWord(updatedRows, word);
    setSelectedWord((current) => (current && makeWordKey(current) === makeWordKey(word) ? updatedWord ?? current : current));
  }, [fetchWords]);

  const handleCyclePriority = useCallback(async (word) => {
    const nextPriority = cyclePriority(word.priority);
    await updatePriority(word.word, word.hanja, word.def, nextPriority);
    const updatedRows = await fetchWords();
    const updatedWord = findMatchingWord(updatedRows, word);
    setSelectedWord((current) => (current && makeWordKey(current) === makeWordKey(word) ? updatedWord ?? current : current));
  }, [fetchWords]);

  const applyManualLearningAction = useCallback(async (word, updates) => {
    await updateVocabLearningState(word.word, word.hanja, word.def, updates);
    const updatedRows = await fetchWords();
    const updatedWord = findMatchingWord(updatedRows, word) ?? {
      ...word,
      ...updates,
    };

    setSelectedWord(updatedWord);
    await syncEntryToCloud(updatedWord);
  }, [fetchWords, syncEntryToCloud]);

  const handleAlreadyKnow = useCallback(async (word) => {
    const now = new Date().toISOString();
    await applyManualLearningAction(word, {
      level: 'good',
      maturity: 'graduated',
      graduated_at: word.graduated_at ?? now,
      next_review_at: null,
    });
  }, [applyManualLearningAction]);

  const handleStillConfusing = useCallback(async (word) => {
    await applyManualLearningAction(word, {
      level: 'bad',
      maturity: 'growing',
      graduated_at: null,
      next_review_at: new Date().toISOString(),
      priority: 'high',
    });
  }, [applyManualLearningAction]);

  const handleResetProgress = useCallback((word) => {
    Alert.alert(
      'Reset progress',
      `Reset reading and review progress for "${word.word}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await clearVocabEncountersForEntry(word.word, word.hanja, word.def);
            await applyManualLearningAction(word, {
              level: 'unorganized',
              encounter_count: 0,
              last_encountered_at: null,
              last_encounter_source_uri: null,
              last_encounter_source_title: null,
              maturity: 'new',
              graduated_at: null,
              implicit_review_count: 0,
              last_reviewed_at: null,
              next_review_at: null,
              correct_count: 0,
              wrong_count: 0,
            });
          },
        },
      ]
    );
  }, [applyManualLearningAction]);

  const handleRemoveWord = useCallback((word) => {
    Alert.alert(
      'Remove saved word',
      `Remove "${word.word}" from your saved words?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeData(word.word, word.hanja, word.def);

            const {
              data: { user },
            } = await supabase.auth.getUser();

            if (user) {
              try {
                await deleteUserVocabEntry(user.id, {
                  word: word.word,
                  hanja: word.hanja,
                  definition: word.def,
                });
              } catch (error) {
                console.log('[Learn] cloud remove failed:', error.message);
              }
            }

            await fetchWords();
            setSelectedWord((current) => (current && makeWordKey(current) === makeWordKey(word) ? null : current));
          },
        },
      ]
    );
  }, [fetchWords]);

  const startPractice = useCallback((deckWords, title) => {
    if (!deckWords || deckWords.length === 0) {
      return;
    }

    setPracticeDeck({
      title,
      words: deckWords,
    });
    setPracticeIndex(0);
  }, []);

  const closePractice = useCallback(() => {
    setPracticeDeck(null);
    setPracticeIndex(0);
  }, []);

  const handlePracticeMark = useCallback(async (status) => {
    if (!practiceDeck?.words?.length) {
      return;
    }

    const currentWord = practiceDeck.words[practiceIndex];
    await recordReviewOutcome(currentWord.word, currentWord.hanja, currentWord.def, currentWord.level, status);
    await incrementWordsStudied(1);
    const updatedRows = await fetchWords();
    const updatedWord = findMatchingWord(updatedRows, currentWord) ?? {
      ...currentWord,
      level: status,
    };
    await syncEntryToCloud(updatedWord, { status: updatedWord.level ?? status });

    if (practiceIndex >= practiceDeck.words.length - 1) {
      closePractice();
      return;
    }

    setPracticeIndex((prev) => prev + 1);
  }, [closePractice, fetchWords, practiceDeck, practiceIndex, syncEntryToCloud]);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <SectionHeader
          eyebrow="Vocabulary"
          title="Your words are growing through reading"
          subtitle="Track saved words by maturity, natural encounters, and the words that need more exposure."
        />

        <Card tone="muted" style={styles.heroCard} contentStyle={styles.heroContent}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Vocabulary</Text>
            <Text style={styles.heroSubtitle}>
              Your saved words get stronger as they reappear in books, pages, and practice.
            </Text>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{savedCount}</Text>
              <Text style={styles.heroStatLabel}>Saved</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{growingCount}</Text>
              <Text style={styles.heroStatLabel}>Growing</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{matureCount}</Text>
              <Text style={styles.heroStatLabel}>Mature</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{needsExposureCount}</Text>
              <Text style={styles.heroStatLabel}>Needs exposure</Text>
            </View>
          </View>

          <Text style={styles.heroNudge}>{nudgeText}</Text>

          <TouchableOpacity
            onPress={() => startPractice(primaryPracticeDeck.words, primaryPracticeDeck.title)}
            style={[styles.practiceButton, practiceButtonDisabled && styles.practiceButtonDisabled]}
            disabled={practiceButtonDisabled}
          >
            <Feather name="layers" size={16} color={practiceButtonDisabled ? colors.textSubtle : colors.accentStrong} />
            <Text style={[styles.practiceButtonLabel, practiceButtonDisabled && styles.practiceButtonLabelDisabled]}>
              {practiceButtonLabel}
            </Text>
          </TouchableOpacity>

          <Text style={styles.heroFooter}>
            {favoriteCount} favorites · {words.length} saved total
          </Text>
        </Card>

        {words.length > 0 ? (
          <Card style={styles.practiceModesCard} contentStyle={styles.practiceModesContent}>
            <View style={styles.practiceModesHeader}>
              <View style={styles.practiceModesCopy}>
                <Text style={styles.practiceModesTitle}>Practice modes</Text>
                <Text style={styles.practiceModesSubtitle}>
                  Optional flashcards for words that need a safety net.
                </Text>
              </View>
            </View>

            <View style={styles.practiceModeGrid}>
              {practiceModes.map((mode) => {
                const disabled = mode.count === 0;

                return (
                  <TouchableOpacity
                    key={mode.key}
                    onPress={() => startPractice(mode.words, mode.title)}
                    disabled={disabled}
                    style={[styles.practiceModeButton, disabled && styles.practiceModeButtonDisabled]}
                  >
                    <View style={[styles.practiceModeIcon, disabled && styles.practiceModeIconDisabled]}>
                      <Feather
                        name={mode.icon}
                        size={15}
                        color={disabled ? colors.textSubtle : colors.accentStrong}
                      />
                    </View>
                    <View style={styles.practiceModeCopy}>
                      <Text style={[styles.practiceModeTitle, disabled && styles.practiceModeTextDisabled]} numberOfLines={1}>
                        {mode.title}
                      </Text>
                      <Text style={[styles.practiceModeMeta, disabled && styles.practiceModeTextDisabled]}>
                        {pluralize(mode.count, 'word')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>
        ) : null}

        {words.length > 0 ? (
          <Card style={styles.controlsCard} contentStyle={styles.controlsContent}>
            <View style={styles.searchBox}>
              <Feather name="search" size={16} color={colors.textSubtle} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search words, hanja, definitions"
                placeholderTextColor={colors.textSubtle}
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={styles.searchInput}
              />
              {searchQuery ? (
                <TouchableOpacity
                  accessibilityLabel="Clear vocabulary search"
                  onPress={() => setSearchQuery('')}
                  style={styles.searchClearButton}
                >
                  <Feather name="x" size={15} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Maturity</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.chipRow}
              >
                {MATURITY_FILTERS.map((option) => {
                  const selected = maturityFilter === option.key;

                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setMaturityFilter(option.key)}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipLabel, selected && styles.filterChipLabelActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {sourceOptions.length > 1 ? (
              <View style={styles.controlGroup}>
                <Text style={styles.controlLabel}>Source</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.chipRow}
                >
                  {sourceOptions.map((option) => {
                    const selected = sourceFilter === option.key;

                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => setSourceFilter(option.key)}
                        style={[styles.filterChip, styles.sourceChip, selected && styles.filterChipActive]}
                      >
                        <Text
                          style={[styles.filterChipLabel, selected && styles.filterChipLabelActive]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Sort</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.chipRow}
              >
                {SORT_MODES.map((option) => {
                  const selected = sortMode === option.key;

                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setSortMode(option.key)}
                      style={[styles.filterChip, selected && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipLabel, selected && styles.filterChipLabelActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {filtersActive || sortMode !== DEFAULT_SORT_MODE ? (
              <TouchableOpacity onPress={clearFilters} style={styles.clearFiltersButton}>
                <Feather name="x-circle" size={15} color={colors.textMuted} />
                <Text style={styles.clearFiltersLabel}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ) : null}

        <SectionHeader
          eyebrow="Saved vocabulary"
          title="Saved vocabulary"
          subtitle={filtersActive
            ? `${visibleWords.length} of ${words.length} words match current filters.`
            : 'Browse words by exposure and maturity, with optional practice when natural reading has not surfaced them lately.'}
        />

        {words.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved words yet</Text>
            <Text style={styles.emptyBody}>
              Save words while reading and they will appear here.
            </Text>
          </Card>
        ) : visibleWords.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No words match these filters</Text>
            <Text style={styles.emptyBody}>
              Clear filters to see your saved vocabulary.
            </Text>
            <TouchableOpacity onPress={clearFilters} style={styles.emptyActionButton}>
              <Feather name="x-circle" size={15} color={colors.accentStrong} />
              <Text style={styles.emptyActionLabel}>Clear filters</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View style={styles.sectionList}>
            {sections.map((section) => (
              <BookWordSection
                key={section.key}
                section={section}
                expanded={!!expandedSections[section.key]}
                onToggleExpand={() => toggleExpand(section.key)}
                onStartPractice={() => startPractice(section.words, section.title)}
                onToggleFavorite={handleToggleFavorite}
                onCycleStatus={handleCycleStatus}
                onCyclePriority={handleCyclePriority}
                onRemoveWord={handleRemoveWord}
                onSelectWord={setSelectedWord}
              />
            ))}
          </View>
        )}
      </View>

      <Modal animationType="fade" transparent visible={!!selectedWord} onRequestClose={() => setSelectedWord(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedWord(null)} />

          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleCopy}>
                <Text style={styles.detailWord} selectable>{selectedWord?.word}</Text>
                {selectedWord?.hanja ? (
                  <Text style={styles.detailHanja} selectable>{selectedWord.hanja}</Text>
                ) : null}
              </View>

              <TouchableOpacity
                accessibilityLabel="Close word details"
                onPress={() => setSelectedWord(null)}
                style={styles.detailCloseButton}
              >
                <Feather name="x" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailScrollContent}>
              <Text style={styles.detailDefinition} selectable>
                {selectedWord?.def || 'No definition saved'}
              </Text>

              <View style={styles.detailBadgeRow}>
                <View style={styles.detailBadge}>
                  <Text style={styles.detailBadgeLabel}>{selectedMaturityLabel}</Text>
                </View>
                <Text style={styles.detailBadgeDescription}>{selectedMaturityDescription}</Text>
              </View>

              <View style={styles.detailGrid}>
                <View style={styles.detailMetric}>
                  <Text style={styles.detailMetricValue}>{numberValue(selectedWord?.encounter_count)}</Text>
                  <Text style={styles.detailMetricLabel}>Encounters</Text>
                </View>
                <View style={styles.detailMetric}>
                  <Text style={styles.detailMetricValue}>{numberValue(selectedWord?.encounter_day_count)}</Text>
                  <Text style={styles.detailMetricLabel}>Days</Text>
                </View>
                <View style={styles.detailMetric}>
                  <Text style={styles.detailMetricValue}>{numberValue(selectedWord?.encounter_source_count)}</Text>
                  <Text style={styles.detailMetricLabel}>Sources</Text>
                </View>
              </View>

              <View style={styles.detailInfoList}>
                <View style={styles.detailInfoRow}>
                  <Text style={styles.detailInfoLabel}>Last seen</Text>
                  <Text style={styles.detailInfoValue} numberOfLines={2}>
                    {formatDetailDate(selectedWord?.last_encountered_at)}
                  </Text>
                </View>
                <View style={styles.detailInfoRow}>
                  <Text style={styles.detailInfoLabel}>Source</Text>
                  <Text style={styles.detailInfoValue} numberOfLines={2}>
                    {selectedSourceTitle}
                  </Text>
                </View>
                <View style={styles.detailInfoRow}>
                  <Text style={styles.detailInfoLabel}>Review history</Text>
                  <Text style={styles.detailInfoValue} numberOfLines={2}>
                    {selectedReviewSummary}
                  </Text>
                </View>
                <View style={styles.detailInfoRow}>
                  <Text style={styles.detailInfoLabel}>Next review</Text>
                  <Text style={styles.detailInfoValue} numberOfLines={2}>
                    {formatDetailDate(selectedWord?.next_review_at)}
                  </Text>
                </View>
                {selectedWord?.context_sentence ? (
                  <View style={styles.detailContextBlock}>
                    <Text style={styles.detailInfoLabel}>Saved context</Text>
                    <Text style={styles.detailContextText} selectable>
                      {selectedWord.context_sentence}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.detailActions}>
                <TouchableOpacity
                  onPress={() => selectedWord && handleAlreadyKnow(selectedWord)}
                  style={[styles.detailActionButton, styles.detailActionPrimary]}
                >
                  <Feather name="check-circle" size={15} color={colors.success} />
                  <Text style={[styles.detailActionLabel, styles.detailActionPrimaryLabel]}>Already know</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => selectedWord && handleStillConfusing(selectedWord)}
                  style={styles.detailActionButton}
                >
                  <Feather name="alert-circle" size={15} color={colors.warning} />
                  <Text style={styles.detailActionLabel}>Still confusing</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => selectedWord && handleResetProgress(selectedWord)}
                  style={styles.detailActionButton}
                >
                  <Feather name="rotate-ccw" size={15} color={colors.textMuted} />
                  <Text style={styles.detailActionLabel}>Reset progress</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={!!practiceDeck} onRequestClose={closePractice}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closePractice} />

          <View style={styles.modalCardWrap}>
            <Flashcard
              vocab={practiceDeck?.words?.[practiceIndex]}
              title={practiceDeck?.title ?? 'Practice'}
              index={practiceIndex}
              total={practiceDeck?.words?.length ?? 0}
              onClose={closePractice}
              onMark={handlePracticeMark}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xl * 2,
  },
  stack: {
    gap: spacing.lg,
  },
  heroCard: {
    borderRadius: radii.xl,
  },
  heroContent: {
    gap: spacing.lg,
  },
  heroCopy: {
    gap: spacing.xs,
  },
  heroTitle: {
    ...textStyles.title,
  },
  heroSubtitle: {
    ...textStyles.bodyMuted,
  },
  heroNudge: {
    ...textStyles.bodyMuted,
    color: colors.text,
  },
  heroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  heroStat: {
    flexGrow: 1,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  heroStatValue: {
    ...textStyles.sectionTitle,
    fontSize: 18,
  },
  heroStatLabel: {
    ...textStyles.caption,
  },
  practiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    paddingVertical: spacing.md,
  },
  practiceButtonDisabled: {
    backgroundColor: colors.surfaceStrong,
  },
  practiceButtonLabel: {
    ...textStyles.label,
    color: colors.accentStrong,
  },
  practiceButtonLabelDisabled: {
    color: colors.textSubtle,
  },
  heroFooter: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  practiceModesCard: {
    borderRadius: radii.xl,
  },
  practiceModesContent: {
    gap: spacing.md,
  },
  practiceModesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  practiceModesCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  practiceModesTitle: {
    ...textStyles.sectionTitle,
    fontSize: 18,
  },
  practiceModesSubtitle: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  practiceModeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  practiceModeButton: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 136,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  practiceModeButtonDisabled: {
    opacity: 0.55,
  },
  practiceModeIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
  },
  practiceModeIconDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  practiceModeCopy: {
    flex: 1,
    minWidth: 0,
  },
  practiceModeTitle: {
    ...textStyles.label,
    color: colors.text,
  },
  practiceModeMeta: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  practiceModeTextDisabled: {
    color: colors.textSubtle,
  },
  controlsCard: {
    borderRadius: radii.xl,
  },
  controlsContent: {
    gap: spacing.md,
  },
  searchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    ...textStyles.body,
    paddingVertical: spacing.xs,
    color: colors.text,
  },
  searchClearButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
  },
  controlGroup: {
    gap: spacing.xs,
  },
  controlLabel: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  chipRow: {
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  filterChip: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  sourceChip: {
    maxWidth: 176,
  },
  filterChipActive: {
    borderColor: colors.accentStrong,
    backgroundColor: colors.accentSoft,
  },
  filterChipLabel: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  filterChipLabelActive: {
    color: colors.accentStrong,
  },
  clearFiltersButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  clearFiltersLabel: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  sectionList: {
    gap: spacing.md,
  },
  emptyCard: {
    borderRadius: radii.xl,
  },
  emptyTitle: {
    ...textStyles.sectionTitle,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...textStyles.bodyMuted,
  },
  emptyActionButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emptyActionLabel: {
    ...textStyles.label,
    color: colors.accentStrong,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalCardWrap: {
    justifyContent: 'center',
  },
  detailCard: {
    maxHeight: '86%',
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailTitleCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  detailWord: {
    ...textStyles.title,
    fontSize: 25,
    lineHeight: 31,
  },
  detailHanja: {
    ...textStyles.bodyMuted,
  },
  detailCloseButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
  },
  detailScrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  detailDefinition: {
    ...textStyles.body,
    color: colors.text,
  },
  detailBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  detailBadge: {
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  detailBadgeLabel: {
    ...textStyles.label,
    color: colors.accentStrong,
  },
  detailBadgeDescription: {
    flex: 1,
    minWidth: 160,
    ...textStyles.caption,
    color: colors.textMuted,
  },
  detailGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  detailMetric: {
    flex: 1,
    minHeight: 68,
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  detailMetricValue: {
    ...textStyles.sectionTitle,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  detailMetricLabel: {
    ...textStyles.caption,
    textAlign: 'center',
    color: colors.textMuted,
  },
  detailInfoList: {
    gap: spacing.xs,
  },
  detailInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  detailInfoLabel: {
    ...textStyles.caption,
    color: colors.textSubtle,
  },
  detailInfoValue: {
    flex: 1,
    ...textStyles.caption,
    color: colors.text,
    textAlign: 'right',
  },
  detailContextBlock: {
    gap: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
  },
  detailContextText: {
    ...textStyles.bodyMuted,
    color: colors.text,
  },
  detailActions: {
    gap: spacing.sm,
  },
  detailActionButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailActionPrimary: {
    backgroundColor: 'rgba(47, 125, 76, 0.12)',
  },
  detailActionLabel: {
    ...textStyles.label,
    color: colors.textMuted,
  },
  detailActionPrimaryLabel: {
    color: colors.success,
  },
});

export default Learn;
