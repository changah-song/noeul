import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialIcons } from '@expo/vector-icons';

import SwipeWordRow from '../components/Learn/SwipeWordRow';
import GrammarSection from '../components/Learn/GrammarSection';
import AppTopBar from '../components/shared/AppTopBar';
import { usePillTabBarClearance } from '../components/shared/TabBar';
import CandidateCard from '../components/vocab/CandidateCard';
import { Screen } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import { useNavigationButtonsInset } from '../hooks/useNavigationButtonsInset';
import { stripStoredPlaceholder } from '../i18n/userFacing';
import { fetchHanjaRelated } from '../services/api/hanjaRelated';
import { formatDate, formatNumber, tRuntime } from '../services/interfaceLanguage';
import {
  addRelatedKnownWord,
  getAllBooksWordCandidates,
  getCachedPKnown,
  getVocabContexts,
  getRelatedKnownWords,
  insertData,
  logInteractionEvent,
  fsrsSchedule,
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
import {
  supabase,
  toggleCloudRelatedKnownWord,
} from '../services/supabase';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { requestUserDataSync } from '../services/userDataSyncQueue';
import { normalizeBookLanguage } from '../constants/languages';
import { colors, fontFamilies, radii, spacing, useTheme } from '../theme';

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
const DETAIL_BOTTOM_PADDING = 32;
const SEGMENT_TRACK_PADDING = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
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

const getSourceLabel = (word, t = tRuntime) => (
  stripStoredPlaceholder(word?.source_book_title)
  || cleanText(word?.source_book_uri)
  || t('learn.savedWord')
);

const getLastSawDate = (word) => (
  cleanText(word?.last_reviewed_at)
  || cleanText(word?.created_at)
  || null
);

// Month/day in the interface language (never the phone's locale).
const formatLocalizedDate = (date, language, month) => (
  formatDate(date, { month, day: 'numeric' }, language)
);

const formatShortDate = (value, fallback = '', language = undefined) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  return formatLocalizedDate(new Date(timestamp), language, 'short') || fallback;
};

const formatLongDate = (value, fallback = '', language = undefined) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return fallback;
  }

  return formatLocalizedDate(new Date(timestamp), language, 'long') || fallback;
};

const capitalizeFirst = (value) => {
  const text = cleanText(value);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
};

const startOfDay = (timestamp) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// Whole calendar days from `now` until `timestamp` (0 = later today).
const calendarDaysUntil = (timestamp, now = Date.now()) => (
  Math.round((startOfDay(timestamp) - startOfDay(now)) / MS_PER_DAY)
);

const formatNextReview = (word, t, now = Date.now()) => {
  const nextReviewAt = getNextReviewTimestamp(word);
  if (nextReviewAt === null || nextReviewAt <= now) {
    return t('learn.when.today');
  }

  const days = calendarDaysUntil(nextReviewAt, now);
  if (days <= 0) {
    return t('learn.when.today');
  }
  if (days === 1) {
    return t('learn.when.tomorrow');
  }
  if (days < 45) {
    return t('learn.when.inDays', { count: days });
  }
  return t('learn.when.inMonths', { count: Math.round(days / 30) });
};

const WORD_BOUNDARY_RE = /[\s.,!?;:"'“”‘’()[\]{}…·「」『』<>~-]/;

// Finds the saved word inside a context sentence so it can be underlined. A
// Korean word usually appears inflected (정직 → 정직한, 아름답다 → 아름다운),
// so try shrinking prefixes of the stem and extend the match to the end of
// the written word.
const findWordInSentence = (sentence, word, isKorean) => {
  const text = cleanText(sentence);
  const target = cleanText(word);
  if (!text || !target) {
    return null;
  }

  const stem = isKorean && target.length > 1 && target.endsWith('다') ? target.slice(0, -1) : target;
  const minLength = isKorean && stem.length >= 3 ? Math.ceil(stem.length / 2) : stem.length;

  for (let length = stem.length; length >= minLength; length -= 1) {
    const index = text.indexOf(stem.slice(0, length));
    if (index === -1) {
      continue;
    }

    let end = index + length;
    if (isKorean) {
      while (end < text.length && !WORD_BOUNDARY_RE.test(text[end])) {
        end += 1;
      }
    }

    return {
      before: text.slice(0, index),
      match: text.slice(index, end),
      after: text.slice(end),
    };
  }

  return null;
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
  stripStoredPlaceholder(context?.sourceBookTitle)
  || stripStoredPlaceholder(context?.source_book_title)
  || cleanText(context?.sourceTitle)
  || cleanText(context?.sourceBookUri)
  || cleanText(context?.source_book_uri)
  || fallbackSource
);

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

// Never graded in a review: a newly saved word. It counts as "not seen yet"
// and, since nothing schedules it for later, as due.
const isNeverReviewed = (word) => (
  !cleanText(word?.last_reviewed_at)
  && numericValue(word?.correct_count) + numericValue(word?.wrong_count) === 0
);

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

const isReviewCoolingDown = (word, now = Date.now()) => {
  const nextReviewAt = getNextReviewTimestamp(word);
  return nextReviewAt !== null && nextReviewAt > now;
};

const isReviewAvailable = (word, now = Date.now()) => !isReviewCoolingDown(word, now);

const sortDueReviews = (rows) => [...rows].sort((a, b) => (
  (getNextReviewTimestamp(a) ?? Number.MAX_SAFE_INTEGER)
  - (getNextReviewTimestamp(b) ?? Number.MAX_SAFE_INTEGER)
));

// How many of the latest swipes can be taken back, and for how long. Those
// grades are held unsaved, so an undo never rewrites a stored review.
// Same green the swipe row turns for a known word.
const KNOWN_GREEN = '#2e8b57';
const UNDO_DEPTH = 5;
const UNDO_WINDOW_MS = 6000;
// Rows drawn at first and added each time the list is scrolled near its end.
const LIST_PAGE_SIZE = 30;
// A word whose reviews are three weeks or more apart counts as long-term
// memory. Same line Anki draws between "young" and "mature" cards; with the
// scheduler it is reached after about three known reviews in a row.
const LONG_TERM_INTERVAL_DAYS = 21;

// Days between a word's last review and its next one.
const getScheduledIntervalDays = (word) => {
  const next = getNextReviewTimestamp(word);
  if (next === null) {
    return 0;
  }
  const last = new Date(word?.last_reviewed_at).getTime();
  return Math.round((next - (Number.isFinite(last) ? last : Date.now())) / MS_PER_DAY);
};
const isLongTerm = (word) => getScheduledIntervalDays(word) >= LONG_TERM_INTERVAL_DAYS;

// How firmly a word is held, as 0–4 filled dots: none until its first review,
// then one more as the gap between reviews passes a week, three weeks and
// two months.
const getStrengthDots = (word) => {
  if (isNeverReviewed(word)) {
    return 0;
  }
  const interval = getScheduledIntervalDays(word);
  if (interval >= 60) return 4;
  if (interval >= LONG_TERM_INTERVAL_DAYS) return 3;
  if (interval >= 7) return 2;
  return 1;
};

const SWIPE_NUDGE_SEEN_KEY = 'learn.swipeNudgeSeen';

// The word as it will read once a swipe grade is saved, so it can move to its
// queue at once. Mirrors recordReviewOutcome in services/Database.js.
const applyGradeLocally = (word, status) => {
  const now = Date.now();
  // No last review must stay "none": new Date(null) is 1970, which would read
  // as a word remembered across fifty years and schedule it a year out.
  const lastReviewed = word.last_reviewed_at ? new Date(word.last_reviewed_at).getTime() : NaN;
  const daysSince = Number.isFinite(lastReviewed) ? Math.max(0, (now - lastReviewed) / MS_PER_DAY) : null;
  const schedule = fsrsSchedule(word, status, daysSince);
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + Math.max(0, Number(schedule?.interval) || 1));
  const reviewedAt = new Date(now).toISOString();
  return {
    ...word,
    level: status,
    last_reviewed_at: reviewedAt,
    next_review_at: nextReview.toISOString(),
    stability: schedule?.stability ?? word.stability,
    difficulty: schedule?.difficulty ?? word.difficulty,
    correct_count: numericValue(word.correct_count) + (status === 'bad' ? 0 : 1),
    wrong_count: numericValue(word.wrong_count) + (status === 'bad' ? 1 : 0),
    updated_at: reviewedAt,
  };
};

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

