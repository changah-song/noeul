import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
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
  recordReviewOutcome,
  updatePriority,
  updateFavorite,
  updateLevel,
  viewData,
} from '../services/Database';
import { incrementWordsStudied } from '../services/dailyProgress';
import { deleteUserVocabEntry, supabase, updateUserVocabStatus } from '../services/supabase';
import { colors, radii, spacing, textStyles } from '../theme';

const STATUS_ORDER = ['unorganized', 'bad', 'mid', 'good'];
const PRIORITY_ORDER = ['low', 'normal', 'high'];

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

const normalizeRows = (rows) =>
  rows.map((row) => ({
    ...row,
    is_favorite: Boolean(row.is_favorite),
    priority: row.priority ?? 'normal',
    created_at: row.created_at ?? null,
    next_review_at: row.next_review_at ?? null,
    last_reviewed_at: row.last_reviewed_at ?? null,
    correct_count: row.correct_count ?? 0,
    wrong_count: row.wrong_count ?? 0,
  }));

const priorityScore = {
  high: 0,
  normal: 1,
  low: 2,
};

const sortWords = (rows) =>
  [...rows].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) {
      return a.is_favorite ? -1 : 1;
    }

    const priorityDiff = (priorityScore[a.priority] ?? 1) - (priorityScore[b.priority] ?? 1);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const createdAtDiff = new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return (a.word ?? '').localeCompare(b.word ?? '');
  });

const buildStudySections = (rows) => {
  const now = new Date();
  const dueWords = sortWords(
    rows.filter((row) => row.next_review_at && new Date(row.next_review_at) <= now && row.level !== 'unorganized')
  );
  const newWords = sortWords(rows.filter((row) => row.level === 'unorganized'));
  const priorityWords = sortWords(rows.filter((row) => row.priority === 'high' && row.level !== 'good'));
  const allWords = sortWords(rows);

  return [
    {
      key: 'due-today',
      title: 'Due today',
      meta: dueWords.length
        ? `${dueWords.length} words ready for spaced repetition`
        : 'Nothing due yet — great chance to clear new words',
      practiceLabel: 'Review',
      progress: allWords.length ? (allWords.length - dueWords.length) / allWords.length : 0,
      words: dueWords,
    },
    {
      key: 'new-words',
      title: 'Newly saved',
      meta: newWords.length
        ? `${newWords.length} words waiting to enter your study cycle`
        : 'Your inbox is clear',
      practiceLabel: 'Study',
      progress: newWords.length ? 0.08 : 0,
      words: newWords,
    },
    {
      key: 'priority-words',
      title: 'Priority words',
      meta: priorityWords.length
        ? `${priorityWords.length} words you marked as high priority`
        : 'Mark words as High to bring them here',
      practiceLabel: 'Focus',
      progress: priorityWords.length
        ? priorityWords.filter((row) => row.level === 'good').length / priorityWords.length
        : 0,
      words: priorityWords,
    },
    {
      key: 'all-words',
      title: 'Browse all words',
      meta: `${allWords.length} saved words across your current shelf`,
      practiceLabel: 'Practice',
      progress: allWords.length
        ? allWords.filter((row) => row.level === 'good').length / allWords.length
        : 0,
      words: allWords,
    },
  ];
};

