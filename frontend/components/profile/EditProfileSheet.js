import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import SheetModal from './SheetModal';
import { Press } from '../ui';
import { useBooks } from '../../contexts/BooksContext';
import {
  AVATAR_PRESETS,
  AVATAR_PRESET_KEYS,
  DEFAULT_AVATAR_PRESET,
  getAvatarGradient,
} from '../../constants/avatarPresets';
import { elevation, radii, useTheme } from '../../theme/tokens';
import { fontFamilies } from '../../theme/typography';
import { spacing, insets } from '../../theme/spacing';

// Edit profile — rename + pick one of five gradient avatar fields, each
// previewing the first letter of the (live-edited) username.
const EditProfileSheet = ({ visible, onClose }) => {
  const { colors, isDarkMode } = useTheme();
  const { user, updateProfile } = useBooks();

  const [name, setName] = useState('');
  const [presetKey, setPresetKey] = useState(DEFAULT_AVATAR_PRESET);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const meta = user?.user_metadata ?? {};
    setName(
      meta.username
        ?? meta.display_name
        ?? meta.full_name
        ?? user?.email?.split('@')[0]
        ?? ''
    );
    setPresetKey(AVATAR_PRESETS[meta.avatar_preset] ? meta.avatar_preset : DEFAULT_AVATAR_PRESET);
  }, [visible, user]);

  const trimmed = name.trim();
  const letter = (trimmed.charAt(0) || '?').toUpperCase();
  const canSave = trimmed.length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!trimmed) return;
    setSaving(true);
    try {
      await updateProfile({
        username: trimmed,
        display_name: trimmed,
        avatar_preset: presetKey,
      });
      onClose?.();
    } catch (error) {
      Alert.alert('Could not save profile', error?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [trimmed, presetKey, updateProfile, onClose]);

  return (
    <SheetModal visible={visible} onClose={onClose} title="Edit profile">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Username</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Your name"
          placeholderTextColor={colors.textSubtle}
          maxLength={24}
          autoCorrect={false}
          returnKeyType="done"
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.surfaceGlass,
              borderColor: focused ? colors.accent : colors.borderStrong,
            },
          ]}
        />

        <Text style={[styles.fieldLabel, styles.avatarLabel, { color: colors.textMuted }]}>
          Profile image
        </Text>
        <View style={styles.presetRow}>
          {AVATAR_PRESET_KEYS.map((key) => {
            const preset = AVATAR_PRESETS[key];
            const selected = key === presetKey;
            return (
              <Press
                key={key}
                onPress={() => setPresetKey(key)}
                style={[
                  styles.presetRing,
                  { borderColor: selected ? colors.accent : 'transparent' },
                ]}
              >
                <LinearGradient
                  colors={getAvatarGradient(preset, isDarkMode)}
                  start={{ x: 0.2, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={[styles.presetCircle, selected && elevation.fab]}
                >
                  <Text style={[styles.presetLetter, { color: preset.letter }]}>{letter}</Text>
                </LinearGradient>
              </Press>
            );
          })}
        </View>

        <Press onPress={handleSave} disabled={!canSave}>
          <LinearGradient
            colors={getAvatarGradient(AVATAR_PRESETS.sunset, isDarkMode)}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={[styles.saveBtn, elevation.fab, !canSave && styles.saveBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnLabel}>Save changes</Text>
            )}
          </LinearGradient>
        </Press>
      </ScrollView>
    </SheetModal>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxxl,
  },
  fieldLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  input: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  avatarLabel: {
    marginTop: spacing.xl,
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xxs,
  },
  presetRing: {
    borderWidth: 2,
    borderRadius: 33,
    padding: 3,
  },
  presetCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetLetter: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 24,
  },
  saveBtn: {
    height: 46,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xxl,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});

export default EditProfileSheet;
