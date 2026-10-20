import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { fsrsSchedule, getVocabContexts } from '../../services/Database';
import {
  fetchUserPreferences,
  getTimestampMs,
  updateUserPreferenceFields,
} from '../../services/preferencesCloudSync';
import { isCurrentSyncGeneration } from '../../services/localOwnerCoordinator';
import { fontFamilies, useTheme } from '../../theme';

const STATUS_ACTIONS = [
  { key: 'bad', labelKey: 'learn.hard', tone: 'danger' },
  { key: 'mid', labelKey: 'learn.okay', tone: 'warning' },
  { key: 'good', labelKey: 'learn.easy', tone: 'success' },
];

const MS_PER_DAY = 86_400_000;

// A scheduler interval (whole days) as a short "when it comes back" line.
const formatInterval = (days, t) => {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }
  if (value <= 1) {
    return t('learn.when.tomorrow');
  }
  if (value < 45) {
    return t('learn.when.inDays', { count: Math.round(value) });
  }
  return t('learn.when.inMonths', { count: Math.round(value / 30) });
};

const FLASHCARD_SETTINGS_KEY = 'flashcardFrontSettings';
const FLASHCARD_SETTINGS_UPDATED_AT_KEY = 'flashcardFrontSettingsUpdatedAt';

const createDefaultFlashcardSettings = () => ({
  front: {
    showPronunciation: false,
    showContext: false,
    showHanja: false,
    showRelated: false,
  },
  back: {
    showPronunciation: true,
    showContext: true,
    showHanja: true,
    showRelated: true,
    showDefinition: true,
  },
});

const normalizeSideSettings = (defaults, raw = {}) => (
  Object.keys(defaults).reduce((next, key) => {
    next[key] = typeof raw?.[key] === 'boolean' ? raw[key] : defaults[key];
    return next;
  }, {})
);

const normalizeFlashcardSettings = (rawSettings) => {
  const defaults = createDefaultFlashcardSettings();
  const raw = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
    ? rawSettings
    : {};
  const normalized = {
    front: normalizeSideSettings(defaults.front, raw.front),
    back: normalizeSideSettings(defaults.back, raw.back),
  };

  if (typeof raw.showPronunciation === 'boolean') {
    normalized.front.showPronunciation = raw.showPronunciation;
  }
  if (typeof raw.showContext === 'boolean') {
    normalized.front.showContext = raw.showContext;
  }
  if (typeof raw.showHanja === 'boolean') {
    normalized.front.showHanja = raw.showHanja;
  }
  if (typeof raw.showRelated === 'boolean') {
    normalized.front.showRelated = raw.showRelated;
  }

  return normalized;
};

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

