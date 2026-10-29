import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { formatDate, getInterfaceLocale } from '../../services/interfaceLanguage';
import { describeSyncStatus, getSyncStatus, subscribeSyncStatus } from '../../services/syncStatus';
import { requestUserDataSync } from '../../services/userDataSyncQueue';

// "3:42 PM" today, "Oct 28, 3:42 PM" before.
const syncedTime = (ms) => {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  let time = '';
  try {
    time = date.toLocaleTimeString(getInterfaceLocale(), { hour: 'numeric', minute: '2-digit' });
  } catch {
    time = '';
  }
  if (date.toDateString() === new Date().toDateString()) return time;
  const day = formatDate(date, { month: 'short', day: 'numeric' });
  return time ? `${day}, ${time}` : day;
};

const ICONS = {
  synced: 'check-circle',
  pending: 'upload-cloud',
  offline: 'wifi-off',
  error: 'alert-circle',
  never: 'upload-cloud',
};

/**
 * SyncStatusRow — Profile's "Sync" row for a signed-in account: up to date
 * (and when), not synced yet, syncing, offline (it will sync when connected),
 * or failed. Tapping it syncs now. Nothing for a guest (nothing syncs).
 */
const SyncStatusRow = ({ styles, profileColors, showDivider, dividerBelow }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState(getSyncStatus);
  useEffect(() => subscribeSyncStatus(setStatus), []);

  const kind = describeSyncStatus(status);
  if (kind === 'guest') return null;

  const value = {
    syncing: t('sync.syncing'),
    synced: status.lastSyncedAt
      ? t('sync.syncedAt', { time: syncedTime(status.lastSyncedAt) })
      : t('sync.synced'),
    pending: t('sync.pending'),
    // Offline still says when the account last had everything.
    offline: status.lastSyncedAt
      ? t('sync.offlineSince', { time: syncedTime(status.lastSyncedAt) })
      : t('sync.offline'),
    error: t('sync.error'),
    never: t('sync.never'),
  }[kind];
  const attention = kind === 'pending' || kind === 'error' || kind === 'never';
  const canSync = kind !== 'syncing' && kind !== 'offline';

  return (
    <>
      {showDivider ? <View style={styles.rowDivider} /> : null}
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={!canSync}
        onPress={() => requestUserDataSync('manual')}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${t('sync.title')}, ${value}`}
        accessibilityHint={canSync ? t('sync.now') : undefined}
        accessibilityState={{ busy: kind === 'syncing', disabled: !canSync }}
      >
        <Feather name="refresh-cw" size={18} color={profileColors.body} />
        <Text style={[styles.rowLabel, styles.rowLabelFlex]} numberOfLines={1}>{t('sync.title')}</Text>
        <Text
          style={[styles.rowValue, { maxWidth: '62%' }, attention && { color: profileColors.ink }]}
          numberOfLines={2}
        >
          {value}
        </Text>
        {kind === 'syncing' ? (
          <ActivityIndicator size="small" color={profileColors.faint} />
        ) : (
          <Feather name={ICONS[kind]} size={16} color={attention ? profileColors.ink : profileColors.faint} />
        )}
      </TouchableOpacity>
      {dividerBelow ? <View style={styles.rowDivider} /> : null}
    </>
  );
};

export default SyncStatusRow;
