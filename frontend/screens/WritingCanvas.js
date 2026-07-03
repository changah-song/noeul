import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Screen, Card, IconButton, Press } from '../components/ui';
import { useBooks } from '../contexts/BooksContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { upsertUserWritingEntry } from '../services/writingCloudSync';
import { makeScopedStorageKey } from '../services/localDataScope';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import {
  getAssessmentPromise,
  isAssessmentInFlight,
  startAssessment,
} from '../services/writingAssessmentManager';
import { WRITING_CATEGORIES, WRITING_PROMPTS, findPromptByKo } from '../constants/writingPrompts';
import { elevation, radii, useTheme } from '../theme/tokens';
import { fontFamilies, typeScale, lineHeights } from '../theme/typography';
import { insets } from '../theme/spacing';
import { Gradients, Motion } from '../theme';

const getWritingStorageKey = (ownerId) => makeScopedStorageKey(ownerId, 'writing-entries-v1');

const ASSESS_MESSAGES = [
  'AI parsing syntax constructs…',
  'Checking particle accuracy…',
  'Scoring composition…',
];

const createId = () => `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const getWordCount = (text = '') => text.trim().split(/\s+/).filter(Boolean).length;

const getOverallScore = (assessment) => {
  const raw = assessment?.score ?? assessment?.overall_score;
  const num = typeof raw === 'string' ? Number(raw) : raw;
  return typeof num === 'number' && Number.isFinite(num) ? Math.round(num) : null;
};

const getBand = (assessment) => {
  const raw = assessment?.band ?? assessment?.level;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null;
};

const cleanStrings = (list) =>
  Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()) : [];

// Split the entry body into plain and annotated spans. Each annotation's
// `original` is an exact substring of the entry (backend contract); the first
// non-overlapping occurrence of each gets highlighted, in document order.
const buildAnnotationSegments = (text, annotations) => {
  const marks = [];
  annotations.forEach((a, i) => {
    const idx = text.indexOf(a.original);
    if (idx >= 0) {
      marks.push({ start: idx, end: idx + a.original.length, key: a.id ?? String(i), annotation: a });
    }
  });
  marks.sort((x, y) => x.start - y.start);

  const segments = [];
  let pos = 0;
  marks.forEach((m) => {
    if (m.start < pos) return; // overlaps an earlier mark — skip
    if (m.start > pos) segments.push({ text: text.slice(pos, m.start) });
    segments.push({ text: text.slice(m.start, m.end), key: m.key, annotation: m.annotation });
    pos = m.end;
  });
  if (pos < text.length) segments.push({ text: text.slice(pos) });
  return segments;
};

// The .spinner ring from the prototype — 34px, 3px accent-soft track with a
// coral cap, spinning at 0.8s/turn.
const SpinnerRing = () => {
  const { colors } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          borderColor: colors.accentSoft,
          borderTopColor: colors.accent,
          transform: [{ rotate }],
        },
      ]}
    />
  );
};

export default function WritingCanvas({ navigation, route }) {
  const { colors, isDarkMode } = useTheme();
  const { user } = useBooks();
  const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();

  const existingEntry = route?.params?.entry ?? null;
  const [title, setTitle] = useState(existingEntry?.title ?? '');
  const [body, setBody] = useState(existingEntry?.body ?? '');
  // 'sandbox' is the legacy key for 'free' — normalize so old entries light
  // up the right pill and pull from the right prompt bank.
  const [category, setCategory] = useState(() => {
    const raw = existingEntry?.category ?? 'free';
    return raw === 'sandbox' ? 'free' : raw;
  });
  const [promptIndex, setPromptIndex] = useState(() => Math.floor(Math.random() * 1000));
  // A chosen prompt is "solidified": it stays pinned above the title and is
  // saved on the entry + sent with the assessment request.
  const [chosenPrompt, setChosenPrompt] = useState(() => {
    const ko = existingEntry?.prompt;
    if (typeof ko !== 'string' || !ko.trim()) return null;
    return findPromptByKo(ko) ?? { ko, en: '' };
  });
  const [promptHidden, setPromptHidden] = useState(existingEntry?.promptHidden ?? false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [editingBody, setEditingBody] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAssessing, setIsAssessing] = useState(false);
  const [assessment, setAssessment] = useState(existingEntry?.assessment ?? null);
  const [assessError, setAssessError] = useState(null);
  const [assessMsgIndex, setAssessMsgIndex] = useState(0);
  const [lastAssessedBody, setLastAssessedBody] = useState(
    existingEntry?.assessment ? existingEntry?.body ?? '' : null
  );
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const outputAnim = useRef(new Animated.Value(0)).current;

  const entryId = useRef(existingEntry?.id ?? createId());

  const promptBank = WRITING_PROMPTS[category] ?? WRITING_PROMPTS.free;
  const currentPrompt = promptBank[promptIndex % promptBank.length];
  const wordCount = getWordCount(body);
  const isAssessed = Boolean(assessment) && lastAssessedBody === body;

  // Cycle the loading messages on a loop for as long as the assessment runs.
  useEffect(() => {
    if (!isAssessing) return undefined;
    setAssessMsgIndex(0);
    const interval = setInterval(() => {
      setAssessMsgIndex((i) => (i + 1) % ASSESS_MESSAGES.length);
    }, 1400);
    return () => clearInterval(interval);
  }, [isAssessing]);

  // The .fade-up entrance on the output pane.
  useEffect(() => {
    if (!assessment || isAssessing) return;
    outputAnim.setValue(0);
    Animated.timing(outputAnim, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [assessment, isAssessing, outputAnim]);

  const saveEntry = useCallback(async (opts = {}) => {
    if (!activeOwnerId) return;
    const entry = {
      id: entryId.current,
      title: title.trim() || 'Untitled entry',
      body,
      prompt: chosenPrompt?.ko ?? '',
      createdAt: existingEntry?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: opts.status ?? (assessment ? 'reviewed' : 'draft'),
      category,
      promptHidden,
      assessment: opts.assessment ?? assessment,
      deleted: false,
    };

    try {
      const storageKey = getWritingStorageKey(activeOwnerId);
      const raw = await AsyncStorage.getItem(storageKey);
      const existing = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(existing) ? existing : [];
      const idx = arr.findIndex((e) => e.id === entryId.current);
      if (idx >= 0) arr[idx] = entry;
      else arr.unshift(entry);
      await AsyncStorage.setItem(storageKey, JSON.stringify(arr));

      if (!opts.localOnly && user?.id && activeOwnerId === user.id && !syncPaused && isCurrentSyncGeneration(syncGeneration)) {
        await upsertUserWritingEntry({ user, ownerId: activeOwnerId, generation: syncGeneration, entry });
      }
    } catch (error) {
      console.warn('[WritingCanvas] Save error:', error);
    }
  }, [activeOwnerId, assessment, body, category, chosenPrompt, existingEntry?.createdAt, promptHidden, syncGeneration, syncPaused, title, user]);

  // Debounced autosave — draft state (title, body, category, chosen prompt,
  // prompt-card visibility) persists per entry without an explicit save.
  // Local-only: the cloud upsert still happens on exit/assess.
  const saveEntryRef = useRef(saveEntry);
  useEffect(() => { saveEntryRef.current = saveEntry; });
  const autosaveArmed = useRef(false);
  useEffect(() => {
    if (!autosaveArmed.current) {
      autosaveArmed.current = true;
      return undefined;
    }
    if (!existingEntry && !title.trim() && !body.trim() && !chosenPrompt) return undefined;
    const timer = setTimeout(() => { saveEntryRef.current({ localOnly: true }); }, Motion.autosaveDebounceDuration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, category, chosenPrompt, promptHidden]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    await saveEntry();
    setIsSaving(false);
    navigation.goBack();
  }, [navigation, saveEntry]);

  // Builds the save closure the assessment manager runs when the result
  // arrives — even if this screen has unmounted by then. It merges the
  // assessment into the latest stored copy of the entry (so edits autosaved
  // after pressing Assess aren't clobbered), then pushes to the cloud.
  const buildAssessmentPersist = useCallback((assessedBody) => {
    const snapshot = {
      id: entryId.current,
      title: title.trim() || 'Untitled entry',
      body: assessedBody,
      prompt: chosenPrompt?.ko ?? '',
      createdAt: existingEntry?.createdAt ?? new Date().toISOString(),
      category,
      promptHidden,
      deleted: false,
    };
    const owner = activeOwnerId;
    const cloud = { user, syncPaused, syncGeneration };
    return async (result) => {
      if (!owner) return;
      const storageKey = getWritingStorageKey(owner);
      const raw = await AsyncStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(parsed) ? parsed : [];
      const idx = arr.findIndex((e) => e.id === snapshot.id);
      const entry = {
        ...snapshot,
        ...(idx >= 0 ? arr[idx] : null),
        assessment: result,
        status: 'reviewed',
        updatedAt: new Date().toISOString(),
      };
      if (idx >= 0) arr[idx] = entry;
      else arr.unshift(entry);
      await AsyncStorage.setItem(storageKey, JSON.stringify(arr));

      if (cloud.user?.id && owner === cloud.user.id && !cloud.syncPaused && isCurrentSyncGeneration(cloud.syncGeneration)) {
        try {
          await upsertUserWritingEntry({ user: cloud.user, ownerId: owner, generation: cloud.syncGeneration, entry });
        } catch (error) {
          console.warn('[WritingCanvas] Cloud sync of assessment failed:', error);
        }
      }
    };
  }, [activeOwnerId, category, chosenPrompt, existingEntry?.createdAt, promptHidden, syncGeneration, syncPaused, title, user]);

  const applyAssessmentOutcome = useCallback((outcome) => {
    if (!outcome) return;
    if (outcome.status === 'success') {
      setAssessment(outcome.result);
      setLastAssessedBody(outcome.body ?? '');
      setSelectedAnnotationId(null);
      setEditingBody(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } else {
      const detail = outcome.error?.response?.data?.detail;
      setAssessError(typeof detail === 'string' && detail ? detail : 'Assessment failed. Please try again.');
    }
    setIsAssessing(false);
  }, []);

  // Resume a background assessment for this entry if one is still running
  // (the user left mid-assessment and came back).
  useEffect(() => {
    const id = entryId.current;
    if (!isAssessmentInFlight(id)) return undefined;
    setIsAssessing(true);
    let cancelled = false;
    getAssessmentPromise(id)?.then((outcome) => {
      if (!cancelled) applyAssessmentOutcome(outcome);
    });
    return () => { cancelled = true; };
  }, [applyAssessmentOutcome]);

  const handleAssess = useCallback(async () => {
    if (!body.trim() || isAssessing) return;
    if (user?.is_anonymous) {
      setAssessError('Sign in to use AI writing assessment');
      return;
    }
    setIsAssessing(true);
    setAssessError(null);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    // The manager owns the request: it keeps running if this screen unmounts,
    // saves the result itself, and dedupes repeat presses for this entry.
    const outcome = await startAssessment({
      entryId: entryId.current,
      body,
      category,
      prompt: chosenPrompt?.ko ?? '',
      persist: buildAssessmentPersist(body),
    });
    applyAssessmentOutcome(outcome);
  }, [applyAssessmentOutcome, body, buildAssessmentPersist, category, chosenPrompt, isAssessing, user?.is_anonymous]);

  const handleCyclePrompt = useCallback(() => {
    setPromptIndex((i) => i + 1);
  }, []);

  const handleSelectCategory = useCallback((key) => {
    setCategory(key);
    setPromptIndex(Math.floor(Math.random() * 1000));
  }, []);

  const handleChoosePrompt = useCallback(() => {
    setChosenPrompt(currentPrompt);
    inputRef.current?.focus();
  }, [currentPrompt]);

  // ✕ — clears any chosen prompt and closes the card for this visit.
  const handleClosePrompt = useCallback(() => {
    setChosenPrompt(null);
    setPromptHidden(true);
  }, []);

  // ── Real assessment data → output pane sections ──
  const summary = assessment?.summary && typeof assessment.summary === 'object' ? assessment.summary : null;
  const strengths = cleanStrings(summary?.strengths);
  const patterns = cleanStrings(summary?.patterns);
  const feedbackLines = [...strengths, ...patterns];
  if (!feedbackLines.length && typeof assessment?.feedback === 'string' && assessment.feedback.trim()) {
    feedbackLines.push(assessment.feedback.trim());
  }
  const annotations = Array.isArray(assessment?.annotations)
    ? assessment.annotations.filter((a) => a && typeof a.original === 'string' && a.original.trim())
    : [];
  const vocabItems = Array.isArray(summary?.vocab_items)
    ? summary.vocab_items.filter((v) => v && typeof v.word === 'string' && v.word.trim())
    : [];
  const overallScore = getOverallScore(assessment);
  const band = getBand(assessment);

  const assessDisabled = !body.trim() || isAssessing || isAssessed;

  // Inline suggestions — while the entry matches the assessed text, render the
  // body read-only with annotated phrases highlighted; tapping one reveals its
  // explanation. "Edit" (or changing the body) returns to the input.
  const showAnnotatedBody = isAssessed && !editingBody && annotations.length > 0;
  const bodySegments = showAnnotatedBody ? buildAnnotationSegments(body, annotations) : null;
  const selectedAnnotation = showAnnotatedBody
    ? annotations.find((a, i) => (a.id ?? String(i)) === selectedAnnotationId) ?? null
    : null;

  return (
    <Screen gradient edges={['top', 'left', 'right']}>
      {/* Toolbar — 56px, hairline underneath. Back+Logs / eyebrow / Draft+Assess */}
      <View style={[styles.header, { borderBottomColor: colors.readerHairline }]}>
        <Press onPress={handleSave} style={styles.backBtn} hitSlop={12}>
          <Feather name="chevron-left" size={22} color={colors.textMuted} />
          <Text style={[styles.breadcrumb, { color: colors.textMuted }]}>Logs</Text>
        </Press>
        <Text style={[styles.headerLabel, { color: colors.textTertiary }]} numberOfLines={1}>
          {existingEntry ? 'Entry' : 'New entry'} · 한국어
        </Text>
        <View style={styles.headerActions}>
          <Press
            onPress={handleSave}
            disabled={isSaving}
            style={[styles.draftBtn, { borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted }]}
          >
            <Feather name="save" size={14} color={colors.textMuted} />
            <Text style={[styles.draftLabel, { color: colors.textMuted }]}>Draft</Text>
          </Press>
          <Press
            onPress={handleAssess}
            disabled={assessDisabled}
            style={{ opacity: assessDisabled && !isAssessed ? Motion.disabledOpacity : 1 }}
          >
            {isAssessed ? (
              <View style={[styles.assessBtn, { backgroundColor: colors.success }]}>
                <Feather name="check" size={15} color={colors.glyphCream} />
                <Text style={[styles.assessLabel, { color: colors.glyphCream }]}>Assessed</Text>
              </View>
            ) : (
              <LinearGradient
                colors={isDarkMode ? Gradients.accentDusk : Gradients.accent}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={[styles.assessBtn, elevation.fab]}
              >
                <MaterialIcons name="auto-awesome" size={15} color={colors.glyphCream} />
                <Text style={[styles.assessLabel, { color: colors.glyphCream }]}>
                  {isAssessing ? 'Assessing' : 'Assess'}
                </Text>
              </LinearGradient>
            )}
          </Press>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Chosen prompt — solidified above the title; ✕ removes it */}
          {!promptHidden && chosenPrompt ? (
            <Card tone="glass" padded={false} contentStyle={styles.promptContent}>
              <View style={styles.chosenRow}>
                <MaterialCommunityIcons
                  name="lightbulb-outline"
                  size={16}
                  color={colors.accent3}
                  style={styles.chosenIcon}
                />
                <View style={styles.chosenTextCol}>
                  <Text style={[styles.promptKoreanChosen, { color: colors.text }]}>{chosenPrompt.ko}</Text>
                  {chosenPrompt.en ? (
                    <Text style={[styles.promptEnglish, { color: colors.textMuted }]}>{chosenPrompt.en}</Text>
                  ) : null}
                </View>
                <Press onPress={handleClosePrompt} hitSlop={8} style={styles.closeBtn}>
                  <Feather name="x" size={16} color={colors.textSubtle} />
                </Press>
              </View>
            </Card>
          ) : null}

          {/* Inspiration prompt card — browse by category, choose or dismiss */}
          {!promptHidden && !chosenPrompt ? (
            <Card tone="glass" padded={false} contentStyle={styles.promptContent}>
              <View style={styles.promptHeader}>
                <View style={styles.promptHeaderLeft}>
                  <MaterialCommunityIcons name="lightbulb-outline" size={14} color={colors.accent3} />
                  <Text style={[styles.promptEyebrow, { color: colors.textTertiary }]}>Need inspiration?</Text>
                </View>
                <View style={styles.promptHeaderRight}>
                  <IconButton
                    tone="muted"
                    size={30}
                    onPress={handleCyclePrompt}
                    icon={<Feather name="refresh-cw" size={15} color={colors.textMuted} />}
                  />
                  <Press onPress={handleClosePrompt} hitSlop={8} style={styles.closeBtn}>
                    <Feather name="x" size={16} color={colors.textSubtle} />
                  </Press>
                </View>
              </View>
              <View style={styles.categoryRow}>
                {WRITING_CATEGORIES.map(({ key, label }) => {
                  const active = category === key;
                  return (
                    <Press key={key} onPress={() => handleSelectCategory(key)}>
                      <View
                        style={[
                          styles.categoryPill,
                          active
                            ? { backgroundColor: colors.accentSoft, borderColor: 'transparent' }
                            : { backgroundColor: 'transparent', borderColor: colors.borderStrong },
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryLabel,
                            { color: active ? colors.accent : colors.textMuted },
                          ]}
                        >
                          {label}
                        </Text>
                      </View>
                    </Press>
                  );
                })}
              </View>
              <Press onPress={handleChoosePrompt}>
                <Text style={[styles.promptKorean, { color: colors.text }]}>{currentPrompt.ko}</Text>
              </Press>
              <Text style={[styles.promptEnglish, { color: colors.textMuted }]}>{currentPrompt.en}</Text>
              <Press onPress={handleChoosePrompt} style={styles.startFromBtn}>
                <Feather name="check" size={13} color={colors.accent} />
                <Text style={[styles.startFromLabel, { color: colors.accent }]}>Choose this prompt</Text>
              </Press>
            </Card>
          ) : null}

          {/* Entry title */}
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Untitled entry"
            placeholderTextColor={colors.textSubtle}
            style={[
              styles.titleInput,
              { color: colors.text },
              !promptHidden ? styles.titleInputBelowPrompt : null,
            ]}
            returnKeyType="next"
            onSubmitEditing={() => inputRef.current?.focus()}
          />

          {/* Word count row */}
          <View style={styles.wordCountRow}>
            <Text style={[styles.wordCount, { color: colors.textTertiary }]}>
              {wordCount} word{wordCount !== 1 ? 's' : ''} · {assessment ? 'reviewed' : 'draft'}
            </Text>
            {showAnnotatedBody ? (
              <Press
                onPress={() => { setEditingBody(true); setSelectedAnnotationId(null); }}
                hitSlop={8}
                style={styles.editBtn}
              >
                <Feather name="edit-2" size={12} color={colors.textMuted} />
                <Text style={[styles.editLabel, { color: colors.textMuted }]}>Edit</Text>
              </Press>
            ) : null}
          </View>

          {/* Body — annotated read-only view after assessment, input otherwise */}
          {showAnnotatedBody ? (
            <View>
              <Text style={[styles.bodyAnnotated, { color: colors.text }]}>
                {bodySegments.map((seg, i) => (
                  seg.annotation ? (
                    <Text
                      key={`${seg.key}-${i}`}
                      onPress={() => setSelectedAnnotationId((prev) => (prev === seg.key ? null : seg.key))}
                      style={
                        selectedAnnotationId === seg.key
                          ? { backgroundColor: colors.readerTappedWordBg, color: colors.readerTappedWordText }
                          : { backgroundColor: colors.readerHeatAbove }
                      }
                    >
                      {seg.text}
                    </Text>
                  ) : (
                    <Text key={`plain-${i}`}>{seg.text}</Text>
                  )
                ))}
              </Text>
              {selectedAnnotation ? (
                <Card tone="glass" padded={false} style={styles.annotCard} contentStyle={styles.suggestContent}>
                  <Text style={[styles.annotType, { color: colors.textTertiary }]}>
                    {String(selectedAnnotation.type ?? 'suggestion').replace(/_/g, ' ')}
                  </Text>
                  <View style={styles.suggestTopRow}>
                    <Text style={[styles.suggestFrom, { color: colors.textMuted, textDecorationColor: colors.danger }]}>
                      {selectedAnnotation.original}
                    </Text>
                    {Array.isArray(selectedAnnotation.suggestions) && selectedAnnotation.suggestions[0] ? (
                      <>
                        <Feather name="arrow-right" size={15} color={colors.textSubtle} />
                        <Text style={[styles.suggestTo, { color: colors.accent }]}>
                          {selectedAnnotation.suggestions[0]}
                        </Text>
                      </>
                    ) : null}
                  </View>
                  {selectedAnnotation.explanation ? (
                    <Text style={[styles.suggestWhy, { color: colors.textMuted }]}>
                      {selectedAnnotation.explanation}
                    </Text>
                  ) : null}
                  {Array.isArray(selectedAnnotation.suggestion_notes)
                    && selectedAnnotation.suggestion_notes[0]
                    && selectedAnnotation.suggestion_notes[0] !== selectedAnnotation.explanation ? (
                      <Text style={[styles.suggestWhy, { color: colors.textMuted }]}>
                        {selectedAnnotation.suggestion_notes[0]}
                      </Text>
                    ) : null}
                </Card>
              ) : (
                <Text style={[styles.annotHint, { color: colors.textSubtle }]}>
                  Tap a highlighted phrase to see the suggestion.
                </Text>
              )}
            </View>
          ) : (
            <TextInput
              ref={inputRef}
              value={body}
              onChangeText={setBody}
              placeholder="오늘 하루를 한국어로 적어 보세요…"
              placeholderTextColor={colors.textSubtle}
              multiline
              textAlignVertical="top"
              style={[styles.bodyInput, { color: colors.text }]}
            />
          )}

          {/* Assessment error (quota, too short, sign-in) */}
          {assessError && !isAssessing ? (
            <Text style={[styles.assessErrorText, { color: colors.danger }]}>{assessError}</Text>
          ) : null}

          {/* AI loading state */}
          {isAssessing ? (
            <View style={styles.loadingPane}>
              <SpinnerRing />
              <Text style={[styles.loadingMsg, { color: colors.textMuted }]}>
                {ASSESS_MESSAGES[assessMsgIndex]}
              </Text>
              <Text style={[styles.loadingHint, { color: colors.textSubtle }]}>
                You can leave this screen — the assessment will finish in the background.
              </Text>
            </View>
          ) : null}

          {/* AI output pane */}
          {assessment && !isAssessing ? (
            <Animated.View
              style={[
                styles.outputPane,
                { borderTopColor: colors.divider },
                {
                  opacity: outputAnim,
                  transform: [{
                    translateY: outputAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
                  }],
                },
              ]}
            >
              <View style={styles.outputHeader}>
                <MaterialIcons name="auto-awesome" size={16} color={colors.accent} />
                <Text style={[styles.outputTitle, { color: colors.text }]}>AI Evaluation</Text>
              </View>

              {/* Score tiles — Overall (+CEFR band), issue count, study count */}
              <View style={styles.tileRow}>
                <Card tone="glass" padded={false} style={styles.tile} contentStyle={styles.tileContent}>
                  <Text style={[styles.tileValue, { color: colors.accent }]}>{overallScore ?? '—'}</Text>
                  <Text style={[styles.tileLabel, { color: colors.textTertiary }]}>Overall</Text>
                  {band ? (
                    <View style={[styles.bandChip, { borderColor: colors.accent2 }]}>
                      <Text style={[styles.bandChipLabel, { color: colors.accent2 }]}>{band}</Text>
                    </View>
                  ) : null}
                </Card>
                <Card tone="glass" padded={false} style={styles.tile} contentStyle={styles.tileContent}>
                  <Text style={[styles.tileValue, { color: colors.accent }]}>{annotations.length}</Text>
                  <Text style={[styles.tileLabel, { color: colors.textTertiary }]}>Issues</Text>
                </Card>
                <Card tone="glass" padded={false} style={styles.tile} contentStyle={styles.tileContent}>
                  <Text style={[styles.tileValue, { color: colors.accent }]}>{vocabItems.length}</Text>
                  <Text style={[styles.tileLabel, { color: colors.textTertiary }]}>To study</Text>
                </Card>
              </View>

              {/* Feedback — strengths, then recurring patterns */}
              {feedbackLines.length ? (
                <Card tone="glass" padded={false} style={styles.feedbackCard} contentStyle={styles.feedbackContent}>
                  <Text style={[styles.feedbackLabel, { color: colors.textTertiary }]}>Feedback</Text>
                  <View style={styles.feedbackLines}>
                    {feedbackLines.map((line, i) => (
                      <Text key={i} style={[styles.feedbackText, { color: colors.textSecondary }]}>{line}</Text>
                    ))}
                  </View>
                </Card>
              ) : null}

              {/* Words to study — summary.vocab_items */}
              {vocabItems.length ? (
                <>
                  <Text style={[styles.sectLabel, { color: colors.textTertiary }]}>Words to study</Text>
                  <View style={styles.suggestList}>
                    {vocabItems.map((v, i) => (
                      <Card key={i} tone="glass" padded={false} contentStyle={styles.suggestContent}>
                        <View style={styles.suggestTopRow}>
                          <Text style={[styles.vocabWord, { color: colors.accent }]}>{v.word}</Text>
                          {v.meaning ? (
                            <Text style={[styles.vocabMeaning, { color: colors.textSecondary }]}>{v.meaning}</Text>
                          ) : null}
                        </View>
                        {v.example ? (
                          <Text style={[styles.vocabExample, { color: colors.textMuted }]}>{v.example}</Text>
                        ) : null}
                      </Card>
                    ))}
                  </View>
                </>
              ) : null}
            </Animated.View>
          ) : null}

          <View style={{ height: 200 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Toolbar — prototype: 56px row, padding 0 12px 0 8px, reader hairline below
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  breadcrumb: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  headerLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.caption,
    lineHeight: 14,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginHorizontal: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Draft — pill, strong hairline, faint tint fill, 12px bold
  draftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  draftLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 15,
  },
  // Assess — accent gradient pill with glow; solid success when assessed
  assessBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  assessLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12.5,
    lineHeight: 16,
  },
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: 20,
  },
  // Title — serif 24/500, bare input
  titleInput: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: typeScale.title,
    lineHeight: lineHeights.title,
    padding: 0,
  },
  titleInputBelowPrompt: {
    marginTop: 14,
  },
  // Prompt card — glass, 13×15 padding, sits above the title
  promptContent: {
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  promptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  promptHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  promptHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  closeBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  categoryPill: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  categoryLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 14,
  },
  // Solidified (chosen) prompt — icon + text + ✕, no header or refresh
  chosenRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  chosenIcon: {
    marginTop: 3,
  },
  chosenTextCol: {
    flex: 1,
  },
  promptKoreanChosen: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 16,
    lineHeight: 24,
  },
  promptEyebrow: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  promptKorean: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
  },
  promptEnglish: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  startFromBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 11,
    alignSelf: 'flex-start',
  },
  startFromLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.caption,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  wordCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 4,
  },
  wordCount: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Body — Korean serif 17px at 1.9 line height
  bodyInput: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 17,
    lineHeight: 32,
    minHeight: 280,
    padding: 0,
  },
  // Read-only annotated body shown after an assessment
  bodyAnnotated: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 17,
    lineHeight: 32,
  },
  annotHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 10,
  },
  annotCard: {
    marginTop: 12,
  },
  annotType: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  assessErrorText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 16,
  },
  // Loading — spinner + italic serif status line
  loadingPane: {
    alignItems: 'center',
    paddingVertical: 34,
  },
  spinner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
  },
  loadingMsg: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 16,
  },
  loadingHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  // Output pane — divider top, then evaluation sections
  outputPane: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
  },
  outputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  outputTitle: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 18,
    lineHeight: 24,
  },
  tileRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
  },
  tileContent: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  tileValue: {
    fontFamily: fontFamilies.sansExtraBold,
    fontSize: 24,
    lineHeight: 26,
  },
  tileLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 5,
  },
  bandChip: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 5,
    paddingVertical: 1,
  },
  bandChipLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  feedbackCard: {
    marginTop: 14,
  },
  feedbackContent: {
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  feedbackLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  feedbackLines: {
    gap: 6,
  },
  feedbackText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.bodySm,
    lineHeight: 21,
  },
  sectLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.micro,
    lineHeight: lineHeights.micro,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 12,
    marginHorizontal: 4,
  },
  suggestList: {
    gap: 10,
  },
  suggestContent: {
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  suggestTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 9,
  },
  suggestFrom: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: 'line-through',
  },
  suggestTo: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 15,
    lineHeight: 22,
  },
  suggestWhy: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 6,
  },
  vocabWord: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 15,
    lineHeight: 22,
  },
  vocabMeaning: {
    flex: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.bodySm,
    lineHeight: 18,
  },
  vocabExample: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
});
