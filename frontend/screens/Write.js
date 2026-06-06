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
import { colors, radii, spacing, textStyles } from '../theme';

const LEGACY_STORAGE_KEY = 'writing_entries_v1';
const getWritingStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'writing-entries-v1');

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

const makeEmptyDraft = () => ({
  id: null,
  title: '',
  body: '',
  prompt: '',
  date: null,
  createdAt: null,
  updatedAt: null,
  status: 'draft',
});

const formatEntryDate = (value) => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return '';
  }
};

const formatStatusLabel = (status) => {
  if (!status) return 'Draft';
  return status
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
    ...(assessment ? { assessment } : {}),
  };
};

const isMockWritingEntry = (entryOrId) => (
  (typeof entryOrId === 'string' ? entryOrId : entryOrId?.id) === MOCK_WRITING_ENTRY_ID
);

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
      mergedEntries.push(normalizeEntry(cloudWritingRowToEntry(cloudRow)));
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

const getExpandedStateForPrompt = (prompt) => {
  const selectedCategory = PROMPT_CATEGORIES.find((category) =>
    category.prompts.includes(prompt)
  );

  return {
    [(selectedCategory ?? PROMPT_CATEGORIES[0]).title]: true,
  };
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

const AnnotatedEntry = ({ text, annotations, onAnnotationPress }) => {
  const spans = buildAnnotatedSpans(text, annotations);

  return (
    <Text selectable style={styles.assessmentEntryText}>
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

const SummaryList = ({ title, items }) => {
  if (!items?.length) {
    return null;
  }

  return (
    <Card style={styles.summaryCard} contentStyle={styles.summaryCardContent} subtle>
      <Text style={styles.summaryTitle}>{title}</Text>
      <View style={styles.summaryItemList}>
        {items.map((item, index) => (
          <View key={`${title}-${index}`} style={styles.summaryItem}>
            <View style={styles.summaryBullet} />
            <Text selectable style={styles.summaryText}>
              {item}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

const AssessmentSummary = ({ summary }) => {
  if (!summary) {
    return null;
  }

  return (
    <View style={styles.assessmentSummary}>
      <SummaryList title="Patterns" items={summary.patterns} />
      <SummaryList title="Strengths" items={summary.strengths} />

      {summary.vocab_items?.length ? (
        <View style={styles.vocabSection}>
          <Text style={styles.summaryTitle}>Vocabulary</Text>
          {summary.vocab_items.map((item) => (
            <Card key={item.word} style={styles.vocabCard} contentStyle={styles.vocabCardContent} subtle>
              <View style={styles.vocabHeader}>
                <Text selectable style={styles.vocabWord}>
                  {item.word}
                </Text>
                <IconButton
                  label="Save"
                  disabled
                  icon={<Feather name="bookmark" size={14} color={colors.text} />}
                  style={styles.vocabSaveButton}
                />
              </View>
              <Text selectable style={styles.vocabMeaning}>
                {item.meaning}
              </Text>
              <Text selectable style={styles.vocabExample}>
                {item.example}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const Write = ({ user }) => {
  const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
  const [entries, setEntries] = useState([]);
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(makeEmptyDraft());
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState(getExpandedStateForPrompt(''));
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
      setExpandedCategories(getExpandedStateForPrompt(''));

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
      [...entries].sort(
        (a, b) => new Date(b.updatedAt ?? b.date ?? 0) - new Date(a.updatedAt ?? a.date ?? 0)
      ),
    [entries]
  );
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId),
    [entries, selectedEntryId]
  );

  const canSave = draft.title.trim().length > 0 || draft.body.trim().length > 0;

  const openNewDraft = () => {
    setDraft(makeEmptyDraft());
    setSelectedEntryId(null);
    setSelectedAnnotation(null);
    setExpandedCategories(getExpandedStateForPrompt(''));
    setMode('editor');
  };

  const openEntryDetail = (entry) => {
    setSelectedEntryId(entry.id);
    setSelectedAnnotation(null);
    setMode('detail');
  };

  const openExistingDraft = (entry) => {
    const normalizedEntry = normalizeEntry(entry);
    setDraft(normalizedEntry);
    setExpandedCategories(getExpandedStateForPrompt(normalizedEntry.prompt));
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
    const nextEntry = {
      id: draft.id ?? `entry-${Date.now()}`,
      title: draft.title.trim() || '[Untitled]',
      body: draft.body,
      prompt: draft.prompt,
      date: draft.date ?? now,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
      status: preservedAssessment ? draft.status ?? 'reviewed' : 'draft',
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

  const togglePromptCategory = (categoryTitle) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryTitle]: !prev[categoryTitle],
    }));
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading your writing...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll contentContainerStyle={styles.screenContent}>
      {mode === 'list' ? (
        <View style={styles.stack}>
          <SectionHeader
            eyebrow="Write"
            title="Recent writing"
            subtitle="Review your latest entries or start a new one."
            action={
              <IconButton
                tone="accent"
                label="New Entry"
                onPress={openNewDraft}
                icon={<Feather name="plus" size={16} color={colors.accentStrong} />}
              />
            }
          />

          {sortedEntries.length === 0 ? (
            <Card style={styles.emptyCard} contentStyle={styles.emptyContent}>
              <View style={styles.emptyCopy}>
                <Text style={styles.emptyTitle}>No writing yet</Text>
                <Text style={styles.emptyBody}>
                  Start a short entry and it will appear here.
                </Text>
              </View>
              <IconButton
                tone="accent"
                label="New Entry"
                onPress={openNewDraft}
                icon={<Feather name="plus" size={16} color={colors.accentStrong} />}
              />
            </Card>
          ) : (
            <View style={styles.entryList}>
              {sortedEntries.map((entry) => (
                <Pressable key={entry.id} onPress={() => openEntryDetail(entry)} style={styles.entryPressable}>
                  <Card style={styles.entryCard} contentStyle={styles.entryCardContent} subtle>
                    <View style={styles.entryMainRow}>
                      <View style={styles.entryCopy}>
                        <Text style={styles.entryDate}>{formatEntryDate(entry.date)}</Text>
                        <Text style={styles.entryTitle} numberOfLines={1}>
                          {entry.title}
                        </Text>
                        <Text style={styles.entryPreview} numberOfLines={2}>
                          {entry.body || 'No body text yet.'}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.textSubtle} />
                    </View>

                    <View style={styles.entryMetaRow}>
                      <Text style={styles.entryPrompt} numberOfLines={1}>
                        {entry.prompt || 'No prompt selected'}
                      </Text>
                      <Text style={styles.entryStatus}>{formatStatusLabel(entry.status)}</Text>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : mode === 'detail' && selectedEntry ? (
        <View style={styles.stack}>
          <SectionHeader
            eyebrow="Entry"
            title={selectedEntry.title}
            subtitle={`${formatEntryDate(selectedEntry.date)} - ${formatStatusLabel(selectedEntry.status)}`}
            action={
              <TouchableOpacity onPress={leaveDetail} style={styles.backButton}>
                <Feather name="arrow-left" size={16} color={colors.text} />
                <Text style={styles.backButtonLabel}>Back</Text>
              </TouchableOpacity>
            }
          />

          {selectedEntry.prompt ? (
            <Card tone="muted" style={styles.detailPromptCard} contentStyle={styles.detailPromptContent}>
              <Text style={styles.selectedPromptLabel}>Prompt</Text>
              <Text selectable style={styles.selectedPromptText}>
                {selectedEntry.prompt}
              </Text>
            </Card>
          ) : null}

          {selectedEntry.assessment ? (
            <>
              <AnnotationLegend />
              <Card style={styles.assessmentCard} contentStyle={styles.assessmentCardContent}>
                <AnnotatedEntry
                  text={selectedEntry.body}
                  annotations={selectedEntry.assessment.annotations}
                  onAnnotationPress={setSelectedAnnotation}
                />
              </Card>
              <AssessmentSummary summary={selectedEntry.assessment.summary} />
            </>
          ) : (
            <>
              <Card style={styles.assessmentCard} contentStyle={styles.assessmentCardContent}>
                <Text selectable style={styles.assessmentEntryText}>
                  {selectedEntry.body || 'No body text yet.'}
                </Text>
              </Card>
              <Card tone="muted" style={styles.detailPromptCard} contentStyle={styles.detailPromptContent}>
                <Text style={styles.selectedPromptLabel}>Assessment</Text>
                <Text style={styles.selectedPromptText}>
                  Feedback has not been run for this entry yet.
                </Text>
              </Card>
            </>
          )}

          <View style={styles.detailActions}>
            <IconButton
              label="Edit"
              onPress={() => openExistingDraft(selectedEntry)}
              icon={<Feather name="edit-3" size={15} color={colors.text} />}
              style={styles.actionButton}
            />
            <IconButton
              label="Delete"
              onPress={() =>
                Alert.alert(
                  'Delete entry',
                  'Remove this writing from your recent entries?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteEntry(selectedEntry.id) },
                  ]
                )
              }
              icon={<Feather name="trash-2" size={15} color={colors.danger} />}
              style={styles.actionButton}
            />
          </View>
        </View>
      ) : (
        <View style={styles.stack}>
          <SectionHeader
            eyebrow="Write"
            title={draft.id ? 'Edit entry' : 'New entry'}
            subtitle="Choose a prompt, add a title, and write your response."
            action={
              <TouchableOpacity onPress={leaveEditor} style={styles.backButton}>
                <Feather name="arrow-left" size={16} color={colors.text} />
                <Text style={styles.backButtonLabel}>Back</Text>
              </TouchableOpacity>
            }
          />

          <Card tone="muted" style={styles.promptSelectorCard} contentStyle={styles.promptSelectorContent}>
            <Text style={styles.promptSelectorTitle}>Prompts</Text>
            <View style={styles.categoryList}>
              {PROMPT_CATEGORIES.map((category) => {
                const expanded = Boolean(expandedCategories[category.title]);

                return (
                  <View key={category.title} style={styles.categoryGroup}>
                    <Pressable
                      onPress={() => togglePromptCategory(category.title)}
                      style={styles.categoryHeader}
                    >
                      <Text style={styles.categoryTitle}>{category.title}</Text>
                      <Feather
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.textMuted}
                      />
                    </Pressable>

                    {expanded ? (
                      <View style={styles.promptOptionList}>
                        {category.prompts.map((prompt) => {
                          const selected = draft.prompt === prompt;

                          return (
                            <Pressable
                              key={prompt}
                              onPress={() => updateDraft({ prompt })}
                              style={[
                                styles.promptOption,
                                selected && styles.promptOptionSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.promptOptionText,
                                  selected && styles.promptOptionTextSelected,
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
                );
              })}
            </View>
          </Card>

          <Card style={styles.editorCard} contentStyle={styles.editorContent}>
            <TextInput
              value={draft.title}
              onChangeText={(title) => updateDraft({ title })}
              placeholder="Title"
              placeholderTextColor={colors.textSubtle}
              style={styles.titleInput}
            />

            <View style={styles.selectedPromptBox}>
              <Text style={styles.selectedPromptLabel}>Selected prompt</Text>
              <Text style={[styles.selectedPromptText, !draft.prompt && styles.selectedPromptPlaceholder]}>
                {draft.prompt || 'Choose a prompt above, or write without one.'}
              </Text>
            </View>

            <TextInput
              value={draft.body}
              onChangeText={(body) => updateDraft({ body })}
              placeholder="Start writing here..."
              placeholderTextColor={colors.textSubtle}
              multiline
              textAlignVertical="top"
              style={styles.editorInput}
            />

            <View style={styles.editorActions}>
              <IconButton
                label="Save Draft"
                onPress={saveEntry}
                disabled={!canSave}
                icon={<Feather name="save" size={15} color={colors.text} />}
                style={styles.actionButton}
              />
              <IconButton
                tone="accent"
                label="Submit"
                onPress={saveEntry}
                disabled={!canSave}
                icon={<Feather name="check" size={15} color={colors.accentStrong} />}
                style={styles.actionButton}
              />
            </View>
          </Card>

          {draft.id ? (
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  'Delete entry',
                  'Remove this writing from your recent entries?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteEntry(draft.id) },
                  ]
                )
              }
              style={styles.deleteLink}
            >
              <Text style={styles.deleteLinkText}>Delete entry</Text>
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
    paddingBottom: spacing.xl * 2,
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
  entryList: {
    gap: spacing.sm,
  },
  entryPressable: {
    borderRadius: radii.md,
  },
  entryCard: {
    borderRadius: radii.md,
  },
  entryCardContent: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  entryMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  entryDate: {
    ...textStyles.eyebrow,
  },
  entryTitle: {
    ...textStyles.label,
    color: colors.text,
  },
  entryPreview: {
    ...textStyles.bodyMuted,
  },
  entryMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  entryPrompt: {
    ...textStyles.caption,
    flex: 1,
  },
  entryStatus: {
    ...textStyles.caption,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  emptyCard: {
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
  promptSelectorCard: {
    borderRadius: radii.md,
  },
  promptSelectorContent: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  promptSelectorTitle: {
    ...textStyles.label,
    color: colors.text,
  },
  categoryList: {
    gap: spacing.xs,
  },
  categoryGroup: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  categoryHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryTitle: {
    ...textStyles.label,
    color: colors.text,
    flex: 1,
  },
  promptOptionList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  promptOption: {
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  promptOptionSelected: {
    backgroundColor: colors.accentSoft,
  },
  promptOptionText: {
    ...textStyles.bodyMuted,
  },
  promptOptionTextSelected: {
    color: colors.accentStrong,
    fontFamily: 'FFSans-Medium',
  },
  editorCard: {
    borderRadius: radii.md,
  },
  editorContent: {
    gap: spacing.md,
  },
  titleInput: {
    ...textStyles.sectionTitle,
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    padding: 0,
    color: colors.text,
  },
  selectedPromptBox: {
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.xs,
  },
  selectedPromptLabel: {
    ...textStyles.eyebrow,
  },
  selectedPromptText: {
    ...textStyles.body,
  },
  selectedPromptPlaceholder: {
    color: colors.textSubtle,
  },
  editorInput: {
    minHeight: 260,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontFamily: 'FFSans-Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
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
  assessmentSummary: {
    gap: spacing.sm,
  },
  summaryCard: {
    borderRadius: radii.md,
  },
  summaryCardContent: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  summaryTitle: {
    ...textStyles.label,
    color: colors.text,
  },
  summaryItemList: {
    gap: spacing.sm,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  summaryBullet: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.accentStrong,
    marginTop: 8,
  },
  summaryText: {
    ...textStyles.bodyMuted,
    flex: 1,
  },
  vocabSection: {
    gap: spacing.sm,
  },
  vocabCard: {
    borderRadius: radii.md,
  },
  vocabCardContent: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  vocabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  vocabWord: {
    ...textStyles.label,
    color: colors.text,
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  vocabSaveButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vocabMeaning: {
    ...textStyles.bodyMuted,
  },
  vocabExample: {
    color: colors.text,
    fontFamily: 'FFSerif-Regular',
    fontSize: 15,
    lineHeight: 24,
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
