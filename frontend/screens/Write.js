import React, { useEffect, useMemo, useState } from 'react';
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
  ANNOTATION_COLORS,
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
import { colors, fontFamilies, radii, spacing, textStyles } from '../theme';

const LEGACY_STORAGE_KEY = 'writing_entries_v1';
const getWritingStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'writing-entries-v1');
const WRITE_SCREEN_BACKGROUND = '#ece4d6';
const WRITE_SIDE_PADDING = 18;
const WRITING_FILTERS = [
  { key: 'all', labelKey: 'write.filters.all' },
  { key: 'free', labelKey: 'write.filters.free' },
  { key: 'diary', labelKey: 'write.filters.diary' },
  { key: 'essay', labelKey: 'write.filters.essay' },
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

const PROMPT_CATEGORIES = [
  {
    title: 'Comprehension & summary',
    prompts: [
      'Summarize what happened in this chapter/book in your own words',
      'Who are the main characters and what do they want?',
      'What was the most important moment and why?',
    ],
  },
  {
    title: 'Reaction & opinion',
    prompts: [
      'What surprised you most and why?',
      'Which character do you relate to most?',
      'What would you have done differently if you were the main character?',
      "Did you enjoy it? What worked and what didn't?",
    ],
  },
  {
    title: 'Themes & meaning',
    prompts: [
      'What is the author trying to say about human nature?',
      'What is the central conflict and how is it resolved?',
      "What does the title mean to you now that you've read it?",
    ],
  },
  {
    title: 'Personal connection',
    prompts: [
      'Does anything in this story remind you of your own life?',
      'Has this changed how you think about anything?',
      'Would you recommend this to a friend and how would you describe it?',
    ],
  },
  {
    title: 'Prediction & continuation',
    prompts: [
      'What do you think happens next?',
      'If there were a sequel, what would it be about?',
      'How do you think this will end?',
    ],
  },
  {
    title: 'Language-focused',
    prompts: [
      'Write about a scene using at least 3 new words you learned while reading it',
      'Retell a key moment from the perspective of a different character',
      "Describe the setting as if explaining it to someone who hasn't read the book",
    ],
  },
];

const EDITOR_PROMPT_OPTIONS = {
  free: [],
  diary: [
    'Describe a moment from today that surprised you.',
    'Write about a memory that came to mind recently.',
    'How have your habits changed in the past year?',
  ],
  essay: [
    'Is modern life making people more isolated?',
    'What does it mean to belong to a place?',
    'Compare city life and rural life in Korea.',
    ...PROMPT_CATEGORIES[5].prompts,
  ],
};

const makeEmptyDraft = () => ({
  id: null,
  title: '',
  body: '',
  prompt: '',
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

const getEntryFilterKey = (entry = {}) => {
  if (!entry.prompt) {
    return 'free';
  }

  const directType = Object.entries(EDITOR_PROMPT_OPTIONS).find(([, prompts]) =>
    prompts.includes(entry.prompt)
  )?.[0];
  if (directType) {
    return directType;
  }

  const categoryTitle = PROMPT_CATEGORIES.find((category) =>
    category.prompts.includes(entry.prompt)
  )?.title ?? '';

  if (/personal|reaction|prediction/i.test(categoryTitle)) {
    return 'diary';
  }

  return 'essay';
};

const getEntryStatusTone = (status) => {
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus === 'reviewed') {
    return {
      backgroundColor: '#e7f0e2',
      color: '#5c8754',
    };
  }

  if (normalizedStatus === 'submitted') {
    return {
      backgroundColor: '#f6ecd6',
      color: '#a9782c',
    };
  }

  return {
    backgroundColor: '#f0ece2',
    color: '#8c8172',
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
    : '[Untitled]';
  const assessment = entry.assessment ?? entry.review;

  return {
    id: entry.id ?? `entry-${index}-${Date.now()}`,
    title,
    body,
    prompt: entry.prompt ?? '',
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
  const dateParts = getEntryDateParts(entry.date ?? entry.createdAt ?? entry.updatedAt, language);
  const statusTone = getEntryStatusTone(entry.status);
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
          {entry.title}
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

      <Feather name="chevron-right" size={16} color="#b3a892" />
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
  const color = ANNOTATION_COLORS[type] ?? colors.textMuted;

  return (
    <View style={[styles.typeBadge, { borderColor: color }]}>
      <View style={[styles.typeBadgeDot, { backgroundColor: color }]} />
      <Text style={[styles.typeBadgeText, { color }]}>{getAnnotationLabel(type)}</Text>
    </View>
  );
};

const AnnotationLegend = () => (
  <View style={styles.legend}>
    {ANNOTATION_LEGEND.map((item) => (
      <View key={item.type} style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: item.color }]} />
        <Text style={styles.legendLabel}>{item.label}</Text>
      </View>
    ))}
  </View>
);

const AnnotatedEntry = ({ text, annotations, onAnnotationPress, style }) => {
  const spans = buildAnnotatedSpans(text, annotations);

  return (
    <Text selectable style={[styles.assessmentEntryText, style]}>
      {spans.map((span, index) => {
        if (span.type === 'plain') {
          return <Text key={`plain-${index}`}>{span.text}</Text>;
        }

        const color = ANNOTATION_COLORS[span.annotation.type] ?? colors.accentStrong;

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
  if (!annotations.length) {
    return null;
  }

  return (
    <View style={styles.inlineCorrectionList}>
      {annotations.map((annotation) => {
        const color = ANNOTATION_COLORS[annotation.type] ?? colors.accentStrong;
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

const AnnotationSheet = ({ annotation, onClose }) => (
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

const FormattingToolbar = ({ formatting, onToggle }) => {
  const { t } = useTranslation();
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

const Write = ({ user }) => {
  const { t, language } = useTranslation();
  const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
  const [entries, setEntries] = useState([]);
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(makeEmptyDraft());
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [activeWriteFilter, setActiveWriteFilter] = useState('all');
  const [activeEditorType, setActiveEditorType] = useState('diary');
  const [promptPickerExpanded, setPromptPickerExpanded] = useState(false);
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
      setPromptPickerExpanded(false);

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
  const editorPromptOptions = EDITOR_PROMPT_OPTIONS[activeEditorType] ?? [];
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
    setActiveEditorType('diary');
    setPromptPickerExpanded(false);
    setMode('editor');
  };

  const openEntryDetail = (entry) => {
    setSelectedEntryId(entry.id);
    setSelectedAnnotation(null);
    setActiveEditorType(getEntryFilterKey(entry));
    setPromptPickerExpanded(false);
    setMode('detail');
  };

  const openExistingDraft = (entry) => {
    const normalizedEntry = normalizeEntry(entry);
    setDraft(normalizedEntry);
    setActiveEditorType(getEntryFilterKey(normalizedEntry));
    setPromptPickerExpanded(false);
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

  const saveEntry = async () => {
    if (!canSave) {
      return;
    }

    const now = new Date().toISOString();
    const existingEntry = entries.find((entry) => entry.id === draft.id);
    const preservedAssessment =
      draft.assessment && existingEntry?.body === draft.body ? draft.assessment : null;
    const fallbackTitle = draft.body.trim().replace(/\s+/g, ' ').slice(0, 24);
    const nextEntry = {
      id: draft.id ?? `entry-${Date.now()}`,
      title: draft.title.trim() || fallbackTitle || '[Untitled]',
      body: draft.body,
      prompt: draft.prompt,
      date: draft.date ?? now,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
      status: preservedAssessment ? draft.status ?? 'reviewed' : 'draft',
      formatting: normalizeEntryFormatting(draft.formatting),
      ...(preservedAssessment ? { assessment: preservedAssessment } : {}),
    };

    const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);
    const nextEntries = existingIndex >= 0
      ? entries.map((entry, index) => (index === existingIndex ? nextEntry : entry))
      : [nextEntry, ...entries];

    await persistEntries(nextEntries);
    syncEntryToCloud(nextEntry);
    leaveEditor();
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
    setPromptPickerExpanded(type !== 'free');
    if (type === 'free' || !EDITOR_PROMPT_OPTIONS[type]?.includes(draft.prompt)) {
      updateDraft({ prompt: '' });
    }
  };

  if (loading) {
    return (
      <Screen backgroundColor={WRITE_SCREEN_BACKGROUND}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>{t('write.loading')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll backgroundColor={WRITE_SCREEN_BACKGROUND} contentContainerStyle={styles.screenContent}>
      {mode === 'list' ? (
        <View style={styles.writeHome}>
          <View style={styles.writeHomeHeader}>
            <View style={styles.writeHomeTitleBlock}>
              <Text style={styles.writeHomeTitle}>{t('write.title')}</Text>
              <View style={styles.writeHomeCountRow}>
                <Text style={styles.writeHomeCount}>{entries.length}</Text>
                <Text style={styles.writeHomeCountLabel}>{t('write.entries')}</Text>
              </View>
            </View>

            <TouchableOpacity
              disabled
              accessibilityState={{ disabled: true }}
              style={[styles.writeNewButton, styles.writeNewButtonDisabled]}
            >
              <Text style={styles.writeNewButtonText}>{t('write.new')}</Text>
            </TouchableOpacity>
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
              <Feather name="chevron-left" size={18} color="#2c261f" />
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
                <View style={styles.editorPromptChevronIcon}>
                  <Feather name="chevron-right" size={16} color="#776b5e" />
                </View>
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
                {t(WRITING_FILTERS.find((filter) => filter.key === getEntryFilterKey(selectedEntry))?.labelKey ?? 'write.filters.free')}
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
              <Text style={styles.editorSubmitText}>{t('write.submitReview')}</Text>
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
              <Feather name="chevron-left" size={18} color="#2c261f" />
            </TouchableOpacity>

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

          {activeEditorType !== 'free' ? (
            <View style={styles.editorPromptPanel}>
              <Pressable
                onPress={() => setPromptPickerExpanded((expanded) => !expanded)}
                style={styles.editorPromptHeader}
              >
                <Text style={styles.editorPromptHeaderText}>{t('write.choosePrompt')}</Text>
                <View style={styles.editorPromptChevronIcon}>
                  <Feather
                    name={promptPickerExpanded ? 'chevron-down' : 'chevron-right'}
                    size={16}
                    color="#776b5e"
                  />
                </View>
              </Pressable>
              {promptPickerExpanded ? (
                <View style={styles.editorPromptOptions}>
                  {editorPromptOptions.map((prompt, index) => {
                    const selected = draft.prompt === prompt;
                    const last = index === editorPromptOptions.length - 1;

                    return (
                      <Pressable
                        key={prompt}
                        onPress={() => {
                          updateDraft({ prompt });
                          setPromptPickerExpanded(false);
                        }}
                        style={[
                          styles.editorPromptOption,
                          selected && styles.editorPromptOptionSelected,
                          last && styles.editorPromptOptionLast,
                        ]}
                      >
                        <Text
                          style={[
                            styles.editorPromptOptionText,
                            selected && styles.editorPromptOptionTextSelected,
                          ]}
                        >
                          {prompt}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.editorWritingPanel}>
            <FormattingToolbar formatting={draft.formatting} onToggle={toggleDraftFormatting} />

            <TextInput
              value={draft.title}
              onChangeText={(title) => updateDraft({ title })}
              placeholder={t('write.titlePlaceholder')}
              placeholderTextColor="#b4a893"
              style={styles.editorTitleInput}
            />

            <TextInput
              value={draft.body}
              onChangeText={(body) => updateDraft({ body })}
              placeholder={t('write.startKorean')}
              placeholderTextColor="#b4a893"
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
            disabled={!canSave}
            onPress={saveEntry}
            style={[styles.editorSubmitButton, !canSave && styles.editorSubmitButtonDisabled]}
          >
            <Text style={styles.editorSubmitText}>{t('write.submitReview')}</Text>
          </TouchableOpacity>

          {draft.id ? (
            <TouchableOpacity
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
  );
};

const styles = StyleSheet.create({
  screenContent: {
    paddingHorizontal: 0,
    paddingBottom: spacing.xl * 2,
  },
  writeHome: {
    gap: 16,
  },
  writeHomeHeader: {
    paddingHorizontal: WRITE_SIDE_PADDING,
    paddingTop: 2,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  writeHomeTitleBlock: {
    gap: 2,
  },
  writeHomeTitle: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 26,
    lineHeight: 31,
    color: '#26211b',
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
    color: '#7a6f61',
  },
  writeHomeCountLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 17,
    color: '#7a6f61',
  },
  writeNewButton: {
    minHeight: 31,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2c261f',
  },
  writeNewButtonDisabled: {
    opacity: 0.42,
  },
  writeNewButtonText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    color: '#fff8ec',
  },
  writeFilterRow: {
    paddingHorizontal: WRITE_SIDE_PADDING,
    gap: 8,
  },
  writeFilterChip: {
    minHeight: 26,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#d9cbb6',
    paddingHorizontal: 14,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 250, 243, 0.42)',
  },
  writeFilterChipActive: {
    backgroundColor: '#b8552e',
    borderColor: '#b8552e',
  },
  writeFilterText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    color: '#796d5f',
  },
  writeFilterTextActive: {
    color: '#fff8ec',
  },
  writeEntryList: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#d9cbb6',
    backgroundColor: '#fff8ec',
  },
  writeEntryRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: WRITE_SIDE_PADDING,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e4d9c8',
  },
  writeEntryRowPressed: {
    backgroundColor: '#f7efe2',
  },
  writeEntryDate: {
    width: 34,
    alignItems: 'center',
    gap: 1,
  },
  writeEntryDay: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 16,
    lineHeight: 18,
    color: '#302a23',
  },
  writeEntryMonth: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 10,
    lineHeight: 13,
    color: '#9a8e7a',
  },
  writeEntryMain: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  writeEntryTitle: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 15,
    lineHeight: 22,
    color: '#27231d',
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
    color: '#9a8e7a',
  },
  writeEntryMetaDot: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    color: '#b7aa95',
  },
  writeEntryType: {
    flexShrink: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 15,
    color: '#9a8e7a',
  },
  writeEntryStatusBadge: {
    minHeight: 21,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  writeEntryStatusText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 15,
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
    gap: 14,
  },
  editorTopBar: {
    paddingHorizontal: WRITE_SIDE_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editorTopBarSpacer: {
    flex: 1,
  },
  editorBackButton: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 250, 243, 0.48)',
    borderWidth: 1,
    borderColor: '#d9cbb6',
  },
  editorTypeScroller: {
    flex: 1,
  },
  editorTypeChips: {
    alignItems: 'center',
    gap: 6,
  },
  editorTypeChip: {
    minHeight: 23,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#d8cbb8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 250, 243, 0.42)',
  },
  editorTypeChipActive: {
    backgroundColor: '#2c261f',
    borderColor: '#2c261f',
  },
  editorTypeText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    color: '#776b5e',
  },
  editorTypeTextActive: {
    color: '#fff8ec',
  },
  editorSaveButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  editorSaveButtonDisabled: {
    opacity: 0.5,
  },
  editorSaveText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: '#6f6559',
  },
  editorSaveTextDisabled: {
    color: '#a79b88',
  },
  editorPromptPanel: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8cbb8',
    backgroundColor: '#fff8ec',
    overflow: 'hidden',
  },
  editorPromptHeader: {
    minHeight: 35,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e4d9c8',
    paddingLeft: 18,
  },
  editorPromptHeaderText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: '#2c261f',
  },
  editorPromptChevronIcon: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorPromptOptions: {
    backgroundColor: '#fff8ec',
  },
  editorPromptOption: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#eee3d2',
  },
  editorPromptOptionSelected: {
    backgroundColor: '#f6ecd6',
  },
  editorPromptOptionLast: {
    borderBottomWidth: 0,
  },
  editorPromptOptionText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 20,
    color: '#655a4d',
  },
  editorPromptOptionTextSelected: {
    color: '#2c261f',
    fontFamily: fontFamilies.sansMedium,
  },
  editorWritingPanel: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d8cbb8',
    backgroundColor: '#fff8ec',
    overflow: 'hidden',
  },
  editorToolbar: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee3d2',
    backgroundColor: '#fbf2e5',
  },
  editorToolbarButton: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorToolbarButtonActive: {
    backgroundColor: '#ead8bf',
  },
  editorToolbarText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 18,
    color: '#5f5548',
  },
  editorToolbarTextActive: {
    color: '#2c261f',
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
    minHeight: 49,
    borderBottomWidth: 1,
    borderBottomColor: '#eee3d2',
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: '#26211b',
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 18,
    lineHeight: 25,
  },
  editorBodyInput: {
    minHeight: 285,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    color: '#26211b',
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 17,
    lineHeight: 34,
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
    marginHorizontal: WRITE_SIDE_PADDING,
    minHeight: 45,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#b8552e',
  },
  editorSubmitButtonDisabled: {
    opacity: 0.5,
  },
  editorSubmitText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    lineHeight: 18,
    color: '#fff8ec',
  },
  reviewShell: {
    gap: 14,
  },
  reviewTitleBlock: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#d8cbb8',
    backgroundColor: '#fff8ec',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  reviewTitleText: {
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 23,
    lineHeight: 31,
    color: '#26211b',
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
    borderRadius: radii.pill,
    backgroundColor: '#e7f0e2',
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewStatusText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 15,
    color: '#5c8754',
  },
  reviewTitleMeta: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 17,
    color: '#776b5e',
  },
  reviewTitleMetaDot: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 17,
    color: '#b7aa95',
  },
  reviewWritingPanel: {
    marginHorizontal: WRITE_SIDE_PADDING,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d8cbb8',
    backgroundColor: '#fff8ec',
    overflow: 'hidden',
  },
  reviewEntryMetaBar: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee3d2',
    paddingHorizontal: 18,
  },
  reviewEntryMetaText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: '#9a8e7a',
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
    color: '#2c261f',
  },
  reviewTranslateLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 15,
    color: '#b8552e',
  },
  reviewEntryBodyText: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    color: '#26211b',
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 17,
    lineHeight: 34,
  },
  reviewEnglishWords: {
    borderTopWidth: 1,
    borderTopColor: '#eee3d2',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#fbf2e5',
  },
  reviewEnglishWordsLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: '#5f5548',
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
    borderColor: '#d8cbb8',
    backgroundColor: '#fff8ec',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewEnglishWordText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
    color: '#b8552e',
  },
  inlineCorrectionList: {
    borderTopWidth: 1,
    borderTopColor: '#eee3d2',
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#fff8ec',
  },
  inlineCorrectionItem: {
    borderLeftWidth: 3,
    borderRadius: 12,
    backgroundColor: '#fbf2e5',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  inlineCorrectionItemPressed: {
    backgroundColor: '#f4e6d1',
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
    color: '#2c261f',
  },
  inlineCorrectionOriginal: {
    color: '#2c261f',
  },
  inlineCorrectionArrow: {
    fontFamily: fontFamilies.sansRegular,
    color: '#9a8e7a',
  },
  inlineCorrectionSuggestion: {
    color: '#b8552e',
  },
  reviewDoneButton: {
    marginHorizontal: WRITE_SIDE_PADDING,
    minHeight: 45,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2c261f',
  },
  reviewDoneText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    lineHeight: 18,
    color: '#fff8ec',
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

export default Write;
