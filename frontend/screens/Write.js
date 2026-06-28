import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';

import { Card, IconButton, Screen, SectionHeader } from '../components/ui';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import {
  cloudWritingRowToEntry,
  fetchUserWritingEntries,
  softDeleteUserWritingEntry,
  upsertUserWritingEntry,
  upsertUserWritingEntries,
} from '../services/writingCloudSync';
import {
  ANNOTATION_LEGEND,
  MOCK_WRITING_ENTRY_ID,
  buildAnnotatedSpans,
  createMockWritingEntry,
} from '../services/writingAssessmentMock';
import { GUEST_OWNER_ID, makeScopedStorageKey } from '../services/localDataScope';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from '../services/localOwnerCoordinator';
import { colors, fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';
import { useAppContext } from '../contexts/AppContext';
import { useVocabWords } from '../contexts/VocabWordsContext';
import { assessEntry } from '../services/api/assessEntry';

const LEGACY_STORAGE_KEY = 'writing_entries_v1';
const getWritingStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'writing-entries-v1');
const WRITE_SIDE_PADDING = 18;
const WRITING_FILTERS = [
  { key: 'all', labelKey: 'write.filters.all' },
  { key: 'reflective', labelKey: 'write.filters.reflective' },
  { key: 'persuasive', labelKey: 'write.filters.persuasive' },
  { key: 'creative', labelKey: 'write.filters.creative' },
  { key: 'sandbox', labelKey: 'write.filters.sandbox' },
];
const EDITOR_TYPE_FILTERS = WRITING_FILTERS.filter((filter) => filter.key !== 'all');
const DEFAULT_ENTRY_FORMATTING = {
  bold: false,
  italic: false,
  underline: false,
};
const FORMAT_BUTTONS = [
  { key: 'bold', label: 'B', textStyle: 'editorToolbarTextBold' },
  { key: 'italic', label: 'I', textStyle: 'editorToolbarTextItalic' },
  { key: 'underline', label: 'U', textStyle: 'editorToolbarTextUnderline' },
];

const createAnnotationLegend = (themeColors) => (
  ANNOTATION_LEGEND.map((item) => ({
    ...item,
    color: {
      GRAMMAR: themeColors.accent,
      DICTION: themeColors.textMuted,
      NATIVE_INSERT: themeColors.textTertiary,
      UNNATURAL: themeColors.textSubtle,
    }[item.type] ?? themeColors.textMuted,
  }))
);

const createAnnotationColors = (legend) => legend.reduce((acc, item) => {
  acc[item.type] = item.color;
  return acc;
}, {});

const defaultAnnotationLegend = createAnnotationLegend(colors);
const defaultAnnotationColors = createAnnotationColors(defaultAnnotationLegend);
const WriteThemeContext = createContext(null);
const useWriteTheme = () => (
  useContext(WriteThemeContext) ?? {
    colors,
    styles: defaultWriteStyles,
    annotationLegend: defaultAnnotationLegend,
    annotationColors: defaultAnnotationColors,
  }
);

const EDITOR_PROMPTS = {
  reflective: [
    'The Daily Micro-Moment: Describe a mundane interaction you had in the last 24 hours that unexpectedly made you smile, pause, or think.',
    'The Unsent Letter: Write a short note to someone from your past (a friend, a former teacher, an ex). What do you wish you had said?',
    'Energy Audit: Look back at your last 7 days. What single activity or person gave you the most energy? What drained you the most?',
    'Future Self Capsule: If you could send a 3-sentence warning or encouragement to yourself exactly one year from today, what would it say?',
    'The Current Soundtrack: If your current mood or phase of life was an album title, what would it be called and what does the cover art look like?',
    'Sensory Rooting: Describe the room you are sitting in right now using only sounds, textures, and smells—no visual descriptions allowed.',
    'The Shift: What is a belief, opinion, or habit you held tightly five years ago that you have completely abandoned now? What changed your mind?',
    'Anatomy of a Flaw: Pick a minor personal flaw or quirk you have (e.g., being chronically 5 minutes late, overthinking emails). Explore where you think it stems from.',
    'Childhood Artifact: Think of a specific object from your childhood home that no longer exists or you haven\'t seen in years. Describe it from memory in vivid detail.',
    'The Compliment: What is the most memorable compliment you\'ve ever received? Why did it stick with you so deeply?',
    'Anxiety Deconstruction: Write down something that is currently making you anxious. Break it down into the absolute worst-case scenario, and then a highly realistic outcome.',
    'The Perfect Hour: Describe what a perfect, completely stress-free hour looks like for you on a random Tuesday.',
    'Role Reversal: If you could spend one day living as your pet, a family member, or a close friend, who would it be and what would frustrate you most about their routine?',
    'The Unchosen Path: Think of a major crossroads in your life (a school choice, a job choice, a move). Imagine the alternate version of you who took the other path—how are they doing right now?',
    'Guilty Pleasure Defense: Write an unironic defense of a movie, song, food, or hobby that is generally considered "lowbrow" or a guilty pleasure.',
    'The Mentor: Write about a specific piece of advice someone gave you that you didn\'t understand or appreciate at the time, but now rely on.',
    'Physical Geography: Focus on your body right now. Where are you holding tension? How does the chair or floor feel beneath you? Document your exact physical state.',
    'The Friction Point: What is a small, recurring friction point in your daily routine (e.g., a bad commute, a messy desk) that you have the power to fix but haven\'t? Why are you tolerating it?',
    'Unspoken Gratitude: Write about someone you encounter regularly (a barista, a coworker, a bus driver) who makes your life slightly better, even though you barely know their name.',
    'The Threshold: Think about a goal or boundary you are currently hesitant to cross. What is the fear keeping you on this side of the line?',
  ],
  persuasive: [
    'The Counter-Intuitive Truth: What is something you believe to be absolutely true that most people would disagree with you on? Argue your case.',
    'The Digital Footprint: Should an individual\'s digital data history belong strictly to them, or do tech corporations have a legitimate right to trade it for optimization?',
    'The Micro-Invention Ban: If you could erase one minor piece of modern technology from existence (e.g., read receipts, autofill, the alarm snooze button) to improve human behavior, what would it be?',
    'Cultural Critique: Pick a recent trend in modern media, fashion, internet slang, or workplace culture that irritates you. Write an argument explaining why it\'s a step backward.',
    'The Funding Dilemma: If you were handed a $10 million grant that must be spent entirely on improving your local neighborhood, where would you allocate it for maximum impact?',
    'Anatomy of an Icon: Choose a book, movie, or piece of art that is universally praised. Argue why it is either perfectly rated, vastly overrated, or misunderstood.',
    'The AI Frontier: As AI becomes more integrated into creative industries, will human art become more valuable because of its scarcity, or will it become obsolete?',
    'The Redefinition of Success: Society traditionally measures a successful life by wealth, status, and career trajectory. Propose a new, concrete metric for evaluating a "successful" human life.',
    'The Obligation of Wealth: Do billionaires have a moral obligation to redistribute their wealth during their lifetime, or should they have absolute autonomy over what they earned?',
    'The Attention Economy: Is the human attention span genuinely shrinking due to short-form content, or are we just adapting to filter out low-value information faster?',
    'Remote vs. Co-located: Make a definitive case for either 100% remote work or 100% in-office work being superior for long-term career mentorship and company health.',
    'The Best Age: Argue for the specific age or decade of life that is the absolute pinnacle of human existence, balancing freedom, capability, and wisdom.',
    'Mandatory National Service: Should countries implement a mandatory year of civil, environmental, or military service for citizens post-high school? Why or why not?',
    'The Censorship Line: Where should the line be drawn between protecting free speech and banning hate speech or misinformation on public platforms? Who gets to decide?',
    'The Price of Convenience: Modern life prioritizes speed and convenience (delivery apps, fast fashion). Argue what psychological or social traits we are losing by eliminating friction from daily life.',
    'Space vs. Earth: Should global superpowers continue spending billions on space exploration, or should those funds be strictly frozen until major terrestrial crises (like climate change) are solved?',
    'The Paradox of Choice: Does having endless options (in dating apps, streaming content, career paths) make modern humans happier, or does it paralyze us?',
    'The Value of Higher Ed: Is a traditional 4-year university degree still the most viable path to socio-economic mobility, or is it becoming an outdated financial trap?',
    'Anonymity Online: Should internet anonymity be protected as a fundamental right to privacy, or should verified real-name identification be mandatory to curb online toxicity?',
    'The Best Teacher: Argue whether failure or success is a more effective teacher for building long-term resilience.',
  ],
  creative: [
    'In Media Res: Start a story with the exact sentence: "The alarm went off three hours late, but that was the least of my problems."',
    'The Object\'s Perspective: Pick a random item on your desk right now. Write a brief narrative from its perspective about how it views your daily habits.',
    'Subtext Dialogue: Write a scene between two people arguing about something mundane (like where to eat dinner or a missing sock), but make it clear through subtext that they are actually about to break up. No narration, just dialogue.',
    'The Five-Senses Room: Describe a bustling location (a night market, an airport terminal, a rainy coffee shop) using vivid imagery, capturing all five senses across the narrative.',
    'Alternate History: Imagine a world where the internet was never invented, but smartphones still existed as completely offline pocket utilities. Describe a typical morning commute.',
    'The Unfamiliar Mirror: Write a scene where a character catches their reflection in a window, but for a split second, they don\'t recognize the person looking back. What do they see?',
    'The Lie: Write a short narrative centered around a character telling a seemingly harmless lie that immediately snowballs out of their control.',
    'Monologue of an Antagonist: Write a first-person justification from the perspective of a classic villain (from a fairy tale, history, or fiction) explaining why they were actually the hero of their own story.',
    'The Weather as a Character: Describe a normal outdoor setting (a park, a city street corner) where the weather (a heatwave, a sudden blizzard, a thick fog) acts as the primary antagonist driving the action.',
    'The Time Loop: A character realizes they have lived the last twenty minutes before. Write the scene where the realization hits, and show how they try to break the loop on the next pass.',
    'A Stranger\'s Baggage: You are sitting across from someone on a train or subway. Based purely on their shoes, expression, and what they are holding, invent their entire backstory and destination.',
    'The Forgotten Key: A character finds a strange, old key at the bottom of their backpack that they have absolutely no memory of acquiring. What does it open?',
    'The Last of Its Kind: Write from the perspective of the very last working analog typewriter or retro arcade machine left in an abandoned building.',
    'No Adjectives Allowed: Describe a high-stakes action scene (a foot chase, a narrow escape, a sports play) using only strong verbs and nouns. Zero adjectives or adverbs allowed.',
    'The Secret Room: You discover a hidden, doorless crawl space behind a drywall panel in your closet. What is stored inside it?',
    'The Interrogation: Write a scene consisting entirely of a conversation between an interrogator and a suspect, where the suspect answers every single question with another question.',
    'The Flavor Profile: Describe the taste and experience of eating your favorite meal to someone who has completely lost their sense of taste. Focus on texture, heat, and memory.',
    'The First Flight: Describe the sensations of a human who has suddenly discovered they can levitate, but they can only control it when they close their eyes.',
    'The Lost City: Describe a fictional city that is built entirely vertically up the sides of a massive canyon, detailing how the people at the top live versus the people at the bottom.',
    'The Final Sentence: Write a story backwards. Start with the final sentence: "And that was the last time anyone ever heard that sound." and work your way to how it began.',
  ],
  sandbox: [],
};