const EncounterDots = ({ seenCount, size = 6, filled = null }) => {
  const { t } = useTranslation();
  const { styles } = useLearnTheme();
  const filledCount = filled ?? getExposureDotCount(seenCount);

  return (
    <View
      accessible
      accessibilityLabel={t('learn.maturityA11y', { count: filledCount, total: ENCOUNTER_DOT_COUNT })}
      style={styles.dotRow}
    >
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

const VocabularyRow = ({
  word,
  onPress,
  onLongPress,
  selectionMode = false,
  selected = false,
  dueLabel = '',
  // Swipe rows: the meaning stays hidden (this opacity) until the row is
  // touched, and the swipe row supplies the press handlers.
  definitionOpacity = null,
  pressableProps = null,
}) => {
  const { t, language } = useTranslation();
  const { colors, styles } = useLearnTheme();
  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const lastSaw = formatShortDate(getLastSawDate(word), t('learn.notSeenDate'), language);
  const seenLabel = seenCount === 1
    ? t('learn.rowSeenOnce')
    : t('learn.rowSeenTimes', { count: seenCount });

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      {...pressableProps}
      style={({ pressed }) => [
        styles.wordRow,
        pressableProps ? styles.wordRowSwipe : (pressed && styles.wordRowPressed),
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
          {word.is_favorite ? <MaterialIcons name="star" size={15} color={colors.inkSlate} /> : null}
        </View>
        {definitionOpacity ? (
          <View style={styles.wordDefinitionSlot}>
            {/* A blank bar holds the meaning's place until the row is touched. */}
            {/* The bar fades out in the first half; the meaning rises into
                its place over the whole reveal. */}
            <Animated.View
              style={[
                styles.wordDefinitionCover,
                { opacity: definitionOpacity.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] }) },
              ]}
            />
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.wordDefinition,
                {
                  opacity: definitionOpacity.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0, 1] }),
                  transform: [{
                    translateY: definitionOpacity.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }),
                  }],
                },
              ]}
            >
              {word.def || t('learn.noDefinition')}
            </Animated.Text>
          </View>
        ) : (
          <Text numberOfLines={1} style={styles.wordDefinition}>{word.def || t('learn.noDefinition')}</Text>
        )}
        <Text numberOfLines={1} style={styles.wordMetaText}>
          {[source, seenLabel, lastSaw].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View style={styles.encounterSummary}>
        {dueLabel ? <Text numberOfLines={1} style={styles.wordDueText}>{dueLabel}</Text> : null}
        <EncounterDots seenCount={seenCount} filled={getStrengthDots(word)} />
      </View>
    </Pressable>
  );
};

