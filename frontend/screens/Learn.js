import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialIcons } from '@expo/vector-icons';

import Flashcard from '../components/Learn/Flashcard';
import CandidateCard from '../components/vocab/CandidateCard';
import { PaperButton, PaperSheet, PaperTabs, PressableScale, Screen } from '../components/ui';
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
  restoreLearnedWord,
  viewData,
  vocabEntryExists,
} from '../services/Database';
import { deriveCandidateReason } from '../services/wordCandidates';
import { LEARNED_LEVEL } from '../services/savedWordFade';
import { incrementWordsStudied } from '../services/dailyProgress';
import {
  recordCloudVocabReview,
  supabase,
  toggleCloudRelatedKnownWord,
} from '../services/supabase';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { requestUserDataSync } from '../services/userDataSyncQueue';
import { normalizeBookLanguage } from '../constants/languages';
import { colors, fontFamilies, spacing, textStyles, useTheme } from '../theme';
import {
  fadeTo,
  project,
  rubberband,
  springs,
  springTo,
  useReducedMotion,
} from '../theme/motion';
import { tapSelect } from '../services/haptics';

const FILTERS = [
  { key: 'recent', labelKey: 'learn.filters.recent' },
  { key: 'starred', labelKey: 'learn.filters.starred' },
  { key: 'maturity', labelKey: 'learn.filters.maturity' },
  { key: 'not-seen', labelKey: 'learn.filters.notSeen' },
];

