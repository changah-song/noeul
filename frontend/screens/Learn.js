import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import CandidateCard from '../components/vocab/CandidateCard';
import { Screen } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import { fetchHanjaRelated } from '../services/api/hanjaRelated';
import {
  addRelatedKnownWord,
  getAllBooksWordCandidates,
  getCachedPKnown,
  getVocabContexts,
  getRelatedKnownWords,
  insertData,
  logInteractionEvent,
  recordReviewOutcome,
  removeData,
  removeRelatedKnownWord,
  updateFavorite,
  viewData,
  vocabEntryExists,
} from '../services/Database';
import { deriveCandidateReason } from '../services/wordCandidates';
import { incrementWordsStudied } from '../services/dailyProgress';
import {
  recordCloudVocabReview,
  supabase,
  toggleCloudRelatedKnownWord,
} from '../services/supabase';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { requestUserDataSync } from '../services/userDataSyncQueue';
import { normalizeBookLanguage } from '../constants/languages';
import { colors, fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';

const FILTERS = [
  { key: 'starred', labelKey: 'learn.filters.starred', icon: 'star' },
  { key: 'recent', labelKey: 'learn.filters.recent' },
  { key: 'maturity', labelKey: 'learn.filters.maturity' },
  { key: 'not-seen', labelKey: 'learn.filters.notSeen' },
];

const createProficiencyLevels = (themeColors) => [
  {
    key: 'new',
    labelKey: 'learn.proficiency.new',
    rank: 1,
    color: themeColors.textSubtle,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.newDescription',
  },
  {
    key: 'growing',
    labelKey: 'learn.proficiency.growing',
    rank: 2,
    color: themeColors.textTertiary,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.growingDescription',
  },
  {
    key: 'familiar',
    labelKey: 'learn.proficiency.familiar',
    rank: 3,
    color: themeColors.textMuted,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.familiarDescription',
  },
  {
    key: 'mature',
    labelKey: 'learn.proficiency.mature',
    rank: 4,
    color: themeColors.accent,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.matureDescription',
  },
  {
    key: 'graduated',
    labelKey: 'learn.proficiency.graduated',
    rank: 5,
    color: themeColors.accent,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.graduatedDescription',
  },
];

const PROFICIENCY_LEVELS = createProficiencyLevels(colors);
const createProficiencyByKey = (levels) => levels.reduce((acc, level) => {
  acc[level.key] = level;
  return acc;
}, {});
const proficiencyByKey = createProficiencyByKey(PROFICIENCY_LEVELS);

const LearnThemeContext = createContext(null);
const useLearnTheme = () => (
  useContext(LearnThemeContext) ?? { colors, styles: defaultLearnStyles, proficiencyByKey }
);

const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const LEARN_SIDE_PADDING = 16;
const ENCOUNTER_DOT_COUNT = 4;
const DETAIL_CONTEXT_LIMIT = 2;
const DETAIL_HANJA_RELATED_PAGE_SIZE = 2;
const MONTH_SHORT_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_LONG_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const EMPTY_HANJA_LOOKUP = {
  firstTableData: [],
  similarWordsTableData: [],
};
const HANGUL_BASE_CODE = 0xAC00;
const HANGUL_END_CODE = 0xD7A3;
const HANGUL_INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];
const HANGUL_VOWELS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
  'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
const HANGUL_FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k',
  'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 't',
];

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');
const getHanjaCharacters = (value) => cleanText(value).split('').filter((char) => HANJA_RE.test(char));
const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const romanizeHangulSyllable = (character) => {
  const code = character.codePointAt(0);
  if (!Number.isFinite(code) || code < HANGUL_BASE_CODE || code > HANGUL_END_CODE) {
    return null;
  }

  const offset = code - HANGUL_BASE_CODE;
  const initialIndex = Math.floor(offset / 588);
  const vowelIndex = Math.floor((offset % 588) / 28);
  const finalIndex = offset % 28;

  return `${HANGUL_INITIALS[initialIndex] ?? ''}${HANGUL_VOWELS[vowelIndex] ?? ''}${HANGUL_FINALS[finalIndex] ?? ''}`;
};

const romanizeKoreanText = (value) => {
  const text = cleanText(value);
  let hasHangul = false;
  let previousWasHangul = false;
  let result = '';

  Array.from(text).forEach((character) => {
    const romanized = romanizeHangulSyllable(character);
    if (romanized) {
      result += `${previousWasHangul ? '-' : ''}${romanized}`;
      hasHangul = true;
      previousWasHangul = true;
      return;
    }

    result += character;
    previousWasHangul = false;
  });

  return hasHangul ? result : '';
};

const uniqueValues = (values) => [...new Set(values.map(cleanText).filter(Boolean))];

const normalizeReadingEntries = (entries = []) => {
  const seen = new Set();
  const normalized = [];

  entries.forEach((entry) => {
    const reading = cleanText(entry?.reading);
    const koreanMeaning = cleanText(entry?.hun_korean);
    const englishMeaning = cleanText(entry?.hun_display) || cleanText(entry?.meaning);
    const fallbackMeaning = cleanText(entry?.meaning);
    const key = `${reading}|${koreanMeaning}|${englishMeaning || fallbackMeaning}`;

    if ((!reading && !koreanMeaning && !englishMeaning && !fallbackMeaning) || seen.has(key)) {
      return;
    }

    seen.add(key);
    normalized.push({
      hanja: cleanText(entry?.hanja),
      reading,
      koreanMeaning,
      englishMeaning,
      fallbackMeaning,
    });
  });

  return normalized;
};

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

const formatShortDate = (value, fallback = 'NOT SEEN') => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  const date = new Date(timestamp);
  return `${MONTH_SHORT_LABELS[date.getMonth()] ?? ''} ${date.getDate()}`.trim() || fallback;
};

const formatLongDate = (value, fallback = '') => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  const date = new Date(timestamp);
  return `${MONTH_LONG_LABELS[date.getMonth()] ?? ''} ${date.getDate()}`.trim() || fallback;
};