const makeEmptyDraft = () => ({
  id: null,
  title: '',
  body: '',
  prompt: '',
  category: null,
  date: null,
  createdAt: null,
  updatedAt: null,
  status: 'draft',
  formatting: DEFAULT_ENTRY_FORMATTING,
});

const normalizeEntryFormatting = (formatting) => ({
  bold: Boolean(formatting?.bold),
  italic: Boolean(formatting?.italic),
  underline: Boolean(formatting?.underline),
});

const formatEntryDate = (value, language = 'en') => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat(language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return '';
  }
};

const formatStatusLabel = (status, t) => {
  const normalized = String(status || 'draft').toLowerCase().replace(/_/g, '-');
  return t(`write.status.${normalized}`) || t('write.status.draft');
};

const getEntryDateParts = (value, language = 'en') => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return { day: '--', month: '' };
  }

  return {
    day: new Intl.DateTimeFormat(language, { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat(language, { month: 'short' }).format(date).toUpperCase(),
  };
};

const getEntryCharacterCount = (entry) => String(entry?.body ?? '').length;

const VALID_ENTRY_CATEGORIES = new Set(['reflective', 'persuasive', 'creative', 'sandbox']);

// Legacy key mapping for entries created before the category rename
const LEGACY_CATEGORY_MAP = { free: 'sandbox', diary: 'reflective', essay: 'persuasive' };

const getEntryFilterKey = (entry = {}) => {
  if (entry.category && VALID_ENTRY_CATEGORIES.has(entry.category)) {
    return entry.category;
  }

  // Legacy: prompt-based inference for old entries
  if (!entry.prompt) {
    return 'sandbox';
  }

  for (const [key, prompts] of Object.entries(EDITOR_PROMPTS)) {
    if (prompts.includes(entry.prompt)) {
      return key;
    }
  }

  // Map old diary/essay prompt text to new categories
  const legacyDiaryPhrases = ['today', 'memory', 'habits', 'surprised', 'relate', 'differently', 'enjoy', 'own life', 'thinking', 'recommend', 'happens next', 'sequel', 'end'];
  const lowerPrompt = entry.prompt.toLowerCase();
  if (legacyDiaryPhrases.some((phrase) => lowerPrompt.includes(phrase))) {
    return 'reflective';
  }

  return 'persuasive';
};

const getEntryStatusTone = (status, themeColors = colors) => {
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus === 'reviewed') {
    return {
      backgroundColor: themeColors.accent,
      color: themeColors.readerTappedWordText,
    };
  }

  if (normalizedStatus === 'submitted') {
    return {
      backgroundColor: themeColors.surfaceMuted,
      color: themeColors.textSecondary,
    };
  }

  return {
    backgroundColor: themeColors.surface,
    color: themeColors.textMuted,
  };
};

