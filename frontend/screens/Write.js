import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialIcons } from '@expo/vector-icons';

import { Card, IconButton, Screen, SectionHeader } from '../components/ui';
import { colors, radii, spacing, textStyles } from '../theme';

const STORAGE_KEY = 'writing_entries_v1';
const DEFAULT_PROMPT = 'Write about something that happened today, and describe how it made you feel.';

const defaultFormat = {
  fontSize: 18,
  lineHeight: 29,
  serif: false,
};

const makeEmptyDraft = () => ({
  id: null,
  title: '',
  content: '',
  prompt: DEFAULT_PROMPT,
  createdAt: null,
  updatedAt: null,
  submittedAt: null,
  review: null,
  format: defaultFormat,
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

const buildReview = (draft) => {
  const content = draft.content.trim();
  const koreanCharCount = (content.match(/[\uAC00-\uD7A3]/g) ?? []).length;
  const englishWordCount = (content.match(/[A-Za-z]+/g) ?? []).length;
  const sentenceCount = content
    .split(/[.!?。！？\n]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;

  const strengths = [];
  const revisionNotes = [];

  if (koreanCharCount > 80) {
    strengths.push('You sustained Korean for a full paragraph instead of stopping after a few short phrases.');
  } else {
    strengths.push('You got the idea down clearly, which is the most important part of building a writing habit.');
  }

  if (sentenceCount >= 3) {
    strengths.push('Your writing has a natural sense of progression from one sentence to the next.');
  }

  if (englishWordCount > 0) {
    revisionNotes.push('You used a few English placeholders, which is fine for drafting. On the next pass, replace one or two of them with Korean alternatives.');
  } else {
    revisionNotes.push('Try one follow-up revision that makes the verbs a little more specific or vivid.');
  }

  if (content.length < 80) {
    revisionNotes.push('Add one more sentence with a concrete detail so the piece feels more grounded.');
  } else {
    revisionNotes.push('Look for one sentence you can tighten so the rhythm feels cleaner.');
  }

  return {
    summary: 'Solid draft with a clear idea and room for one focused revision pass.',
    strengths,
    revisionNotes,
    encouragedAt: new Date().toISOString(),
  };
};

const Write = () => {
  const [entries, setEntries] = useState([]);
  const [mode, setMode] = useState('list');
  const [draft, setDraft] = useState(makeEmptyDraft());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEntries = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setEntries(Array.isArray(parsed) ? parsed : []);
      } catch (error) {
        console.error('[Write] Failed to load entries:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEntries();
  }, []);

  const persistEntries = async (nextEntries) => {
    setEntries(nextEntries);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
  };

  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0) - new Date(a.updatedAt ?? a.createdAt ?? 0)
      ),
    [entries]
  );

  const openNewDraft = () => {
    setDraft(makeEmptyDraft());
    setMode('editor');
  };

  const openExistingDraft = (entry) => {
    setDraft({
      ...entry,
      format: {
        ...defaultFormat,
        ...(entry.format ?? {}),
      },
    });
    setMode('editor');
  };

  const leaveEditor = () => {
    setDraft(makeEmptyDraft());
    setMode('list');
  };

  const saveDraft = async ({ submit = false } = {}) => {
    if (!draft.title.trim() && !draft.content.trim()) {
      leaveEditor();
      return;
    }

    const now = new Date().toISOString();
    const nextEntry = {
      ...draft,
      id: draft.id ?? `entry-${Date.now()}`,
      title: draft.title.trim() || 'Untitled entry',
      content: draft.content,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
      submittedAt: submit ? now : draft.submittedAt,
      review: submit ? buildReview(draft) : draft.review,
    };

    const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);
    const nextEntries = existingIndex >= 0
      ? entries.map((entry, index) => (index === existingIndex ? nextEntry : entry))
      : [nextEntry, ...entries];

    await persistEntries(nextEntries);
    setDraft(nextEntry);

    if (submit) {
      Alert.alert('Review added', 'Your writing now includes a saved review section you can revisit later.');
    }
  };

  const deleteEntry = async (entryId) => {
    const nextEntries = entries.filter((entry) => entry.id !== entryId);
    await persistEntries(nextEntries);
    leaveEditor();
  };

  const updateDraft = (patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const updateFormat = (patch) => {
    setDraft((prev) => ({
      ...prev,
      format: {
        ...prev.format,
        ...patch,
      },
    }));
  };

  const currentFontFamily = draft.format.serif ? 'FFSerif-Regular' : 'FFSans-Regular';

  if (loading) {
    return (
      <Screen>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading your writing desk…</Text>
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
            title="Your writing desk"
            subtitle="Short Korean entries, saved reviews, and a gentle place to keep practicing."
            action={
              <IconButton
                tone="accent"
                label="New"
                onPress={openNewDraft}
                icon={<Feather name="plus" size={16} color={colors.accentStrong} />}
              />
            }
          />

          <Card tone="muted" style={styles.heroCard} contentStyle={styles.heroContent}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Today&apos;s prompt</Text>
              <Text style={styles.heroPrompt}>{DEFAULT_PROMPT}</Text>
            </View>
            <TouchableOpacity onPress={openNewDraft} style={styles.heroButton}>
              <Text style={styles.heroButtonLabel}>Start writing</Text>
            </TouchableOpacity>
          </Card>

          <SectionHeader
            eyebrow="Entries"
            title="Recent writing"
            subtitle="Each draft keeps its review attached after you submit it."
          />

          {sortedEntries.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No writing yet</Text>
              <Text style={styles.emptyBody}>
                Start with a short paragraph in Korean. You can use English for words you don&apos;t know yet.
              </Text>
            </Card>
          ) : (
            <View style={styles.entryList}>
              {sortedEntries.map((entry) => (
                <Pressable key={entry.id} onPress={() => openExistingDraft(entry)} style={styles.entryPressable}>
                  <Card style={styles.entryCard} contentStyle={styles.entryCardContent} subtle>
                    <Text style={styles.entryDate}>{formatEntryDate(entry.createdAt)}</Text>
                    <Text style={styles.entryTitle}>{entry.title}</Text>
                    <Text style={styles.entryPreview} numberOfLines={2}>
                      {entry.content || 'Open this entry to keep writing.'}
                    </Text>
                    <View style={styles.entryFooter}>
                      <Text style={styles.entryFooterText}>
                        {entry.review ? 'Review attached' : 'Draft'}
                      </Text>
                      <Feather name="chevron-right" size={16} color={colors.textSubtle} />
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.stack}>
          <SectionHeader
            eyebrow="Write"
            title={draft.id ? 'Edit writing' : 'New writing'}
            subtitle="Write in Korean and use English only for the words you do not know yet."
            action={
              <TouchableOpacity onPress={leaveEditor} style={styles.backButton}>
                <Feather name="arrow-left" size={16} color={colors.text} />
                <Text style={styles.backButtonLabel}>Back</Text>
              </TouchableOpacity>
            }
          />

          <Card tone="muted" style={styles.promptCard} contentStyle={styles.promptContent}>
            <Text style={styles.promptLabel}>Prompt</Text>
            <Text style={styles.promptText}>{draft.prompt}</Text>
          </Card>

          <Card style={styles.editorCard} contentStyle={styles.editorContent}>
            <TextInput
              value={draft.title}
              onChangeText={(title) => updateDraft({ title })}
              placeholder="Title"
              placeholderTextColor={colors.textSubtle}
              style={styles.titleInput}
            />

            <View style={styles.toolRow}>
              <Text style={styles.toolLabel}>Formatting</Text>
              <View style={styles.toolButtons}>
                <TouchableOpacity
                  onPress={() => updateFormat({ fontSize: Math.max(15, draft.format.fontSize - 1), lineHeight: Math.max(24, draft.format.lineHeight - 2) })}
                  style={styles.toolButton}
                >
                  <Text style={styles.toolButtonText}>A-</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => updateFormat({ fontSize: Math.min(24, draft.format.fontSize + 1), lineHeight: Math.min(38, draft.format.lineHeight + 2) })}
                  style={styles.toolButton}
                >
                  <Text style={styles.toolButtonText}>A+</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => updateFormat({ serif: !draft.format.serif })}
                  style={[styles.toolButton, draft.format.serif && styles.toolButtonActive]}
                >
                  <MaterialIcons
                    name="text-fields"
                    size={17}
                    color={draft.format.serif ? colors.accentStrong : colors.textMuted}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => updateFormat({
                    lineHeight: draft.format.lineHeight > 29 ? 27 : 33,
                  })}
                  style={styles.toolButton}
                >
                  <Feather name="align-left" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.helperText}>
              Write in Korean and use English for words you don&apos;t know yet.
            </Text>

            <TextInput
              value={draft.content}
              onChangeText={(content) => updateDraft({ content })}
              placeholder="Start writing here…"
              placeholderTextColor={colors.textSubtle}
              multiline
              textAlignVertical="top"
              style={[
                styles.editorInput,
                {
                  fontSize: draft.format.fontSize,
                  lineHeight: draft.format.lineHeight,
                  fontFamily: currentFontFamily,
                },
              ]}
            />

            <View style={styles.editorActions}>
              <IconButton
                label="Save draft"
                onPress={() => saveDraft()}
                icon={<Feather name="save" size={15} color={colors.text} />}
              />
              <IconButton
                tone="accent"
                label="Submit"
                onPress={() => saveDraft({ submit: true })}
                icon={<Feather name="sparkles" size={15} color={colors.accentStrong} />}
              />
            </View>
          </Card>

          {draft.review ? (
            <Card style={styles.reviewCard} contentStyle={styles.reviewContent}>
              <Text style={styles.reviewLabel}>AI Review</Text>
              <Text style={styles.reviewSummary}>{draft.review.summary}</Text>

              <View style={styles.reviewSection}>
                <Text style={styles.reviewSectionTitle}>What is working</Text>
                {draft.review.strengths.map((item, index) => (
                  <Text key={index} style={styles.reviewBullet}>• {item}</Text>
                ))}
              </View>

              <View style={styles.reviewSection}>
                <Text style={styles.reviewSectionTitle}>Next revision pass</Text>
                {draft.review.revisionNotes.map((item, index) => (
                  <Text key={index} style={styles.reviewBullet}>• {item}</Text>
                ))}
              </View>
            </Card>
          ) : null}

          {draft.id ? (
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  'Delete writing',
                  'Remove this writing from your journal?',
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
    </Screen>
  );
};

const styles = StyleSheet.create({
  screenContent: {
    paddingBottom: spacing.xl * 2,
  },
  stack: {
    gap: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...textStyles.bodyMuted,
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
  heroPrompt: {
    ...textStyles.body,
  },
  heroButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  heroButtonLabel: {
    ...textStyles.label,
    color: colors.accentStrong,
  },
  entryList: {
    gap: spacing.md,
  },
  entryPressable: {
    borderRadius: radii.xl,
  },
  entryCard: {
    borderRadius: radii.xl,
  },
  entryCardContent: {
    gap: spacing.sm,
  },
  entryDate: {
    ...textStyles.eyebrow,
  },
  entryTitle: {
    ...textStyles.sectionTitle,
  },
  entryPreview: {
    ...textStyles.bodyMuted,
  },
  entryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  entryFooterText: {
    ...textStyles.caption,
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
  promptCard: {
    borderRadius: radii.xl,
  },
  promptContent: {
    gap: spacing.xs,
  },
  promptLabel: {
    ...textStyles.eyebrow,
  },
  promptText: {
    ...textStyles.body,
  },
  editorCard: {
    borderRadius: radii.xl,
  },
  editorContent: {
    gap: spacing.md,
  },
  titleInput: {
    ...textStyles.title,
    padding: 0,
    color: colors.text,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  toolLabel: {
    ...textStyles.caption,
  },
  toolButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toolButton: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  toolButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  toolButtonText: {
    ...textStyles.label,
    color: colors.textMuted,
  },
  helperText: {
    ...textStyles.caption,
  },
  editorInput: {
    minHeight: 280,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reviewCard: {
    borderRadius: radii.xl,
  },
  reviewContent: {
    gap: spacing.md,
  },
  reviewLabel: {
    ...textStyles.eyebrow,
  },
  reviewSummary: {
    ...textStyles.body,
  },
  reviewSection: {
    gap: spacing.xs,
  },
  reviewSectionTitle: {
    ...textStyles.label,
    color: colors.text,
  },
  reviewBullet: {
    ...textStyles.bodyMuted,
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