// Stage ink (Paper): new reads warm red, growing amber, familiar the teal
// tint, mature and graduated green. All theme tokens, so dark mode follows.
const createProficiencyLevels = (themeColors) => [
  {
    key: 'new',
    labelKey: 'learn.proficiency.new',
    rank: 1,
    color: themeColors.danger,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.newDescription',
  },
  {
    key: 'growing',
    labelKey: 'learn.proficiency.growing',
    rank: 2,
    color: themeColors.warning,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.growingDescription',
  },
  {
    key: 'familiar',
    labelKey: 'learn.proficiency.familiar',
    rank: 3,
    color: themeColors.tint,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.familiarDescription',
  },
  {
    key: 'mature',
    labelKey: 'learn.proficiency.mature',
    rank: 4,
    color: themeColors.success,
    soft: themeColors.surfaceMuted,
    descriptionKey: 'learn.proficiency.matureDescription',
  },
  {
    key: 'graduated',
    labelKey: 'learn.proficiency.graduated',
    rank: 5,
    color: themeColors.success,
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
const LEARN_SIDE_PADDING = 24;
// Horizontal drag (px) before the word page commits to following the finger.
const DETAIL_DRAG_SLOP = 12;
const DETAIL_CONTEXT_LIMIT = 2;
const DETAIL_HANJA_RELATED_PAGE_SIZE = 2;
const MONTH_SHORT_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
const capitalizeFirst = (value) => (
  value ? `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}` : value
);

// Paper strings added with the redesign fall back to English until
// translations.js carries them (translate() returns the bare key otherwise).
const copyWithFallback = (t, key, fallback, params = {}) => {
  const value = t(key, params);
  if (value !== key) {
    return value;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_, name) => (
    params[name] == null ? '' : String(params[name])
  ));
};
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

const VocabularyRow = ({ word, onPress, onLongPress, selectionMode = false, selected = false }) => {
  const { t } = useTranslation();
  const { colors, styles, proficiencyByKey } = useLearnTheme();
  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const lastSaw = formatShortDate(getLastSawDate(word), t('learn.notSeenDate'));
  const showNewBadge = isRecentlySaved(word);
  const showNotSeenBadge = !showNewBadge && isNotSeenLately(word);
  const proficiency = getProficiency(word, proficiencyByKey);
  const stageLabel = t(proficiency.labelKey);
  const definition = word.def || t('learn.noDefinition');
  const meta = [
    source,
    `×${seenCount}`,
    lastSaw,
    showNotSeenBadge ? t('learn.filters.notSeen') : null,
  ].filter(Boolean).join(' · ');

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      scaleTo={0.98}
      hitSlop={0}
      accessibilityRole="button"
      accessibilityLabel={[
        word.word,
        definition,
        stageLabel,
        word.is_favorite ? t('learn.filters.starred') : null,
        showNewBadge && proficiency.key !== 'new' ? t('learn.proficiency.new') : null,
      ].filter(Boolean).join(', ')}
      accessibilityState={selectionMode ? { selected } : undefined}
      style={styles.wordRow}
    >
      {selectionMode ? (
        <View style={[styles.selectionCircle, selected && styles.selectionCircleSelected]}>
          {selected ? <Feather name="check" size={14} color={colors.onInk} /> : null}
        </View>
      ) : null}
      <View style={styles.wordCopy}>
        <View style={styles.wordTitleLine}>
          <Text numberOfLines={1} style={styles.wordText}>{word.word}</Text>
          {word.hanja ? <Text numberOfLines={1} style={styles.wordHanja}>{word.hanja}</Text> : null}
          {showNewBadge ? <View style={styles.newDot} /> : null}
        </View>
        <Text numberOfLines={2} style={styles.wordDefinition}>{definition}</Text>
        <Text numberOfLines={1} style={styles.wordMetaText}>{meta}</Text>
      </View>

      <View style={styles.wordAside}>
        <Text style={[styles.stageText, { color: proficiency.color }]}>{stageLabel}</Text>
        {word.is_favorite ? <MaterialIcons name="star" size={16} color={colors.tint} /> : null}
      </View>
    </PressableScale>
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
      <Text style={styles.detailSectionTitle}>{t('learn.hanjaCharacter')}</Text>
      <View style={styles.detailHanjaPanelHeader}>
        <Text selectable style={styles.detailHanjaPanelCharacter}>{activeHanja}</Text>
        <View style={styles.detailHanjaPanelCopy}>
          <Text selectable numberOfLines={3} style={styles.detailHanjaPanelMeaning}>
            {readingLabel || (isLoading ? t('common.loading') : t('hanja.meaningUnavailable'))}
            {meaningLabel ? ` · ${meaningLabel}` : ''}
          </Text>
        </View>
        {characters.length > 1 ? (
          <View style={styles.detailHanjaPanelNav}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('hanja.previous')}
              disabled={!canGoPrevious}
              onPress={goToPrevious}
              hitSlop={0}
              style={styles.hanjaPanelArrow}
            >
              <Feather name="chevron-left" size={20} color={colors.text} />
            </PressableScale>
            <Text style={styles.detailHanjaPanelCount}>
              {t('learn.hanjaCount', { current: safeActiveIndex + 1, total: characters.length })}
            </Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('hanja.next')}
              disabled={!canGoNext}
              onPress={goToNext}
              hitSlop={0}
              style={styles.hanjaPanelArrow}
            >
              <Feather name="chevron-right" size={20} color={colors.text} />
            </PressableScale>
          </View>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.hanjaPanelEmpty}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.hanjaPanelEmptyText}>{t('hanja.loading')}</Text>
        </View>
      ) : visibleRelatedWords.length > 0 ? (
        <View>
          {visibleRelatedWords.map((relatedWord, index) => {
            const known = knownKeys.has(relatedWordKey(relatedWord));
            return (
              <View
                key={`${relatedWord.korean}-${relatedWord.hanja}-${index}`}
                style={styles.detailHanjaRelatedRow}
              >
                <View style={styles.detailHanjaRelatedCopy}>
                  <Text selectable numberOfLines={1} style={styles.detailHanjaRelatedWord}>{relatedWord.korean}</Text>
                  <Text selectable style={styles.detailHanjaRelatedMeaning}>
                    {relatedWord.meaning || t('hanja.meaningUnavailable')}
                  </Text>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={known
                    ? t('hanja.markedKnown', { word: relatedWord.korean })
                    : t('hanja.markKnown', { word: relatedWord.korean })}
                  accessibilityState={{ checked: known }}
                  onPress={() => {
                    tapSelect();
                    handleKnownPress(relatedWord);
                  }}
                  style={styles.detailHanjaKnownButton}
                >
                  {known ? <Feather name="check" size={15} color={colors.text} /> : null}
                  <Text style={[
                    styles.detailHanjaKnownButtonText,
                    !known && styles.detailHanjaKnownButtonTextAction,
                  ]}>
                    {known ? t('learn.known') : t('learn.markKnown')}
                  </Text>
                </PressableScale>
              </View>
            );
          })}
          {canShowMoreRelatedWords ? (
            <PaperButton
              variant="quiet"
              size="md"
              label={t('common.seeMore')}
              icon={<Feather name="chevron-down" size={16} color={colors.tint} />}
              onPress={() => setVisibleRelatedCount((count) => count + DETAIL_HANJA_RELATED_PAGE_SIZE)}
              style={styles.detailHanjaSeeMoreButton}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.hanjaPanelEmpty}>
          <Text style={styles.hanjaPanelEmptyText}>{t('hanja.none')}</Text>
        </View>
      )}
    </View>
  );
};

