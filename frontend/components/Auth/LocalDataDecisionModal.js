import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radii, spacing, textStyles } from '../../theme';
import { useTranslation } from '../../hooks/useTranslation';

const DECISION_CONTENT = {
  'legacy-signed-in': {
    titleKey: 'localData.legacyTitle',
    bodyKey: 'localData.legacyBody',
    actions: [
      { action: 'import-to-account', labelKey: 'localData.importAccount', tone: 'primary' },
      { action: 'keep-as-guest', labelKey: 'localData.keepGuest', tone: 'secondary' },
      { action: 'discard', labelKey: 'localData.discard', tone: 'danger' },
    ],
  },
  'guest-signup-empty-remote': {
    titleKey: 'localData.saveProgressTitle',
    bodyKey: 'localData.saveProgressBody',
    actions: [
      { action: 'save-progress', labelKey: 'localData.saveProgress', tone: 'primary' },
      { action: 'start-fresh', labelKey: 'localData.startFresh', tone: 'secondary' },
    ],
  },
  'guest-login-existing-remote': {
    titleKey: 'localData.offlineFoundTitle',
    bodyKey: 'localData.offlineFoundBody',
    actions: [
      { action: 'merge', labelKey: 'localData.merge', tone: 'primary' },
      { action: 'discard', labelKey: 'localData.discard', tone: 'danger' },
    ],
  },
};

const getContent = (decision) => (
  DECISION_CONTENT[decision?.type] ?? {
    titleKey: 'localData.reviewTitle',
    bodyKey: 'localData.reviewBody',
    actions: [],
  }
);

const LocalDataDecisionModal = ({
  decision,
  user,
  onResolve,
  onCancel,
  busy = false,
}) => {
  const { t } = useTranslation();
  const visible = Boolean(decision);
  const content = getContent(decision);
  const email = user?.email || user?.user_metadata?.email || '';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => {
        if (!busy) {
          onCancel?.();
        }
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t(content.titleKey)}</Text>
          {email ? <Text style={styles.account}>{email}</Text> : null}
          <Text style={styles.body}>{t(content.bodyKey)}</Text>

          <View style={styles.actions}>
            {content.actions.map((item) => (
              <Pressable
                key={item.action}
                disabled={busy}
                onPress={() => onResolve?.(item.action)}
                style={({ pressed }) => [
                  styles.button,
                  item.tone === 'primary' && styles.primaryButton,
                  item.tone === 'danger' && styles.dangerButton,
                  item.tone === 'secondary' && styles.secondaryButton,
                  pressed && !busy && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    item.tone === 'primary' && styles.primaryButtonText,
                    item.tone === 'danger' && styles.dangerButtonText,
                  ]}
                >
                  {t(item.labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={colors.accentStrong} />
              <Text style={styles.busyText}>{t('localData.resolving')}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 27, 22, 0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 430,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...textStyles.sectionTitle,
    color: colors.text,
  },
  account: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
  body: {
    ...textStyles.body,
    color: colors.textMuted,
    lineHeight: 22,
  },
  actions: {
    gap: spacing.sm,
  },
  button: {
    minHeight: 46,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  primaryButton: {
    backgroundColor: colors.accentSoft,
    borderColor: 'transparent',
  },
  secondaryButton: {
    backgroundColor: colors.surfaceMuted,
  },
  dangerButton: {
    backgroundColor: '#fff1ef',
    borderColor: '#efc0b8',
  },
  buttonText: {
    ...textStyles.label,
    color: colors.text,
  },
  primaryButtonText: {
    color: colors.accentStrong,
  },
  dangerButtonText: {
    color: '#a64234',
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.6,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  busyText: {
    ...textStyles.caption,
    color: colors.textMuted,
  },
});

export default LocalDataDecisionModal;