const getEntryNativeInsertWords = (entry) => {
  const explicitWords = entry?.assessment?.summary?.native_inserts;
  if (Array.isArray(explicitWords) && explicitWords.length > 0) {
    return explicitWords;
  }

  const englishMatches = String(entry?.body ?? '').match(/[A-Za-z][A-Za-z'-]*/g);
  return [...new Set(englishMatches ?? [])];
};

const normalizeEntry = (entry = {}, index = 0) => {
  const body = typeof entry.body === 'string' ? entry.body : entry.content ?? '';
  const date = entry.date ?? entry.createdAt ?? entry.updatedAt ?? new Date().toISOString();
  const title = typeof entry.title === 'string' && entry.title.trim()
    ? entry.title.trim()
    : '';
  const assessment = entry.assessment ?? entry.review;

  const rawCategory = entry.category ?? LEGACY_CATEGORY_MAP[entry.type] ?? null;
  const category = rawCategory && VALID_ENTRY_CATEGORIES.has(rawCategory) ? rawCategory : null;

  return {
    id: entry.id ?? `entry-${index}-${Date.now()}`,
    title,
    body,
    prompt: entry.prompt ?? '',
    category,
    date,
    createdAt: entry.createdAt ?? date,
    updatedAt: entry.updatedAt ?? date,
    status: entry.status ?? (assessment ? 'reviewed' : 'draft'),
    formatting: normalizeEntryFormatting(entry.formatting),
    ...(assessment ? { assessment } : {}),
  };
};

const isMockWritingEntry = (entryOrId) => (
  (typeof entryOrId === 'string' ? entryOrId : entryOrId?.id) === MOCK_WRITING_ENTRY_ID
);

const WritingEntryRow = ({ entry, onPress }) => {
  const { t, language } = useTranslation();
  const { colors, styles } = useWriteTheme();
  const dateParts = getEntryDateParts(entry.date ?? entry.createdAt ?? entry.updatedAt, language);
  const statusTone = getEntryStatusTone(entry.status, colors);
  const statusLabel = formatStatusLabel(entry.status, t);
  const filter = WRITING_FILTERS.find((item) => item.key === getEntryFilterKey(entry));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.writeEntryRow,
        pressed && styles.writeEntryRowPressed,
      ]}
    >
      <View style={styles.writeEntryDate}>
        <Text style={styles.writeEntryDay}>{dateParts.day}</Text>
        <Text style={styles.writeEntryMonth}>{dateParts.month}</Text>
      </View>

      <View style={styles.writeEntryMain}>
        <Text numberOfLines={1} style={styles.writeEntryTitle}>
          {entry.title || t('common.untitled')}
        </Text>
        <View style={styles.writeEntryMeta}>
          <Text style={styles.writeEntryMetaText}>{getEntryCharacterCount(entry)}</Text>
          <Text style={styles.writeEntryMetaText}>{t('write.chars', { count: '' }).trim() || 'chars'}</Text>
          <Text style={styles.writeEntryMetaDot}>·</Text>
          <Text numberOfLines={1} style={styles.writeEntryType}>
            {filter?.labelKey ? t(filter.labelKey) : t('write.free')}
          </Text>
        </View>
      </View>

      <View style={[styles.writeEntryStatusBadge, { backgroundColor: statusTone.backgroundColor }]}>
        <Text style={[styles.writeEntryStatusText, { color: statusTone.color }]}>
          {statusLabel}
        </Text>
      </View>

      <Feather name="chevron-right" size={16} color={colors.textSubtle} />
    </Pressable>
  );
};