/**
 * WordDetailModal — a word's page, pushed over the list from the right edge
 * and dismissed back the same way (the list stays mounted underneath, so its
 * scroll position survives).
 *
 * - A horizontal drag to the right follows the finger 1:1; past the left
 *   bound it resists (rubber-band).
 * - On release it projects where the flick is heading and closes if that
 *   lands past half the width, so a short fast flick works as well as a long
 *   slow drag. The spring that takes over starts at the finger's speed.
 * - Grabbing it mid-animation catches it where it is.
 * - Hardware back and the header back button animate out the same path.
 * - Reduced motion: a short cross-fade instead of the slide.
 */
const WordDetailModal = ({
  word,
  contexts = [],
  onClose,
  onToggleFavorite,
  onKnownWordsChange,
}) => {
  const { t } = useTranslation();
  const { colors, styles, proficiencyByKey } = useLearnTheme();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const translateX = useRef(new Animated.Value(width)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const widthRef = useRef(width);
  widthRef.current = width;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const currentXRef = useRef(width);
  const startXRef = useRef(0);
  const closingRef = useRef(false);

  useEffect(() => {
    const id = translateX.addListener(({ value }) => { currentXRef.current = value; });
    return () => translateX.removeListener(id);
  }, [translateX]);

  useEffect(() => {
    if (reducedRef.current) {
      translateX.setValue(0);
      fade.setValue(0);
      fadeTo(fade, 1).start();
      return;
    }
    springTo(translateX, 0, { spring: springs.move }).start();
  }, [fade, translateX]);

  const requestClose = useCallback((velocity = 0) => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    const done = ({ finished }) => {
      if (finished) {
        onCloseRef.current?.();
      } else {
        // Caught mid-flight by a new drag: stay open.
        closingRef.current = false;
      }
    };
    if (reducedRef.current) {
      fadeTo(fade, 0, { duration: 160 }).start(done);
      return;
    }
    springTo(translateX, widthRef.current, {
      spring: velocity > 0.3 ? springs.flick : springs.move,
      gestureVelocity: velocity,
    }).start(done);
  }, [fade, translateX]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, g) => (
      g.dx > DETAIL_DRAG_SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 1.6
    ),
    onPanResponderGrant: () => {
      closingRef.current = false;
      translateX.stopAnimation((value) => {
        startXRef.current = value;
      });
    },
    onPanResponderMove: (_event, g) => {
      const next = startXRef.current + g.dx;
      translateX.setValue(next < 0 ? rubberband(next, widthRef.current) : next);
    },
    onPanResponderRelease: (_event, g) => {
      const projected = currentXRef.current + project(g.vx);
      if (projected > widthRef.current * 0.5) {
        requestClose(g.vx);
        return;
      }
      springTo(translateX, 0, {
        spring: Math.abs(g.vx) > 0.3 ? springs.flick : springs.standard,
        gestureVelocity: g.vx,
      }).start();
    },
    onPanResponderTerminate: () => {
      springTo(translateX, 0).start();
    },
  }), [requestClose, translateX]);

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
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.overlay,
            opacity: reduced ? 0 : translateX.interpolate({
              inputRange: [0, Math.max(1, width)],
              outputRange: [0.6, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />
      <Animated.View
        {...pan.panHandlers}
        style={[styles.detailScreen, { opacity: fade, transform: [{ translateX }] }]}
      >
        <SafeAreaView edges={['top']} style={styles.detailSafe}>
          <View style={styles.detailHeader}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('learn.title')}
              onPress={() => requestClose()}
              style={styles.detailBackButton}
            >
              <Feather name="chevron-left" size={26} color={colors.text} />
              <Text style={styles.detailBackLabel}>{t('learn.title')}</Text>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={word.is_favorite ? t('learn.removeFavorite') : t('learn.addFavorite')}
              accessibilityState={{ selected: Boolean(word.is_favorite) }}
              onPress={() => {
                tapSelect();
                onToggleFavorite?.();
              }}
              style={styles.detailIconButton}
            >
              <MaterialIcons
                name={word.is_favorite ? 'star' : 'star-outline'}
                size={26}
                color={word.is_favorite ? colors.tint : colors.textMuted}
              />
            </PressableScale>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailContent}>
            <View style={styles.detailWordLine}>
              <Text selectable style={styles.detailWord}>{word.word}</Text>
              {isKoreanWord && hanjaCharacters.length > 0 ? (
                <Text selectable style={styles.detailHanja}>{word.hanja}</Text>
              ) : null}
            </View>
            {pronunciation ? <Text selectable style={styles.detailPronunciation}>{pronunciation}</Text> : null}
            <Text style={styles.detailMeta}>
              <Text style={[styles.detailMetaStage, { color: proficiency.color }]}>{capitalizeFirst(detailStatus)}</Text>
              {` · ×${seenCount} ${t('learn.encounters')}`}
              {partOfSpeech ? ` · ${partOfSpeech}` : ''}
            </Text>
            <Text selectable style={styles.detailDefinition}>{word.def || t('learn.noDefinition')}</Text>

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>{t('learn.seenIn')}</Text>
              {visibleContexts.length > 0 ? (
                visibleContexts.map((context, index) => {
                  const sourceLabel = getContextSource(context, source);
                  const dateLabel = formatLongDate(context.seenAt ?? context.seen_at ?? getLastSawDate(word));
                  const translation = getContextTranslation(context);
                  return (
                    <View
                      key={`${context.sentence}-${context.seenAt ?? context.seen_at ?? ''}-${index}`}
                      style={styles.contextBlock}
                    >
                      <Text selectable style={styles.contextSentence}>{cleanText(context.sentence)}</Text>
                      {translation ? (
                        <Text selectable style={styles.contextTranslation}>{translation}</Text>
                      ) : null}
                      <Text style={styles.contextAttribution}>
                        — {sourceLabel}{dateLabel ? ` · ${dateLabel}` : ''}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.emptyContext}>{t('learn.noContext')}</Text>
              )}
            </View>

            <View style={styles.detailStats}>
              <View style={styles.detailStat}>
                <Text style={styles.detailStatValue}>{seenCount}</Text>
                <Text style={styles.detailStatLabel}>{t('learn.encounters')}</Text>
              </View>
              <View style={styles.detailStatRule} />
              <View style={styles.detailStat}>
                <Text style={styles.detailStatValue}>{getDistinctDays(word)}</Text>
                <Text style={styles.detailStatLabel}>{t('learn.daysTracked')}</Text>
              </View>
            </View>

            {isKoreanWord ? (
              <DetailHanjaPanel word={word} onKnownWordsChange={onKnownWordsChange} />
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

const Learn = ({ navigation, user }) => {
  const { t } = useTranslation();
  const { targetLanguage, interfaceLanguage } = useAppContext();
  const { activeOwnerId, syncGeneration, syncPaused } = useLocalOwner();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const proficiencyLevels = useMemo(() => createProficiencyLevels(colors), [colors]);
  const proficiencyByKey = useMemo(() => createProficiencyByKey(proficiencyLevels), [proficiencyLevels]);
  const learnThemeValue = useMemo(() => ({
    colors,
    styles,
    proficiencyByKey,
  }), [colors, proficiencyByKey, styles]);
  const [words, setWords] = useState([]);
  // UI only: the Today headline waits for the first load instead of flashing
  // the empty-state line.
  const [wordsLoaded, setWordsLoaded] = useState(false);
  const [mainTab, setMainTab] = useState('saved');
  const [learnedWords, setLearnedWords] = useState([]);
  const [candidateGroups, setCandidateGroups] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [savedCandidateStems, setSavedCandidateStems] = useState(() => new Set());
  const [activeFilter, setActiveFilter] = useState('recent');
  const [practiceDeck, setPracticeDeck] = useState(null);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const markedPracticeIndexRef = useRef(-1);
  const practiceSnapshotRef = useRef(null);
  const [selectedWord, setSelectedWord] = useState(null);
  const [selectedWordContexts, setSelectedWordContexts] = useState([]);
  const [selectedWordKeys, setSelectedWordKeys] = useState(() => new Set());

  const isSelectionMode = selectedWordKeys.size > 0;

  // Request ids: a fetch started for the previous language/owner can resolve
  // after the switch; only the latest request may write state.
  const wordsRequestIdRef = useRef(0);
  const candidatesRequestIdRef = useRef(0);

  const fetchWords = useCallback(async () => {
    const requestId = ++wordsRequestIdRef.current;
    try {
      const data = await viewData({ ownerId: activeOwnerId, language: targetLanguage });
      // Learned words (saved words whose highlight faded out while reading)
      // have their own tab and leave the saved list and the reviews.
      const all = normalizeRows(data);
      const normalized = all.filter((row) => row.level !== LEARNED_LEVEL);
      if (requestId !== wordsRequestIdRef.current) {
        return normalized;
      }
      setWords(normalized);
      setWordsLoaded(true);
      setLearnedWords(sortRecent(all.filter((row) => row.level === LEARNED_LEVEL)).sort(
        (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
      ));
      setSelectedWord((current) => {
        if (!current) {
          return null;
        }

        return normalized.find((candidate) => sameWord(candidate, current)) ?? current;
      });
      return normalized;
    } catch (error) {
      console.error('[Learn] Error fetching vocab data:', error);
      if (requestId === wordsRequestIdRef.current) {
        setWordsLoaded(true);
      }
      return [];
    }
  }, [activeOwnerId, targetLanguage]);

  const handleRestoreLearned = useCallback(async (row) => {
    try {
      await restoreLearnedWord({ ownerId: activeOwnerId, language: targetLanguage, id: row.id });
      requestUserDataSync('learn-vocab-restore');
      await fetchWords();
    } catch (error) {
      console.warn('[Learn] Failed to restore learned word:', error?.message ?? error);
    }
  }, [activeOwnerId, fetchWords, targetLanguage]);

  useEffect(() => {
    setWords([]);
    setWordsLoaded(false);
    setPracticeDeck(null);
    setPracticeIndex(0);
    setSelectedWord(null);
    setSelectedWordContexts([]);
    setSelectedWordKeys(new Set());
    // Invalidate any in-flight suggestions load for the old language and
    // unblock the loader so the Suggested tab refetches for the new one.
    candidatesRequestIdRef.current += 1;
    setCandidateGroups([]);
    setCandidatesLoaded(false);
    setCandidatesLoading(false);
    setSavedCandidateStems(new Set());
    fetchWords();
  }, [activeOwnerId, fetchWords, targetLanguage]);

  // Suggested tab: unsaved candidate words grouped by book, loaded on demand the
  // first time the reader opens the tab (and refreshable via pull/retry).
  const loadCandidates = useCallback(async () => {
    const requestId = ++candidatesRequestIdRef.current;
    const isStale = () => requestId !== candidatesRequestIdRef.current;
    setCandidatesLoading(true);
    try {
      const groups = await getAllBooksWordCandidates({
        ownerId: activeOwnerId,
        language: targetLanguage,
        interfaceLanguage,
      });
      if (isStale()) return;
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
      if (isStale()) return;
      console.warn('[Learn] Failed to load word candidates:', error?.message ?? error);
      setCandidateGroups([]);
      setCandidatesLoaded(true);
    } finally {
      if (!isStale()) {
        setCandidatesLoading(false);
      }
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

  // Hardware back on the word page is handled inside WordDetailModal, so it
  // slides out the way it came before the list takes over again.

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

    markedPracticeIndexRef.current = -1;
    setPracticeDeck({
      title,
      words: availableDeckWords,
    });
    setPracticeIndex(0);
  }, []);

  const closePractice = useCallback(() => {
    // markedPracticeIndexRef is reset in startPractice, not here: a double tap
    // on the last card still sees the old deck in its closure.
    setPracticeDeck(null);
    setPracticeIndex(0);
  }, []);

  const persistPracticeOutcome = useCallback(async (currentWord, status) => {
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
  }, [
    activeOwnerId,
    fetchWords,
    syncFieldsToCloud,
    syncGeneration,
    syncPaused,
    user,
  ]);

  const handlePracticeMark = useCallback(async (status) => {
    if (!practiceDeck?.words?.length) {
      return;
    }
    // A fast double tap fires twice before the re-render: without this guard
    // the same card is recorded twice and the index skips the next card.
    if (markedPracticeIndexRef.current === practiceIndex) {
      return;
    }
    markedPracticeIndexRef.current = practiceIndex;

    const currentWord = practiceDeck.words[practiceIndex];
    // Advance before the slow DB/cloud work so the next card shows at once.
    if (practiceIndex >= practiceDeck.words.length - 1) {
      closePractice();
    } else {
      setPracticeIndex(practiceIndex + 1);
    }

    try {
      await persistPracticeOutcome(currentWord, status);
    } catch (error) {
      console.warn('[Learn] Failed to record flashcard review:', error?.message ?? error);
    }
  }, [closePractice, persistPracticeOutcome, practiceDeck, practiceIndex]);

  const copy = useCallback(
    (key, fallback, params) => copyWithFallback(t, key, fallback, params),
    [t]
  );

  // The practice sheet keeps showing the last card while it slides away.
  const livePracticeVocab = practiceDeck?.words?.[practiceIndex] ?? null;
  if (livePracticeVocab) {
    practiceSnapshotRef.current = {
      vocab: livePracticeVocab,
      index: practiceIndex,
      total: practiceDeck.words.length,
      title: practiceDeck.title,
    };
  }
  const practiceView = practiceSnapshotRef.current;

  const dueCount = dueWords.length;
  const canReview = reviewDeck.length > 0;
  const headline = dueCount > 0
    ? (dueCount === 1
      ? copy('learn.headlineDueOne', '1 word is ready to review.')
      : copy('learn.headlineDue', '{{count}} words are ready to review.', { count: dueCount }))
    : (words.length > 0
      ? copy('learn.headlineCaughtUp', 'You’re all caught up.')
      : copy('learn.headlineEmpty', 'Save a word while reading to begin.'));
  const statsLine = [
    `${maturedCount} ${t('learn.matured')}`,
    `${waitingCount} ${t('learn.waiting')}`,
    `${notSeenCount} ${t('learn.notSeen')}`,
  ].join(' · ');
  const openReview = () => startPractice(reviewDeck, reviewDeckTitle);
  const keepReading = () => navigation?.navigate?.('Read', { returnTo: 'Learn' });
  const tabs = [
    {
      key: 'saved',
      label: words.length > 0 ? `${t('learn.savedTab')} ${words.length}` : t('learn.savedTab'),
    },
    { key: 'suggested', label: t('learn.suggestedTab') },
    {
      key: 'learned',
      label: learnedWords.length > 0 ? `${t('learn.learnedTab')} ${learnedWords.length}` : t('learn.learnedTab'),
    },
  ];

  return (
    <LearnThemeContext.Provider value={learnThemeValue}>
    <View style={styles.root}>
    <View
      style={styles.root}
      importantForAccessibility={selectedWord ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={!!selectedWord}
    >
    <Screen scroll backgroundColor={colors.bgPage} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{t('learn.today')}</Text>
        <Text accessibilityRole="header" style={styles.headline}>{wordsLoaded ? headline : ' '}</Text>
        <Text style={styles.statsLine}>{statsLine}</Text>
        <View style={styles.heroActions}>
          {dueCount > 0 ? (
            <>
              <PaperButton
                label={copy('learn.startReview', 'Start review')}
                accessibilityLabel={t('learn.reviewDueCount', { count: reviewDeck.length })}
                onPress={openReview}
              />
              <PaperButton variant="secondary" label={t('learn.keepReading')} onPress={keepReading} />
            </>
          ) : (
            <>
              <PaperButton label={t('learn.keepReading')} onPress={keepReading} />
              {canReview ? (
                <PaperButton
                  variant="secondary"
                  label={copy('learn.practiceAnyway', 'Practise anyway')}
                  onPress={openReview}
                />
              ) : null}
            </>
          )}
        </View>
      </View>

      <PaperTabs
        tabs={tabs}
        value={mainTab}
        onChange={(key) => {
          if (key !== mainTab) tapSelect();
          setMainTab(key);
        }}
        accessibilityLabel={t('learn.vocabulary')}
        style={styles.tabs}
      />

      {mainTab === 'saved' ? (
      <>
      {isSelectionMode ? (
        <View style={styles.selectionBar}>
          <PaperButton
            variant="quiet"
            size="md"
            label={t('common.cancel')}
            labelStyle={{ color: colors.text }}
            onPress={clearWordSelection}
          />
          <Text style={styles.selectionCount}>
            {t('common.selected', { count: selectedWords.length })}
          </Text>
          <PaperButton
            variant="secondary"
            size="md"
            label={t('common.delete')}
            labelStyle={{ color: colors.destructive }}
            icon={<Feather name="trash-2" size={16} color={colors.destructive} />}
            onPress={handleBulkDelete}
            style={styles.selectionDelete}
          />
        </View>
      ) : (
        <View style={styles.filters}>
          {FILTERS.map((filter) => {
            const active = activeFilter === filter.key;
            return (
              <PressableScale
                key={filter.key}
                accessibilityRole="button"
                accessibilityLabel={t(filter.labelKey)}
                accessibilityState={{ selected: active }}
                hitSlop={{ top: 0, bottom: 0, left: 2, right: 2 }}
                onPress={() => {
                  if (!active) tapSelect();
                  clearWordSelection();
                  setActiveFilter(filter.key);
                }}
                style={styles.filterButton}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{t(filter.labelKey)}</Text>
              </PressableScale>
            );
          })}
        </View>
      )}

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
              onLongPress={() => {
                tapSelect();
                startWordSelection(word);
              }}
            />
          ))
        )}
      </View>
      </>
      ) : mainTab === 'learned' ? (
        <View style={styles.panel}>
          {learnedWords.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('learn.learnedEmptyTitle')}</Text>
              <Text style={styles.emptyBody}>{t('learn.learnedEmptyBody')}</Text>
            </View>
          ) : (
            <View>
              <Text style={styles.learnedHint}>{t('learn.learnedHint')}</Text>
              {learnedWords.map((row) => (
                <View key={row.id} style={styles.learnedRow}>
                  <View style={styles.learnedText}>
                    <Text style={styles.learnedWord}>{row.word}</Text>
                    {row.def ? <Text style={styles.learnedDef} numberOfLines={2}>{row.def}</Text> : null}
                  </View>
                  <PaperButton
                    variant="secondary"
                    size="md"
                    label={t('learn.learnedRestore')}
                    accessibilityLabel={t('learn.learnedRestoreFor', { word: row.word })}
                    onPress={() => handleRestoreLearned(row)}
                    style={styles.learnedRestore}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.panel}>
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
                <Text style={styles.candidateGroupTitle} numberOfLines={1} accessibilityRole="header">
                  {group.bookTitle || t('learn.untitledBook')}
                </Text>
                <View>
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
    </Screen>
    </View>

    {selectedWord ? (
      <WordDetailModal
        word={selectedWord}
        contexts={selectedWordContexts}
        onClose={() => setSelectedWord(null)}
        onToggleFavorite={() => handleToggleFavorite(selectedWord)}
        onKnownWordsChange={fetchWords}
      />
    ) : null}

    <PaperSheet
      visible={!!practiceDeck}
      onClose={closePractice}
      maxHeightRatio={0.94}
      dragRegion="header"
      accessibilityLabel={t('learn.practice')}
      style={[styles.practiceSheet, { height: windowHeight * 0.94 }]}
    >
      {practiceView ? (
        <Flashcard
          vocab={practiceView.vocab}
          title={practiceView.title ?? t('learn.practice')}
          index={practiceView.index}
          total={practiceView.total}
          active={!!livePracticeVocab}
          onClose={closePractice}
          onMark={handlePracticeMark}
          user={user}
          ownerId={activeOwnerId}
          syncGeneration={syncGeneration}
        />
      ) : null}
    </PaperSheet>
    </View>
    </LearnThemeContext.Provider>
  );
};

const createStyles = (colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  content: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingTop: 28,
    paddingBottom: 48,
  },

  // Today
  hero: {
    gap: 14,
  },
  eyebrow: {
    ...textStyles.eyebrow,
    color: colors.textMuted,
  },
  headline: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1,
    color: colors.text,
  },
  statsLine: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },

  // Tabs and filters
  tabs: {
    marginTop: 32,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginLeft: -10,
  },
  filterButton: {
    minHeight: 44,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  filterText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
  },
  filterTextActive: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.tint,
  },
  selectionBar: {
    marginTop: 4,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  selectionCount: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.text,
  },
  selectionDelete: {
    paddingHorizontal: 16,
  },

  // Word list
  list: {
    marginTop: 2,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  selectionCircle: {
    width: 24,
    height: 24,
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCircleSelected: {
    borderColor: colors.tint,
    backgroundColor: colors.tint,
  },
  wordCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  wordTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  wordText: {
    flexShrink: 1,
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 21,
    lineHeight: 30,
    letterSpacing: -0.2,
    color: colors.text,
  },
  wordHanja: {
    flexShrink: 1,
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  newDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.tint,
  },
  wordDefinition: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  wordMetaText: {
    marginTop: 2,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSubtle,
  },
  wordAside: {
    alignItems: 'flex-end',
    gap: 6,
    paddingTop: 7,
    maxWidth: 96,
  },
  stageText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  emptyState: {
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },

  // Suggested and Learned
  panel: {
    paddingTop: 12,
    gap: 28,
  },
  suggestedLoading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  candidateGroup: {
    gap: 2,
  },
  candidateGroupTitle: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 20,
    lineHeight: 26,
    color: colors.text,
    paddingBottom: 4,
  },
  learnedHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    marginBottom: 6,
  },
  learnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  learnedText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  learnedWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 21,
    lineHeight: 30,
    letterSpacing: -0.2,
    color: colors.text,
  },
  learnedDef: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  learnedRestore: {
    paddingHorizontal: 16,
  },

  // Practice sheet
  practiceSheet: {
    backgroundColor: colors.bgPage,
  },

  // Word detail
  detailScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bgPage,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  detailSafe: {
    flex: 1,
  },
  detailHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  detailBackButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 12,
  },
  detailBackLabel: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
  },
  detailIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingTop: 12,
    paddingBottom: 48,
  },
  detailWordLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    columnGap: 14,
    flexWrap: 'wrap',
  },
  detailWord: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 38,
    lineHeight: 52,
    letterSpacing: -0.6,
    color: colors.text,
  },
  detailHanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 22,
    lineHeight: 30,
    color: colors.textMuted,
  },
  detailPronunciation: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textTertiary,
  },
  detailMeta: {
    marginTop: 8,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  detailMetaStage: {
    fontFamily: fontFamilies.sansSemiBold,
  },
  detailDefinition: {
    marginTop: 18,
    fontFamily: fontFamilies.displayRegular,
    fontSize: 23,
    lineHeight: 31,
    color: colors.text,
  },
  detailSection: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 16,
  },
  detailSectionTitle: {
    ...textStyles.eyebrow,
    color: colors.textMuted,
  },
  contextBlock: {
    gap: 6,
    paddingLeft: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  contextSentence: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 17,
    lineHeight: 30,
    color: colors.text,
  },
  contextTranslation: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  contextAttribution: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSubtle,
  },
  emptyContext: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  detailStats: {
    marginTop: 28,
    paddingVertical: 16,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  detailStat: {
    flex: 1,
    gap: 2,
  },
  detailStatRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  detailStatValue: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  detailStatLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
  },

  // Hanja panel
  detailHanjaPanel: {
    marginTop: 28,
    gap: 12,
  },
  detailHanjaPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  detailHanjaPanelCharacter: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 44,
    lineHeight: 56,
    color: colors.text,
  },
  detailHanjaPanelCopy: {
    flex: 1,
    minWidth: 0,
  },
  detailHanjaPanelMeaning: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 17,
    lineHeight: 24,
    color: colors.text,
  },
  detailHanjaPanelNav: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailHanjaPanelCount: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    minWidth: 40,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  hanjaPanelArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hanjaPanelEmpty: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hanjaPanelEmptyText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  detailHanjaRelatedRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  detailHanjaRelatedCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  detailHanjaRelatedWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 18,
    lineHeight: 26,
    color: colors.text,
  },
  detailHanjaRelatedMeaning: {
    flexShrink: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  detailHanjaKnownButton: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingLeft: 8,
  },
  detailHanjaKnownButtonText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  detailHanjaKnownButtonTextAction: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.tint,
  },
  detailHanjaSeeMoreButton: {
    alignSelf: 'flex-start',
    marginLeft: -4,
  },
});

const defaultLearnStyles = createStyles(colors);

export default Learn;