// `tab.weight` sets a tab's share of the width (default 1). `pulse`
// ({ key, nonce }) makes that tab's label jump once: a swiped word landed there.
const SegmentedTabs = ({ tabs, value, onChange, pulse = null }) => {
  const { styles } = useLearnTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === value));
  const position = useRef(new Animated.Value(activeIndex)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(position, {
      toValue: activeIndex,
      duration: 180,
      // Width changes between tabs, which the native driver cannot animate.
      useNativeDriver: false,
    }).start();
  }, [activeIndex, position]);

  useEffect(() => {
    if (!pulse?.nonce) {
      return;
    }
    pulseScale.setValue(1.22);
    Animated.spring(pulseScale, {
      toValue: 1,
      bounciness: 14,
      speed: 14,
      useNativeDriver: true,
    }).start();
  }, [pulse?.nonce, pulseScale]);

  const totalWeight = tabs.reduce((sum, tab) => sum + (tab.weight ?? 1), 0);
  const innerWidth = Math.max(0, trackWidth - SEGMENT_TRACK_PADDING * 2);
  const widths = tabs.map((tab) => (innerWidth * (tab.weight ?? 1)) / totalWeight);
  const offsets = widths.map((_, index) => widths.slice(0, index).reduce((sum, width) => sum + width, 0));
  const indexes = tabs.map((_, index) => index);

  return (
    <View
      accessibilityRole="tablist"
      style={styles.mainTabs}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      {innerWidth > 0 && tabs.length > 1 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.mainTabIndicator,
            {
              width: position.interpolate({ inputRange: indexes, outputRange: widths }),
              left: position.interpolate({
                inputRange: indexes,
                outputRange: offsets.map((offset) => offset + SEGMENT_TRACK_PADDING),
              }),
            },
          ]}
        />
      ) : null}
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.7}
            style={[styles.mainTab, { flex: tab.weight ?? 1 }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.mainTabText,
                active && styles.mainTabTextActive,
                pulse?.key === tab.key && { transform: [{ scale: pulseScale }] },
              ]}
            >
              {tab.label}
            </Animated.Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const DottedUnderline = ({ color }) => {
  const { styles } = useLearnTheme();

  return (
    <View style={styles.dottedUnderline}>
      {Array.from({ length: 5 }).map((_, index) => (
        <View key={`dot-${index}`} style={[styles.dottedUnderlineDot, { backgroundColor: color }]} />
      ))}
    </View>
  );
};