const getEntryTimestamp = (entry, keys = ['updatedAt', 'updated_at', 'date', 'createdAt', 'created_at']) => {
  for (const key of keys) {
    const value = entry?.[key];
    if (!value) {
      continue;
    }

    const timestamp = new Date(value).getTime();
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
};

const mergeWritingEntries = (localEntries, cloudRows) => {
  const localById = new Map();
  const cloudByClientId = new Map();
  const uploadCandidates = [];

  localEntries
    .map(normalizeEntry)
    .filter((entry) => !isMockWritingEntry(entry))
    .forEach((entry) => {
      localById.set(entry.id, entry);
    });

  (cloudRows || [])
    .filter((row) => row?.client_id && !isMockWritingEntry(row.client_id))
    .forEach((row) => {
      cloudByClientId.set(row.client_id, row);
    });

  const mergedEntries = [];
  const allIds = new Set([...localById.keys(), ...cloudByClientId.keys()]);

  allIds.forEach((entryId) => {
    const localEntry = localById.get(entryId);
    const cloudRow = cloudByClientId.get(entryId);

    if (!cloudRow) {
      if (localEntry) {
        mergedEntries.push(localEntry);
        uploadCandidates.push(localEntry);
      }
      return;
    }

    const deletedAt = getEntryTimestamp(cloudRow, ['deleted_at']);
    const localUpdatedAt = getEntryTimestamp(localEntry);
    const cloudUpdatedAt = getEntryTimestamp(cloudRow);

    if (deletedAt && deletedAt >= localUpdatedAt) {
      return;
    }

    if (!localEntry) {
      mergedEntries.push(normalizeEntry(cloudWritingRowToEntry(cloudRow)));
      return;
    }

    if (cloudUpdatedAt > localUpdatedAt) {
      const cloudEntry = normalizeEntry(cloudWritingRowToEntry(cloudRow));
      mergedEntries.push({
        ...cloudEntry,
        formatting: (
          localEntry.body === cloudEntry.body
            ? normalizeEntryFormatting(localEntry.formatting)
            : cloudEntry.formatting
        ),
      });
      return;
    }

    mergedEntries.push(localEntry);
    uploadCandidates.push(localEntry);
  });

  return {
    entries: ensureMockEntry(mergedEntries.map(normalizeEntry)),
    uploadCandidates,
  };
};

const ensureMockEntry = (entries) => {
  const mockEntry = createMockWritingEntry();
  const hasMockEntry = entries.some((entry) => entry.id === MOCK_WRITING_ENTRY_ID);

  if (!hasMockEntry) {
    return [mockEntry, ...entries];
  }

  return entries.map((entry) => {
    if (entry.id !== MOCK_WRITING_ENTRY_ID) {
      return entry;
    }

    return mockEntry;
  });
};

const getAnnotationLabel = (type) =>
  ANNOTATION_LEGEND.find((item) => item.type === type)?.label ?? type;

const TypeBadge = ({ type }) => {
  const { colors, styles, annotationColors } = useWriteTheme();
  const color = annotationColors[type] ?? colors.textMuted;

  return (
    <View style={[styles.typeBadge, { borderColor: color }]}>
      <View style={[styles.typeBadgeDot, { backgroundColor: color }]} />
      <Text style={[styles.typeBadgeText, { color }]}>{getAnnotationLabel(type)}</Text>
    </View>
  );
};

const AnnotationLegend = () => {
  const { styles, annotationLegend } = useWriteTheme();

  return (
    <View style={styles.legend}>
      {annotationLegend.map((item) => (
        <View key={item.type} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={styles.legendLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
};

const AnnotatedEntry = ({ text, annotations, onAnnotationPress, style }) => {
  const { colors, styles, annotationColors } = useWriteTheme();
  const spans = buildAnnotatedSpans(text, annotations);

  return (
    <Text selectable style={[styles.assessmentEntryText, style]}>
      {spans.map((span, index) => {
        if (span.type === 'plain') {
          return <Text key={`plain-${index}`}>{span.text}</Text>;
        }

        const color = annotationColors[span.annotation.type] ?? colors.accentStrong;

        return (
          <Text
            key={`${span.annotation.id}-${index}`}
            onPress={() => onAnnotationPress(span.annotation)}
            style={[
              styles.annotatedText,
              {
                color,
                textDecorationColor: color,
              },
            ]}
          >
            {span.text}
          </Text>
        );
      })}
    </Text>
  );
};

const InlineCorrectionList = ({ annotations = [], onAnnotationPress }) => {
  const { colors, styles, annotationColors } = useWriteTheme();

  if (!annotations.length) {
    return null;
  }

  return (
    <View style={styles.inlineCorrectionList}>
      {annotations.map((annotation) => {
        const color = annotationColors[annotation.type] ?? colors.accentStrong;
        const suggestion = annotation.suggestions?.[0] ?? '';

        return (
          <Pressable
            key={annotation.id}
            onPress={() => onAnnotationPress(annotation)}
            style={({ pressed }) => [
              styles.inlineCorrectionItem,
              { borderLeftColor: color },
              pressed && styles.inlineCorrectionItemPressed,
            ]}
          >
            <View style={styles.inlineCorrectionHeader}>
              <View style={[styles.inlineCorrectionDot, { backgroundColor: color }]} />
              <Text style={[styles.inlineCorrectionType, { color }]}>
                {getAnnotationLabel(annotation.type)}
              </Text>
            </View>
            <Text selectable style={styles.inlineCorrectionText}>
              <Text style={styles.inlineCorrectionOriginal}>{annotation.original}</Text>
              {suggestion ? (
                <>
                  <Text style={styles.inlineCorrectionArrow}> -> </Text>
                  <Text style={styles.inlineCorrectionSuggestion}>{suggestion}</Text>
                </>
              ) : null}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const AnnotationSheet = ({ annotation, onClose }) => {
  const { colors, styles } = useWriteTheme();

  return (
    <Modal
      visible={Boolean(annotation)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetScrim} onPress={onClose} />
        {annotation ? (
          <View style={styles.sheetPanel}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <TypeBadge type={annotation.type} />
                <Text selectable style={styles.sheetOriginal}>
                  {annotation.original}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.sheetCloseButton}>
                <Feather name="x" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetScrollContent}
            >
              <Text selectable style={styles.sheetExplanation}>
                {annotation.explanation}
              </Text>

              <View style={styles.suggestionList}>
                {(annotation.suggestions ?? []).map((suggestion, index) => (
                  <View key={`${annotation.id}-suggestion-${index}`} style={styles.suggestionRow}>
                    <Text selectable style={styles.suggestionText}>
                      {suggestion}
                    </Text>
                    {annotation.suggestion_notes?.[index] ? (
                      <Text selectable style={styles.suggestionNote}>
                        {annotation.suggestion_notes[index]}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
};

const FormattingToolbar = ({ formatting, onToggle }) => {
  const { t } = useTranslation();
  const { styles } = useWriteTheme();
  const normalizedFormatting = normalizeEntryFormatting(formatting);
  const interactive = typeof onToggle === 'function';

  return (
    <View style={styles.editorToolbar}>
      {FORMAT_BUTTONS.map((button) => {
        const active = normalizedFormatting[button.key];
        const content = (
          <Text
            style={[
              styles.editorToolbarText,
              styles[button.textStyle],
              active && styles.editorToolbarTextActive,
            ]}
          >
            {button.label}
          </Text>
        );

        if (!interactive) {
          return (
            <View
              key={button.key}
              style={[
                styles.editorToolbarButton,
                active && styles.editorToolbarButtonActive,
              ]}
            >
              {content}
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={button.key}
            accessibilityRole="button"
            accessibilityLabel={t('write.toggleFormat', { format: button.key })}
            accessibilityState={{ selected: active }}
            activeOpacity={0.78}
            onPress={() => onToggle(button.key)}
            style={[
              styles.editorToolbarButton,
              active && styles.editorToolbarButtonActive,
            ]}
          >
            {content}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const SANDBOX_WORD_PAGE_SIZE = 5;

const Write = ({ user }) => {
  const { t, language } = useTranslation();
  const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
  const { targetLanguage } = useAppContext();
  const dueVocabWords = useVocabWords();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const annotationLegend = useMemo(() => createAnnotationLegend(colors), [colors]);
  const annotationColors = useMemo(() => createAnnotationColors(annotationLegend), [annotationLegend]);
  const writeThemeValue = useMemo(() => ({
    colors,
    styles,
    annotationLegend,
    annotationColors,
  }), [annotationColors, annotationLegend, colors, styles]);
  const screenBackground = colors.bgPage;
  const [entries, setEntries] = useState([]);
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(makeEmptyDraft());
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [activeWriteFilter, setActiveWriteFilter] = useState('all');
  const [activeEditorType, setActiveEditorType] = useState('reflective');
  const [promptIndex, setPromptIndex] = useState(0);
  const [wordBankPage, setWordBankPage] = useState(0);
  const [isAssessing, setIsAssessing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeOwnerId) {
      return undefined;
    }

    let isActive = true;
    const ownerId = activeOwnerId;
    const generation = syncGeneration;

    const loadEntries = async () => {
      setLoading(true);
      setEntries([]);
      setMode('list');
      setDraft(makeEmptyDraft());
      setSelectedEntryId(null);
      setSelectedAnnotation(null);

      try {
        const storageKey = getWritingStorageKey(ownerId);
        let raw = await AsyncStorage.getItem(storageKey);

        if (!raw && ownerId === GUEST_OWNER_ID) {
          const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyRaw) {
            const legacyParsed = JSON.parse(legacyRaw);
            if (Array.isArray(legacyParsed)) {
              const normalizedLegacyEntries = legacyParsed.map(normalizeEntry);
              raw = JSON.stringify(normalizedLegacyEntries);
              await AsyncStorage.setItem(storageKey, raw);
            }
          }
        }

        if (!isActive || !isCurrentSyncGeneration(generation)) {
          return;
        }

        const parsed = raw ? JSON.parse(raw) : [];
        const normalizedEntries = Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
        let nextEntries = ensureMockEntry(normalizedEntries);
        let uploadCandidates = [];
        const canSyncCloud = user?.id
          && ownerId === user.id
          && !syncPaused
          && isCurrentSyncGeneration(generation);

        if (canSyncCloud) {
          try {
            const cloudRows = await fetchUserWritingEntries(user.id, { includeDeleted: true });
            if (!isActive || !isCurrentSyncGeneration(generation)) {
              return;
            }

            const merged = mergeWritingEntries(normalizedEntries, cloudRows);
            nextEntries = merged.entries;
            uploadCandidates = merged.uploadCandidates;
          } catch (syncError) {
            console.warn('[Write] Cloud writing sync failed; keeping local entries:', syncError);
          }
        }

        if (!isActive || !isCurrentSyncGeneration(generation)) {
          return;
        }

        setEntries(nextEntries);

        if (JSON.stringify(nextEntries) !== JSON.stringify(normalizedEntries)) {
          await AsyncStorage.setItem(storageKey, JSON.stringify(nextEntries));
          if (!isActive || !isCurrentSyncGeneration(generation)) {
            return;
          }
        }

        if (canSyncCloud && uploadCandidates.length > 0) {
          if (!isActive || !isCurrentSyncGeneration(generation)) {
            return;
          }

          try {
            assertCanUploadForOwner({ ownerId, user });
            await upsertUserWritingEntries({
              user,
              ownerId,
              generation,
              entries: uploadCandidates,
            });
          } catch (error) {
            console.warn('[Write] Background writing upload failed:', error);
          }
        }
      } catch (error) {
        console.error('[Write] Failed to load entries:', error);
        const fallbackEntries = ensureMockEntry([]);
        if (isActive && isCurrentSyncGeneration(generation)) {
          setEntries(fallbackEntries);
          await AsyncStorage.setItem(getWritingStorageKey(ownerId), JSON.stringify(fallbackEntries));
        }
      } finally {
        if (isActive && isCurrentSyncGeneration(generation)) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    loadEntries();

    return () => {
      isActive = false;
    };
  }, [activeOwnerId, syncGeneration, syncPaused, user?.id]);

  const persistEntries = async (nextEntries) => {
    setEntries(nextEntries);
    await AsyncStorage.setItem(
      getWritingStorageKey(activeOwnerId),
      JSON.stringify(nextEntries)
    );
  };

  const syncEntryToCloud = (entry) => {
    if (
      !user?.id
      || syncPaused
      || activeOwnerId !== user.id
      || isMockWritingEntry(entry)
      || !isCurrentSyncGeneration(syncGeneration)
    ) {
      return;
    }

    try {
      assertCanUploadForOwner({ ownerId: activeOwnerId, user });
    } catch (error) {
      console.warn('[Write] Refusing writing entry upload:', error?.message ?? error);
      return;
    }

    upsertUserWritingEntry({
      user,
      ownerId: activeOwnerId,
      generation: syncGeneration,
      entry,
    }).catch((error) => {
      console.warn('[Write] Background writing entry sync failed:', error);
    });
  };

  const syncEntryDeleteToCloud = (entryId) => {
    if (
      !user?.id
      || syncPaused
      || activeOwnerId !== user.id
      || isMockWritingEntry(entryId)
      || !isCurrentSyncGeneration(syncGeneration)
    ) {
      return;
    }

    try {
      assertCanUploadForOwner({ ownerId: activeOwnerId, user });
    } catch (error) {
      console.warn('[Write] Refusing writing delete sync:', error?.message ?? error);
      return;
    }

    softDeleteUserWritingEntry({
      user,
      ownerId: activeOwnerId,
      generation: syncGeneration,
      entryId,
    }).catch((error) => {
      console.warn('[Write] Background writing delete sync failed:', error);
    });
  };

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        if (isMockWritingEntry(a)) return -1;
        if (isMockWritingEntry(b)) return 1;

        return new Date(b.updatedAt ?? b.date ?? 0) - new Date(a.updatedAt ?? a.date ?? 0);
      }),
    [entries]
  );
  const visibleEntries = useMemo(() => {
    if (activeWriteFilter === 'all') {
      return sortedEntries;
    }

    return sortedEntries.filter((entry) => getEntryFilterKey(entry) === activeWriteFilter);
  }, [activeWriteFilter, sortedEntries]);
  const currentPrompts = EDITOR_PROMPTS[activeEditorType] ?? [];
  const currentPromptText = currentPrompts.length > 0
    ? currentPrompts[promptIndex % currentPrompts.length]
    : null;

  const sandboxWordBank = useMemo(() => {
    const total = dueVocabWords.length;
    if (total === 0) return [];
    const start = (wordBankPage * SANDBOX_WORD_PAGE_SIZE) % Math.max(total, 1);
    return dueVocabWords.slice(start, start + SANDBOX_WORD_PAGE_SIZE);
  }, [dueVocabWords, wordBankPage]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId),
    [entries, selectedEntryId]
  );
  const selectedEntryIsReviewed = Boolean(
    selectedEntry?.assessment || String(selectedEntry?.status || '').toLowerCase() === 'reviewed'
  );
  const selectedEntryAnnotations = selectedEntry?.assessment?.annotations ?? [];
  const selectedEntryNativeInsertWords = selectedEntry
    ? getEntryNativeInsertWords(selectedEntry)
    : [];
  const canSave = draft.title.trim().length > 0 || draft.body.trim().length > 0;

  const openNewDraft = () => {
    setDraft(makeEmptyDraft());
    setSelectedEntryId(null);
    setSelectedAnnotation(null);
    setActiveEditorType('reflective');
    setPromptIndex(0);
    setWordBankPage(0);
    setMode('editor');
  };

  const openEntryDetail = (entry) => {
    setSelectedEntryId(entry.id);
    setSelectedAnnotation(null);
    setActiveEditorType(getEntryFilterKey(entry));
    setMode('detail');
  };

  const openExistingDraft = (entry) => {
    const normalizedEntry = normalizeEntry(entry);
    setDraft(normalizedEntry);
    setActiveEditorType(getEntryFilterKey(normalizedEntry));
    setPromptIndex(0);
    setWordBankPage(0);
    setSelectedAnnotation(null);
    setMode('editor');
  };

  const leaveEditor = () => {
    setDraft(makeEmptyDraft());
    setMode('list');
  };

  const leaveDetail = () => {
    setSelectedEntryId(null);
    setSelectedAnnotation(null);
    setMode('list');
  };

  const buildNextEntry = ({ status = 'draft', assessment = null } = {}) => {
    const now = new Date().toISOString();
    const existingEntry = entries.find((entry) => entry.id === draft.id);
    const preservedAssessment =
      assessment ?? (draft.assessment && existingEntry?.body === draft.body ? draft.assessment : null);
    const fallbackTitle = draft.body.trim().replace(/\s+/g, ' ').slice(0, 24);
    return {
      id: draft.id ?? `entry-${Date.now()}`,
      title: draft.title.trim() || fallbackTitle || t('common.untitled'),
      body: draft.body,
      prompt: draft.prompt,
      category: activeEditorType,
      date: draft.date ?? now,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
      status: preservedAssessment ? (status === 'draft' ? draft.status ?? 'reviewed' : status) : status,
      formatting: normalizeEntryFormatting(draft.formatting),
      ...(preservedAssessment ? { assessment: preservedAssessment } : {}),
    };
  };

  const persistAndSyncEntry = async (nextEntry, currentEntries) => {
    const existingIndex = currentEntries.findIndex((entry) => entry.id === nextEntry.id);
    const nextEntries = existingIndex >= 0
      ? currentEntries.map((entry, index) => (index === existingIndex ? nextEntry : entry))
      : [nextEntry, ...currentEntries];
    await persistEntries(nextEntries);
    syncEntryToCloud(nextEntry);
    return nextEntries;
  };

  const saveEntry = async () => {
    if (!canSave) return;
    const nextEntry = buildNextEntry();
    await persistAndSyncEntry(nextEntry, entries);
    leaveEditor();
  };

  const submitForAssessment = async () => {
    if (!user) {
      Alert.alert('', t('write.assessSignInRequired'));
      return;
    }

    const wordCount = draft.body.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 30) {
      Alert.alert('', t('write.assessTooShort'));
      return;
    }
    if (wordCount > 500) {
      Alert.alert('', t('write.assessTooLong'));
      return;
    }

    setIsAssessing(true);
    const submittedEntry = buildNextEntry({ status: 'submitted' });
    let currentEntries = await persistAndSyncEntry(submittedEntry, entries).catch(() => entries);

    try {
      const sandboxWords = activeEditorType === 'sandbox'
        ? sandboxWordBank.map((w) => w.word ?? w.def ?? '').filter(Boolean)
        : [];

      const assessment = await assessEntry({
        body: submittedEntry.body,
        category: activeEditorType,
        language: targetLanguage ?? 'ko',
        prompt: submittedEntry.prompt,
        sandboxWords,
      });

      const reviewedEntry = {
        ...submittedEntry,
        status: 'reviewed',
        assessment,
        updatedAt: new Date().toISOString(),
      };

      await persistAndSyncEntry(reviewedEntry, currentEntries);
      setDraft(makeEmptyDraft());
      setSelectedEntryId(reviewedEntry.id);
      setSelectedAnnotation(null);
      setMode('detail');
    } catch (error) {
      leaveEditor();
      const detail = error?.response?.data?.detail ?? '';
      const isQuota = error?.response?.status === 429;
      Alert.alert('', isQuota ? t('write.assessLimitReached') : (detail || t('write.assessError')));
    } finally {
      setIsAssessing(false);
    }
  };

  const deleteEntry = async (entryId) => {
    const nextEntries = entries.filter((entry) => entry.id !== entryId);
    await persistEntries(nextEntries);
    syncEntryDeleteToCloud(entryId);
    setSelectedEntryId(null);
    setSelectedAnnotation(null);
    leaveEditor();
  };

  const updateDraft = (patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const toggleDraftFormatting = (formatKey) => {
    setDraft((prev) => {
      const formatting = normalizeEntryFormatting(prev.formatting);
      return {
        ...prev,
        formatting: {
          ...formatting,
          [formatKey]: !formatting[formatKey],
        },
      };
    });
  };

  const selectEditorType = (type) => {
    setActiveEditorType(type);
    setPromptIndex(0);
    setWordBankPage(0);
    updateDraft({ prompt: '' });
  };

  if (loading) {
    return (
      <WriteThemeContext.Provider value={writeThemeValue}>
        <Screen backgroundColor={screenBackground}>
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>{t('write.loading')}</Text>
          </View>
        </Screen>
      </WriteThemeContext.Provider>
    );
  }

  return (
    <WriteThemeContext.Provider value={writeThemeValue}>
    <Screen scroll backgroundColor={screenBackground} contentContainerStyle={styles.screenContent}>
      {mode === 'list' ? (
        <View style={styles.writeHome}>
          <View style={styles.appTopBar}>
            <View style={styles.appTopSide} />
            <Text style={styles.appTopTitle}>{t('write.title')}</Text>
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={openNewDraft}
              style={styles.appTopSideRight}
            >
              <Feather name="edit-3" size={19} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.writeHomeHeader}>
            <View style={styles.writeHomeTitleBlock}>
              <Text style={styles.writeHomeTitle}>{t('write.archive')}</Text>
              <View style={styles.writeHomeCountRow}>
                <Text style={styles.writeHomeCount}>{entries.length}</Text>
                <Text style={styles.writeHomeCountLabel}>{t('write.entries')}</Text>
              </View>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.writeFilterRow}
          >
            {WRITING_FILTERS.map((filter) => {
              const active = activeWriteFilter === filter.key;
              return (
                <TouchableOpacity
                  key={filter.key}
                  onPress={() => setActiveWriteFilter(filter.key)}
                  style={[styles.writeFilterChip, active && styles.writeFilterChipActive]}
                >
                  <Text style={[styles.writeFilterText, active && styles.writeFilterTextActive]}>
                    {t(filter.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {visibleEntries.length === 0 ? (
            <Card style={styles.emptyCard} contentStyle={styles.emptyContent}>
              <View style={styles.emptyCopy}>
                <Text style={styles.emptyTitle}>{t('write.emptyTitle')}</Text>
                <Text style={styles.emptyBody}>
                  {t('write.emptyBody')}
                </Text>
              </View>
              <IconButton
                tone="accent"
                label={t('write.newEntry')}
                onPress={openNewDraft}
                icon={<Feather name="plus" size={16} color={colors.accentStrong} />}
              />
            </Card>
          ) : (
            <View style={styles.writeEntryList}>
              {visibleEntries.map((entry) => (
                <WritingEntryRow
                  key={entry.id}
                  entry={entry}
                  onPress={() => openEntryDetail(entry)}
                />
              ))}
            </View>
          )}
        </View>
      ) : mode === 'detail' && selectedEntry ? (
        <View style={styles.reviewShell}>
          <View style={styles.editorTopBar}>
            <TouchableOpacity
              accessibilityLabel={t('write.backList')}
              onPress={leaveDetail}
              style={styles.editorBackButton}
            >
              <Feather name="chevron-left" size={18} color={colors.text} />
            </TouchableOpacity>

            {selectedEntryIsReviewed ? (
              <View style={styles.editorTopBarSpacer} />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.editorTypeChips}
                style={styles.editorTypeScroller}
              >
                {EDITOR_TYPE_FILTERS.map((filter) => {
                  const active = getEntryFilterKey(selectedEntry) === filter.key;

                  return (
                    <View
                      key={filter.key}
                      style={[styles.editorTypeChip, active && styles.editorTypeChipActive]}
                    >
                      <Text style={[styles.editorTypeText, active && styles.editorTypeTextActive]}>
                        {t(filter.labelKey)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {!selectedEntryIsReviewed ? (
              <TouchableOpacity onPress={() => openExistingDraft(selectedEntry)} style={styles.editorSaveButton}>
                <Text style={styles.editorSaveText}>{t('common.edit')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {selectedEntry.prompt && !selectedEntryIsReviewed ? (
            <View style={styles.editorPromptPanel}>
              <View style={styles.editorPromptHeader}>
                <Text style={styles.editorPromptHeaderText}>{t('write.choosePrompt')}</Text>
              </View>
              <View style={[styles.editorPromptOption, styles.editorPromptOptionLast, styles.editorPromptOptionSelected]}>
                <Text style={styles.editorPromptOptionTextSelected}>{selectedEntry.prompt}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.reviewTitleBlock}>
            <Text selectable style={styles.reviewTitleText}>
              {selectedEntry.title}
            </Text>
            <View style={styles.reviewTitleMetaRow}>
              <View style={styles.reviewStatusPill}>
                <Text style={styles.reviewStatusText}>{t('write.reviewed')}</Text>
              </View>
              <Text style={styles.reviewTitleMeta}>
                {t(WRITING_FILTERS.find((filter) => filter.key === getEntryFilterKey(selectedEntry))?.labelKey ?? 'write.filters.sandbox')}
              </Text>
              <Text style={styles.reviewTitleMetaDot}>·</Text>
              <Text style={styles.reviewTitleMeta}>
                {formatEntryDate(selectedEntry.date ?? selectedEntry.createdAt ?? selectedEntry.updatedAt, language)}
              </Text>
            </View>
          </View>

          <View style={styles.reviewWritingPanel}>
            {!selectedEntryIsReviewed ? (
              <FormattingToolbar formatting={selectedEntry.formatting} />
            ) : null}

            <View style={styles.reviewEntryMetaBar}>
              <Text style={styles.reviewEntryMetaText}>
                {t('write.chars', { count: getEntryCharacterCount(selectedEntry) })}
              </Text>
              <View style={styles.reviewTranslateBadge}>
                <Text style={styles.reviewTranslateCount}>
                  {selectedEntryNativeInsertWords.length}
                </Text>
                <Text style={styles.reviewTranslateLabel}>{t('write.toTranslate')}</Text>
              </View>
            </View>

            {selectedEntryAnnotations.length > 0 ? (
              <>
                <AnnotatedEntry
                  text={selectedEntry.body || t('write.startKorean')}
                  annotations={selectedEntryAnnotations}
                  onAnnotationPress={setSelectedAnnotation}
                  style={[
                    styles.reviewEntryBodyText,
                    selectedEntry.formatting?.bold && styles.formattedBodyBold,
                    selectedEntry.formatting?.italic && styles.formattedBodyItalic,
                    selectedEntry.formatting?.underline && styles.formattedBodyUnderline,
                  ]}
                />
                <InlineCorrectionList
                  annotations={selectedEntryAnnotations}
                  onAnnotationPress={setSelectedAnnotation}
                />
              </>
            ) : (
              <Text
                selectable
                style={[
                  styles.reviewEntryBodyText,
                  selectedEntry.formatting?.bold && styles.formattedBodyBold,
                  selectedEntry.formatting?.italic && styles.formattedBodyItalic,
                  selectedEntry.formatting?.underline && styles.formattedBodyUnderline,
                ]}
              >
                {selectedEntry.body || t('write.startKorean')}
              </Text>
            )}

            {selectedEntryNativeInsertWords.length > 0 ? (
              <View style={styles.reviewEnglishWords}>
                <Text style={styles.reviewEnglishWordsLabel}>
                  {t('write.englishWords')}
                </Text>
                <View style={styles.reviewEnglishWordChips}>
                  {selectedEntryNativeInsertWords.map((word) => (
                    <View key={word} style={styles.reviewEnglishWordChip}>
                      <Text style={styles.reviewEnglishWordText}>{word}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>

          {!selectedEntryIsReviewed ? (
            <TouchableOpacity onPress={() => openExistingDraft(selectedEntry)} style={styles.editorSubmitButton}>
              <Text style={styles.editorSubmitText}>{t('write.getAiFeedback')}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={leaveDetail} style={styles.reviewDoneButton}>
            <Text style={styles.reviewDoneText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.editorShell}>
          <View style={styles.editorTopBar}>
            <TouchableOpacity
              accessibilityLabel={t('write.backList')}
              onPress={leaveEditor}
              style={styles.editorBackButton}
            >
              <Feather name="x" size={18} color={colors.text} />
              <Text style={styles.editorCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <Text style={styles.editorBarTitle}>{t('write.newEntry')}</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.editorTypeChips}
              style={styles.editorTypeScroller}
            >
              {EDITOR_TYPE_FILTERS.map((filter) => {
                const active = activeEditorType === filter.key;

                return (
                  <TouchableOpacity
                    key={filter.key}
                    onPress={() => selectEditorType(filter.key)}
                    style={[styles.editorTypeChip, active && styles.editorTypeChipActive]}
                  >
                    <Text style={[styles.editorTypeText, active && styles.editorTypeTextActive]}>
                      {t(filter.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              disabled={!canSave}
              onPress={saveEntry}
              style={[styles.editorSaveButton, !canSave && styles.editorSaveButtonDisabled]}
            >
              <Text style={[styles.editorSaveText, !canSave && styles.editorSaveTextDisabled]}>
                {t('common.save')}
              </Text>
            </TouchableOpacity>
          </View>

          {activeEditorType === 'sandbox' ? (
            <View style={styles.editorPromptPanel}>
              <View style={styles.editorPromptHeader}>
                <Text style={styles.editorPromptHeaderText}>{t('write.wordBank')}</Text>
                {dueVocabWords.length > SANDBOX_WORD_PAGE_SIZE ? (
                  <TouchableOpacity
                    onPress={() => setWordBankPage((p) => p + 1)}
                    style={styles.editorPromptReloadButton}
                  >
                    <Feather name="refresh-cw" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {sandboxWordBank.length > 0 ? (
                <>
                  <Text style={styles.editorPromptHint}>{t('write.wordBankOptional')}</Text>
                  <View style={styles.sandboxWordChips}>
                    {sandboxWordBank.map((word, idx) => (
                      <View key={word.word ?? idx} style={styles.sandboxWordChip}>
                        <Text style={styles.sandboxWordText}>{word.word}</Text>
                        {word.def ? (
                          <Text style={styles.sandboxWordDef} numberOfLines={1}>{word.def}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text style={styles.editorPromptHint}>{t('write.wordBankEmpty')}</Text>
              )}
            </View>
          ) : currentPromptText ? (
            <View style={styles.editorPromptPanel}>
              <View style={styles.editorPromptHeader}>
                <Text style={styles.editorPromptHeaderText}>{t('write.choosePrompt')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    const next = (promptIndex + 1) % currentPrompts.length;
                    setPromptIndex(next);
                    updateDraft({ prompt: currentPrompts[next] });
                  }}
                  style={styles.editorPromptReloadButton}
                >
                  <Feather name="refresh-cw" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Pressable
                onPress={() => updateDraft({ prompt: draft.prompt === currentPromptText ? '' : currentPromptText })}
                style={[styles.editorPromptOption, styles.editorPromptOptionLast, draft.prompt === currentPromptText && styles.editorPromptOptionSelected]}
              >
                <Text style={[styles.editorPromptOptionText, draft.prompt === currentPromptText && styles.editorPromptOptionTextSelected]}>
                  {currentPromptText}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.editorWritingPanel}>
            <FormattingToolbar formatting={draft.formatting} onToggle={toggleDraftFormatting} />

            <TextInput
              value={draft.title}
              onChangeText={(title) => updateDraft({ title })}
              placeholder={t('write.titlePlaceholder')}
              placeholderTextColor={colors.textSubtle}
              style={styles.editorTitleInput}
            />

            <TextInput
              value={draft.body}
              onChangeText={(body) => updateDraft({ body })}
              placeholder={t('write.startKorean')}
              placeholderTextColor={colors.textSubtle}
              multiline
              textAlignVertical="top"
              style={[
                styles.editorBodyInput,
                draft.formatting?.bold && styles.formattedBodyBold,
                draft.formatting?.italic && styles.formattedBodyItalic,
                draft.formatting?.underline && styles.formattedBodyUnderline,
              ]}
            />
          </View>

          <TouchableOpacity
            disabled={!canSave || isAssessing}
            onPress={submitForAssessment}
            style={[styles.editorSubmitButton, (!canSave || isAssessing) && styles.editorSubmitButtonDisabled]}
          >
            <Text style={styles.editorSubmitText}>
              {isAssessing ? t('write.assessingEntry') : t('write.getAiFeedback')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!canSave || isAssessing}
            onPress={saveEntry}
            style={[styles.reviewDoneButton, (!canSave || isAssessing) && styles.editorSaveButtonDisabled]}
          >
            <Text style={[styles.reviewDoneText, (!canSave || isAssessing) && styles.editorSaveTextDisabled]}>
              {t('write.saveAsDraft')}
            </Text>
          </TouchableOpacity>

          {draft.id ? (
            <TouchableOpacity
              disabled={isAssessing}
              onPress={() =>
                Alert.alert(
                  t('write.deleteEntryTitle'),
                  t('write.deleteEntryBody'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.delete'), style: 'destructive', onPress: () => deleteEntry(draft.id) },
                  ]
                )
              }
              style={styles.deleteLink}
            >
              <Text style={styles.deleteLinkText}>{t('write.deleteEntry')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      <AnnotationSheet
        annotation={selectedAnnotation}
        onClose={() => setSelectedAnnotation(null)}
      />
    </Screen>
    </WriteThemeContext.Provider>
  );
};

const createStyles = (colors) => StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: spacing.xl * 2,
  },
  writeHome: {
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
  appTopSideRight: {
    width: 70,
    alignItems: 'flex-end',
  },
  appTopTitle: {
    flex: 1,
    textAlign: 'center',
    ...textStyles.appTitle,
  },
  writeHomeHeader: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  writeHomeTitleBlock: {
    gap: 2,
  },
  writeHomeTitle: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text,
  },
  writeHomeCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  writeHomeCount: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  writeHomeCountLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  writeNewButton: {
    minHeight: 31,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  writeNewButtonDisabled: {
    opacity: 0.42,
  },
  writeNewButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    color: colors.white,
  },
  writeFilterRow: {
    paddingHorizontal: 24,
    gap: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  writeFilterChip: {
    minHeight: 30,
    borderRadius: 0,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.transparent,
  },
  writeFilterChipActive: {
    backgroundColor: colors.transparent,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  writeFilterText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.8,
    color: colors.textSubtle,
    textTransform: 'uppercase',
  },
  writeFilterTextActive: {
    fontFamily: fontFamilies.sansBold,
    color: colors.text,
  },
  writeEntryList: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.bgPage,
    marginTop: 0,
  },
  writeEntryRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  writeEntryRowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  writeEntryDate: {
    width: 0,
    display: 'none',
    alignItems: 'center',
    gap: 1,
  },
  writeEntryDay: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 16,
    lineHeight: 18,
    color: colors.text,
  },
  writeEntryMonth: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 10,
    lineHeight: 13,
    color: colors.textSubtle,
  },
  writeEntryMain: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  writeEntryTitle: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  writeEntryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  writeEntryMetaText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSubtle,
  },
  writeEntryMetaDot: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    color: colors.textSubtle,
  },
  writeEntryType: {
    flexShrink: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSubtle,
  },
  writeEntryStatusBadge: {
    minHeight: 22,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  writeEntryStatusText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  stack: {
    gap: spacing.md,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...textStyles.bodyMuted,
  },
  emptyCard: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: radii.md,
  },
  emptyContent: {
    gap: spacing.md,
  },
  emptyCopy: {
    gap: spacing.xs,
  },
  emptyTitle: {
    ...textStyles.sectionTitle,
  },
  emptyBody: {
    ...textStyles.bodyMuted,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButtonLabel: {
    ...textStyles.label,
    color: colors.text,
  },
  editorShell: {
    gap: 0,
  },
  editorTopBar: {
    minHeight: 52,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.bgPage,
    position: 'relative',
  },
  editorTopBarSpacer: {
    flex: 1,
  },
  editorBackButton: {
    width: 86,
    height: 34,
    borderRadius: 0,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: colors.transparent,
    borderWidth: 0,
  },
  editorCancelText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.6,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  editorBarTitle: {
    flex: 1,
    textAlign: 'center',
    ...textStyles.screenBarTitle,
  },
  editorTypeScroller: {
    position: 'absolute',
    top: 62,
    left: 24,
    right: 24,
  },
  editorTypeChips: {
    alignItems: 'center',
    gap: 8,
  },
  editorTypeChip: {
    minHeight: 28,
    borderRadius: radii.pill,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.transparent,
  },
  editorTypeChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  editorTypeText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.6,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  editorTypeTextActive: {
    color: colors.white,
  },
  editorSaveButton: {
    width: 86,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: 0,
  },
  editorSaveButtonDisabled: {
    opacity: 0.5,
  },
  editorSaveText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.8,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  editorSaveTextDisabled: {
    color: colors.textSubtle,
  },
  editorPromptPanel: {
    marginHorizontal: 24,
    marginTop: 48,
    borderRadius: 0,
    borderWidth: 0,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderStrong,
    backgroundColor: colors.transparent,
    overflow: 'hidden',
  },
  editorPromptHeader: {
    minHeight: 35,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0,
    paddingLeft: 14,
  },
  editorPromptHeaderText: {
    ...textStyles.eyebrow,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textSubtle,
  },
  editorPromptChevronIcon: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorPromptReloadButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorPromptHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    color: colors.textSubtle,
    paddingLeft: 14,
    paddingBottom: 8,
  },
  sandboxWordChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingLeft: 14,
    paddingBottom: 10,
    gap: 8,
  },
  sandboxWordChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 160,
  },
  sandboxWordText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    color: colors.text,
  },
  sandboxWordDef: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  editorPromptOptions: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editorPromptOption: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  editorPromptOptionSelected: {
    backgroundColor: colors.surfaceMuted,
  },
  editorPromptOptionLast: {
    borderBottomWidth: 0,
  },
  editorPromptOptionText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  editorPromptOptionTextSelected: {
    color: colors.text,
    fontFamily: fontFamilies.sansMedium,
  },
  editorWritingPanel: {
    marginHorizontal: 24,
    marginTop: 20,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: colors.bgPage,
    overflow: 'hidden',
  },
  editorToolbar: {
    minHeight: 0,
    display: 'none',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surfaceMuted,
  },
  editorToolbarButton: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorToolbarButtonActive: {
    backgroundColor: colors.surfaceSelected,
  },
  editorToolbarText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 18,
    color: colors.textMuted,
  },
  editorToolbarTextActive: {
    color: colors.text,
  },
  editorToolbarTextBold: {
    fontFamily: fontFamilies.sansBold,
  },
  editorToolbarTextItalic: {
    fontStyle: 'italic',
  },
  editorToolbarTextUnderline: {
    textDecorationLine: 'underline',
  },
  editorTitleInput: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingHorizontal: 0,
    paddingVertical: 12,
    color: colors.text,
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 23,
    lineHeight: 31,
  },
  editorBodyInput: {
    minHeight: 360,
    paddingHorizontal: 0,
    paddingTop: 14,
    paddingBottom: 18,
    color: colors.text,
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 16,
    lineHeight: 32,
  },
  formattedBodyBold: {
    fontFamily: fontFamilies.krSerifBold,
  },
  formattedBodyItalic: {
    fontStyle: 'italic',
  },
  formattedBodyUnderline: {
    textDecorationLine: 'underline',
  },
  editorSubmitButton: {
    marginHorizontal: 24,
    minHeight: 45,
    borderRadius: 4,
    paddingHorizontal: 13,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  editorSubmitButtonDisabled: {
    opacity: 0.5,
  },
  editorSubmitText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.white,
  },
  reviewShell: {
    gap: 14,
  },
  reviewTitleBlock: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  reviewTitleText: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 23,
    lineHeight: 31,
    color: colors.text,
    letterSpacing: 0,
  },
  reviewTitleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  reviewStatusPill: {
    minHeight: 23,
    borderRadius: 2,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewStatusText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  reviewTitleMeta: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  reviewTitleMetaDot: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  reviewWritingPanel: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  reviewEntryMetaBar: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingHorizontal: 18,
  },
  reviewEntryMetaText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSubtle,
  },
  reviewTranslateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reviewTranslateCount: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text,
  },
  reviewTranslateLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.accent,
  },
  reviewEntryBodyText: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    color: colors.text,
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 17,
    lineHeight: 34,
  },
  reviewEnglishWords: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: colors.surfaceMuted,
  },
  reviewEnglishWordsLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  reviewEnglishWordChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reviewEnglishWordChip: {
    minHeight: 25,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewEnglishWordText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.accent,
  },
  inlineCorrectionList: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: colors.surface,
  },
  inlineCorrectionItem: {
    borderLeftWidth: 3,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  inlineCorrectionItemPressed: {
    backgroundColor: colors.surfaceSelected,
  },
  inlineCorrectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineCorrectionDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
  },
  inlineCorrectionType: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    lineHeight: 14,
  },
  inlineCorrectionText: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  inlineCorrectionOriginal: {
    color: colors.text,
  },
  inlineCorrectionArrow: {
    fontFamily: fontFamilies.sansRegular,
    color: colors.textSubtle,
  },
  inlineCorrectionSuggestion: {
    color: colors.accent,
  },
  reviewDoneButton: {
    marginHorizontal: WRITE_SIDE_PADDING,
    minHeight: 45,
    borderRadius: 4,
    paddingHorizontal: 13,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  reviewDoneText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.white,
  },
  selectedPromptLabel: {
    ...textStyles.eyebrow,
  },
  selectedPromptText: {
    ...textStyles.body,
  },
  actionButton: {
    flex: 1,
  },
  detailPromptCard: {
    borderRadius: radii.md,
  },
  detailPromptContent: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  assessmentCard: {
    borderRadius: radii.md,
  },
  assessmentCardContent: {
    paddingVertical: spacing.lg,
  },
  assessmentEntryText: {
    color: colors.text,
    fontFamily: 'FFSerif-Regular',
    fontSize: 17,
    lineHeight: 31,
  },
  annotatedText: {
    fontFamily: 'FFSerif-SemiBold',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  legendItem: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  legendLabel: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  typeBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  typeBadgeText: {
    ...textStyles.caption,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheetPanel: {
    maxHeight: '82%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: spacing.sm,
  },
  sheetOriginal: {
    ...textStyles.sectionTitle,
    color: colors.text,
  },
  sheetCloseButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  sheetScrollContent: {
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetExplanation: {
    ...textStyles.body,
  },
  suggestionList: {
    gap: spacing.sm,
  },
  suggestionRow: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  suggestionText: {
    ...textStyles.label,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  suggestionNote: {
    ...textStyles.bodyMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  deleteLink: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
  },
  deleteLinkText: {
    ...textStyles.label,
    color: colors.danger,
  },
});

const defaultWriteStyles = createStyles(colors);

export default Write;
