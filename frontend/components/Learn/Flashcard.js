import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { PaperButton, PressableScale } from '../ui';
import { fadeTo, springs, springTo, useReducedMotion } from '../../theme/motion';
import { tapSelect } from '../../services/haptics';
import { getVocabContexts } from '../../services/Database';
import {
  fetchUserPreferences,
  getTimestampMs,
  updateUserPreferenceFields,
} from '../../services/preferencesCloudSync';
import { isCurrentSyncGeneration } from '../../services/localOwnerCoordinator';
import { colors, elevation, fontFamilies, spacing, textStyles, useTheme } from '../../theme';

const STATUS_ACTIONS = [
  { key: 'bad', labelKey: 'learn.hard' },
  { key: 'mid', labelKey: 'learn.okay' },
  { key: 'good', labelKey: 'learn.easy' },
];

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

/**
 * Flashcard — one review card in the practice sheet (Paper).
 *
 * Tap the card (or "Show answer") to turn it; the face that appears settles in
 * on a critically damped spring from wherever the last one left off, so rapid
 * taps re-target instead of queueing. A new card arrives from the right, the
 * way the deck advances. Reduced motion swaps both for a short fade.
 *
 * `active` is false while the sheet is closing on the last card it showed.
 */
const Flashcard = ({ vocab, title, index, total, onClose, onMark, user, ownerId, syncGeneration, active = true }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduced = useReducedMotion();
  const [isFlipped, setIsFlipped] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const faceAnim = useRef(new Animated.Value(1)).current;
  const cardEnter = useRef(new Animated.Value(1)).current;
  const settingsAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(total > 0 ? (index + 1) / total : 0)).current;
  const lastVocabRef = useRef(vocab);
  const firstFaceRef = useRef(true);
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
    if (!vocab || !active) markedVocabRef.current = null;
  }, [active, vocab]);

  // The face that appears after a flip settles in from slightly smaller.
  useEffect(() => {
    if (firstFaceRef.current) {
      firstFaceRef.current = false;
      return;
    }
    faceAnim.setValue(0);
    (reduced ? fadeTo(faceAnim, 1, { duration: 140 }) : springTo(faceAnim, 1, { spring: springs.standard })).start();
  }, [faceAnim, isFlipped, reduced]);

  // A new card comes in from the right, the way the deck moves forward.
  useEffect(() => {
    if (!vocab || lastVocabRef.current === vocab) {
      return;
    }
    lastVocabRef.current = vocab;
    cardEnter.setValue(0);
    (reduced ? fadeTo(cardEnter, 1) : springTo(cardEnter, 1, { spring: springs.move })).start();
  }, [cardEnter, reduced, vocab]);

  useEffect(() => {
    const progress = total > 0 ? Math.min(1, (index + 1) / total) : 0;
    springTo(progressAnim, progress, { spring: springs.standard, useNativeDriver: false }).start();
  }, [index, progressAnim, total]);

  // Settings popover: stays mounted while it animates out.
  useEffect(() => {
    if (showSettings) {
      setSettingsMounted(true);
      (reduced ? fadeTo(settingsAnim, 1, { duration: 140 }) : springTo(settingsAnim, 1, { spring: springs.snappy })).start();
      return;
    }
    (reduced ? fadeTo(settingsAnim, 0, { duration: 120 }) : springTo(settingsAnim, 0, { spring: springs.snappy }))
      .start(({ finished }) => {
        if (finished) setSettingsMounted(false);
      });
  }, [reduced, settingsAnim, showSettings]);

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

  const renderSettingRow = (side, key, label) => {
    const enabled = Boolean(flashcardSettings?.[side]?.[key]);

    return (
      <View key={`${side}-${key}`} style={styles.settingRow}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Switch
          value={enabled}
          accessibilityLabel={label}
          onValueChange={(value) => updateFlashcardSetting(side, key, value)}
          trackColor={{ false: colors.surfaceStrong, true: colors.tint }}
          thumbColor={enabled ? colors.glyphCream : colors.frame}
        />
      </View>
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
              {[entry.korean || t('learn.relatedWord'), entry.hanja].filter(Boolean).join(' / ')}
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
      <View style={styles.contextSection}>
        <Text style={styles.fieldLabel}>{t('learn.contextSentence')}</Text>
        <Text selectable numberOfLines={4} style={styles.contextSentence}>
          “{contextSentence}”
        </Text>
      </View>
    );
  };

  const renderDefinition = () => {
    if (!vocab?.def) {
      return null;
    }

    return (
      <View style={styles.definitionSection}>
        <Text style={styles.fieldLabel}>{t('learn.definition')}</Text>
        <Text selectable style={styles.definition}>{vocab.def}</Text>
      </View>
    );
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

  if (!vocab) {
    return null;
  }

  const grade = (status) => {
    // One grade per card: a double tap must not record twice.
    if (!active || markedVocabRef.current === vocab) return;
    markedVocabRef.current = vocab;
    tapSelect();
    setShowSettings(false);
    setIsFlipped(false);
    onMark(status);
  };

  const faceStyle = {
    opacity: faceAnim,
    transform: reduced ? [] : [{
      scale: faceAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }),
    }],
  };
  const cardStyle = {
    opacity: cardEnter,
    transform: reduced ? [] : [{
      translateX: cardEnter.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }),
    }],
  };
  const settingsStyle = {
    opacity: settingsAnim,
    transform: reduced ? [] : [
      { translateY: settingsAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
      { scale: settingsAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
    ],
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.shell}>
      <View style={styles.header}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={styles.iconButton}
        >
          <Feather name="x" size={22} color={colors.text} />
        </PressableScale>
        <View style={styles.headerCopy} accessible>
          {title ? <Text numberOfLines={1} style={styles.deckTitle}>{title}</Text> : null}
          <Text style={styles.progress}>
            {t('learn.progress', { current: index + 1, total })}
          </Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('learn.flashcardSettings')}
          accessibilityState={{ expanded: showSettings }}
          onPress={() => setShowSettings((current) => !current)}
          style={[styles.iconButton, showSettings && styles.iconButtonActive]}
        >
          <Feather name="sliders" size={19} color={showSettings ? colors.text : colors.textMuted} />
        </PressableScale>
      </View>

      <View style={styles.progressTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View
          style={[
            styles.progressFill,
            { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>

      <Animated.View style={[styles.cardWrap, cardStyle]}>
        <PressableScale
          scaleTo={0.985}
          hitSlop={0}
          onPress={() => setIsFlipped((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={isFlipped ? t('learn.tapAgainHide') : t('learn.tapToFlip')}
          style={styles.cardArea}
        >
          <Animated.View style={[styles.cardFace, faceStyle]}>
            {!isFlipped ? (
              <>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.frontCenter}
                  style={styles.cardScroll}
                >
                  <Text selectable style={styles.word}>{vocab.word}</Text>
                  {renderCardDetails('front')}
                </ScrollView>
                <Text style={styles.flipHint}>{t('learn.tapToFlip')}</Text>
              </>
            ) : (
              <>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.backContent}
                  style={styles.cardScroll}
                >
                  <Text selectable style={styles.wordSmall}>{vocab.word}</Text>
                  {renderCardDetails('back')}
                </ScrollView>
                <Text style={styles.flipHint}>{t('learn.tapAgainHide')}</Text>
              </>
            )}
          </Animated.View>
        </PressableScale>
      </Animated.View>

      <View style={styles.actions}>
        {!isFlipped ? (
          <PaperButton
            label={t('learn.showAnswer')}
            onPress={() => setIsFlipped(true)}
            style={styles.actionFull}
          />
        ) : STATUS_ACTIONS.map((action) => (
          <PaperButton
            key={action.key}
            variant="secondary"
            label={t(action.labelKey)}
            onPress={() => grade(action.key)}
            style={styles.actionButton}
          />
        ))}
      </View>

      {settingsMounted ? (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowSettings(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          />
          <Animated.View style={[styles.settingsMenu, settingsStyle]}>
            <Text style={styles.settingsTitle}>{t('learn.flashcardSettings')}</Text>
            {renderSettingSection('front', t('learn.frontCard'), [
              { key: 'showPronunciation', label: t('learn.showPronunciation') },
              { key: 'showContext', label: t('learn.showContextSentence') },
              { key: 'showHanja', label: t('learn.showHanja') },
              { key: 'showRelated', label: t('learn.showRelatedWords') },
            ])}
            {renderSettingSection('back', t('learn.backCard'), [
              { key: 'showPronunciation', label: t('learn.showPronunciation') },
              { key: 'showContext', label: t('learn.showContextSentence') },
              { key: 'showHanja', label: t('learn.showHanja') },
              { key: 'showRelated', label: t('learn.showRelatedWords') },
              { key: 'showDefinition', label: t('learn.showDefinition') },
            ])}
          </Animated.View>
        </>
      ) : null}
    </SafeAreaView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: {
    backgroundColor: colors.surfaceMuted,
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  deckTitle: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 17,
    color: colors.textMuted,
  },
  progress: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 2,
    marginHorizontal: 24,
    borderRadius: 1,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.tint,
  },
  settingsMenu: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 5,
    width: 300,
    maxWidth: '92%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    ...elevation.sheet,
  },
  settingsTitle: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 20,
    lineHeight: 26,
    color: colors.text,
  },
  settingSection: {
    gap: 2,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  settingsSectionTitle: {
    ...textStyles.eyebrow,
    color: colors.textMuted,
    marginBottom: 2,
  },
  settingRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  settingLabel: {
    flex: 1,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  cardWrap: {
    flex: 1,
    marginHorizontal: 24,
    marginTop: 20,
  },
  cardArea: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 20,
    gap: 16,
  },
  cardScroll: {
    flex: 1,
    width: '100%',
  },
  frontCenter: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  backContent: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  word: {
    width: '100%',
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 56,
    lineHeight: 74,
    letterSpacing: -0.5,
    textAlign: 'center',
    color: colors.text,
    includeFontPadding: true,
  },
  pronunciation: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  wordSmall: {
    width: '100%',
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 34,
    lineHeight: 46,
    letterSpacing: -0.3,
    textAlign: 'center',
    color: colors.text,
    includeFontPadding: true,
  },
  hanja: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 18,
    lineHeight: 26,
    color: colors.textMuted,
    textAlign: 'center',
  },
  definition: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 20,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'center',
  },
  definitionSection: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
  },
  fieldLabel: {
    ...textStyles.eyebrow,
    color: colors.textMuted,
    textAlign: 'center',
  },
  contextSection: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  contextSentence: {
    fontFamily: fontFamilies.krSerifRegular,
    fontSize: 16,
    lineHeight: 26,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  relatedSection: {
    width: '100%',
    gap: 6,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  relatedTitle: {
    ...textStyles.eyebrow,
    color: colors.textMuted,
    textAlign: 'center',
  },
  relatedList: {
    width: '100%',
    gap: 4,
  },
  relatedText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  flipHint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSubtle,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  actionFull: {
    flex: 1,
  },
  actionButton: {
    flex: 1,
    paddingHorizontal: 8,
  },
});

const styles = createStyles(colors);

export default Flashcard;