const getExposureDotCount = (seenCount) => {
  const count = Number(seenCount) || 0;
  if (count >= 8) return 4;
  if (count >= 5) return 3;
  if (count >= 3) return 2;
  if (count >= 2) return 1;
  return 0;
};

const getPronunciation = (word) => (
  cleanText(word?.romanization)
  || cleanText(word?.pronunciation)
  || cleanText(word?.pinyin)
  || cleanText(word?.ipa)
  || (normalizeBookLanguage(word?.language ?? 'ko') === 'ko' ? romanizeKoreanText(word?.word) : '')
);

const cleanPartOfSpeech = (value) => {
  const text = cleanText(value);
  return text && !['n/a', 'unknown'].includes(text.toLowerCase()) ? text : '';
};

const getPartOfSpeech = (word) => (
  cleanPartOfSpeech(word?.part_of_speech)
  || cleanPartOfSpeech(word?.partOfSpeech)
  || cleanPartOfSpeech(word?.pos)
  || cleanPartOfSpeech(word?.dictionary_pos)
);

const POS_TRANSLATION_KEYS = {
  noun: 'pos.noun',
  n: 'pos.noun',
  'proper noun': 'pos.noun',
  명사: 'pos.noun',
  의존명사: 'pos.dependentNoun',
  '의존 명사': 'pos.dependentNoun',
  verb: 'pos.verb',
  v: 'pos.verb',
  동사: 'pos.verb',
  adverb: 'pos.adverb',
  d: 'pos.adverb',
  부사: 'pos.adverb',
  adjective: 'pos.adjective',
  a: 'pos.adjective',
  형용사: 'pos.adjective',
  modifier: 'pos.modifier',
  determiner: 'pos.determiner',
  관형사: 'pos.determiner',
  interjection: 'pos.interjection',
  감탄사: 'pos.interjection',
  pronoun: 'pos.pronoun',
  대명사: 'pos.pronoun',
  numeral: 'pos.numeral',
  수사: 'pos.numeral',
  particle: 'pos.particle',
  조사: 'pos.particle',
  affix: 'pos.affix',
  접사: 'pos.affix',
  ending: 'pos.ending',
  어미: 'pos.ending',
  'auxiliary verb': 'pos.auxiliaryVerb',
  'adverbial verb': 'pos.auxiliaryVerb',
  'verb noun': 'pos.auxiliaryVerb',
  보조동사: 'pos.auxiliaryVerb',
  '보조 동사': 'pos.auxiliaryVerb',
  'auxiliary adjective': 'pos.auxiliaryAdjective',
  'adverbial adjective': 'pos.auxiliaryAdjective',
  보조형용사: 'pos.auxiliaryAdjective',
  '보조 형용사': 'pos.auxiliaryAdjective',
};

const getPartOfSpeechLabel = (word, t) => {
  const rawPartOfSpeech = getPartOfSpeech(word);
  const normalized = rawPartOfSpeech.toLowerCase().replace(/\s+/g, ' ').trim();
  const translationKey = POS_TRANSLATION_KEYS[normalized] ?? POS_TRANSLATION_KEYS[rawPartOfSpeech];
  return translationKey ? t(translationKey) : rawPartOfSpeech;
};

const getContextTranslation = (context) => (
  cleanText(context?.translation)
  || cleanText(context?.translatedSentence)
  || cleanText(context?.translated_text)
  || cleanText(context?.translationText)
);

const getContextSource = (context, fallbackSource) => (
  cleanText(context?.sourceBookTitle)
  || cleanText(context?.source_book_title)
  || cleanText(context?.sourceTitle)
  || cleanText(context?.sourceBookUri)
  || cleanText(context?.source_book_uri)
  || fallbackSource
);

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

const getProficiency = (word, levelsByKey = proficiencyByKey) => {
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

  return levelsByKey[key] ?? levelsByKey.new;
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

const getFilteredWords = (rows, filter, levelsByKey = proficiencyByKey) => {
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
      const rankDiff = getProficiency(a, levelsByKey).rank - getProficiency(b, levelsByKey).rank;
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return getSeenCount(b) - getSeenCount(a);
    });
  }

  return sortRecent(rows);
};