const Learn = () => {
  const [words, setWords] = useState([]);
  const [expandedSections, setExpandedSections] = useState({
    'due-today': true,
    'new-words': true,
    'priority-words': false,
    'all-words': false,
  });
  const [practiceDeck, setPracticeDeck] = useState(null);
  const [practiceIndex, setPracticeIndex] = useState(0);

  const fetchWords = useCallback(() => {
    viewData()
      .then((data) => {
        setWords(normalizeRows(data));
      })
      .catch((error) => {
        console.error('[Learn] Error fetching vocab data:', error);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchWords();
    }, [fetchWords])
  );

  const visibleWords = useMemo(() => words, [words]);

  const sections = useMemo(() => buildStudySections(visibleWords), [visibleWords]);
  const dueSection = useMemo(() => sections.find((section) => section.key === 'due-today'), [sections]);
  const newSection = useMemo(() => sections.find((section) => section.key === 'new-words'), [sections]);
  const allSection = useMemo(() => sections.find((section) => section.key === 'all-words'), [sections]);
  const favoriteCount = useMemo(() => visibleWords.filter((word) => word.is_favorite).length, [visibleWords]);
  const masteredCount = useMemo(() => visibleWords.filter((word) => word.level === 'good').length, [visibleWords]);
  const inProgressCount = useMemo(
    () => visibleWords.filter((word) => word.level === 'mid' || word.level === 'bad').length,
    [visibleWords]
  );
  const newCount = useMemo(() => visibleWords.filter((word) => word.level === 'unorganized').length, [visibleWords]);
  const dueCount = useMemo(
    () => visibleWords.filter((word) => word.next_review_at && new Date(word.next_review_at) <= new Date() && word.level !== 'unorganized').length,
    [visibleWords]
  );
  const primaryPracticeDeck = dueSection?.words?.length
    ? { title: 'Due today', words: dueSection.words }
    : newSection?.words?.length
      ? { title: 'Newly saved', words: newSection.words }
      : allSection?.words?.length
        ? { title: 'All saved words', words: allSection.words }
        : { title: 'Practice', words: [] };

  const toggleExpand = useCallback((sectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  }, []);

  const syncStatusToCloud = useCallback(async (word, status) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    try {
      await updateUserVocabStatus(
        user.id,
        {
          word: word.word,
          hanja: word.hanja,
          definition: word.def,
        },
        status
      );
    } catch (error) {
      console.log('[Learn] cloud status sync failed:', error.message);
    }
  }, []);

  const handleCycleStatus = useCallback(async (word, explicitStatus = null) => {
    const nextStatus = explicitStatus ?? cycleStatus(word.level);
    await updateLevel(word.word, word.hanja, word.def, nextStatus);
    await syncStatusToCloud(word, nextStatus);
    fetchWords();
  }, [fetchWords, syncStatusToCloud]);

  const handleToggleFavorite = useCallback(async (word) => {
    await updateFavorite(word.word, word.hanja, word.def, !word.is_favorite);
    fetchWords();
  }, [fetchWords]);

  const handleCyclePriority = useCallback(async (word) => {
    const nextPriority = cyclePriority(word.priority);
    await updatePriority(word.word, word.hanja, word.def, nextPriority);
    fetchWords();
  }, [fetchWords]);

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

            fetchWords();
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
    await syncStatusToCloud(currentWord, status);
    await incrementWordsStudied(1);
    await fetchWords();

    if (practiceIndex >= practiceDeck.words.length - 1) {
      closePractice();
      return;
    }

    setPracticeIndex((prev) => prev + 1);
  }, [closePractice, fetchWords, practiceDeck, practiceIndex, syncStatusToCloud]);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.stack}>
        <SectionHeader
          eyebrow="Learn"
          title="Study the words that matter now"
          subtitle="Use today’s queue, new saves, and priority words to keep your learning manageable."
        />

        <Card tone="muted" style={styles.heroCard} contentStyle={styles.heroContent}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Your study queue</Text>
            <Text style={styles.heroSubtitle}>
              Save freely while reading, then come here to decide what deserves attention today.
            </Text>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{dueCount}</Text>
              <Text style={styles.heroStatLabel}>Due</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{newCount}</Text>
              <Text style={styles.heroStatLabel}>New</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{inProgressCount}</Text>
              <Text style={styles.heroStatLabel}>Reviewing</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{masteredCount}</Text>
              <Text style={styles.heroStatLabel}>Mastered</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => startPractice(primaryPracticeDeck.words, primaryPracticeDeck.title)}
            style={[styles.practiceButton, visibleWords.length === 0 && styles.practiceButtonDisabled]}
            disabled={visibleWords.length === 0}
          >
            <Feather name="layers" size={16} color={visibleWords.length === 0 ? colors.textSubtle : colors.accentStrong} />
            <Text style={[styles.practiceButtonLabel, visibleWords.length === 0 && styles.practiceButtonLabelDisabled]}>
              {dueCount > 0 ? 'Start today’s review' : 'Practice new words'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.heroFooter}>
            {favoriteCount} favorites · {visibleWords.length} saved total
          </Text>
        </Card>

        <SectionHeader
          eyebrow="Queue"
          title="Organize your saved words"
          subtitle="Cycle status, raise priority, favorite useful words, or remove anything you do not want to study."
        />

        {visibleWords.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved words yet</Text>
            <Text style={styles.emptyBody}>
              Save a word while reading and it will land here in your study queue.
            </Text>
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
              />
            ))}
          </View>
        )}
      </View>

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
});

export default Learn;
