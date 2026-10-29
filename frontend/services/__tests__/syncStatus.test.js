import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetSyncStatus,
  describeSyncStatus,
  getSyncStatus,
  markSyncFinished,
  markSyncPending,
  markSyncStarted,
  setSyncOnline,
  setSyncOwner,
} from '../syncStatus';

describe('sync status', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetSyncStatus();
  });

  it('is nothing to sync for a guest', async () => {
    await setSyncOwner(null);
    expect(describeSyncStatus(getSyncStatus())).toBe('guest');
  });

  it('goes not synced -> syncing -> up to date', async () => {
    await setSyncOwner('user-1');
    markSyncPending();
    expect(describeSyncStatus(getSyncStatus())).toBe('pending');
    const startedAt = markSyncStarted();
    expect(describeSyncStatus(getSyncStatus())).toBe('syncing');
    markSyncFinished({ startedAt: startedAt + 1, completed: true });
    expect(describeSyncStatus(getSyncStatus())).toBe('synced');
    expect(getSyncStatus().lastSyncedAt).toBeTruthy();
  });

  it('keeps changes made during a sync as not synced', async () => {
    await setSyncOwner('user-1');
    const startedAt = markSyncStarted();
    markSyncPending(startedAt + 10);
    markSyncFinished({ startedAt, completed: true });
    expect(describeSyncStatus(getSyncStatus())).toBe('pending');
  });

  it('shows offline with waiting changes, and a failure until the next good pass', async () => {
    await setSyncOwner('user-1');
    markSyncPending();
    setSyncOnline(false);
    expect(describeSyncStatus(getSyncStatus())).toBe('offline');
    setSyncOnline(true);
    const startedAt = markSyncStarted();
    markSyncFinished({ startedAt, error: new Error('Network request failed') });
    expect(describeSyncStatus(getSyncStatus())).toBe('error');
  });

  it('remembers waiting changes across restarts', async () => {
    await setSyncOwner('user-1');
    markSyncPending();
    await new Promise((resolve) => setTimeout(resolve, 0));
    __resetSyncStatus();
    await setSyncOwner('user-1');
    expect(describeSyncStatus(getSyncStatus())).toBe('pending');
  });
});
