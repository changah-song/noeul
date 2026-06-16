import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
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

const FRONT_SETTINGS_KEY = 'flashcardFrontSettings';
const FRONT_SETTINGS_UPDATED_AT_KEY = 'flashcardFrontSettingsUpdatedAt';
const DEFAULT_FRONT_SETTINGS = {
  showHanja: false,
  showDefinition: false,
  showRelated: false,
};

const Flashcard = ({ vocab, index, total, onClose, onMark, user, ownerId, syncGeneration }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toneStyles = useMemo(() => createToneStyles(colors), [colors]);
  const [isFlipped, setIsFlipped] = useState(false);
  const showSettings = false;
  const [frontSettings, setFrontSettings] = useState(DEFAULT_FRONT_SETTINGS);
  const [frontSettingsLoaded, setFrontSettingsLoaded] = useState(false);
  const frontSettingsRef = useRef(DEFAULT_FRONT_SETTINGS);
  const frontSettingsUpdatedAtRef = useRef(null);
  const frontSettingsCloudUserRef = useRef(null);

  const hanjaText = useMemo(
    () => (vocab?.hanja && vocab.hanja !== 'N/A' ? vocab.hanja : null),
    [vocab?.hanja]
  );
  const pronunciation = useMemo(
    () => (
      vocab?.romanization
      || vocab?.pronunciation
      || vocab?.pinyin
      || vocab?.ipa
      || null
    ),
    [vocab?.ipa, vocab?.pinyin, vocab?.pronunciation, vocab?.romanization]
  );
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
    frontSettingsRef.current = frontSettings;
  }, [frontSettings]);

  const persistFrontSettings = useCallback((nextSettings, updatedAt = new Date().toISOString(), options = {}) => {
    const { syncCloud = true } = options;

    frontSettingsRef.current = nextSettings;
    frontSettingsUpdatedAtRef.current = updatedAt;

    Promise.all([
      AsyncStorage.setItem(FRONT_SETTINGS_KEY, JSON.stringify(nextSettings)),
      AsyncStorage.setItem(FRONT_SETTINGS_UPDATED_AT_KEY, updatedAt),
    ]).catch(() => {});

    if (syncCloud && user?.id && ownerId === user.id) {
      updateUserPreferenceFields({
        user,
        ownerId,
        generation: syncGeneration,
        patch: {
          flashcard_settings: {
            ...nextSettings,
            updatedAt,
          },
          updated_at: updatedAt,
        },
      }).catch((error) => {
        console.warn('[Flashcard] Failed to sync front-card settings:', error?.message ?? error);
      });
    }
  }, [ownerId, syncGeneration, user]);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      AsyncStorage.getItem(FRONT_SETTINGS_KEY),
      AsyncStorage.getItem(FRONT_SETTINGS_UPDATED_AT_KEY),
    ])
      .then(([stored, storedUpdatedAt]) => {
        if (!isMounted) {
          return;
        }

        if (stored) {
          const parsed = JSON.parse(stored);
          const nextSettings = {
            ...DEFAULT_FRONT_SETTINGS,
            ...parsed,
          };
          frontSettingsRef.current = nextSettings;
          setFrontSettings(nextSettings);
        }
        frontSettingsUpdatedAtRef.current = storedUpdatedAt ?? null;
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) {
          setFrontSettingsLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!frontSettingsLoaded) {
      return;
    }

    if (!user?.id || ownerId !== user.id) {
      frontSettingsCloudUserRef.current = null;
      return;
    }

    if (frontSettingsCloudUserRef.current === user.id) {
      return;
    }

    let isMounted = true;
    frontSettingsCloudUserRef.current = user.id;

    const mergeCloudFrontSettings = async () => {
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
        const localUpdatedAt = frontSettingsUpdatedAtRef.current;

        if (hasCloudSettings && getTimestampMs(cloudUpdatedAt) > getTimestampMs(localUpdatedAt)) {
          const nextSettings = {
            ...DEFAULT_FRONT_SETTINGS,
            ...cloudSettings,
          };
          delete nextSettings.updatedAt;
          delete nextSettings.updated_at;

          if (!isMounted) {
            return;
          }

          setFrontSettings(nextSettings);
          persistFrontSettings(nextSettings, cloudUpdatedAt, { syncCloud: false });
          return;
        }

        const updatedAt = localUpdatedAt ?? new Date().toISOString();
        await updateUserPreferenceFields({
          user,
          ownerId,
          generation: syncGeneration,
          patch: {
            flashcard_settings: {
              ...frontSettingsRef.current,
              updatedAt,
            },
            updated_at: updatedAt,
          },
        });
      } catch (error) {
        frontSettingsCloudUserRef.current = null;
        console.warn('[Flashcard] Failed to merge cloud front-card settings:', error?.message ?? error);
      }
    };

    mergeCloudFrontSettings();

    return () => {
      isMounted = false;
    };
  }, [frontSettingsLoaded, ownerId, persistFrontSettings, syncGeneration, user]);

  const updateFrontSetting = (key, value) => {
    setFrontSettings((current) => {
      const next = {
        ...current,
        [key]: value,
      };
      persistFrontSettings(next);
      return next;
    });
  };

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
              {entry.korean || t('learn.relatedWord')}{entry.meaning ? ` - ${entry.meaning}` : ''}
            </Text>
          ))}
        </View>
      </View>
    );
  };

  if (!vocab) {
    return null;
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Feather name="x" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.deckTitle}>FLASHCARD</Text>
        <Text style={styles.progress}>{index + 1} / {total}</Text>
      </View>

      {showSettings ? (
        <View style={styles.settingsMenu}>
          <Text style={styles.settingsTitle}>{t('learn.frontCard')}</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('learn.showHanja')}</Text>
            <Switch
              value={frontSettings.showHanja}
              onValueChange={(value) => updateFrontSetting('showHanja', value)}
              trackColor={{ false: colors.surfaceStrong, true: colors.accentSoft }}
              thumbColor={frontSettings.showHanja ? colors.accentStrong : colors.surfaceElevated}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('learn.showDefinition')}</Text>
            <Switch
              value={frontSettings.showDefinition}
              onValueChange={(value) => updateFrontSetting('showDefinition', value)}
              trackColor={{ false: colors.surfaceStrong, true: colors.accentSoft }}
              thumbColor={frontSettings.showDefinition ? colors.accentStrong : colors.surfaceElevated}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{t('learn.showRelatedWords')}</Text>
            <Switch
              value={frontSettings.showRelated}
              onValueChange={(value) => updateFrontSetting('showRelated', value)}
              trackColor={{ false: colors.surfaceStrong, true: colors.accentSoft }}
              thumbColor={frontSettings.showRelated ? colors.accentStrong : colors.surfaceElevated}
            />
          </View>
        </View>
      ) : null}

      <Pressable onPress={() => setIsFlipped((prev) => !prev)} style={styles.cardArea}>
        <View style={styles.cardFace}>
          {!isFlipped ? (
            <>
              <View style={styles.frontCenter}>
                <Text style={styles.word}>{vocab.word}</Text>
                {pronunciation ? <Text style={styles.pronunciation}>{pronunciation}</Text> : null}
              </View>
              <Text style={styles.flipHint}>TAP TO FLIP</Text>
            </>
          ) : (
            <>
              <View style={styles.backContent}>
                <Text style={styles.wordSmall}>{vocab.word}</Text>
                {hanjaText ? <Text style={styles.hanja}>{hanjaText}</Text> : null}
                <Text style={styles.definition}>{vocab.def}</Text>
                {frontSettings.showRelated ? renderRelatedWords() : null}
              </View>
              <Text style={styles.flipHint}>{t('learn.tapAgainHide')}</Text>
            </>
          )}
        </View>
      </Pressable>

      <View style={styles.actions}>
        {!isFlipped ? (
          <TouchableOpacity onPress={() => setIsFlipped(true)} style={styles.showAnswerButton}>
            <Text style={styles.showAnswerText}>SHOW ANSWER</Text>
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
    width: 70,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  closeButton: {
    width: 70,
    height: 40,
    borderRadius: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.transparent,
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
    width: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    padding: 12,
    gap: 10,
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
  },
  frontCenter: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  backContent: {
    flex: 1,
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