const Flashcard = ({
  vocab,
  index,
  total,
  onClose,
  onMark,
  completed = false,
  completionNote = '',
  onKeepReading,
  onBackToLearn,
  user,
  ownerId,
  syncGeneration,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progressFraction = total > 0 ? Math.min(1, (completed ? total : index) / total) : 0;
  const progressAnim = useRef(new Animated.Value(progressFraction)).current;
  const [isFlipped, setIsFlipped] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [flashcardSettings, setFlashcardSettings] = useState(() => createDefaultFlashcardSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [contextRows, setContextRows] = useState([]);
  const flashcardSettingsRef = useRef(createDefaultFlashcardSettings());
  const flashcardSettingsUpdatedAtRef = useRef(null);
  const flashcardSettingsCloudUserRef = useRef(null);
  const markedVocabRef = useRef(null);
  useEffect(() => {
    // A new card is a new object, so the guard below re-arms by itself; reset
    // on close too so reopening a deck with the same word objects still grades.
    if (!vocab) markedVocabRef.current = null;
  }, [vocab]);

  const hanjaText = useMemo(
    () => (vocab?.hanja && vocab.hanja !== 'N/A' ? vocab.hanja : null),
    [vocab?.hanja]
  );
  const pronunciation = useMemo(
    () => (
      cleanText(vocab?.romanization)
      || cleanText(vocab?.pronunciation)
      || cleanText(vocab?.pinyin)
      || cleanText(vocab?.ipa)
      || null
    ),
    [vocab?.ipa, vocab?.pinyin, vocab?.pronunciation, vocab?.romanization]
  );
  const contextSentence = useMemo(() => {
    const vocabContexts = Array.isArray(vocab?.contexts)
      ? vocab.contexts
      : (Array.isArray(vocab?.contextRows) ? vocab.contextRows : []);
    const firstContext = [...contextRows, ...vocabContexts].find((context) => (
      cleanText(context?.sentence)
    ));

    return cleanText(firstContext?.sentence)
      || cleanText(vocab?.context_sentence)
      || cleanText(vocab?.contextSentence)
      || null;
  }, [contextRows, vocab?.contextRows, vocab?.contextSentence, vocab?.context_sentence, vocab?.contexts]);
  const relatedKnownWords = useMemo(() => {
    const normalizeEntry = (entry) => ({
      ...entry,
      korean: entry?.korean ?? entry?.relatedWord ?? entry?.related_word ?? '',
      hanja: entry?.hanja ?? entry?.relatedHanja ?? entry?.related_hanja ?? '',
      meaning: entry?.meaning ?? entry?.relatedDefinition ?? entry?.related_definition ?? '',
    });
    const normalizeEntries = (entries = []) => entries
      .map(normalizeEntry)
      .filter((entry) => entry?.korean || entry?.hanja || entry?.meaning);

    if (Array.isArray(vocab?.related_known_words)) {
      return normalizeEntries(vocab.related_known_words);
    }

    if (!vocab?.related_known_words) {
      return [];
    }

    try {
      const parsed = JSON.parse(vocab.related_known_words);
      return Array.isArray(parsed) ? normalizeEntries(parsed) : [];
    } catch {
      return [];
    }
  }, [vocab?.related_known_words]);

  useEffect(() => {
    flashcardSettingsRef.current = flashcardSettings;
  }, [flashcardSettings]);

  const persistFlashcardSettings = useCallback((nextSettings, updatedAt = new Date().toISOString(), options = {}) => {
    const { syncCloud = true } = options;
    const normalizedSettings = normalizeFlashcardSettings(nextSettings);

    flashcardSettingsRef.current = normalizedSettings;
    flashcardSettingsUpdatedAtRef.current = updatedAt;

    Promise.all([
      AsyncStorage.setItem(FLASHCARD_SETTINGS_KEY, JSON.stringify(normalizedSettings)),
      AsyncStorage.setItem(FLASHCARD_SETTINGS_UPDATED_AT_KEY, updatedAt),
    ]).catch(() => {});

    if (syncCloud && user?.id && ownerId === user.id) {
      updateUserPreferenceFields({
        user,
        ownerId,
        generation: syncGeneration,
        patch: {
          flashcard_settings: {
            ...normalizedSettings,
            updatedAt,
          },
          updated_at: updatedAt,
        },
      }).catch((error) => {
        console.warn('[Flashcard] Failed to sync flashcard settings:', error?.message ?? error);
      });
    }
  }, [ownerId, syncGeneration, user]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      AsyncStorage.getItem(FLASHCARD_SETTINGS_KEY),
      AsyncStorage.getItem(FLASHCARD_SETTINGS_UPDATED_AT_KEY),
    ])
      .then(([stored, storedUpdatedAt]) => {
        if (!isMounted) {
          return;
        }

        if (stored) {
          const nextSettings = normalizeFlashcardSettings(JSON.parse(stored));
          flashcardSettingsRef.current = nextSettings;
          setFlashcardSettings(nextSettings);
        }
        flashcardSettingsUpdatedAtRef.current = storedUpdatedAt ?? null;
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    if (!user?.id || ownerId !== user.id) {
      flashcardSettingsCloudUserRef.current = null;
      return;
    }

    if (flashcardSettingsCloudUserRef.current === user.id) {
      return;
    }

    let isMounted = true;
    flashcardSettingsCloudUserRef.current = user.id;

    const mergeCloudFlashcardSettings = async () => {
      try {
        const cloudPreferences = await fetchUserPreferences(user.id);
        if (!isMounted || !isCurrentSyncGeneration(syncGeneration)) {
          return;
        }
        const cloudSettings = cloudPreferences?.flashcard_settings;
        const hasCloudSettings = cloudSettings
          && typeof cloudSettings === 'object'
          && !Array.isArray(cloudSettings)
          && Object.keys(cloudSettings).length > 0;
        const cloudUpdatedAt = cloudSettings?.updatedAt
          ?? cloudSettings?.updated_at
          ?? cloudPreferences?.updated_at
          ?? null;
        const localUpdatedAt = flashcardSettingsUpdatedAtRef.current;

        if (hasCloudSettings && getTimestampMs(cloudUpdatedAt) > getTimestampMs(localUpdatedAt)) {
          const nextSettings = normalizeFlashcardSettings(cloudSettings);

          if (!isMounted) {
            return;
          }

          setFlashcardSettings(nextSettings);
          persistFlashcardSettings(nextSettings, cloudUpdatedAt, { syncCloud: false });
          return;
        }

        const updatedAt = localUpdatedAt ?? new Date().toISOString();
        await updateUserPreferenceFields({
          user,
          ownerId,
          generation: syncGeneration,
          patch: {
            flashcard_settings: {
              ...flashcardSettingsRef.current,
              updatedAt,
            },
            updated_at: updatedAt,
          },
        });
      } catch (error) {
        flashcardSettingsCloudUserRef.current = null;
        console.warn('[Flashcard] Failed to merge cloud flashcard settings:', error?.message ?? error);
      }
    };

    mergeCloudFlashcardSettings();

    return () => {
      isMounted = false;
    };
  }, [ownerId, persistFlashcardSettings, settingsLoaded, syncGeneration, user]);

  useEffect(() => {
    let isActive = true;

    setContextRows([]);

    if (!vocab?.word) {
      return () => {
        isActive = false;
      };
    }

    getVocabContexts(
      vocab.word,
      vocab.hanja,
      vocab.def,
      1,
      vocab.language ?? 'ko',
      { ownerId }
    )
      .then((contexts) => {
        if (isActive) {
          setContextRows(contexts);
        }
      })
      .catch((error) => {
        console.warn('[Flashcard] Failed to load context sentence:', error?.message ?? error);
      });

    return () => {
      isActive = false;
    };
  }, [ownerId, vocab?.word, vocab?.hanja, vocab?.def, vocab?.language]);

  const updateFlashcardSetting = (side, key, value) => {
    setFlashcardSettings((current) => {
      const next = {
        ...current,
        [side]: {
          ...current[side],
          [key]: value,
        },
      };
      persistFlashcardSettings(next);
      return next;
    });
  };

  // "When it comes back" under each grade: the same FSRS schedule
  // recordReviewOutcome will apply for that grade.
  const gradeHints = useMemo(() => {
    if (!vocab) {
      return {};
    }

    const lastReviewedAt = new Date(vocab.last_reviewed_at ?? vocab.lastReviewedAt).getTime();
    const daysSinceLastReview = Number.isFinite(lastReviewedAt)
      ? Math.max(0, (Date.now() - lastReviewedAt) / MS_PER_DAY)
      : null;

    const hints = STATUS_ACTIONS.reduce((next, action) => {
      try {
        const schedule = fsrsSchedule(vocab, action.key, daysSinceLastReview);
        const label = formatInterval(schedule?.interval, t);
        if (label) {
          next[action.key] = label;
        }
      } catch {
        // No hint for this grade.
      }
      return next;
    }, {});
    // A brand-new card comes back tomorrow whatever the grade; three identical
    // lines would read like a bug, so show them only when they differ.
    return new Set(Object.values(hints)).size > 1 ? hints : {};
  }, [t, vocab]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progressFraction,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [progressAnim, progressFraction]);

  const renderSettingRow = (side, key, label) => {
    const enabled = Boolean(flashcardSettings?.[side]?.[key]);

    return (
      <Pressable
        key={`${side}-${key}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: enabled }}
        onPress={() => updateFlashcardSetting(side, key, !enabled)}
        style={styles.settingRow}
      >
        <Text style={styles.settingLabel}>{label}</Text>
        <MaterialIcons
          name={enabled ? 'check-box' : 'check-box-outline-blank'}
          size={22}
          color={enabled ? colors.inkSlate : colors.borderStrong}
        />
      </Pressable>
    );
  };

  const renderSettingSection = (side, title, fields) => (
    <View style={styles.settingSection}>
      <Text style={styles.settingsSectionTitle}>{title}</Text>
      {fields.map(({ key, label }) => renderSettingRow(side, key, label))}
    </View>
  );

  const renderRelatedWords = () => {
    if (relatedKnownWords.length === 0) {
      return null;
    }

    return (
      <View style={styles.relatedSection}>
        <Text style={styles.relatedTitle}>{t('learn.relatedWordsYouKnow')}</Text>
        <View style={styles.relatedList}>
          {relatedKnownWords.map((entry, relatedIndex) => (
            <Text
              key={`${entry.korean ?? ''}-${entry.meaning ?? ''}-${relatedIndex}`}
              numberOfLines={1}
              style={styles.relatedText}
            >
              {[entry.korean || t('learn.relatedWord'), entry.hanja].filter(Boolean).join(' ')}
              {entry.meaning ? ` · ${entry.meaning}` : ''}
            </Text>
          ))}
        </View>
      </View>
    );
  };

  const renderContextSentence = () => {
    if (!contextSentence) {
      return null;
    }

    return (
      <Text selectable numberOfLines={4} style={styles.contextSentence}>
        {contextSentence}
      </Text>
    );
  };

  const renderDefinition = () => {
    if (!vocab?.def) {
      return null;
    }

    return <Text selectable style={styles.definition}>{vocab.def}</Text>;
  };

  const renderCardDetails = (side) => {
    const settings = flashcardSettings[side] ?? {};

    return (
      <>
        {settings.showPronunciation && pronunciation ? (
          <Text selectable style={styles.pronunciation}>{pronunciation}</Text>
        ) : null}
        {settings.showHanja && hanjaText ? (
          <Text selectable style={styles.hanja}>{hanjaText}</Text>
        ) : null}
        {settings.showDefinition ? renderDefinition() : null}
        {settings.showContext ? renderContextSentence() : null}
        {settings.showRelated ? renderRelatedWords() : null}
      </>
    );
  };

  if (!vocab && !completed) {
    return null;
  }

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const position = completed ? total : index + 1;
  const reviewedText = total === 1
    ? t('learn.reviewedOne')
    : t('learn.reviewedOther', { count: total });

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <View style={styles.body}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('learn.endReview')}
            onPress={onClose}
            style={styles.iconButton}
          >
            <Feather name="x" size={22} color={colors.inkSlate} />
          </TouchableOpacity>
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={styles.progress}>{t('learn.progress', { current: position, total })}</Text>
          </View>
          {completed ? (
            <View style={styles.iconButton} />
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('learn.cardSettings')}
              accessibilityState={{ expanded: showSettings }}
              onPress={() => setShowSettings((current) => !current)}
              style={styles.iconButton}
            >
              <Feather name="sliders" size={20} color={colors.inkSlate} />
            </TouchableOpacity>
          )}
        </View>

        {completed ? (
          <View style={styles.doneWrap}>
            <Text style={styles.doneTitle}>{t('learn.allCaughtUp')}</Text>
            <Text style={styles.doneBody}>
              {[reviewedText, completionNote].filter(Boolean).join(' ')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onKeepReading ?? onClose}
              style={styles.donePrimary}
            >
              <Text style={styles.donePrimaryText}>{t('learn.keepReading')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onBackToLearn ?? onClose}
              style={styles.doneSecondary}
            >
              <Text style={styles.doneSecondaryText}>{t('learn.backToLearn')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFlipped ? t('learn.hideAnswer') : t('learn.showAnswer')}
              onPress={() => setIsFlipped((prev) => !prev)}
              style={styles.cardArea}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.cardContent}
                style={styles.cardScroll}
              >
                <Text selectable style={isFlipped ? styles.wordSmall : styles.word}>{vocab.word}</Text>
                {renderCardDetails(isFlipped ? 'back' : 'front')}
              </ScrollView>
              <Text style={styles.flipHint}>
                {isFlipped ? t('learn.tapAgainHide') : t('learn.tapToFlip')}
              </Text>
            </Pressable>

            <View style={styles.actions}>
              {!isFlipped ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setIsFlipped(true)}
                  style={styles.showAnswerButton}
                >
                  <Text style={styles.showAnswerText}>{t('learn.showAnswer')}</Text>
                </TouchableOpacity>
              ) : STATUS_ACTIONS.map((action) => (
                <TouchableOpacity
                  key={action.key}
                  accessibilityRole="button"
                  accessibilityLabel={[t(action.labelKey), gradeHints[action.key]].filter(Boolean).join(', ')}
                  onPress={() => {
                    // One grade per card: a double tap must not record twice.
                    if (markedVocabRef.current === vocab) return;
                    markedVocabRef.current = vocab;
                    setIsFlipped(false);
                    onMark(action.key);
                  }}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionLabel}>{t(action.labelKey)}</Text>
                  {gradeHints[action.key] ? (
                    <Text numberOfLines={1} style={styles.actionHint}>{gradeHints[action.key]}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {showSettings && !completed ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={() => setShowSettings(false)}
              style={styles.settingsBackdrop}
            />
            <View style={styles.settingsMenu}>
              <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
                {renderSettingSection('front', t('learn.frontOfCard'), [
                  { key: 'showPronunciation', label: t('learn.cardOpt.pronunciation') },
                  { key: 'showContext', label: t('learn.contextSentence') },
                  { key: 'showHanja', label: t('learn.cardOpt.hanja') },
                  { key: 'showRelated', label: t('hanja.relatedWords') },
                ])}
                <View style={styles.settingsDivider} />
                {renderSettingSection('back', t('learn.backOfCard'), [
                  { key: 'showPronunciation', label: t('learn.cardOpt.pronunciation') },
                  { key: 'showContext', label: t('learn.contextSentence') },
                  { key: 'showHanja', label: t('learn.cardOpt.hanja') },
                  { key: 'showRelated', label: t('hanja.relatedWords') },
                  { key: 'showDefinition', label: t('learn.definition') },
                ])}
              </ScrollView>
            </View>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  body: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.inkSlate,
  },
  progress: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  settingsBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(27, 28, 28, 0.08)',
  },
  settingsMenu: {
    position: 'absolute',
    top: 52,
    right: 12,
    width: 268,
    maxHeight: '80%',
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: '#1b1c1c',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 34,
    elevation: 10,
  },
  settingSection: {
    paddingTop: 4,
  },
  settingsSectionTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
    paddingVertical: 6,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 6,
  },
  settingRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  settingLabel: {
    flex: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  cardArea: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    shadowColor: '#1b1c1c',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 28,
    elevation: 2,
  },
  cardScroll: {
    flex: 1,
    width: '100%',
  },
  cardContent: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  word: {
    width: '100%',
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 54,
    lineHeight: 70,
    textAlign: 'center',
    color: colors.text,
    includeFontPadding: true,
  },
  wordSmall: {
    width: '100%',
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 40,
    lineHeight: 52,
    textAlign: 'center',
    color: colors.text,
    includeFontPadding: true,
  },
  pronunciation: {
    fontFamily: fontFamilies.sansRegular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 20,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  hanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 18,
    lineHeight: 26,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  definition: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 20,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'center',
  },
  contextSentence: {
    marginTop: 8,
    maxWidth: 300,
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 16,
    lineHeight: 26,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  relatedSection: {
    width: '100%',
    gap: 4,
    marginTop: 4,
  },
  relatedTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textTertiary,
  },
  relatedList: {
    width: '100%',
    gap: 2,
  },
  relatedText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
  },
  flipHint: {
    marginTop: 8,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSubtle,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  showAnswerButton: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.inkSlate,
  },
  showAnswerText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 16,
    color: colors.white,
  },
  actionButton: {
    flex: 1,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
  },
  actionLabel: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  actionHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textTertiary,
  },
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 36,
  },
  doneTitle: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'center',
  },
  doneBody: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
  },
  donePrimary: {
    marginTop: 14,
    height: 50,
    paddingHorizontal: 26,
    borderRadius: 14,
    backgroundColor: colors.inkSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donePrimaryText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 16,
    color: colors.white,
  },
  doneSecondary: {
    height: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneSecondaryText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.textSecondary,
  },
});

export default Flashcard;
