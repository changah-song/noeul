import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialIcons } from '@expo/vector-icons';

import Flashcard from '../components/Learn/Flashcard';
import HanjaDetails from '../components/Read/TopSection/HanjaDetails';
import { Screen } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import {
  getVocabContexts,
  recordReviewOutcome,
  removeData,
  updateFavorite,
  viewData,
} from '../services/Database';
import { incrementWordsStudied } from '../services/dailyProgress';
import {
  softDeleteUserVocabContextsForWord,
  softDeleteRelatedKnownWordsForMainWord,
  softDeleteUserVocabEntry,
  supabase,
  updateUserVocabFields,
} from '../services/supabase';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { colors, fontFamilies, radii, spacing, textStyles } from '../theme';

const FILTERS = [
  { key: 'starred', labelKey: 'learn.filters.starred', icon: 'star' },
  { key: 'recent', labelKey: 'learn.filters.recent' },
  { key: 'maturity', labelKey: 'learn.filters.maturity' },
  { key: 'not-seen', labelKey: 'learn.filters.notSeen' },
  { key: 'most-seen', labelKey: 'learn.filters.mostSeen' },
];

const PROFICIENCY_LEVELS = [
  {
    key: 'new',
    labelKey: 'learn.proficiency.new',
    rank: 1,
    color: '#3f79aa',
    soft: '#e7f1fa',
    descriptionKey: 'learn.proficiency.newDescription',
  },
  {
    key: 'growing',
    labelKey: 'learn.proficiency.growing',
    rank: 2,
    color: '#c58b28',
    soft: '#fff1d5',
    descriptionKey: 'learn.proficiency.growingDescription',
  },
  {
    key: 'familiar',
    labelKey: 'learn.proficiency.familiar',
    rank: 3,
    color: '#b47b2a',
    soft: '#f8ead1',
    descriptionKey: 'learn.proficiency.familiarDescription',
  },
  {
    key: 'mature',
    labelKey: 'learn.proficiency.mature',
    rank: 4,
    color: '#5c9856',
    soft: '#e7f1dd',
    descriptionKey: 'learn.proficiency.matureDescription',
  },
  {
    key: 'graduated',
    labelKey: 'learn.proficiency.graduated',
    rank: 5,
    color: '#8f897d',
    soft: '#ece8df',
    descriptionKey: 'learn.proficiency.graduatedDescription',
  },
];

const proficiencyByKey = PROFICIENCY_LEVELS.reduce((acc, level) => {
  acc[level.key] = level;
  return acc;
}, {});

const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const LEARN_SIDE_PADDING = 16;
const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');
const getHanjaCharacters = (value) => cleanText(value).split('').filter((char) => HANJA_RE.test(char));

