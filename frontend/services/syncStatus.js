import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether the account has everything this phone has: Profile's "Sync" row.
//
// - `pendingSince`: the first local change (saved word, lookup, reading) the
//   account doesn't have yet. Kept across restarts, so reading offline and
//   closing the app still shows "not synced yet".
// - `syncing`: a sync pass is running.
// - `lastSyncedAt`: when the last full pass finished.
// - `lastError`: the last pass failed (cleared by the next good one).
// - `online`: from NetInfo (App.js).
//
// A pass clears `pendingSince` only for changes made before it started.

const STORAGE_KEY = 'syncStatus.v1';

let state = {
  ownerId: null,
  pendingSince: null,
  syncing: false,
  lastSyncedAt: null,
  lastError: null,
  online: true,
};
const listeners = new Set();
let saved = {};
let loading = null;

const notify = () => {
  const snapshot = getSyncStatus();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // A listener's failure doesn't stop the others.
    }
  });
};

const persist = () => {
  if (!state.ownerId) return;
  saved = {
    ...saved,
    [state.ownerId]: { pendingSince: state.pendingSince, lastSyncedAt: state.lastSyncedAt },
  };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved)).catch(() => {});
};

const set = (patch, { save = false } = {}) => {
  state = { ...state, ...patch };
  if (save) persist();
  notify();
};

export const getSyncStatus = () => ({ ...state });

export const subscribeSyncStatus = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const loadSaved = () => {
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        saved = raw ? JSON.parse(raw) || {} : {};
      })
      .catch(() => {
        saved = {};
      });
  }
  return loading;
};

// The account whose sync this is (null for a guest: nothing syncs).
export const setSyncOwner = async (ownerId) => {
  await loadSaved();
  const entry = ownerId ? saved[ownerId] || {} : {};
  set({
    ownerId: ownerId || null,
    pendingSince: entry.pendingSince ?? null,
    lastSyncedAt: entry.lastSyncedAt ?? null,
    lastError: null,
    syncing: false,
  });
};

export const markSyncPending = (at = Date.now()) => {
  if (state.pendingSince) return;
  set({ pendingSince: at }, { save: true });
};

export const markSyncStarted = () => {
  const startedAt = Date.now();
  set({ syncing: true });
  return startedAt;
};

/**
 * markSyncFinished — `completed`: the pass ran to the end; `error`: it failed.
 * Neither (skipped, e.g. paused): back to how it was.
 */
export const markSyncFinished = ({ startedAt, completed = false, error = null } = {}) => {
  if (error) {
    set({ syncing: false, lastError: String(error?.message ?? error) });
    return;
  }
  if (!completed) {
    set({ syncing: false });
    return;
  }
  const changedSince = state.pendingSince && state.pendingSince > startedAt;
  set({
    syncing: false,
    lastError: null,
    lastSyncedAt: Date.now(),
    pendingSince: changedSince ? state.pendingSince : null,
  }, { save: true });
};

export const setSyncOnline = (online) => {
  if (state.online === Boolean(online)) return;
  set({ online: Boolean(online) });
};

/**
 * describeSyncStatus — which message Profile shows: 'guest' | 'offline' |
 * 'syncing' | 'error' | 'pending' | 'synced' | 'never'.
 */
export const describeSyncStatus = (status) => {
  if (!status?.ownerId) return 'guest';
  if (status.syncing) return 'syncing';
  if (!status.online) return status.pendingSince ? 'offline' : (status.lastSyncedAt ? 'synced' : 'offline');
  if (status.lastError) return 'error';
  if (status.pendingSince) return 'pending';
  return status.lastSyncedAt ? 'synced' : 'never';
};

// For tests.
export const __resetSyncStatus = () => {
  state = { ownerId: null, pendingSince: null, syncing: false, lastSyncedAt: null, lastError: null, online: true };
  saved = {};
  loading = null;
  listeners.clear();
};
