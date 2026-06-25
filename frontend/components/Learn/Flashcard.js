import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { getVocabContexts } from '../../services/Database';
import {
  fetchUserPreferences,
  getTimestampMs,
  updateUserPreferenceFields,
} from '../../services/preferencesCloudSync';
import { isCurrentSyncGeneration } from '../../services/localOwnerCoordinator';
import { colors, fontFamilies, spacing, textStyles, useTheme } from '../../theme';

const STATUS_ACTIONS = [
  { key: 'bad', labelKey: 'learn.hard', tone: 'danger' },
  { key: 'mid', labelKey: 'learn.okay', tone: 'warning' },
  { key: 'good', labelKey: 'learn.easy', tone: 'success' },
];

const createToneStyles = (themeColors) => ({
  danger: {
    backgroundColor: themeColors.surface,
    color: themeColors.text,
  },
  warning: {
    backgroundColor: themeColors.surface,
    color: themeColors.text,
  },
  success: {
    backgroundColor: themeColors.surface,
    color: themeColors.text,
  },
});

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

const Flashcard = ({ vocab, index, total, onClose, onMark, user, ownerId, syncGeneration }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toneStyles = useMemo(() => createToneStyles(colors), [colors]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [flashcardSettings, setFlashcardSettings] = useState(() => createDefaultFlashcardSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [contextRows, setContextRows] = useState([]);
  const flashcardSettingsRef = useRef(createDefaultFlashcardSettings());
  const flashcardSettingsUpdatedAtRef = useRef(null);
  const flashcardSettingsCloudUserRef = useRef(null);

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
          onValueChange={(value) => updateFlashcardSetting(side, key, value)}
          trackColor={{ false: colors.surfaceStrong, true: colors.accentSoft }}
          thumbColor={enabled ? colors.accentStrong : colors.surfaceElevated}
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
              {entry.meaning ? ` - ${entry.meaning}` : ''}
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
          "{contextSentence}"
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

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Feather name="x" size={28} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={styles.deckTitle}>{t('learn.flashcard')}</Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <Text style={styles.progress}>{index + 1} / {total}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('learn.flashcardSettings')}
            onPress={() => setShowSettings((current) => !current)}
            style={[styles.settingsButton, showSettings && styles.settingsButtonActive]}
          >
            <Feather
              name="settings"
              size={19}
              color={showSettings ? colors.text : colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </View>

      {showSettings ? (
        <View style={styles.settingsMenu}>
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
        </View>
      ) : null}

      <Pressable onPress={() => setIsFlipped((prev) => !prev)} style={styles.cardArea}>
        <View style={styles.cardFace}>
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
        </View>
      </Pressable>

      <View style={styles.actions}>
        {!isFlipped ? (
          <TouchableOpacity onPress={() => setIsFlipped(true)} style={styles.showAnswerButton}>
            <Text style={styles.showAnswerText}>{t('learn.showAnswer')}</Text>
          </TouchableOpacity>
        ) : STATUS_ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.key}
            onPress={() => {
              setIsFlipped(false);
              onMark(action.key);
            }}
            style={[
              styles.actionButton,
              { backgroundColor: toneStyles[action.tone].backgroundColor },
            ]}
          >
            <Text style={[styles.actionLabel, { color: toneStyles[action.tone].color }]}>
              {t(action.labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.homeIndicator} />
    </SafeAreaView>
  );
};

const createStyles = (colors) => StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  shellContent: {
    position: 'relative',
    padding: 0,
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingHorizontal: 20,
  },
  headerSide: {
    width: 96,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    justifyContent: 'flex-end',
    gap: 8,
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  kicker: {
    ...textStyles.eyebrow,
  },
  deckTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 3.2,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    flex: 1,
    textAlign: 'center',
  },
  progress: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.transparent,
  },
  settingsButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
  },
  settingsButtonActive: {
    backgroundColor: colors.surfaceStrong,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  settingsMenu: {
    position: 'absolute',
    top: 62,
    right: 16,
    zIndex: 5,
    width: 286,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    padding: 12,
    gap: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 8,
  },
  settingsTitle: {
    ...textStyles.label,
    color: colors.text,
  },
  settingSection: {
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  settingsSectionTitle: {
    ...textStyles.eyebrow,
    color: colors.textTertiary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  settingLabel: {
    ...textStyles.caption,
    flex: 1,
    color: colors.textMuted,
  },
  cardArea: {
    flex: 1,
    marginHorizontal: 24,
    marginTop: 28,
    borderRadius: 10,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 32,
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
    gap: 10,
  },
  word: {
    width: '100%',
    fontFamily: fontFamilies.krSerifBold,
    fontSize: 60,
    lineHeight: 76,
    letterSpacing: 0,
    textAlign: 'center',
    color: colors.accent,
    includeFontPadding: true,
  },
  pronunciation: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 3,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  wordSmall: {
    width: '100%',
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 36,
    lineHeight: 46,
    letterSpacing: 0,
    textAlign: 'center',
    includeFontPadding: true,
  },
  hanja: {
    ...textStyles.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  definition: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
  },
  definitionSection: {
    width: '100%',
    alignItems: 'center',
    gap: 5,
  },
  fieldLabel: {
    ...textStyles.eyebrow,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  contextSection: {
    width: '100%',
    alignItems: 'center',
    gap: 6,
  },
  contextSentence: {
    fontFamily: fontFamilies.krSerifMedium,
    fontSize: 16,
    lineHeight: 25,
    color: colors.text,
    textAlign: 'center',
  },
  relatedSection: {
    width: '100%',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  relatedTitle: {
    ...textStyles.caption,
    textAlign: 'center',
    color: colors.textMuted,
  },
  relatedList: {
    width: '100%',
    gap: 3,
  },
  relatedText: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
  },
  flipHint: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 2.6,
    color: colors.frame,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 14,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 13,
  },
  actionLabel: {
    ...textStyles.label,
  },
  showAnswerButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  showAnswerText: {
    ...textStyles.buttonLabel,
    fontSize: 12,
    letterSpacing: 2,
  },
  homeIndicator: {
    alignSelf: 'center',
    width: 110,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 10,
  },
});

const styles = createStyles(colors);

export default Flashcard;