const EncounterDots = ({ seenCount, size = 6 }) => {
  const { styles } = useLearnTheme();
  const filledCount = getExposureDotCount(seenCount);

  return (
    <View style={styles.dotRow}>
      {Array.from({ length: ENCOUNTER_DOT_COUNT }).map((_, index) => {
        const filled = index < filledCount;
        return (
          <View
            key={`encounter-dot-${index}`}
            style={[
              styles.encounterDot,
              filled ? styles.encounterDotFilled : styles.encounterDotEmpty,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const StatusBadge = ({ label }) => {
  const { styles } = useLearnTheme();

  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
};

const VocabularyRow = ({ word, onPress, onLongPress, selectionMode = false, selected = false }) => {
  const { t } = useTranslation();
  const { colors, styles } = useLearnTheme();
  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const lastSaw = formatShortDate(getLastSawDate(word), t('learn.notSeenDate').toUpperCase());
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
          {selected ? <Feather name="check" size={14} color={colors.white} /> : null}
        </View>
      ) : null}
      <View style={styles.wordCopy}>
        <View style={styles.wordTitleLine}>
          <Text numberOfLines={1} style={styles.wordText}>{word.word}</Text>
          {word.hanja ? <Text numberOfLines={1} style={styles.wordHanja}>{word.hanja}</Text> : null}
          {showNewBadge ? <StatusBadge label={t('learn.newBadge')} /> : null}
          {showNotSeenBadge ? <StatusBadge label={t('learn.notSeenBadge')} tone="amber" /> : null}
          {word.is_favorite ? <MaterialIcons name="star" size={16} color={colors.inkSlate} /> : null}
        </View>
        <Text numberOfLines={1} style={styles.wordDefinition}>{word.def || t('learn.noDefinition')}</Text>
        <View style={styles.wordMetaLine}>
          <Text numberOfLines={1} style={styles.wordMetaText}>
            {source} · ×{seenCount} · {lastSaw}
          </Text>
        </View>
      </View>

      <View style={styles.encounterSummary}>
        <EncounterDots seenCount={seenCount} />
      </View>
    </Pressable>
  );
};

const DetailHanjaPanel = ({ word, onKnownWordsChange }) => {
  const { interfaceLanguage } = useAppContext();
  const { activeOwnerId, syncGeneration, syncPaused } = useLocalOwner();
  const { t } = useTranslation();
  const { colors, styles } = useLearnTheme();
  const characters = useMemo(() => getHanjaCharacters(word?.hanja), [word?.hanja]);
  const charactersKey = characters.join('|');
  const [activeIndex, setActiveIndex] = useState(0);
  const [lookupByCharacter, setLookupByCharacter] = useState({});
  const [isLoadingLookup, setIsLoadingLookup] = useState(false);
  const [knownKeys, setKnownKeys] = useState(new Set());
  const [visibleRelatedCount, setVisibleRelatedCount] = useState(DETAIL_HANJA_RELATED_PAGE_SIZE);
  const sourceWord = cleanText(word?.word);
  const language = word?.language ?? 'ko';

  useEffect(() => {
    setActiveIndex(0);
  }, [charactersKey]);

  useEffect(() => {
    setVisibleRelatedCount(DETAIL_HANJA_RELATED_PAGE_SIZE);
  }, [activeIndex, charactersKey]);

  useEffect(() => {
    let isCancelled = false;
    const uniqueCharacters = [...new Set(characters)];

    setLookupByCharacter({});

    if (uniqueCharacters.length === 0) {
      setIsLoadingLookup(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingLookup(true);
    Promise.all(
      uniqueCharacters.map(async (character) => {
        try {
          const lookup = await fetchHanjaRelated(character, { interfaceLanguage });
          return [character, lookup ?? EMPTY_HANJA_LOOKUP];
        } catch (error) {
          console.warn(`[Learn] Hanja lookup failed for "${character}":`, error?.message ?? error);
          return [character, EMPTY_HANJA_LOOKUP];
        }
      })
    ).then((pairs) => {
      if (isCancelled) {
        return;
      }

      setLookupByCharacter(Object.fromEntries(pairs));
      setIsLoadingLookup(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [characters, charactersKey, interfaceLanguage]);

  useEffect(() => {
    let isCancelled = false;
    setKnownKeys(new Set());

    if (!sourceWord) {
      return () => {
        isCancelled = true;
      };
    }

    getRelatedKnownWords(sourceWord, language, { ownerId: activeOwnerId })
      .then((knownWords) => {
        if (!isCancelled) {
          setKnownKeys(new Set(knownWords.map(relatedWordKey)));
        }
      })
      .catch((error) => {
        console.warn(`[Learn] related known words load failed for "${sourceWord}":`, error?.message ?? error);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeOwnerId, language, sourceWord]);

  if (!word || characters.length === 0) {
    return null;
  }

  const safeActiveIndex = Math.max(0, Math.min(activeIndex, characters.length - 1));
  const activeHanja = characters[safeActiveIndex] ?? characters[0];
  const activeLookup = lookupByCharacter[activeHanja] ?? null;
  const isLoading = isLoadingLookup && !activeLookup;
  const titleRows = isLoading ? [] : activeLookup?.firstTableData ?? [];
  const relatedWords = isLoading ? [] : activeLookup?.similarWordsTableData ?? [];
  const visibleRelatedWords = relatedWords.slice(0, visibleRelatedCount);
  const canShowMoreRelatedWords = visibleRelatedWords.length < relatedWords.length;
  const readingEntries = normalizeReadingEntries(titleRows);
  const readingLabel = readingEntries
    .map((entry) => [entry.koreanMeaning, entry.reading].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' / ');
  const meaningLabel = uniqueValues(readingEntries.map((entry) => (
    entry.englishMeaning || entry.fallbackMeaning
  ))).join(', ');
  const canGoPrevious = safeActiveIndex > 0;
  const canGoNext = safeActiveIndex < characters.length - 1;

  const sourceWordDetails = {
    hanja: word.hanja ?? null,
    definition: word.def ?? null,
    level: word.level ?? 'unorganized',
    sourceBookUri: word.source_book_uri ?? null,
    sourceBookTitle: word.source_book_title ?? null,
    contextSentence: word.context_sentence ?? null,
    isFavorite: word.is_favorite,
    priority: word.priority ?? 'normal',
    createdAt: word.created_at ?? new Date().toISOString(),
    updatedAt: word.updated_at ?? new Date().toISOString(),
    lastReviewedAt: word.last_reviewed_at ?? null,
    nextReviewAt: word.next_review_at ?? null,
    correctCount: word.correct_count ?? 0,
    wrongCount: word.wrong_count ?? 0,
    stability: word.stability ?? 1,
    difficulty: word.difficulty ?? 5,
    language,
  };

  const goToPrevious = () => {
    if (canGoPrevious) {
      setActiveIndex(safeActiveIndex - 1);
    }
  };

  const goToNext = () => {
    if (canGoNext) {
      setActiveIndex(safeActiveIndex + 1);
    }
  };

  const handleKnownPress = async (entry) => {
    const key = relatedWordKey(entry);
    const known = knownKeys.has(key);
    const markedAt = new Date().toISOString();
    const knownEntry = {
      korean: entry.korean,
      hanja: entry.hanja,
      meaning: entry.meaning,
      sourceHanja: activeHanja,
      markedAt,
      updatedAt: markedAt,
    };
    const relation = {
      language,
      mainWord: sourceWord,
      mainHanja: sourceWordDetails.hanja,
      mainDefinition: sourceWordDetails.definition,
      relatedWord: knownEntry.korean,
      relatedHanja: knownEntry.hanja,
      relatedDefinition: knownEntry.meaning,
      sourceHanja: knownEntry.sourceHanja,
      markedAt,
      updatedAt: markedAt,
    };

    setKnownKeys((previous) => {
      const next = new Set(previous);
      if (known) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

    try {
      const nextKnownWords = known
        ? await removeRelatedKnownWord(sourceWord, knownEntry, language, {
          ownerId: activeOwnerId,
          mainHanja: sourceWordDetails.hanja,
          mainDefinition: sourceWordDetails.definition,
        })
        : await addRelatedKnownWord(sourceWord, knownEntry, {
          ownerId: activeOwnerId,
          createIfMissing: true,
          mainWord: sourceWordDetails,
          language,
        });

      setKnownKeys(new Set(nextKnownWords.map(relatedWordKey)));
      onKnownWordsChange?.();

      const ownerId = activeOwnerId;
      const generation = syncGeneration;
      supabase.auth.getUser()
        .then(({ data: { user } }) => {
          if (!user || syncPaused || ownerId !== user.id || !isCurrentSyncGeneration(generation)) {
            return null;
          }

          return toggleCloudRelatedKnownWord({
            user,
            ownerId,
            generation,
            known,
            relation,
            entry: {
              word: sourceWord,
              hanja: sourceWordDetails.hanja,
              definition: sourceWordDetails.definition,
              level: sourceWordDetails.level,
              status: sourceWordDetails.level,
              sourceBookUri: sourceWordDetails.sourceBookUri,
              sourceBookTitle: sourceWordDetails.sourceBookTitle,
              contextSentence: sourceWordDetails.contextSentence,
              isFavorite: sourceWordDetails.isFavorite,
              priority: sourceWordDetails.priority,
              createdAt: sourceWordDetails.createdAt,
              updatedAt: markedAt,
              lastReviewedAt: sourceWordDetails.lastReviewedAt,
              nextReviewAt: sourceWordDetails.nextReviewAt,
              correctCount: sourceWordDetails.correctCount,
              wrongCount: sourceWordDetails.wrongCount,
              stability: sourceWordDetails.stability,
              difficulty: sourceWordDetails.difficulty,
              language,
            },
          });
        })
        .catch((syncError) => {
          console.warn(`[Learn] related known word cloud sync failed for "${sourceWord}":`, syncError?.message ?? syncError);
        });
    } catch (error) {
      console.warn(`[Learn] related known word toggle failed for "${sourceWord}":`, error?.message ?? error);
    }
  };

  return (
    <View style={styles.detailHanjaPanel}>
      <View style={styles.detailHanjaPanelHeader}>
        <Text selectable style={styles.detailHanjaPanelCharacter}>{activeHanja}</Text>
        <View style={styles.detailHanjaPanelCopy}>
          <Text style={styles.detailHanjaPanelEyebrow}>{t('learn.hanjaCharacter')}</Text>
          <Text selectable numberOfLines={2} style={styles.detailHanjaPanelMeaning}>
            {readingLabel || (isLoading ? t('common.loading') : t('hanja.meaningUnavailable'))}
            {meaningLabel ? ` · ${meaningLabel}` : ''}
          </Text>
        </View>
        <View style={styles.detailHanjaPanelNav}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('hanja.previous')}
            disabled={!canGoPrevious}
            onPress={goToPrevious}
            style={[styles.hanjaPanelArrow, !canGoPrevious && styles.hanjaPanelArrowDisabled]}
          >
            <Feather
              name="chevron-left"
              size={16}
              color={canGoPrevious ? colors.textTertiary : colors.textSubtle}
            />
          </TouchableOpacity>
          <Text style={styles.detailHanjaPanelCount}>
            {t('learn.hanjaCount', { current: safeActiveIndex + 1, total: characters.length })}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('hanja.next')}
            disabled={!canGoNext}
            onPress={goToNext}
            style={[styles.hanjaPanelArrow, !canGoNext && styles.hanjaPanelArrowDisabled]}
          >
            <Feather
              name="chevron-right"
              size={16}
              color={canGoNext ? colors.textTertiary : colors.textSubtle}
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.detailHanjaDivider} />

      {isLoading ? (
        <View style={styles.hanjaPanelEmpty}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.hanjaPanelEmptyText}>{t('hanja.loading')}</Text>
        </View>
      ) : visibleRelatedWords.length > 0 ? (
        <>
          {visibleRelatedWords.map((relatedWord, index) => {
            const known = knownKeys.has(relatedWordKey(relatedWord));
            return (
              <View
                key={`${relatedWord.korean}-${relatedWord.hanja}-${index}`}
                style={[
                  styles.detailHanjaRelatedRow,
                  index > 0 && styles.detailHanjaRelatedRowSeparated,
                ]}
              >
                <View style={styles.detailHanjaRelatedCopy}>
                  <Text selectable numberOfLines={1} style={styles.detailHanjaRelatedWord}>{relatedWord.korean}</Text>
                  <Text selectable style={styles.detailHanjaRelatedMeaning}>
                    {relatedWord.meaning || t('hanja.meaningUnavailable')}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={known
                    ? t('hanja.markedKnown', { word: relatedWord.korean })
                    : t('hanja.markKnown', { word: relatedWord.korean })}
                  onPress={() => handleKnownPress(relatedWord)}
                  style={styles.detailHanjaKnownButton}
                >
                  {known ? <Feather name="check" size={14} color={colors.text} /> : null}
                  <Text style={[
                    styles.detailHanjaKnownButtonText,
                    !known && styles.detailHanjaKnownButtonTextAction,
                  ]}>
                    {known ? t('learn.known') : t('learn.markKnown')}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {canShowMoreRelatedWords ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('common.seeMore')}
              onPress={() => setVisibleRelatedCount((count) => count + DETAIL_HANJA_RELATED_PAGE_SIZE)}
              style={styles.detailHanjaSeeMoreButton}
            >
              <Text style={styles.detailHanjaSeeMoreText}>{t('common.seeMore')}</Text>
              <Feather name="chevron-down" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </>
      ) : (
        <View style={styles.hanjaPanelEmpty}>
          <Text style={styles.hanjaPanelEmptyText}>{t('hanja.none')}</Text>
        </View>
      )}
    </View>
  );
};

const WordDetailModal = ({
  word,
  contexts = [],
  onClose,
  onToggleFavorite,
  onKnownWordsChange,
}) => {
  const { t } = useTranslation();
  const { colors, styles, proficiencyByKey } = useLearnTheme();

  if (!word) {
    return null;
  }

  const proficiency = getProficiency(word, proficiencyByKey);
  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const isKoreanWord = normalizeBookLanguage(word.language ?? 'ko') === 'ko';
  const hanjaCharacters = getHanjaCharacters(word.hanja);
  const pronunciation = getPronunciation(word);
  const detailStatus = proficiency.rank >= proficiencyByKey.mature.rank
    ? t('learn.detailStatus.mature')
    : (proficiency.rank === proficiencyByKey.new.rank
      ? t('learn.detailStatus.new')
      : t('learn.detailStatus.waiting'));
  const contextRows = contexts.length > 0
    ? contexts
    : (cleanText(word.context_sentence)
      ? [{
        sentence: word.context_sentence,
        sourceBookTitle: word.source_book_title,
        sourceBookUri: word.source_book_uri,
        seenAt: getLastSawDate(word),
      }]
      : []);
  const visibleContexts = contextRows.slice(0, DETAIL_CONTEXT_LIMIT);
  const partOfSpeech = getPartOfSpeechLabel(word, t);

  return (
    <SafeAreaView edges={['top']} style={styles.detailScreen}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onClose} style={styles.detailBackButton}>
          <MaterialIcons name="arrow-back" size={28} color={colors.text} />
          <Text style={styles.detailBackLabel}>{t('learn.vocabulary')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onToggleFavorite} style={styles.detailFavoriteButton}>
          <MaterialIcons
            name={word.is_favorite ? 'star' : 'star-outline'}
            size={28}
            color={word.is_favorite ? colors.accent : colors.textSubtle}
          />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailContent}>
        <View style={styles.detailHero}>
          <View style={styles.detailWordLine}>
            <Text selectable style={styles.detailWord}>{word.word}</Text>
            {isKoreanWord && hanjaCharacters.length > 0 ? (
              <Text selectable style={styles.detailHanja}>{word.hanja}</Text>
            ) : null}
            {pronunciation ? <Text selectable style={styles.detailPronunciation}>{pronunciation}</Text> : null}
          </View>
          <View style={styles.detailMetaLine}>
            <View style={styles.detailStatusPill}>
              <Text style={styles.detailStatusText}>{detailStatus}</Text>
            </View>
            <Text style={styles.detailEncounterMeta}>×{seenCount} {t('learn.encounters')}</Text>
          </View>
          <View style={styles.definitionBlock}>
            {partOfSpeech ? <Text style={styles.definitionPartOfSpeech}>{partOfSpeech}</Text> : null}
            <Text selectable style={styles.detailDefinition}>{word.def || t('learn.noDefinition')}</Text>
          </View>
        </View>

        <View style={styles.contextSection}>
          <Text style={styles.detailSectionTitle}>{t('learn.seenIn')}</Text>
          {visibleContexts.length > 0 ? (
            visibleContexts.map((context, index) => {
              const sourceLabel = getContextSource(context, source);
              const dateLabel = formatLongDate(context.seenAt ?? context.seen_at ?? getLastSawDate(word));
              const translation = getContextTranslation(context);
              return (
                <View
                  key={`${context.sentence}-${context.seenAt ?? context.seen_at ?? ''}-${index}`}
                  style={styles.contextQuoteRow}
                >
                  <Text style={styles.contextQuoteMark}>“</Text>
                  <View style={styles.contextQuoteCopy}>
                    <Text selectable style={styles.contextSentence}>{cleanText(context.sentence)}</Text>
                    {translation ? (
                      <Text selectable style={styles.contextTranslation}>{translation}</Text>
                    ) : null}
                    <Text style={styles.contextAttribution}>
                      — {sourceLabel}{dateLabel ? ` · ${dateLabel}` : ''}
                    </Text>
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.contextQuoteRow}>
              <Text style={styles.contextQuoteMark}>“</Text>
              <View style={styles.contextQuoteCopy}>
                <Text style={styles.emptyContext}>{t('learn.noContext')}</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.detailStatsGrid}>
          <View style={styles.detailStatCard}>
            <Text style={styles.detailStatLabel}>{t('learn.encounters')}</Text>
            <Text style={styles.detailStatValue}>{seenCount}</Text>
          </View>
          <View style={styles.detailStatCard}>
            <Text style={styles.detailStatLabel}>{t('learn.daysTracked')}</Text>
            <Text style={styles.detailStatValue}>{getDistinctDays(word)}</Text>
          </View>
        </View>

        {isKoreanWord ? (
          <DetailHanjaPanel word={word} onKnownWordsChange={onKnownWordsChange} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const Learn = ({ navigation, user }) => {
  const { t } = useTranslation();
  const { targetLanguage, interfaceLanguage } = useAppContext();
  const { activeOwnerId, syncGeneration, syncPaused } = useLocalOwner();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const proficiencyLevels = useMemo(() => createProficiencyLevels(colors), [colors]);
  const proficiencyByKey = useMemo(() => createProficiencyByKey(proficiencyLevels), [proficiencyLevels]);
  const learnThemeValue = useMemo(() => ({
    colors,
    styles,
    proficiencyByKey,
  }), [colors, proficiencyByKey, styles]);
  const [words, setWords] = useState([]);
  const [mainTab, setMainTab] = useState('saved');
  const [candidateGroups, setCandidateGroups] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [savedCandidateStems, setSavedCandidateStems] = useState(() => new Set());
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
    setCandidateGroups([]);
    setCandidatesLoaded(false);
    setSavedCandidateStems(new Set());
    fetchWords();
  }, [activeOwnerId, fetchWords, targetLanguage]);

  // Suggested tab: unsaved candidate words grouped by book, loaded on demand the
  // first time the reader opens the tab (and refreshable via pull/retry).
  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    try {
      const groups = await getAllBooksWordCandidates({
        ownerId: activeOwnerId,
        language: targetLanguage,
        interfaceLanguage,
      });
      const withReasons = groups.map((group) => ({
        ...group,
        candidates: group.candidates.map((candidate) => ({
          ...candidate,
          reason: deriveCandidateReason(candidate),
          bookUri: group.bookUri,
          bookTitle: group.bookTitle,
        })),
      }));
      setCandidateGroups(withReasons);
      setCandidatesLoaded(true);
    } catch (error) {
      console.warn('[Learn] Failed to load word candidates:', error?.message ?? error);
      setCandidateGroups([]);
      setCandidatesLoaded(true);
    } finally {
      setCandidatesLoading(false);
    }
  }, [activeOwnerId, targetLanguage, interfaceLanguage]);

  useEffect(() => {
    if (mainTab === 'suggested' && !candidatesLoaded && !candidatesLoading) {
      loadCandidates();
    }
  }, [mainTab, candidatesLoaded, candidatesLoading, loadCandidates]);

  const handleSaveCandidate = useCallback(async (candidate) => {
    const word = candidate?.stem;
    if (!word) return;
    const hanja = candidate.hanja || '';
    const definition = candidate.gloss || '';
    // Reflect the save immediately, then persist.
    setSavedCandidateStems((prev) => new Set(prev).add(word));
    try {
      const alreadySaved = await vocabEntryExists(word, hanja, definition, targetLanguage, {
        ownerId: activeOwnerId,
      });
      if (!alreadySaved) {
        const createdAt = new Date().toISOString();
        const pKnown = await getCachedPKnown({
          ownerId: activeOwnerId,
          language: targetLanguage,
          word,
        });
        await insertData(word, hanja, definition, {
          ownerId: activeOwnerId,
          level: 'unorganized',
          sourceBookUri: candidate.bookUri ?? null,
          sourceBookTitle: candidate.bookTitle ?? null,
          createdAt,
          updatedAt: createdAt,
          language: targetLanguage,
          pKnown,
        });
      }
      requestUserDataSync('learn-candidate-save');
      logInteractionEvent({
        ownerId: activeOwnerId,
        language: targetLanguage,
        word,
        hanja,
        def: definition,
        eventType: 'save',
        sourceBookUri: candidate.bookUri ?? null,
      }).catch(() => {});
      fetchWords();
    } catch (error) {
      console.warn('[Learn] Failed to save candidate word:', error?.message ?? error);
      // Roll back the optimistic mark so the reader can retry.
      setSavedCandidateStems((prev) => {
        const next = new Set(prev);
        next.delete(word);
        return next;
      });
    }
  }, [activeOwnerId, targetLanguage, fetchWords]);

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

  const visibleWords = useMemo(
    () => getFilteredWords(words, activeFilter, proficiencyByKey),
    [activeFilter, proficiencyByKey, words]
  );
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
    () => words.filter((word) => getProficiency(word, proficiencyByKey).rank >= proficiencyByKey.mature.rank).length,
    [proficiencyByKey, words]
  );
  const waitingCount = useMemo(
    () => words.filter((word) => {
      const rank = getProficiency(word, proficiencyByKey).rank;
      return rank > proficiencyByKey.new.rank && rank < proficiencyByKey.mature.rank;
    }).length,
    [proficiencyByKey, words]
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

  const syncFieldsToCloud = useCallback(async () => {
    requestUserDataSync('learn-vocab-fields');
  }, []);

  const deleteSavedWord = useCallback(async (word) => {
    await removeData(word.word, word.hanja, word.def, word.language ?? 'ko', { ownerId: activeOwnerId });
    requestUserDataSync('learn-vocab-delete');

    logInteractionEvent({
      ownerId: activeOwnerId,
      language: word.language ?? 'ko',
      word: word.word,
      hanja: word.hanja,
      def: word.def,
      eventType: 'unsave',
      vocabId: word.id ?? null,
    }).catch((error) => {
      console.warn('[Learn] Failed to log unsave interaction event:', error);
    });
  }, [activeOwnerId]);

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
      for (const word of selectedWords) {
        try {
          await deleteSavedWord(word);
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
      const reviewedAt = updatedWord.last_reviewed_at ?? updatedWord.updated_at ?? new Date().toISOString();
      let syncedReview = false;

      if (
        user?.id
        && !syncPaused
        && activeOwnerId === user.id
        && isCurrentSyncGeneration(syncGeneration)
      ) {
        try {
          await recordCloudVocabReview({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
            entry: updatedWord,
            review: {
              outcome: status,
              next_status: updatedWord.level,
              reviewed_at: reviewedAt,
              last_reviewed_at: reviewedAt,
              next_review_at: updatedWord.next_review_at,
              stability: updatedWord.stability,
              difficulty: updatedWord.difficulty,
              correct_count: updatedWord.correct_count,
              wrong_count: updatedWord.wrong_count,
              updated_at: updatedWord.updated_at ?? reviewedAt,
            },
          });
          syncedReview = true;
        } catch (error) {
          console.warn('[Learn] Cloud review sync failed; queueing full vocab sync:', error?.message ?? error);
        }
      }

      if (!syncedReview) {
        await syncFieldsToCloud(updatedWord);
      }
    }

    if (practiceIndex >= practiceDeck.words.length - 1) {
      closePractice();
      return;
    }

    setPracticeIndex((prev) => prev + 1);
  }, [
    activeOwnerId,
    closePractice,
    fetchWords,
    practiceDeck,
    practiceIndex,
    syncFieldsToCloud,
    syncGeneration,
    syncPaused,
    user,
  ]);

  if (selectedWord) {
    return (
      <LearnThemeContext.Provider value={learnThemeValue}>
        <WordDetailModal
          word={selectedWord}
          contexts={selectedWordContexts}
          onClose={() => setSelectedWord(null)}
          onToggleFavorite={() => handleToggleFavorite(selectedWord)}
          onKnownWordsChange={fetchWords}
        />
      </LearnThemeContext.Provider>
    );
  }

  return (
    <LearnThemeContext.Provider value={learnThemeValue}>
    <Screen scroll backgroundColor={colors.bgPage} contentContainerStyle={styles.content}>
      <View style={styles.appTopBar}>
        <View style={styles.appTopSide} />
        <Text style={styles.appTopTitle}>{t('learn.vocabulary')}</Text>
        <View style={styles.appTopSide} />
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryStats}>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, styles.summaryValueGreen]}>{maturedCount}</Text>
            <Text style={styles.summaryLabel}>{t('learn.matured')}</Text>
          </View>
          <View style={styles.summaryStatDivider} />
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, styles.summaryValueAmber]}>{waitingCount}</Text>
            <Text style={styles.summaryLabel}>{t('learn.waiting')}</Text>
          </View>
          <View style={styles.summaryStatDivider} />
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>{notSeenCount}</Text>
            <Text style={styles.summaryLabel}>{t('learn.notSeen')}</Text>
          </View>
        </View>

        <View style={styles.summaryActions}>
          <TouchableOpacity
            disabled={reviewDeck.length === 0}
            onPress={() => startPractice(reviewDeck, reviewDeckTitle)}
            style={[styles.reviewButton, reviewDeck.length === 0 && styles.reviewButtonDisabled]}
          >
            <Text style={[
              styles.reviewButtonText,
              reviewDeck.length === 0 && styles.reviewButtonTextDisabled,
            ]}>
              {reviewDeck.length > 0 ? t('learn.reviewDueCount', { count: reviewDeck.length }) : t('learn.noReviews')}
            </Text>
          </TouchableOpacity>
          {words.length > 0 ? (
            <TouchableOpacity
              onPress={() => navigation?.navigate?.('Read', { returnTo: 'Learn' })}
              style={[styles.keepReadingButton, words.length === 0 && styles.keepReadingButtonFull]}
            >
              <Text style={styles.keepReadingText}>{t('learn.keepReading')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.mainTabs}>
        <TouchableOpacity
          onPress={() => setMainTab('saved')}
          style={[styles.mainTab, mainTab === 'saved' && styles.mainTabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: mainTab === 'saved' }}
        >
          <Text style={[styles.mainTabText, mainTab === 'saved' && styles.mainTabTextActive]}>
            {t('learn.savedTab')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMainTab('suggested')}
          style={[styles.mainTab, mainTab === 'suggested' && styles.mainTabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: mainTab === 'suggested' }}
        >
          <Text style={[styles.mainTabText, mainTab === 'suggested' && styles.mainTabTextActive]}>
            {t('learn.suggestedTab')}
          </Text>
        </TouchableOpacity>
      </View>

      {mainTab === 'saved' ? (
      <>
      <View style={styles.filters}>
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
                  color={active ? colors.textMuted : colors.textSubtle}
                />
              ) : (
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{t(filter.labelKey)}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {isSelectionMode ? (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={clearWordSelection} style={styles.selectionBarButton}>
            <Feather name="x" size={17} color={colors.textMuted} />
            <Text style={styles.selectionBarButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>

          <Text style={styles.selectionCount}>
            {t('common.selected', { count: selectedWords.length })}
          </Text>

          <TouchableOpacity onPress={handleBulkDelete} style={[styles.selectionBarButton, styles.selectionDeleteButton]}>
            <Feather name="trash-2" size={17} color={colors.white} />
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
          visibleWords.map((word, index) => (
            <VocabularyRow
              key={`${getWordKey(word)}::${index}`}
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
      </>
      ) : (
        <View style={styles.suggestedWrap}>
          {candidatesLoading && !candidatesLoaded ? (
            <View style={styles.suggestedLoading}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : candidateGroups.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('learn.suggestedEmptyTitle')}</Text>
              <Text style={styles.emptyBody}>{t('learn.suggestedEmptyBody')}</Text>
            </View>
          ) : (
            candidateGroups.map((group) => (
              <View key={group.bookUri} style={styles.candidateGroup}>
                <Text style={styles.candidateGroupTitle} numberOfLines={1}>
                  {group.bookTitle || t('learn.untitledBook')}
                </Text>
                <View style={styles.candidateGroupList}>
                  {group.candidates.map((candidate) => (
                    <CandidateCard
                      key={`${group.bookUri}::${candidate.stem}`}
                      candidate={candidate}
                      colors={colors}
                      saved={savedCandidateStems.has(candidate.stem)}
                      onSave={handleSaveCandidate}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      <Modal animationType="slide" visible={!!practiceDeck} onRequestClose={closePractice}>
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
      </Modal>
    </Screen>
    </LearnThemeContext.Provider>
  );
};

const createStyles = (colors) => StyleSheet.create({
  content: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
  },
  appTopBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.bgPage,
  },
  appTopSide: {
    width: 70,
  },
  appTopTitle: {
    flex: 1,
    textAlign: 'center',
    ...textStyles.appTitle,
  },
  summaryCard: {
    marginHorizontal: 24,
    marginTop: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 18,
  },
  summaryStats: {
    flexDirection: 'row',
    gap: 0,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryStatDivider: {
    width: 1,
    backgroundColor: colors.divider,
    marginVertical: 0,
  },
  summaryValue: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 26,
    lineHeight: 31,
    color: colors.text,
  },
  summaryValueGreen: {
    color: colors.text,
  },
  summaryValueAmber: {
    color: colors.text,
  },
  summaryLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textTertiary,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  summaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  keepReadingButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 3,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
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
    fontSize: 11,
    letterSpacing: 1.8,
    color: colors.text,
    textTransform: 'uppercase',
  },
  reviewButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.accent,
  },
  reviewButtonDisabled: {
    opacity: 0.48,
  },
  reviewButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    letterSpacing: 1.8,
    color: colors.white,
    textTransform: 'uppercase',
  },
  reviewButtonTextDisabled: {
    color: colors.white,
  },
  filters: {
    marginHorizontal: 24,
    marginTop: 24,
    flexDirection: 'row',
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  filterChip: {
    borderRadius: 0,
    borderWidth: 0,
    minHeight: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 10,
    backgroundColor: colors.transparent,
  },
  filterIconChip: {
    width: 36,
    paddingHorizontal: 0,
  },
  filterChipActive: {
    backgroundColor: colors.transparent,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
    paddingBottom: 8,
  },
  filterText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.8,
    color: colors.textSubtle,
    textTransform: 'uppercase',
  },
  filterTextActive: {
    color: colors.text,
  },
  listHeader: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listEyebrow: {
    ...textStyles.eyebrow,
    color: colors.textTertiary,
    fontSize: 10,
    letterSpacing: 2,
  },
  listCount: {
    ...textStyles.caption,
    color: colors.textSubtle,
  },
  selectionBar: {
    marginHorizontal: LEARN_SIDE_PADDING,
    minHeight: 42,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surfaceMuted,
  },
  selectionBarButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    color: colors.textMuted,
  },
  selectionCount: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: colors.text,
  },
  selectionDeleteButton: {
    backgroundColor: colors.accent,
  },
  selectionDeleteText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    color: colors.white,
  },
  list: {
    marginHorizontal: 24,
    backgroundColor: colors.bgPage,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  wordRowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  wordRowSelected: {
    backgroundColor: colors.surfaceMuted,
  },
  selectionCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  selectionCircleSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  wordCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  wordTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  wordText: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 17,
    lineHeight: 24,
    color: colors.text,
  },
  wordHanja: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSubtle,
  },
  badge: {
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  wordDefinition: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  wordMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  wordMetaText: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSubtle,
    letterSpacing: 0.5,
  },
  encounterSummary: {
    width: 76,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  encounterDot: {
    borderWidth: 1,
  },
  encounterDotFilled: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  encounterDotEmpty: {
    backgroundColor: colors.transparent,
    borderColor: colors.borderStrong,
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
  mainTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginHorizontal: 24,
    marginTop: 20,
    backgroundColor: colors.surfaceMuted ?? colors.divider,
    borderRadius: radii.pill,
    padding: 4,
  },
  mainTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  mainTabActive: {
    backgroundColor: colors.bgPage,
  },
  mainTabText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 14,
    color: colors.textSubtle,
  },
  mainTabTextActive: {
    color: colors.textMuted,
  },
  suggestedWrap: {
    paddingHorizontal: 24,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  suggestedLoading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  candidateGroup: {
    gap: spacing.sm,
  },
  candidateGroupTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSubtle,
  },
  candidateGroupList: {
    gap: spacing.sm,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  detailHeader: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: colors.bgPage,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailBackButton: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 12,
  },
  detailBackLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
    letterSpacing: 2.4,
  },
  detailFavoriteButton: {
    width: 42,
    height: 40,
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexDirection: 'row',
  },
  detailContent: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 0,
  },
  detailHero: {
    backgroundColor: colors.bgPage,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
  },
  detailWordLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 14,
    flexWrap: 'wrap',
  },
  detailWord: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 36,
    lineHeight: 48,
    color: colors.text,
  },
  detailHanja: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 22,
    lineHeight: 30,
    color: colors.textMuted,
  },
  detailPronunciation: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textTertiary,
  },
  detailMetaLine: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailStatusPill: {
    minHeight: 24,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  detailStatusText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  detailEncounterMeta: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textTertiary,
  },
  definitionBlock: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    flexWrap: 'wrap',
    paddingTop: 0,
    width: '100%',
  },
  definitionPartOfSpeech: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.6,
    color: '#9a9c9f',
    textTransform: 'uppercase',
  },
  detailDefinition: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamilies.displayMedium,
    fontSize: 22,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'left',
  },
  detailSectionTitle: {
    fontFamily: fontFamilies.sansBold,
    color: colors.textTertiary,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
  },
  contextSection: {
    paddingHorizontal: 0,
    paddingTop: 26,
    gap: 14,
  },
  contextQuoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  contextQuoteMark: {
    width: 30,
    fontFamily: fontFamilies.displayMedium,
    fontSize: 20,
    lineHeight: 22,
    color: colors.textSubtle,
  },
  contextQuoteCopy: {
    flex: 1,
    gap: 5,
  },
  contextSentence: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 16,
    lineHeight: 29,
    color: colors.text,
  },
  contextTranslation: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  contextAttribution: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSubtle,
  },
  emptyContext: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  detailStatsGrid: {
    marginTop: 24,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  detailStatCard: {
    flex: 1,
    minHeight: 74,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 14,
  },
  detailStatLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textSubtle,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  detailStatValue: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 24,
    lineHeight: 30,
    color: colors.text,
  },
  detailHanjaPanel: {
    marginHorizontal: 0,
    marginTop: 20,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    padding: 18,
  },
  detailHanjaPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailHanjaPanelCharacter: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 38,
    lineHeight: 44,
    color: colors.text,
  },
  detailHanjaPanelCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  detailHanjaPanelEyebrow: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textTertiary,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  detailHanjaPanelMeaning: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  detailHanjaPanelNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 32,
  },
  detailHanjaPanelCount: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textTertiary,
    minWidth: 38,
    textAlign: 'center',
  },
  hanjaPanelArrow: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hanjaPanelArrowDisabled: {
    opacity: 0.28,
  },
  hanjaCharacterRail: {
    paddingTop: 14,
    gap: 8,
  },
  hanjaCharacterChip: {
    minWidth: 34,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  hanjaCharacterChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  hanjaCharacterChipText: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 19,
    lineHeight: 24,
    color: colors.textMuted,
  },
  hanjaCharacterChipTextActive: {
    color: colors.white,
  },
  detailHanjaDivider: {
    height: 1,
    backgroundColor: '#ddd9d9',
    marginTop: 14,
  },
  hanjaPanelEmpty: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  hanjaPanelEmptyText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
  },
  detailHanjaRelatedRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  detailHanjaRelatedRowSeparated: {
    borderTopWidth: 1,
    borderTopColor: '#ddd9d9',
  },
  detailHanjaRelatedCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 4,
  },
  detailHanjaRelatedWord: {
    width: '100%',
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  detailHanjaRelatedMeaning: {
    width: '100%',
    flexShrink: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  detailHanjaKnownButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  detailHanjaKnownButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.2,
    color: colors.text,
    textTransform: 'uppercase',
  },
  detailHanjaKnownButtonTextAction: {
    color: colors.textTertiary,
    borderBottomWidth: 1,
    borderBottomColor: colors.frame,
    paddingBottom: 1,
  },
  detailHanjaSeeMoreButton: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailHanjaSeeMoreText: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
});

const defaultLearnStyles = createStyles(colors);

export default Learn;
