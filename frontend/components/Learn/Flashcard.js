import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { Card } from '../ui';
import {
  fetchUserPreferences,
  getTimestampMs,
  updateUserPreferenceFields,
} from '../../services/preferencesCloudSync';
import { isCurrentSyncGeneration } from '../../services/localOwnerCoordinator';
import { colors, fontFamilies, radii, spacing, textStyles } from '../../theme';

const STATUS_ACTIONS = [
  { key: 'bad', label: 'Hard', tone: 'danger' },
  { key: 'mid', label: 'Okay', tone: 'warning' },
  { key: 'good', label: 'Easy', tone: 'success' },
];

const toneStyles = {
  danger: {
    backgroundColor: 'rgba(182, 79, 68, 0.12)',
    color: colors.danger,
  },
  warning: {
    backgroundColor: 'rgba(181, 118, 24, 0.12)',
    color: colors.warning,
  },
  success: {
    backgroundColor: 'rgba(47, 125, 76, 0.12)',
    color: colors.success,
  },
};

const FRONT_SETTINGS_KEY = 'flashcardFrontSettings';
const FRONT_SETTINGS_UPDATED_AT_KEY = 'flashcardFrontSettingsUpdatedAt';
const DEFAULT_FRONT_SETTINGS = {
  showHanja: false,
  showDefinition: false,
  showRelated: false,
};

const Flashcard = ({ vocab, title, index, total, onClose, onMark, user, ownerId, syncGeneration }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [frontSettings, setFrontSettings] = useState(DEFAULT_FRONT_SETTINGS);
  const [frontSettingsLoaded, setFrontSettingsLoaded] = useState(false);
  const frontSettingsRef = useRef(DEFAULT_FRONT_SETTINGS);
  const frontSettingsUpdatedAtRef = useRef(null);
  const frontSettingsCloudUserRef = useRef(null);

  const hanjaText = useMemo(
    () => (vocab?.hanja && vocab.hanja !== 'N/A' ? vocab.hanja : null),
    [vocab?.hanja]
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
        <Text style={styles.relatedTitle}>Related words you know</Text>
        <View style={styles.relatedList}>
          {relatedKnownWords.map((entry, relatedIndex) => (
            <Text
              key={`${entry.korean ?? ''}-${entry.meaning ?? ''}-${relatedIndex}`}
              numberOfLines={1}
              style={styles.relatedText}
            >
              {entry.korean || 'Related word'}{entry.meaning ? ` - ${entry.meaning}` : ''}
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
    <Card style={styles.shell} contentStyle={styles.shellContent}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>Practice</Text>
          <Text style={styles.deckTitle}>{title}</Text>
          <Text style={styles.progress}>{index + 1} of {total}</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setShowSettings((visible) => !visible)}
            style={styles.closeButton}
          >
            <Feather name="settings" size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Feather name="x" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {showSettings ? (
        <View style={styles.settingsMenu}>
          <Text style={styles.settingsTitle}>Front card</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Show Hanja</Text>
            <Switch
              value={frontSettings.showHanja}
              onValueChange={(value) => updateFrontSetting('showHanja', value)}
              trackColor={{ false: colors.surfaceStrong, true: colors.accentSoft }}
              thumbColor={frontSettings.showHanja ? colors.accentStrong : colors.surfaceElevated}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Show definition</Text>
            <Switch
              value={frontSettings.showDefinition}
              onValueChange={(value) => updateFrontSetting('showDefinition', value)}
              trackColor={{ false: colors.surfaceStrong, true: colors.accentSoft }}
              thumbColor={frontSettings.showDefinition ? colors.accentStrong : colors.surfaceElevated}
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Show related words</Text>
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
              <Text style={styles.word}>{vocab.word}</Text>
              {frontSettings.showHanja && hanjaText ? <Text style={styles.hanja}>{hanjaText}</Text> : null}
              {frontSettings.showDefinition ? <Text style={styles.definition}>{vocab.def}</Text> : null}
              {frontSettings.showRelated ? renderRelatedWords() : null}
            </>
          ) : (
            <>
              <Text style={styles.wordSmall}>{vocab.word}</Text>
              {hanjaText ? <Text style={styles.hanja}>{hanjaText}</Text> : null}
              <Text style={styles.definition}>{vocab.def}</Text>
              {renderRelatedWords()}
              <Text style={styles.flipHint}>Tap again to hide</Text>
            </>
          )}
        </View>
      </Pressable>

      <View style={styles.actions}>
        {STATUS_ACTIONS.map((action) => (
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
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.xl,
  },
  shellContent: {
    position: 'relative',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  kicker: {
    ...textStyles.eyebrow,
  },
  deckTitle: {
    ...textStyles.sectionTitle,
    fontSize: 22,
  },
  progress: {
    ...textStyles.caption,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  settingsMenu: {
    position: 'absolute',
    top: 72,
    right: spacing.lg,
    zIndex: 5,
    width: 236,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    gap: spacing.sm,
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
    minHeight: 280,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  word: {
    ...textStyles.hero,
    width: '100%',
    paddingHorizontal: spacing.xs,
    fontFamily: fontFamilies.krSerifBold,
    letterSpacing: 0,
    textAlign: 'center',
    includeFontPadding: true,
  },
  wordSmall: {
    ...textStyles.title,
    width: '100%',
    paddingHorizontal: spacing.xs,
    fontFamily: fontFamilies.krSerifMedium,
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
    ...textStyles.body,
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
    ...textStyles.caption,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
  },
  actionLabel: {
    ...textStyles.label,
  },
});

export default Flashcard;