const DetailHanjaPanel = ({
  word,
  onKnownWordsChange,
  activeIndex: controlledIndex,
  onActiveIndexChange,
}) => {
  const { interfaceLanguage } = useAppContext();
  const { activeOwnerId, syncGeneration, syncPaused } = useLocalOwner();
  const { t } = useTranslation();
  const { colors, styles } = useLearnTheme();
  const characters = useMemo(() => getHanjaCharacters(word?.hanja), [word?.hanja]);
  const charactersKey = characters.join('|');
  const [localIndex, setLocalIndex] = useState(0);
  const activeIndex = controlledIndex ?? localIndex;
  const setActiveIndex = onActiveIndexChange ?? setLocalIndex;
  const [lookupByCharacter, setLookupByCharacter] = useState({});
  const [isLoadingLookup, setIsLoadingLookup] = useState(false);
  const [knownKeys, setKnownKeys] = useState(new Set());
  const [visibleRelatedCount, setVisibleRelatedCount] = useState(DETAIL_HANJA_RELATED_PAGE_SIZE);
  const sourceWord = cleanText(word?.word);
  const language = word?.language ?? 'ko';

  useEffect(() => {
    setLocalIndex(0);
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
  const hasSeveralCharacters = characters.length > 1;

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
        <View style={styles.detailHanjaCharBox}>
          <Text selectable style={styles.detailHanjaPanelCharacter}>{activeHanja}</Text>
        </View>
        <View style={styles.detailHanjaPanelCopy}>
          <Text selectable numberOfLines={1} style={styles.detailHanjaReading}>
            {readingLabel || (isLoading ? t('common.loading') : t('hanja.meaningUnavailable'))}
          </Text>
          {meaningLabel ? (
            <Text selectable numberOfLines={2} style={styles.detailHanjaMeaning}>{meaningLabel}</Text>
          ) : null}
        </View>
        <View style={styles.detailHanjaPanelNav}>
          {hasSeveralCharacters ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('hanja.previous')}
              disabled={!canGoPrevious}
              onPress={goToPrevious}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
              style={[styles.hanjaPanelArrow, !canGoPrevious && styles.hanjaPanelArrowDisabled]}
            >
              <Feather name="chevron-left" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
          <Text style={styles.detailHanjaPanelCount}>
            {t('learn.hanjaCount', { current: safeActiveIndex + 1, total: characters.length })}
          </Text>
          {hasSeveralCharacters ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('hanja.next')}
              disabled={!canGoNext}
              onPress={goToNext}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
              style={[styles.hanjaPanelArrow, !canGoNext && styles.hanjaPanelArrowDisabled]}
            >
              <Feather name="chevron-right" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.detailHanjaDivider} />

      {isLoading ? (
        <View style={styles.hanjaPanelEmpty}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.hanjaPanelEmptyText}>{t('hanja.loading')}</Text>
        </View>
      ) : visibleRelatedWords.length > 0 ? (
        <>
          {visibleRelatedWords.map((relatedWord, index) => {
            const known = knownKeys.has(relatedWordKey(relatedWord));
            return (
              <View
                key={`${relatedWord.korean}-${relatedWord.hanja}-${index}`}
                style={styles.detailHanjaRelatedRow}
              >
                <View style={styles.detailHanjaRelatedCopy}>
                  <Text selectable numberOfLines={1} style={styles.detailHanjaRelatedWord}>
                    {relatedWord.korean}
                    {relatedWord.hanja ? (
                      <Text style={styles.detailHanjaRelatedHanja}>{`  ${relatedWord.hanja}`}</Text>
                    ) : null}
                  </Text>
                  <Text selectable style={styles.detailHanjaRelatedMeaning}>
                    {relatedWord.meaning || t('hanja.meaningUnavailable')}
                  </Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={known
                    ? t('hanja.markedKnown', { word: relatedWord.korean })
                    : t('hanja.markKnown', { word: relatedWord.korean })}
                  accessibilityState={{ selected: known }}
                  onPress={() => handleKnownPress(relatedWord)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={[styles.knownPill, known && styles.knownPillActive]}
                >
                  {known ? <Feather name="check" size={13} color={colors.textSecondary} /> : null}
                  <Text style={styles.knownPillText}>
                    {known ? t('learn.known') : t('learn.iKnowIt')}
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
  onDelete,
  onKnownWordsChange,
}) => {
  const { t, language } = useTranslation();
  const { colors, styles } = useLearnTheme();
  const navigationButtonsInset = useNavigationButtonsInset();
  const [hanjaIndex, setHanjaIndex] = useState(0);
  const hanjaKey = word?.hanja ?? '';

  useEffect(() => {
    setHanjaIndex(0);
  }, [hanjaKey]);

  if (!word) {
    return null;
  }

  const seenCount = getSeenCount(word);
  const source = getSourceLabel(word, t);
  const isKoreanWord = normalizeBookLanguage(word.language ?? 'ko') === 'ko';
  const hanjaCharacters = getHanjaCharacters(word.hanja);
  const pronunciation = getPronunciation(word);
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
  const partOfSpeech = capitalizeFirst(getPartOfSpeechLabel(word, t));
  const seenValue = seenCount === 1
    ? t('learn.seenTimesOnce')
    : t('learn.seenTimesOther', { count: seenCount });
  const nextReviewValue = formatNextReview(word, t);

  return (
    <SafeAreaView edges={['top']} style={styles.detailScreen}>
      <View style={styles.detailHeader}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('learn.backToLearn')}
          onPress={onClose}
          style={styles.headerIconButton}
        >
          <Feather name="chevron-left" size={24} color={colors.inkSlate} />
        </TouchableOpacity>
        <View style={styles.detailHeaderActions}>
          {onDelete ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('common.delete')}
              onPress={onDelete}
              style={styles.headerIconButton}
            >
              <Feather name="trash-2" size={21} color={colors.inkSlate} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={word.is_favorite ? t('learn.removeFavorite') : t('learn.addFavorite')}
            accessibilityState={{ selected: Boolean(word.is_favorite) }}
            onPress={onToggleFavorite}
            style={styles.headerIconButton}
          >
            <MaterialIcons
              name={word.is_favorite ? 'star' : 'star-outline'}
              size={24}
              color={colors.inkSlate}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        // The page runs under the navigation bar; with buttons there, the
        // end of the page scrolls up above them.
        contentContainerStyle={[styles.detailContent, { paddingBottom: DETAIL_BOTTOM_PADDING + navigationButtonsInset }]}
      >
        <View style={styles.detailHero}>
          <View style={styles.detailWordLine}>
            <Text selectable style={styles.detailWord}>{word.word}</Text>
            {isKoreanWord && hanjaCharacters.length > 0 ? (
              <View style={styles.detailHanjaChars}>
                {hanjaCharacters.map((character, index) => {
                  const active = index === hanjaIndex;
                  return (
                    <Pressable
                      key={`${character}-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('learn.hanjaA11y', { char: character })}
                      accessibilityState={{ selected: active }}
                      onPress={() => setHanjaIndex(index)}
                      hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                      style={styles.detailHanjaCharButton}
                    >
                      <Text style={[styles.detailHanja, active && styles.detailHanjaActive]}>{character}</Text>
                      <DottedUnderline color={active ? colors.textMuted : colors.textSubtle} />
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {pronunciation ? <Text selectable style={styles.detailPronunciation}>{pronunciation}</Text> : null}
          </View>
          <View style={styles.definitionBlock}>
            {partOfSpeech ? (
              <View style={styles.posBadge}>
                <Text style={styles.posBadgeText}>{partOfSpeech}</Text>
              </View>
            ) : null}
            <Text selectable style={styles.detailDefinition}>{word.def || t('learn.noDefinition')}</Text>
          </View>
        </View>

        <View style={styles.detailStatsGrid}>
          <View style={styles.detailStatCard}>
            <Text style={styles.detailStatLabel}>{t('learn.seenLabel')}</Text>
            <Text style={styles.detailStatValue}>{seenValue}</Text>
          </View>
          <View style={styles.detailStatCard}>
            <Text style={styles.detailStatLabel}>{t('learn.nextReview')}</Text>
            <Text style={styles.detailStatValue}>{nextReviewValue}</Text>
          </View>
        </View>

        <View style={styles.contextSection}>
          <Text style={styles.detailSectionTitle}>{t('learn.whereYouSawIt')}</Text>
          {visibleContexts.length > 0 ? (
            visibleContexts.map((context, index) => {
              const sentence = cleanText(context.sentence);
              const parts = findWordInSentence(sentence, word.word, isKoreanWord);
              const sourceLabel = getContextSource(context, source);
              const dateLabel = formatLongDate(context.seenAt ?? context.seen_at ?? getLastSawDate(word), '', language);
              const translation = getContextTranslation(context);
              return (
                <View
                  key={`${context.sentence}-${context.seenAt ?? context.seen_at ?? ''}-${index}`}
                  style={styles.contextItem}
                >
                  <Text selectable style={styles.contextSentence}>
                    {parts ? (
                      <>
                        {parts.before}
                        <Text style={styles.contextSentenceMatch}>{parts.match}</Text>
                        {parts.after}
                      </>
                    ) : sentence}
                  </Text>
                  {translation ? (
                    <Text selectable style={styles.contextTranslation}>{translation}</Text>
                  ) : null}
                  <Text style={styles.contextAttribution}>
                    {sourceLabel}{dateLabel ? ` · ${dateLabel}` : ''}
                  </Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyContext}>{t('learn.noContext')}</Text>
          )}
        </View>

        {isKoreanWord ? (
          <DetailHanjaPanel
            word={word}
            activeIndex={hanjaIndex}
            onActiveIndexChange={setHanjaIndex}
            onKnownWordsChange={onKnownWordsChange}
          />
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
  const pillTabBarClearance = usePillTabBarClearance();
  const proficiencyLevels = useMemo(() => createProficiencyLevels(colors), [colors]);
  const proficiencyByKey = useMemo(() => createProficiencyByKey(proficiencyLevels), [proficiencyLevels]);
  const learnThemeValue = useMemo(() => ({
    colors,
    styles,
    proficiencyByKey,
  }), [colors, proficiencyByKey, styles]);
  const [words, setWords] = useState([]);
  const [mainTab, setMainTab] = useState('saved');
  const [learnedWords, setLearnedWords] = useState([]);
  const [candidateGroups, setCandidateGroups] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  const [savedCandidateStems, setSavedCandidateStems] = useState(() => new Set());
  const { width: screenWidth } = useWindowDimensions();
  const [listScrollEnabled, setListScrollEnabled] = useState(true);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  // How many swipes Undo can still take back (drives the Undo button).
  const [undoCount, setUndoCount] = useState(0);
  // Where the last swiped word went: { key, nonce }. The tab jumps and the
  // Undo button names it.
  const [lastMove, setLastMove] = useState(null);
  // First visit: the top row rocks once to show it can be swiped.
  const [showNudge, setShowNudge] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(SWIPE_NUDGE_SEEN_KEY)
      .then((seen) => {
        if (!seen) {
          setShowNudge(true);
        }
      })
      .catch(() => {});
  }, []);
  const undoTimerRef = useRef(null);
  // Every swipe grade not yet stored: { original, optimistic, status }. A
  // reload of the list re-applies them so a graded word never jumps back.
  const gradeOverlayRef = useRef([]);
  // Swipe grades are written one after another; closing the review waits for
  // the last one before it reloads the list.
  const practiceWritesRef = useRef(Promise.resolve());
  const pendingPracticeGradesRef = useRef([]);
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
      const overlay = gradeOverlayRef.current;
      const all = normalizeRows(data).map((row) => (
        overlay.find((entry) => sameWord(entry.original, row))?.optimistic ?? row
      ));
      const normalized = all.filter((row) => row.level !== LEARNED_LEVEL);
      if (requestId !== wordsRequestIdRef.current) {
        return normalized;
      }
      setWords(normalized);
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
    // Unsaved swipe grades belong to the previous owner/language: drop them
    // rather than write them under the new one.
    pendingPracticeGradesRef.current = [];
    gradeOverlayRef.current = [];
    clearTimeout(undoTimerRef.current);
    setUndoCount(0);
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

  // Hardware back closes the word detail view back to the vocabulary list,
  // mirroring the header back button. Without this, back would fall through to
  // the tab navigator and leave the tab or exit the app.
  useEffect(() => {
    if (!selectedWord) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedWord(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedWord]);

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
  // The "Due today" counter, the review button and the review deck all read
  // this one list, so they can never disagree: every saved word that is not
  // scheduled for later, i.e. overdue words plus never-reviewed new words.
  const reviewDeck = useMemo(
    () => {
      const now = Date.now();
      // Overdue words first (longest overdue on top), then new ones, newest first.
      return sortDueReviews(sortRecent(words.filter((word) => isReviewAvailable(word, now))));
    },
    [words]
  );
  // Graded words waiting for their next turn, soonest first, by how far apart
  // their reviews now are: still being learned, or in long-term memory.
  const [learningQueue, longTermQueue] = useMemo(() => {
    const now = Date.now();
    const waiting = sortDueReviews(words.filter((word) => isReviewCoolingDown(word, now)));
    return [
      waiting.filter((word) => !isLongTerm(word)),
      waiting.filter(isLongTerm),
    ];
  }, [words]);
  const notSeenYetCount = useMemo(() => words.filter(isNeverReviewed).length, [words]);
  // "The next one comes back …" once nothing is due: the soonest review
  // scheduled after now.
  const nextComebackNote = useMemo(() => {
    if (reviewDeck.length > 0) {
      return '';
    }
    const now = Date.now();
    const upcoming = words
      .map(getNextReviewTimestamp)
      .filter((timestamp) => timestamp !== null && timestamp > now);
    if (upcoming.length === 0) {
      return '';
    }
    const days = calendarDaysUntil(Math.min(...upcoming), now);
    if (days <= 0) {
      return '';
    }
    return days === 1 ? t('learn.nextBackTomorrow') : t('learn.nextBackInDays', { count: days });
  }, [reviewDeck.length, t, words]);

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

  // Delete from the word's own page (the way out for a word in Today, whose
  // row has no long-press: a held touch there is someone reading the meaning).
  const handleDeleteWord = useCallback((word) => {
    Alert.alert(
      t('learn.deleteSavedWordTitle'),
      t('learn.deleteWordBody', { word: word.word }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSavedWord(word);
            } catch (error) {
              console.warn('[Learn] remove failed:', error?.message ?? error);
            }
            setSelectedWord(null);
            await fetchWords();
          },
        },
      ]
    );
  }, [deleteSavedWord, fetchWords, t]);

  const writePracticeGrade = useCallback((entry) => {
    const word = entry.original;
    practiceWritesRef.current = practiceWritesRef.current
      .then(() => recordReviewOutcome(
        word.word,
        word.hanja,
        word.def,
        word.level,
        entry.status,
        word.language ?? 'ko',
        { ownerId: activeOwnerId, wordData: word }
      ))
      .catch((error) => {
        console.warn('[Learn] Failed to record swipe review:', error?.message ?? error);
      })
      .then(() => {
        // Stored: from here a reload shows the saved row itself.
        gradeOverlayRef.current = gradeOverlayRef.current.filter((candidate) => candidate !== entry);
      });
  }, [activeOwnerId]);

  // Store every swipe still held back for Undo, then reload and sync once.
  const flushPracticeWrites = useCallback(() => {
    clearTimeout(undoTimerRef.current);
    const pending = pendingPracticeGradesRef.current.splice(0);
    setUndoCount(0);
    if (pending.length === 0) {
      return;
    }
    pending.forEach(writePracticeGrade);
    practiceWritesRef.current.then(() => {
      requestUserDataSync('learn-vocab-fields');
      return fetchWords();
    });
  }, [fetchWords, writePracticeGrade]);
  const flushPracticeWritesRef = useRef(flushPracticeWrites);
  flushPracticeWritesRef.current = flushPracticeWrites;

  // One swipe = one graded review. The word moves to its queue at once; the
  // latest few grades stay unsaved for a few seconds so Undo only has to drop
  // them. Nothing per swipe waits on a reload or the network.
  const handleSwipeGrade = useCallback((word, status) => {
    const entry = { original: word, optimistic: applyGradeLocally(word, status), status };
    const pending = pendingPracticeGradesRef.current;
    pending.push(entry);
    gradeOverlayRef.current = [...gradeOverlayRef.current, entry];
    setWords((current) => current.map((candidate) => (
      sameWord(candidate, word) ? entry.optimistic : candidate
    )));
    while (pending.length > UNDO_DEPTH) {
      writePracticeGrade(pending.shift());
    }
    setUndoCount(pending.length);
    setLastMove((current) => ({
      key: isLongTerm(entry.optimistic) ? 'longterm' : 'learning',
      when: capitalizeFirst(formatNextReview(entry.optimistic, t)),
      nonce: (current?.nonce ?? 0) + 1,
    }));
    if (showNudge) {
      setShowNudge(false);
    }
    AsyncStorage.setItem(SWIPE_NUDGE_SEEN_KEY, '1').catch(() => {});
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => flushPracticeWritesRef.current(), UNDO_WINDOW_MS);
  }, [showNudge, t, writePracticeGrade]);

  const handleSwipeUndo = useCallback(() => {
    const pending = pendingPracticeGradesRef.current;
    const entry = pending.pop();
    if (!entry) {
      return;
    }
    gradeOverlayRef.current = gradeOverlayRef.current.filter((candidate) => candidate !== entry);
    setWords((current) => current.map((candidate) => (
      sameWord(candidate, entry.original) ? entry.original : candidate
    )));
    setUndoCount(pending.length);
    clearTimeout(undoTimerRef.current);
    if (pending.length > 0) {
      undoTimerRef.current = setTimeout(() => flushPracticeWritesRef.current(), UNDO_WINDOW_MS);
    }
  }, []);

  // Leaving the tab or the app stores whatever is still waiting on Undo.
  useFocusEffect(useCallback(() => () => flushPracticeWritesRef.current(), []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        flushPracticeWritesRef.current();
      }
    });
    return () => {
      subscription.remove();
      clearTimeout(undoTimerRef.current);
    };
  }, []);

  // A due word looks like every other saved-word row; only its meaning waits
  // for the touch.
  const renderDueRow = useCallback((word, slot) => (
    <VocabularyRow word={word} definitionOpacity={slot.reveal} pressableProps={slot.pressableProps} />
  ), []);

  const handleSwipeActive = useCallback((active) => setListScrollEnabled(!active), []);

  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [mainTab]);

  // The lists can run to hundreds of rows; draw a page and add another each
  // time the reader nears the end.
  const handleListScroll = useCallback((event) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 800) {
      setVisibleCount((count) => (count < words.length ? count + LIST_PAGE_SIZE : count));
    }
  }, [words.length]);

  if (selectedWord) {
    return (
      <LearnThemeContext.Provider value={learnThemeValue}>
        <WordDetailModal
          word={selectedWord}
          contexts={selectedWordContexts}
          onClose={() => setSelectedWord(null)}
          onToggleFavorite={() => handleToggleFavorite(selectedWord)}
          onDelete={() => handleDeleteWord(selectedWord)}
          onKnownWordsChange={fetchWords}
        />
      </LearnThemeContext.Provider>
    );
  }

  const reviewCount = reviewDeck.length;
  const tabLabel = (label, count) => (count > 0 ? `${label} ${formatNumber(count)}` : label);
  const todayLabel = capitalizeFirst(t('learn.when.today'));
  const tomorrowLabel = capitalizeFirst(t('learn.when.tomorrow'));
  const mainTabs = [
    // A word's path, left to right. Today is where the time is spent; the
    // two stages after it only track.
    { key: 'saved', label: tabLabel(todayLabel, reviewCount), weight: 1.4 },
    { key: 'learning', label: tabLabel(t('learn.stageLearningTab'), learningQueue.length) },
    { key: 'longterm', label: tabLabel(t('learn.stageLongTermTab'), longTermQueue.length) },
  ];
  const stageLabelKeys = { learning: 'learn.stageLearningTab', longterm: 'learn.stageLongTermTab' };
  const openWord = (word) => {
    if (isSelectionMode) {
      toggleWordSelection(word);
      return;
    }
    setSelectedWord(word);
  };

  // Today: words back for another look first, then ones never reviewed.
  const dueRows = reviewDeck.slice(0, visibleCount);
  const returningCount = reviewDeck.filter((word) => !isNeverReviewed(word)).length;
  const dueSections = [
    { key: 'returning', title: t('learn.sectionReturning'), count: returningCount, rows: dueRows.filter((word) => !isNeverReviewed(word)) },
    { key: 'new', title: t('learn.sectionNew'), count: reviewCount - returningCount, rows: dueRows.filter(isNeverReviewed) },
  ].filter((section) => section.rows.length > 0);

  // Learning: grouped by how soon each word is back.
  const now = Date.now();
  const daysAway = (word) => calendarDaysUntil(getNextReviewTimestamp(word), now);
  const stageSections = mainTab === 'learning'
    ? [
      { key: 'tomorrow', title: tomorrowLabel, all: learningQueue.filter((word) => daysAway(word) <= 1) },
      { key: 'week', title: t('learn.groupThisWeek'), all: learningQueue.filter((word) => daysAway(word) > 1 && daysAway(word) <= 7) },
      { key: 'later', title: t('learn.groupLater'), all: learningQueue.filter((word) => daysAway(word) > 7) },
    ]
    : [{ key: 'all', title: '', all: longTermQueue }];
  let stageBudget = visibleCount;
  const visibleStageSections = stageSections
    .map((section) => {
      const rows = section.all.slice(0, Math.max(0, stageBudget));
      stageBudget -= rows.length;
      return { ...section, count: section.all.length, rows };
    })
    .filter((section) => section.rows.length > 0);

  const renderSectionHeader = (section) => (section.title ? (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>{formatNumber(section.count)}</Text>
    </View>
  ) : null);

  return (
    <LearnThemeContext.Provider value={learnThemeValue}>
    <View style={styles.screenWrap}>
    <Screen
      scroll
      backgroundColor={colors.bgPage}
      scrollViewProps={{
        scrollEnabled: listScrollEnabled,
        onScroll: handleListScroll,
        scrollEventThrottle: 120,
        // AppTopBar, then the tabs.
        stickyHeaderIndices: [1],
      }}
      // The floating Read/Learn pill sits over the bottom of the list.
      contentContainerStyle={[styles.content, { paddingBottom: pillTabBarClearance }]}
    >
      {/* The same bar as Home (today's goal, profile), so the top of the
          screen stays put when switching between Read and Learn. */}
      <AppTopBar
        ownerId={activeOwnerId}
        user={user}
        onProfilePress={() => navigation?.navigate?.('Profile')}
      />

      {/* Stays at the top while the list scrolls, so the tab a swiped word
          moves to is always in view. */}
      <View style={styles.mainTabsSticky}>
        <SegmentedTabs tabs={mainTabs} value={mainTab} onChange={setMainTab} pulse={lastMove} />
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

      {mainTab === 'saved' ? (
        reviewCount === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {words.length === 0 ? t('learn.emptyTitle') : t('learn.allCaughtUp')}
            </Text>
            <Text style={styles.emptyBody}>
              {words.length === 0 ? t('learn.emptyBody') : nextComebackNote}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation?.navigate?.('Read', { returnTo: 'Learn' })}
              style={styles.emptyAction}
            >
              <Text style={styles.emptyActionText}>{t('learn.keepReading')}</Text>
            </TouchableOpacity>
          </View>
        ) : isSelectionMode ? (
          // Picking words to delete: plain rows, no swiping.
          <View style={styles.list}>
            {dueRows.map((word) => (
              <VocabularyRow
                key={getWordKey(word)}
                word={word}
                selectionMode
                selected={selectedWordKeys.has(getWordKey(word))}
                onPress={() => toggleWordSelection(word)}
                onLongPress={() => startWordSelection(word)}
              />
            ))}
          </View>
        ) : (
          <View>
            {/* What each direction means, in the colours the row turns. */}
            <View style={styles.swipeLegend}>
              <View style={styles.swipeLegendSide}>
                <Feather name="arrow-left" size={15} color={colors.danger} />
                <Text style={styles.swipeLegendText}>{t('learn.legendDontKnow')}</Text>
              </View>
              <View style={styles.swipeLegendSide}>
                <Text style={styles.swipeLegendText}>{t('learn.legendKnow')}</Text>
                <Feather name="arrow-right" size={15} color={KNOWN_GREEN} />
              </View>
            </View>
            {dueSections.map((section, sectionIndex) => (
              <View key={section.key}>
                {renderSectionHeader(section)}
                {section.rows.map((word, index) => (
                  <SwipeWordRow
                    key={getWordKey(word)}
                    word={word}
                    screenWidth={screenWidth}
                    colors={colors}
                    knownLabel={t('learn.swipeKnow')}
                    unknownLabel={t('learn.swipeDontKnow')}
                    knownHint={capitalizeFirst(formatNextReview(applyGradeLocally(word, 'good'), t))}
                    unknownHint={tomorrowLabel}
                    nudge={showNudge && sectionIndex === 0 && index === 0}
                    renderContent={renderDueRow}
                    onGrade={handleSwipeGrade}
                    onOpen={setSelectedWord}
                    onSwipeActive={handleSwipeActive}
                  />
                ))}
              </View>
            ))}
          </View>
        )
      ) : (
        <View>
          {/* What this stage is, whether or not anything is in it yet. */}
          <Text style={styles.stageCaption}>
            {mainTab === 'learning' ? t('learn.stageLearningEmpty') : t('learn.stageLongTermEmpty')}
          </Text>
          {visibleStageSections.map((section) => (
            <View key={section.key}>
              {renderSectionHeader(section)}
              <View style={styles.list}>
                {section.rows.map((word) => (
                  <VocabularyRow
                    key={getWordKey(word)}
                    word={word}
                    dueLabel={capitalizeFirst(formatNextReview(word, t))}
                    selectionMode={isSelectionMode}
                    selected={selectedWordKeys.has(getWordKey(word))}
                    onPress={() => openWord(word)}
                    onLongPress={() => startWordSelection(word)}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
    {undoCount > 0 ? (
      <View style={[styles.undoBar, { bottom: pillTabBarClearance, maxWidth: screenWidth - 40 }]}>
        {lastMove ? (
          <Text numberOfLines={1} style={styles.undoNote}>
            {`${t(stageLabelKeys[lastMove.key])} · ${lastMove.when}`}
          </Text>
        ) : null}
        <TouchableOpacity
          onPress={handleSwipeUndo}
          accessibilityRole="button"
          accessibilityLabel={t('common.undo')}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.undoButton}
        >
          <Feather name="rotate-ccw" size={15} color={colors.bgPage} />
          <Text style={styles.undoText}>{t('common.undo')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    </View>
    </LearnThemeContext.Provider>
  );
};

const createStyles = (colors) => StyleSheet.create({
  screenWrap: {
    flex: 1,
  },
  mainTabsSticky: {
    backgroundColor: colors.bgPage,
    paddingBottom: 8,
  },
  swipeLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  swipeLegendSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swipeLegendText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 2,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  sectionCount: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  stageCaption: {
    paddingHorizontal: 20,
    paddingTop: 12,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  emptyAction: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  emptyActionText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.text,
  },
  undoBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 22,
    paddingLeft: 18,
    paddingRight: 16,
    paddingVertical: 11,
    backgroundColor: colors.text,
    shadowColor: '#1b1c1c',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  undoNote: {
    flexShrink: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    color: colors.bgPage,
    opacity: 0.78,
  },
  undoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  undoText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.bgPage,
  },
  content: {
    // At least the screen's height, so the goal calendar's backdrop (placed
    // against this container) reaches the bottom when the list is short.
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    gap: 0,
  },
  summaryCard: {
    marginHorizontal: LEARN_SIDE_PADDING,
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 14,
  },
  summaryStats: {
    flexDirection: 'row',
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  summaryStatMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.divider,
  },
  summaryValue: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  summaryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  reviewButton: {
    flex: 1.3,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: colors.inkSlate,
  },
  // Disabled reads as a quiet muted block with muted text, never a faded
  // ink fill (that turned into a muddy grey block in dark mode).
  reviewButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  reviewButtonText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.white,
  },
  reviewButtonTextDisabled: {
    color: colors.textTertiary,
  },
  keepReadingButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  listenButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepReadingText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.text,
  },
  mainTabs: {
    flexDirection: 'row',
    marginHorizontal: LEARN_SIDE_PADDING,
    marginTop: 18,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: SEGMENT_TRACK_PADDING,
  },
  mainTabIndicator: {
    position: 'absolute',
    top: SEGMENT_TRACK_PADDING,
    bottom: SEGMENT_TRACK_PADDING,
    left: SEGMENT_TRACK_PADDING,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: '#1b1c1c',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  mainTab: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  mainTabText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textMuted,
  },
  mainTabTextActive: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.text,
  },
  filters: {
    marginHorizontal: LEARN_SIDE_PADDING,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIconChip: {
    width: 34,
    paddingHorizontal: 0,
  },
  filterChipActive: {
    borderColor: colors.inkSlate,
    backgroundColor: colors.inkSlate,
  },
  filterText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  filterTextActive: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.white,
  },
  selectionBar: {
    marginHorizontal: LEARN_SIDE_PADDING,
    marginTop: 10,
    minHeight: 44,
    borderRadius: 14,
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
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  selectionBarButtonText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    color: colors.textMuted,
  },
  selectionCount: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    color: colors.text,
  },
  selectionDeleteButton: {
    backgroundColor: colors.inkSlate,
  },
  selectionDeleteText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    color: colors.white,
  },
  list: {
    marginTop: 6,
    marginHorizontal: 20,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 12,
  },
  // Swipe rows run edge to edge so the colour behind them does too.
  wordRowSwipe: {
    marginHorizontal: 20,
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
    borderColor: colors.inkSlate,
    backgroundColor: colors.inkSlate,
  },
  wordCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
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
    fontSize: 20,
    lineHeight: 28,
    color: colors.text,
  },
  wordHanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textTertiary,
  },
  badge: {
    borderRadius: 5,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  wordDefinition: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  wordDueText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  wordDefinitionSlot: {
    justifyContent: 'center',
  },
  wordDefinitionCover: {
    position: 'absolute',
    left: 0,
    width: 112,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surfaceMuted,
  },
  wordMetaText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSubtle,
  },
  encounterSummary: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  encounterDot: {
    borderWidth: 1,
  },
  encounterDotFilled: {
    backgroundColor: colors.inkSlate,
    borderColor: colors.inkSlate,
  },
  encounterDotEmpty: {
    backgroundColor: colors.transparent,
    borderColor: colors.borderStrong,
  },
  emptyState: {
    marginTop: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 21,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
  },
  suggestedWrap: {
    paddingHorizontal: LEARN_SIDE_PADDING,
    paddingTop: 14,
    gap: 18,
  },
  suggestedLoading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  candidateGroup: {
    gap: 8,
  },
  candidateGroupTitle: {
    paddingHorizontal: 4,
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  candidateGroupList: {
    gap: 8,
  },
  learnedHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  learnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  learnedText: {
    flex: 1,
    gap: 3,
  },
  learnedWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: colors.text,
  },
  learnedDef: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  learnedRestore: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learnedRestoreText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  detailHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.bgPage,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailContent: {
    paddingTop: 6,
  },
  detailHero: {
    paddingHorizontal: 24,
    gap: 6,
  },
  detailWordLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    columnGap: 12,
    flexWrap: 'wrap',
  },
  detailWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 42,
    lineHeight: 56,
    color: colors.text,
  },
  detailHanjaChars: {
    flexDirection: 'row',
    gap: 3,
    marginBottom: 9,
  },
  detailHanjaCharButton: {
    alignItems: 'center',
    paddingHorizontal: 1,
  },
  detailHanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textMuted,
  },
  detailHanjaActive: {
    color: colors.text,
  },
  dottedUnderline: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  dottedUnderlineDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  detailPronunciation: {
    marginBottom: 12,
    fontFamily: fontFamilies.sansRegular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 20,
    color: colors.textTertiary,
  },
  definitionBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  posBadge: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  posBadgeText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  detailDefinition: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 20,
    lineHeight: 28,
    color: colors.text,
  },
  detailStatsGrid: {
    marginTop: 20,
    marginHorizontal: 24,
    flexDirection: 'row',
    gap: 8,
  },
  detailStatCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  detailStatLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textTertiary,
  },
  detailStatValue: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 20,
    lineHeight: 27,
    color: colors.text,
  },
  detailSectionTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  contextSection: {
    marginTop: 22,
    paddingHorizontal: 24,
    gap: 8,
  },
  contextItem: {
    gap: 6,
  },
  contextSentence: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 16,
    lineHeight: 27,
    color: colors.text,
  },
  contextSentenceMatch: {
    fontFamily: fontFamilies.krSerifSemiBold,
    textDecorationLine: 'underline',
    textDecorationColor: colors.readerLevelUnderlineMid,
  },
  contextTranslation: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  contextAttribution: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSubtle,
  },
  emptyContext: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  detailHanjaPanel: {
    marginHorizontal: LEARN_SIDE_PADDING,
    marginTop: 22,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    padding: 16,
  },
  detailHanjaPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailHanjaCharBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHanjaPanelCharacter: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text,
  },
  detailHanjaPanelCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  detailHanjaReading: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  detailHanjaMeaning: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  detailHanjaPanelNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  detailHanjaPanelCount: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSubtle,
    textAlign: 'center',
  },
  hanjaPanelArrow: {
    width: 24,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hanjaPanelArrowDisabled: {
    opacity: 0.3,
  },
  detailHanjaDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: 12,
    marginBottom: 4,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  detailHanjaRelatedCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  detailHanjaRelatedWord: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  detailHanjaRelatedHanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 14,
    color: colors.textTertiary,
  },
  detailHanjaRelatedMeaning: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  knownPill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  knownPillActive: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.surfaceMuted,
  },
  knownPillText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  detailHanjaSeeMoreButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailHanjaSeeMoreText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
});

const defaultLearnStyles = createStyles(colors);

export default Learn;