const parseRelatedKnownWords = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const numericValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const fsrsNumber = (value, fallback) => {
  if (value == null || value === '') {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const sameWord = (a, b) => (
  !!a
  && !!b
  && a.word === b.word
  && (a.hanja ?? null) === (b.hanja ?? null)
  && (a.def ?? null) === (b.def ?? null)
  && (a.language ?? 'ko') === (b.language ?? 'ko')
);

const getWordKey = (word) => [
  word?.language ?? 'ko',
  word?.word ?? '',
  word?.hanja ?? '',
  word?.def ?? '',
].join('::');

const getSeenCount = (word) => {
  const directSeen = [
    word?.encounter_count,
    word?.seen_count,
    word?.exposure_count,
  ].find((value) => Number.isFinite(Number(value)) && Number(value) > 0);

  if (directSeen !== undefined) {
    return Math.max(1, Number(directSeen));
  }

  return Math.max(1, numericValue(word?.correct_count) + numericValue(word?.wrong_count) + 1);
};

const getSourceLabel = (word, t = null) => (
  cleanText(word?.source_book_title)
  || cleanText(word?.source_book_uri)
  || (t ? t('learn.savedWord') : 'saved word')
);

const getLastSawDate = (word) => (
  cleanText(word?.last_reviewed_at)
  || cleanText(word?.created_at)
  || null
);

const formatRelativeDate = (value, t = null) => {
  const label = (key, params) => (t ? t(key, params) : null);

  if (!value) {
    return label('learn.notSeenDate') ?? 'not seen';
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return label('learn.notSeenDate') ?? 'not seen';
  }

  const now = Date.now();
  const diffDays = Math.max(0, Math.floor((now - timestamp) / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) return label('learn.today') ?? 'today';
  if (diffDays === 1) return label('learn.yesterday') ?? 'yesterday';
  if (diffDays < 30) return label('learn.daysAgo', { count: diffDays }) ?? `${diffDays}d ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return label('learn.monthsAgo', { count: months }) ?? `${months}mo ago`;
  }
  const years = Math.floor(diffDays / 365);
  return label('learn.yearsAgo', { count: years }) ?? `${years}y ago`;
};

const getDistinctDays = (word) => {
  const dates = [word?.created_at, word?.last_reviewed_at]
    .map((value) => {
      const timestamp = new Date(value).getTime();
      if (!Number.isFinite(timestamp)) {
        return null;
      }

      return new Date(timestamp).toISOString().slice(0, 10);
    })
    .filter(Boolean);

  return Math.max(1, new Set(dates).size);
};

const getSourceCount = (word) => (cleanText(word?.source_book_title) || cleanText(word?.source_book_uri) ? 1 : 0);

const getProficiency = (word) => {
  const seen = getSeenCount(word);
  let key = 'new';

  if (seen >= 22) {
    key = 'graduated';
  } else if (seen >= 13) {
    key = 'mature';
  } else if (seen >= 8) {
    key = 'familiar';
  } else if (seen >= 3) {
    key = 'growing';
  }

  if (word?.level === 'good' && key !== 'graduated') {
    key = seen >= 22 ? 'graduated' : 'mature';
  } else if ((word?.level === 'mid' || word?.level === 'bad') && key === 'new') {
    key = 'growing';
  }

  return proficiencyByKey[key] ?? proficiencyByKey.new;
};

const isNotSeenLately = (word) => {
  const date = getLastSawDate(word);
  if (!date) {
    return true;
  }

  const timestamp = new Date(date).getTime();
  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return Date.now() - timestamp > 1000 * 60 * 60 * 24 * 7;
};

const isRecentlySaved = (word) => {
  const timestamp = new Date(word?.created_at).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return Date.now() - timestamp < 1000 * 60 * 60 * 24 * 3;
};

const getNextReviewTimestamp = (word) => {
  if (!word?.next_review_at) {
    return null;
  }

  const timestamp = new Date(word?.next_review_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isReviewDue = (word, now = Date.now()) => {
  const nextReviewAt = getNextReviewTimestamp(word);
  return nextReviewAt !== null && nextReviewAt <= now && word?.level !== 'unorganized';
};

const isReviewCoolingDown = (word, now = Date.now()) => {
  const nextReviewAt = getNextReviewTimestamp(word);
  return nextReviewAt !== null && nextReviewAt > now;
};

const isReviewAvailable = (word, now = Date.now()) => !isReviewCoolingDown(word, now);

const sortDueReviews = (rows) => [...rows].sort((a, b) => (
  (getNextReviewTimestamp(a) ?? Number.MAX_SAFE_INTEGER)
  - (getNextReviewTimestamp(b) ?? Number.MAX_SAFE_INTEGER)
));

const normalizeRows = (rows) =>
  rows.map((row) => ({
    ...row,
    is_favorite: Boolean(row.is_favorite),
    priority: row.priority ?? 'normal',
    created_at: row.created_at ?? null,
    next_review_at: row.next_review_at ?? null,
    last_reviewed_at: row.last_reviewed_at ?? null,
    correct_count: numericValue(row.correct_count),
    wrong_count: numericValue(row.wrong_count),
    stability: fsrsNumber(row.stability, 1.0),
    difficulty: fsrsNumber(row.difficulty, 5.0),
    related_known_words: parseRelatedKnownWords(row.related_known_words),
  }));

const sortRecent = (rows) =>
  [...rows].sort((a, b) => {
    const dateDiff = new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return (a.word ?? '').localeCompare(b.word ?? '');
  });

const getFilteredWords = (rows, filter) => {
  if (filter === 'starred') {
    return sortRecent(rows.filter((word) => word.is_favorite));
  }

  if (filter === 'not-seen') {
    return sortRecent(rows.filter(isNotSeenLately));
  }

  if (filter === 'most-seen') {
    return [...rows].sort((a, b) => getSeenCount(b) - getSeenCount(a));
  }

  if (filter === 'maturity') {
    return [...rows].sort((a, b) => {
      const rankDiff = getProficiency(a).rank - getProficiency(b).rank;
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return getSeenCount(b) - getSeenCount(a);
    });
  }

  return sortRecent(rows);
};

const ProficiencyDots = ({ level, size = 7 }) => (
  <View style={styles.dotRow}>
    {PROFICIENCY_LEVELS.map((item) => (
      <View
        key={item.key}
        style={[
          styles.proficiencyDot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: item.rank <= level.rank ? level.color : '#ded8c9',
          },
        ]}
      />
    ))}
  </View>
);

const StatusBadge = ({ label, tone = 'blue' }) => {
  const toneStyle = tone === 'amber'
    ? { backgroundColor: '#f7e6bf', color: '#bd8427' }
    : { backgroundColor: '#e3eef7', color: '#3f79aa' };

  return (
    <View style={[styles.badge, { backgroundColor: toneStyle.backgroundColor }]}>
      <Text style={[styles.badgeText, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
};

const VocabularyRow = ({ word, onPress, onLongPress, selectionMode = false, selected = false }) => {
  const { t } = useTranslation();
  const proficiency = getProficiency(word);
  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const lastSaw = formatRelativeDate(getLastSawDate(word), t);
  const showNewBadge = isRecentlySaved(word);
  const showNotSeenBadge = !showNewBadge && isNotSeenLately(word);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      style={({ pressed }) => [
        styles.wordRow,
        pressed && styles.wordRowPressed,
        selected && styles.wordRowSelected,
      ]}
    >
      {selectionMode ? (
        <View style={[styles.selectionCircle, selected && styles.selectionCircleSelected]}>
          {selected ? <Feather name="check" size={14} color="#fffaf3" /> : null}
        </View>
      ) : null}
      <View style={styles.wordCopy}>
        <View style={styles.wordTitleLine}>
          <Text numberOfLines={1} style={styles.wordText}>{word.word}</Text>
          {word.hanja ? <Text numberOfLines={1} style={styles.wordHanja}>{word.hanja}</Text> : null}
          {showNewBadge ? <StatusBadge label={t('learn.newBadge')} /> : null}
          {showNotSeenBadge ? <StatusBadge label={t('learn.notSeenBadge')} tone="amber" /> : null}
          {word.is_favorite ? <MaterialIcons name="star" size={16} color="#a7997e" /> : null}
        </View>
        <Text numberOfLines={1} style={styles.wordDefinition}>{word.def || t('learn.noDefinition')}</Text>
        <View style={styles.wordMetaLine}>
          <Feather name="eye" size={13} color="#a99e8c" />
          <Text numberOfLines={1} style={styles.wordMetaText}>
            {t('learn.seenMeta', { count: seenCount, source, date: lastSaw })}
          </Text>
        </View>
      </View>

      <View style={styles.proficiencySummary}>
        <ProficiencyDots level={proficiency} />
        <Text style={[styles.proficiencyLabel, { color: proficiency.color }]}>{t(proficiency.labelKey)}</Text>
      </View>
    </Pressable>
  );
};

const HighlightPreview = ({ word, sentence, proficiency }) => {
  const { t } = useTranslation();
  const cleanSentence = cleanText(sentence);
  const cleanWord = cleanText(word?.word);

  if (!cleanSentence || !cleanWord || !cleanSentence.includes(cleanWord)) {
    return (
      <Text style={styles.highlightSentence}>
        <Text style={[styles.highlightedWord, { backgroundColor: proficiency.soft }]}>
          {cleanWord || t('learn.word')}
        </Text>
        {cleanText(word?.def) ? ` - ${word.def}` : ''}
      </Text>
    );
  }

  const index = cleanSentence.indexOf(cleanWord);
  const before = cleanSentence.slice(0, index);
  const after = cleanSentence.slice(index + cleanWord.length);

  return (
    <Text style={styles.highlightSentence}>
      {before}
      <Text style={[styles.highlightedWord, { backgroundColor: proficiency.soft }]}>
        {cleanWord}
      </Text>
      {after}
    </Text>
  );
};

const WordDetailModal = ({
  word,
  contexts = [],
  visible,
  onClose,
  onToggleFavorite,
  onRemove,
}) => {
  const { t } = useTranslation();
  const [currentHanja, setCurrentHanja] = useState(null);

  useEffect(() => {
    setCurrentHanja(null);
  }, [word?.word, word?.hanja, word?.def]);

  if (!word) {
    return null;
  }

  const proficiency = getProficiency(word);
  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const lastSaw = formatRelativeDate(getLastSawDate(word), t);
  const hanjaCharacters = getHanjaCharacters(word.hanja);

  const handleHanjaPress = (hanja, sourceWord = null, options = {}) => {
    if (!hanja) {
      setCurrentHanja(null);
      return;
    }

    const optionCharacters = Array.isArray(options.characters)
      ? options.characters.map(cleanText).filter((char) => HANJA_RE.test(char))
      : [];
    const characters = optionCharacters.length > 0 ? optionCharacters : hanjaCharacters;
    const fallbackCharacters = characters.length > 0 ? characters : getHanjaCharacters(hanja);
    const requestedIndex = Number.isInteger(options.index)
      ? options.index
      : fallbackCharacters.indexOf(cleanText(hanja));
    const activeIndex = requestedIndex >= 0
      ? Math.min(requestedIndex, fallbackCharacters.length - 1)
      : 0;

    if (fallbackCharacters.length === 0) {
      setCurrentHanja(null);
      return;
    }

    setCurrentHanja({
      character: fallbackCharacters[activeIndex],
      characters: fallbackCharacters,
      activeIndex,
      sourceWord: cleanText(sourceWord) || word.word,
      sourceWordDetails: {
        hanja: word.hanja ?? null,
        definition: word.def ?? null,
        level: word.level ?? 'unorganized',
        sourceBookUri: word.source_book_uri ?? null,
        sourceBookTitle: word.source_book_title ?? null,
        contextSentence: word.context_sentence ?? null,
        isFavorite: word.is_favorite,
        language: word.language ?? 'ko',
      },
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.detailScreen}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={onClose} style={styles.detailHeaderButton}>
            <Feather name="chevron-left" size={28} color="#2d2923" />
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle}>{t('learn.word')}</Text>
          <TouchableOpacity onPress={onToggleFavorite} style={styles.detailHeaderButton}>
            <MaterialIcons
              name={word.is_favorite ? 'star' : 'star-outline'}
              size={28}
              color={word.is_favorite ? '#a99672' : '#b3aa99'}
            />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailContent}>
          <View style={styles.detailHero}>
            <View style={styles.detailWordLine}>
              <Text style={styles.detailWord}>{word.word}</Text>
              {hanjaCharacters.length > 0 ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => handleHanjaPress(hanjaCharacters[0], word.word)}
                  style={styles.detailHanjaButton}
                >
                  <Text style={styles.detailHanja}>{word.hanja}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={styles.detailMeta}>{source} · {lastSaw}</Text>
            <Text style={styles.detailDefinition}>{word.def || t('learn.noDefinition')}</Text>
          </View>

          <View style={[styles.maturityCard, { backgroundColor: proficiency.soft }]}>
            <View style={styles.maturityTopRow}>
              <View style={styles.maturityCopy}>
                <Text style={[styles.maturityTitle, { color: proficiency.color }]}>{t(proficiency.labelKey)}</Text>
                <Text style={styles.maturityDescription}>{t(proficiency.descriptionKey)}</Text>
              </View>
              <ProficiencyDots level={proficiency} size={9} />
            </View>

            <View style={styles.detailStatsRow}>
              <View style={styles.detailStat}>
                <Text style={styles.detailStatValue}>{seenCount}</Text>
                <Text style={styles.detailStatLabel}>{t('learn.encounters')}</Text>
              </View>
              <View style={styles.detailStat}>
                <Text style={styles.detailStatValue}>{getDistinctDays(word)}</Text>
                <Text style={styles.detailStatLabel}>{t('learn.distinctDays')}</Text>
              </View>
              <View style={styles.detailStat}>
                <Text style={styles.detailStatValue}>{getSourceCount(word)}</Text>
                <Text style={styles.detailStatLabel}>{t('learn.sources')}</Text>
              </View>
            </View>
          </View>

          <View style={styles.contextSection}>
            <Text style={styles.detailSectionTitle}>{t('learn.seenContext')}</Text>
            {contexts.length > 0 ? (
              contexts.map((context, index) => (
                <View
                  key={`${context.sentence}-${context.seenAt ?? ''}-${index}`}
                  style={styles.contextRow}
                >
                  <View style={styles.contextRowHeader}>
                    <Text numberOfLines={1} style={styles.contextSource}>
                      {cleanText(context.sourceBookTitle) || cleanText(context.sourceBookUri) || source}
                    </Text>
                    <Text style={styles.contextDate}>{formatRelativeDate(context.seenAt, t)}</Text>
                  </View>
                  <HighlightPreview word={word} sentence={context.sentence} proficiency={proficiency} />
                </View>
              ))
            ) : (
              <View style={styles.contextRow}>
                <Text style={styles.emptyContext}>{t('learn.noContext')}</Text>
              </View>
            )}
          </View>
        </ScrollView>

        <View style={styles.detailActions}>
          <TouchableOpacity onPress={onRemove} style={styles.deleteWordButton}>
            <Text style={styles.deleteWordText}>{t('common.delete')}</Text>
          </TouchableOpacity>
        </View>

        <HanjaDetails
          hanja={currentHanja?.character ?? null}
          hanjaCharacters={currentHanja?.characters ?? []}
          initialHanjaIndex={currentHanja?.activeIndex ?? 0}
          sourceWord={currentHanja?.sourceWord ?? word.word}
          sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
          handleHanjaPress={handleHanjaPress}
          isDarkMode={false}
        />
      </SafeAreaView>
    </Modal>
  );
};

const Learn = ({ navigation, user }) => {
  const { t } = useTranslation();
  const { targetLanguage } = useAppContext();
  const { activeOwnerId, syncGeneration } = useLocalOwner();
  const [words, setWords] = useState([]);
  const [activeFilter, setActiveFilter] = useState('recent');
  const [practiceDeck, setPracticeDeck] = useState(null);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [selectedWord, setSelectedWord] = useState(null);
  const [selectedWordContexts, setSelectedWordContexts] = useState([]);
  const [selectedWordKeys, setSelectedWordKeys] = useState(() => new Set());

  const isSelectionMode = selectedWordKeys.size > 0;

  const fetchWords = useCallback(async () => {
    try {
      const data = await viewData({ ownerId: activeOwnerId, language: targetLanguage });
      const normalized = normalizeRows(data);
      setWords(normalized);
      setSelectedWord((current) => {
        if (!current) {
          return null;
        }

        return normalized.find((candidate) => sameWord(candidate, current)) ?? current;
      });
      return normalized;
    } catch (error) {
      console.error('[Learn] Error fetching vocab data:', error);
      return [];
    }
  }, [activeOwnerId, targetLanguage]);

  useEffect(() => {
    setWords([]);
    setPracticeDeck(null);
    setPracticeIndex(0);
    setSelectedWord(null);
    setSelectedWordContexts([]);
    setSelectedWordKeys(new Set());
    fetchWords();
  }, [activeOwnerId, fetchWords, targetLanguage]);

  useFocusEffect(
    useCallback(() => {
      fetchWords();
    }, [fetchWords])
  );

  useEffect(() => {
    let isActive = true;

    if (!selectedWord) {
      setSelectedWordContexts([]);
      return () => {
        isActive = false;
      };
    }

    getVocabContexts(
      selectedWord.word,
      selectedWord.hanja,
      selectedWord.def,
      12,
      selectedWord.language ?? 'ko',
      { ownerId: activeOwnerId }
    )
      .then((contexts) => {
        if (isActive) {
          setSelectedWordContexts(contexts);
        }
      })
      .catch((error) => {
        console.warn('[Learn] Failed to load vocab contexts:', error?.message ?? error);
        if (isActive) {
          setSelectedWordContexts([]);
        }
      });

    return () => {
      isActive = false;
    };
  }, [activeOwnerId, selectedWord?.word, selectedWord?.hanja, selectedWord?.def, selectedWord?.language]);

  const visibleWords = useMemo(() => getFilteredWords(words, activeFilter), [activeFilter, words]);
  const selectedWords = useMemo(
    () => words.filter((word) => selectedWordKeys.has(getWordKey(word))),
    [selectedWordKeys, words]
  );

  useEffect(() => {
    if (selectedWordKeys.size === 0) {
      return;
    }

    const liveKeys = new Set(words.map(getWordKey));
    setSelectedWordKeys((current) => {
      const next = new Set([...current].filter((key) => liveKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [selectedWordKeys.size, words]);
  const maturedCount = useMemo(
    () => words.filter((word) => getProficiency(word).rank >= proficiencyByKey.mature.rank).length,
    [words]
  );
  const waitingCount = useMemo(
    () => words.filter((word) => {
      const rank = getProficiency(word).rank;
      return rank > proficiencyByKey.new.rank && rank < proficiencyByKey.mature.rank;
    }).length,
    [words]
  );
  const notSeenCount = useMemo(() => words.filter(isNotSeenLately).length, [words]);
  const dueWords = useMemo(
    () => sortDueReviews(words.filter((word) => isReviewDue(word))),
    [words]
  );
  const availableVisibleWords = useMemo(
    () => {
      const now = Date.now();
      return visibleWords.filter((word) => isReviewAvailable(word, now));
    },
    [visibleWords]
  );
  const reviewDeck = dueWords.length > 0 ? dueWords : availableVisibleWords;
  const reviewDeckTitle = dueWords.length > 0 ? t('learn.dueReview') : t('learn.savedWords');

  const syncFieldsToCloud = useCallback(async (word, patch) => {
    const {
      data: { user: cloudUser },
    } = await supabase.auth.getUser();

    if (!cloudUser || activeOwnerId !== cloudUser.id || !isCurrentSyncGeneration(syncGeneration)) {
      return;
    }

    try {
      await updateUserVocabFields({
        user: cloudUser,
        ownerId: activeOwnerId,
        generation: syncGeneration,
        entry: {
          word: word.word,
          hanja: word.hanja,
          definition: word.def,
          language: word.language ?? 'ko',
        },
        patch,
      });
    } catch (error) {
      console.warn('[Learn] cloud vocab field sync failed:', error.message);
    }
  }, [activeOwnerId, syncGeneration]);

  const deleteSavedWord = useCallback(async (word, cloudUser = null) => {
    await removeData(word.word, word.hanja, word.def, word.language ?? 'ko', { ownerId: activeOwnerId });

    if (!cloudUser || activeOwnerId !== cloudUser.id || !isCurrentSyncGeneration(syncGeneration)) {
      return;
    }

    const cloudEntry = {
      word: word.word,
      hanja: word.hanja,
      definition: word.def,
      language: word.language ?? 'ko',
    };
    await softDeleteUserVocabEntry({
      user: cloudUser,
      ownerId: activeOwnerId,
      generation: syncGeneration,
      entry: cloudEntry,
    });
    await softDeleteUserVocabContextsForWord({
      user: cloudUser,
      ownerId: activeOwnerId,
      generation: syncGeneration,
      entry: cloudEntry,
    });
    await softDeleteRelatedKnownWordsForMainWord({
      user: cloudUser,
      ownerId: activeOwnerId,
      generation: syncGeneration,
      entry: cloudEntry,
    });
  }, [activeOwnerId, syncGeneration]);

  const handleToggleFavorite = useCallback(async (word) => {
    if (!word) {
      return;
    }

    const nextFavorite = !word.is_favorite;
    await updateFavorite(word.word, word.hanja, word.def, nextFavorite, word.language ?? 'ko', {
      ownerId: activeOwnerId,
    });
    setSelectedWord((current) => sameWord(current, word) ? { ...current, is_favorite: nextFavorite } : current);
    syncFieldsToCloud(word, {
      is_favorite: nextFavorite,
      updated_at: new Date().toISOString(),
    });
    await fetchWords();
  }, [activeOwnerId, fetchWords, syncFieldsToCloud]);

  const handleRemoveWord = useCallback((word, options = {}) => {
    if (!word) {
      return;
    }

    const remove = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      try {
        await deleteSavedWord(word, user);
      } catch (error) {
        console.warn('[Learn] remove failed:', error.message);
      }

      if (options.closeDetail) {
        setSelectedWord(null);
      }
      await fetchWords();
    };

    Alert.alert(
      t('learn.deleteSavedWordTitle'),
      t('learn.deleteWordBody', { word: word.word }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: remove,
        },
      ]
    );
  }, [deleteSavedWord, fetchWords, t]);

  const toggleWordSelection = useCallback((word) => {
    const key = getWordKey(word);
    setSelectedWordKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const startWordSelection = useCallback((word) => {
    setSelectedWord(null);
    setSelectedWordKeys((current) => {
      const next = new Set(current);
      next.add(getWordKey(word));
      return next;
    });
  }, []);

  const clearWordSelection = useCallback(() => {
    setSelectedWordKeys(new Set());
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedWords.length === 0) {
      return;
    }

    const count = selectedWords.length;
    const title = count === 1 ? t('learn.deleteSavedWordTitle') : t('learn.deleteSavedWordsTitle');
    const body = count === 1
      ? t('learn.deleteWordBody', { word: selectedWords[0].word })
      : t('learn.deleteWordsBody', { count });

    const removeSelected = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      for (const word of selectedWords) {
        try {
          await deleteSavedWord(word, user);
        } catch (error) {
          console.warn('[Learn] bulk remove failed:', error.message);
        }
      }

      clearWordSelection();
      setSelectedWord(null);
      await fetchWords();
    };

    Alert.alert(
      title,
      body,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: removeSelected,
        },
      ]
    );
  }, [clearWordSelection, deleteSavedWord, fetchWords, selectedWords, t]);

  const startPractice = useCallback((deckWords, title) => {
    const now = Date.now();
    const availableDeckWords = (deckWords || []).filter((word) => isReviewAvailable(word, now));

    if (availableDeckWords.length === 0) {
      return;
    }

    setPracticeDeck({
      title,
      words: availableDeckWords,
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
    await recordReviewOutcome(
      currentWord.word,
      currentWord.hanja,
      currentWord.def,
      currentWord.level,
      status,
      currentWord.language ?? 'ko',
      {
        ownerId: activeOwnerId,
        wordData: currentWord,
      }
    );
    await incrementWordsStudied(activeOwnerId, 1);
    const updatedWords = await fetchWords();
    const updatedWord = updatedWords.find((candidate) => sameWord(candidate, currentWord));
    if (updatedWord) {
      await syncFieldsToCloud(updatedWord, {
        status: updatedWord.level,
        last_reviewed_at: updatedWord.last_reviewed_at,
        next_review_at: updatedWord.next_review_at,
        stability: updatedWord.stability,
        difficulty: updatedWord.difficulty,
        correct_count: updatedWord.correct_count,
        wrong_count: updatedWord.wrong_count,
        updated_at: updatedWord.updated_at ?? new Date().toISOString(),
      });
    }

    if (practiceIndex >= practiceDeck.words.length - 1) {
      closePractice();
      return;
    }

    setPracticeIndex((prev) => prev + 1);
  }, [activeOwnerId, closePractice, fetchWords, practiceDeck, practiceIndex, syncFieldsToCloud]);

  return (
    <Screen scroll backgroundColor="#eee6d8" contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('learn.title')}</Text>
        <Text style={styles.subtitle}>{t('learn.subtitle', { count: words.length })}</Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryStats}>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, styles.summaryValueGreen]}>{maturedCount}</Text>
            <Text style={styles.summaryLabel}>{t('learn.matured')}</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, styles.summaryValueAmber]}>{waitingCount}</Text>
            <Text style={styles.summaryLabel}>{t('learn.waiting')}</Text>
          </View>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{notSeenCount}</Text>
            <Text style={styles.summaryLabel}>{t('learn.notSeen')}</Text>
          </View>
        </View>

        <View style={styles.readingGuidance}>
          <Feather name="book-open" size={16} color="#8a6f42" />
          <Text style={styles.readingGuidanceText}>
            {t('learn.guidance')}
          </Text>
        </View>

        <View style={styles.summaryActions}>
          <TouchableOpacity
            onPress={() => navigation?.navigate?.('Read')}
            style={[styles.keepReadingButton, words.length === 0 && styles.keepReadingButtonFull]}
          >
            <Feather name="book-open" size={18} color="#fffaf3" />
            <Text style={styles.keepReadingText}>{t('learn.keepReading')}</Text>
          </TouchableOpacity>
          {words.length > 0 ? (
            <TouchableOpacity
              disabled={reviewDeck.length === 0}
              onPress={() => startPractice(reviewDeck, reviewDeckTitle)}
              style={[
                styles.reviewButton,
                reviewDeck.length === 0 && styles.reviewButtonDisabled,
              ]}
            >
              <Text style={[
                styles.reviewButtonText,
                reviewDeck.length === 0 && styles.reviewButtonTextDisabled,
              ]}>
                {reviewDeck.length > 0 ? t('learn.reviewCount', { count: reviewDeck.length }) : t('learn.noReviews')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map((filter) => {
          const active = activeFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              accessibilityRole="button"
              accessibilityLabel={t(filter.labelKey)}
              onPress={() => {
                clearWordSelection();
                setActiveFilter(filter.key);
              }}
              style={[
                styles.filterChip,
                filter.icon && styles.filterIconChip,
                active && styles.filterChipActive,
              ]}
            >
              {filter.icon ? (
                <MaterialIcons
                  name={active ? filter.icon : `${filter.icon}-border`}
                  size={17}
                  color={active ? '#fffaf3' : '#8d806e'}
                />
              ) : (
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{t(filter.labelKey)}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.listHeader}>
        <Text style={styles.listEyebrow}>{t('learn.vocabulary')}</Text>
        <Text style={styles.listCount}>{visibleWords.length}</Text>
      </View>

      {isSelectionMode ? (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={clearWordSelection} style={styles.selectionBarButton}>
            <Feather name="x" size={17} color="#756b5f" />
            <Text style={styles.selectionBarButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>

          <Text style={styles.selectionCount}>
            {t('common.selected', { count: selectedWords.length })}
          </Text>

          <TouchableOpacity onPress={handleBulkDelete} style={[styles.selectionBarButton, styles.selectionDeleteButton]}>
            <Feather name="trash-2" size={17} color="#fffaf3" />
            <Text style={styles.selectionDeleteText}>{t('common.delete')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.list}>
        {visibleWords.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t('learn.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>
              {t('learn.emptyBody')}
            </Text>
          </View>
        ) : (
          visibleWords.map((word) => (
            <VocabularyRow
              key={getWordKey(word)}
              word={word}
              selectionMode={isSelectionMode}
              selected={selectedWordKeys.has(getWordKey(word))}
              onPress={() => {
                if (isSelectionMode) {
                  toggleWordSelection(word);
                  return;
                }
                setSelectedWord(word);
              }}
              onLongPress={() => startWordSelection(word)}
            />
          ))
        )}
      </View>

      <WordDetailModal
        word={selectedWord}
        contexts={selectedWordContexts}
        visible={!!selectedWord}
        onClose={() => setSelectedWord(null)}
        onToggleFavorite={() => handleToggleFavorite(selectedWord)}
        onRemove={() => handleRemoveWord(selectedWord, { closeDetail: true })}
      />

      <Modal animationType="fade" transparent visible={!!practiceDeck} onRequestClose={closePractice}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closePractice} />

          <View style={styles.modalCardWrap}>
            <Flashcard
              vocab={practiceDeck?.words?.[practiceIndex]}
              title={practiceDeck?.title ?? t('learn.practice')}
              index={practiceIndex}
              total={practiceDeck?.words?.length ?? 0}
              onClose={closePractice}
              onMark={handlePracticeMark}
              user={user}
              ownerId={activeOwnerId}
              syncGeneration={syncGeneration}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 0,
    paddingBottom: spacing.lg,
    gap: 12,
  },
  header: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingTop: 2,
    gap: 2,
  },
  title: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 27,
    lineHeight: 32,
    color: '#2b2721',
  },
  subtitle: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 17,
    color: '#807566',
  },
  summaryCard: {
    marginHorizontal: LEARN_SIDE_PADDING,
    borderRadius: 16,
    backgroundColor: '#fffaf3',
    padding: 12,
    gap: 12,
    shadowColor: 'rgba(70, 49, 24, 0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 3,
  },
  summaryStats: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryStat: {
    flex: 1,
    gap: 4,
  },
  summaryValue: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 25,
    lineHeight: 29,
    color: '#a99f8f',
  },
  summaryValueGreen: {
    color: '#5c9856',
  },
  summaryValueAmber: {
    color: '#c58b28',
  },
  summaryLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 10.5,
    lineHeight: 14,
    color: '#817568',
  },
  readingGuidance: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f6ebd8',
  },
  readingGuidanceText: {
    flex: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: '#6f5f4b',
  },
  summaryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  keepReadingButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 13,
    backgroundColor: '#bf5630',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  keepReadingButtonFull: {
    flex: 1,
  },
  keepReadingText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13.5,
    color: '#fffaf3',
  },
  reviewButton: {
    minWidth: 96,
    minHeight: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#eadcc4',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reviewButtonDisabled: {
    opacity: 0.48,
  },
  reviewButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: '#756b5f',
  },
  reviewButtonTextDisabled: {
    color: '#9b9185',
  },
  filters: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    gap: 6,
  },
  filterChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#e4d8c4',
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 13,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 250, 243, 0.5)',
  },
  filterIconChip: {
    width: 36,
    paddingHorizontal: 0,
  },
  filterChipActive: {
    backgroundColor: '#2b2721',
    borderColor: '#2b2721',
  },
  filterText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    color: '#7c7163',
  },
  filterTextActive: {
    color: '#fffaf3',
  },
  listHeader: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listEyebrow: {
    ...textStyles.eyebrow,
    color: '#7e7468',
    fontSize: 11,
    letterSpacing: 0.9,
  },
  listCount: {
    ...textStyles.caption,
    color: '#a99e8c',
  },
  selectionBar: {
    marginHorizontal: LEARN_SIDE_PADDING,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4d8c4',
    backgroundColor: '#fffaf3',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  selectionBarButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: '#f4eadc',
  },
  selectionBarButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    color: '#756b5f',
  },
  selectionCount: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: '#2b2721',
  },
  selectionDeleteButton: {
    backgroundColor: '#b64f44',
  },
  selectionDeleteText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    color: '#fffaf3',
  },
  list: {
    backgroundColor: '#fffaf3',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e4d8c4',
  },
  wordRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e9dece',
    gap: 12,
  },
  wordRowPressed: {
    backgroundColor: '#f7f0e5',
  },
  wordRowSelected: {
    backgroundColor: '#f3eadf',
  },
  selectionCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#cfc1ae',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fffaf3',
  },
  selectionCircleSelected: {
    borderColor: '#bf5630',
    backgroundColor: '#bf5630',
  },
  wordCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  wordTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  wordText: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 19,
    lineHeight: 24,
    color: '#29251f',
  },
  wordHanja: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 12,
    lineHeight: 16,
    color: '#a79a87',
  },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
  },
  wordDefinition: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    lineHeight: 17,
    color: '#756b5f',
  },
  wordMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  wordMetaText: {
    flex: 1,
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 14,
    color: '#a99e8c',
  },
  proficiencySummary: {
    width: 66,
    alignItems: 'flex-end',
    gap: 4,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proficiencyDot: {
    backgroundColor: '#ded8c9',
  },
  proficiencyLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10.5,
    lineHeight: 14,
  },
  emptyState: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...textStyles.sectionTitle,
  },
  emptyBody: {
    ...textStyles.bodyMuted,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: '#eee6d8',
  },
  detailHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#fffaf3',
    borderBottomWidth: 1,
    borderBottomColor: '#e4d8c4',
  },
  detailHeaderButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeaderTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    color: '#776d60',
  },
  detailContent: {
    paddingBottom: spacing.xl,
  },
  detailHero: {
    backgroundColor: '#fffaf3',
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingTop: 16,
    paddingBottom: 16,
    gap: spacing.xs,
  },
  detailWordLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  detailWord: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 32,
    lineHeight: 40,
    color: '#2b2721',
  },
  detailHanjaButton: {
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  detailHanja: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 14,
    lineHeight: 19,
    color: '#a79a87',
  },
  detailMeta: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: '#817568',
  },
  detailDefinition: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 17,
    lineHeight: 23,
    color: '#29251f',
  },
  maturityCard: {
    margin: LEARN_SIDE_PADDING,
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  maturityTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  maturityCopy: {
    flex: 1,
    gap: 4,
  },
  maturityTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 15,
    lineHeight: 20,
  },
  maturityDescription: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 15,
    color: '#807566',
  },
  detailStatsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  detailStat: {
    gap: 2,
  },
  detailStatValue: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 21,
    lineHeight: 26,
    color: '#2b2721',
  },
  detailStatLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10.5,
    lineHeight: 14,
    color: '#817568',
  },
  detailSectionTitle: {
    ...textStyles.eyebrow,
    color: '#817568',
    fontSize: 11,
    letterSpacing: 0.9,
    marginHorizontal: LEARN_SIDE_PADDING,
  },
  highlightSentence: {
    flex: 1,
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 15,
    lineHeight: 21,
    color: '#2b2721',
  },
  highlightedWord: {
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 3,
  },
  contextSection: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  contextRow: {
    backgroundColor: '#fffaf3',
    borderTopWidth: 1,
    borderColor: '#e4d8c4',
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingVertical: 8,
    gap: spacing.xs,
  },
  contextRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  contextSource: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: '#d77d4b',
  },
  contextDate: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    color: '#a99e8c',
  },
  emptyContext: {
    ...textStyles.bodyMuted,
  },
  detailActions: {
    borderTopWidth: 1,
    borderTopColor: '#e1d5c5',
    backgroundColor: '#e8dfd0',
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingVertical: 8,
  },
  deleteWordButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  deleteWordText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: '#d9857b',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: LEARN_SIDE_PADDING,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalCardWrap: {
    justifyContent: 'center',
  },
});

export default Learn;
