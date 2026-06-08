import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  assignUnscopedSqliteUserDataToGuest,
  clearSqliteUserData,
  clearUnscopedSqliteUserData,
  hasSqliteUserData,
  hasUnscopedSqliteUserData,
  initAllTables,
  reassignSqliteUserData,
} from './Database';
import { GUEST_OWNER_ID, makeScopedStorageKey } from './localDataScope';
import {
  isSongStorageLimitError,
  serializeSongsForStorage,
} from './songStorageLimits';

export const LOCAL_OWNER_MIGRATION_KEY = '@ff/local-owner-migration-v1';

const LEGACY_KEYS = {
  books: '@ff/books',
  currentBook: '@ff/current-book',
  currentBookMeta: '@ff/current-book-meta',
  songs: 'manualSongs',
  writing: 'writing_entries_v1',
  dailyProgress: 'dailyProgress',
};

const LEGACY_TO_SCOPED_STORAGE_KEYS = [
  { legacyName: 'books', scopedName: 'books', type: 'array' },
  { legacyName: 'currentBook', scopedName: 'current-book', type: 'target-preferred' },
  { legacyName: 'currentBookMeta', scopedName: 'current-book-meta', type: 'target-preferred' },
  { legacyName: 'songs', scopedName: 'manual-songs', type: 'array' },
  { legacyName: 'writing', scopedName: 'writing-entries-v1', type: 'array' },
  { legacyName: 'dailyProgress', scopedName: 'daily-progress', type: 'object' },
];

const isMeaningfulStorageValue = (value) => (
  Boolean(value) && value !== '[]' && value !== '{}'
);

const normalizeOwnerId = (ownerId = GUEST_OWNER_ID) => {
  const normalized = typeof ownerId === 'string' ? ownerId.trim() : '';
  return normalized || GUEST_OWNER_ID;
};

const requireUserId = (userId) => {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new Error('A user id is required for this legacy migration decision');
  }

  return userId.trim();
};

const getMigrationDone = async () => (
  await AsyncStorage.getItem(LOCAL_OWNER_MIGRATION_KEY)
) === 'done';

const setMigrationDone = async () => {
  await AsyncStorage.setItem(LOCAL_OWNER_MIGRATION_KEY, 'done');
};

const getLegacyStoragePairs = async () => {
  const legacyKeys = LEGACY_TO_SCOPED_STORAGE_KEYS.map(({ legacyName }) => LEGACY_KEYS[legacyName]);
  return AsyncStorage.multiGet(legacyKeys);
};

const parseJsonStore = (key, rawValue, fallback) => {
  if (!isMeaningfulStorageValue(rawValue)) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`Unable to migrate legacy ${key} storage because it contains invalid JSON`);
  }
};

const getStableArrayItemKey = (item) => {
  if (!item || typeof item !== 'object') {
    return `primitive:${String(item)}`;
  }

  const candidates = [
    item.uri,
    item.id,
    item.cloudId,
    item.entryId,
    item.key,
    item.createdAt,
  ];
  const stableValue = candidates.find((value) => (
    typeof value === 'string' && value.trim()
  ));

  return stableValue || JSON.stringify(item);
};

const mergeArrayStorage = (scopedName, legacyRaw, targetRaw) => {
  const legacyItems = parseJsonStore(scopedName, legacyRaw, []);
  const targetItems = parseJsonStore(scopedName, targetRaw, []);

  if (!Array.isArray(legacyItems) || !Array.isArray(targetItems)) {
    throw new Error(`Unable to merge legacy ${scopedName} storage because it is not an array`);
  }

  const seen = new Set();
  const merged = [];
  [...targetItems, ...legacyItems].forEach((item) => {
    const stableKey = getStableArrayItemKey(item);
    if (seen.has(stableKey)) {
      return;
    }

    seen.add(stableKey);
    merged.push(item);
  });

  return JSON.stringify(merged);
};

const mergeObjectStorage = (scopedName, legacyRaw, targetRaw) => {
  const legacyObject = parseJsonStore(scopedName, legacyRaw, {});
  const targetObject = parseJsonStore(scopedName, targetRaw, {});

  if (
    !legacyObject
    || !targetObject
    || Array.isArray(legacyObject)
    || Array.isArray(targetObject)
    || typeof legacyObject !== 'object'
    || typeof targetObject !== 'object'
  ) {
    throw new Error(`Unable to merge legacy ${scopedName} storage because it is not an object`);
  }

  return JSON.stringify({
    ...legacyObject,
    ...targetObject,
  });
};

const getScopedStorageValueForLegacy = ({ scopedName, type }, legacyRaw, targetRaw) => {
  const hasLegacy = isMeaningfulStorageValue(legacyRaw);
  const hasTarget = isMeaningfulStorageValue(targetRaw);

  if (!hasLegacy) {
    return { value: null, conflict: false };
  }

  if (!hasTarget) {
    return { value: legacyRaw, conflict: false };
  }

  if (type === 'array') {
    return { value: mergeArrayStorage(scopedName, legacyRaw, targetRaw), conflict: false };
  }

  if (type === 'object') {
    return { value: mergeObjectStorage(scopedName, legacyRaw, targetRaw), conflict: false };
  }

  return { value: null, conflict: true };
};

const prepareScopedStorageWrite = (entry, value) => {
  if (entry.scopedName !== 'manual-songs' || value == null) {
    return value;
  }

  const songs = parseJsonStore(entry.scopedName, value, []);
  if (!Array.isArray(songs)) {
    throw new Error('Unable to migrate legacy manual-songs storage because it is not an array');
  }

  return serializeSongsForStorage(songs);
};

const copyLegacyStorageToOwner = async (ownerId) => {
  const scopedOwnerId = normalizeOwnerId(ownerId);
  const legacyPairs = await getLegacyStoragePairs();
  const legacyValueByKey = new Map(legacyPairs);
  const scopedKeys = LEGACY_TO_SCOPED_STORAGE_KEYS.map(({ scopedName }) => (
    makeScopedStorageKey(scopedOwnerId, scopedName)
  ));
  const scopedPairs = await AsyncStorage.multiGet(scopedKeys);
  const scopedValueByKey = new Map(scopedPairs);
  const writes = [];
  const conflicts = [];

  LEGACY_TO_SCOPED_STORAGE_KEYS.forEach((entry) => {
    const legacyKey = LEGACY_KEYS[entry.legacyName];
    const scopedKey = makeScopedStorageKey(scopedOwnerId, entry.scopedName);
    const legacyRaw = legacyValueByKey.get(legacyKey) ?? null;
    const scopedRaw = scopedValueByKey.get(scopedKey) ?? null;
    const { value, conflict } = getScopedStorageValueForLegacy(entry, legacyRaw, scopedRaw);

    if (conflict) {
      conflicts.push({
        legacyKey,
        scopedKey,
      });
      return;
    }

    if (value !== null) {
      try {
        writes.push([scopedKey, prepareScopedStorageWrite(entry, value)]);
      } catch (error) {
        if (!isSongStorageLimitError(error)) {
          throw error;
        }

        console.warn('[localOwnerMigration] Skipping oversized legacy songs:', error.message);
        conflicts.push({
          legacyKey,
          scopedKey,
          reason: 'storage-limit',
          message: error.message,
        });
      }
    }
  });

  if (writes.length > 0) {
    await AsyncStorage.multiSet(writes);
  }

  return {
    copiedKeys: writes.map(([key]) => key),
    conflicts,
  };
};

export const hasLegacyUnscopedData = async () => {
  await initAllTables();

  const legacyPairs = await getLegacyStoragePairs();
  const hasLegacyStorage = legacyPairs.some(([, value]) => isMeaningfulStorageValue(value));

  if (hasLegacyStorage) {
    return true;
  }

  if (await hasUnscopedSqliteUserData()) {
    return true;
  }

  if (!(await getMigrationDone())) {
    return hasSqliteUserData(GUEST_OWNER_ID);
  }

  return false;
};

export const migrateLegacyDataToGuest = async () => {
  await initAllTables();

  const storageResult = await copyLegacyStorageToOwner(GUEST_OWNER_ID);
  await assignUnscopedSqliteUserDataToGuest();
  await setMigrationDone();

  return {
    migrationDone: true,
    ownerId: GUEST_OWNER_ID,
    ...storageResult,
  };
};

export const getLegacyMigrationStatus = async ({ user } = {}) => {
  if (await getMigrationDone()) {
    return {
      migrationDone: true,
      hasLegacyData: false,
      requiresDecision: false,
    };
  }

  const hasLegacyData = await hasLegacyUnscopedData();

  if (!hasLegacyData) {
    await setMigrationDone();
    return {
      migrationDone: true,
      hasLegacyData: false,
      requiresDecision: false,
    };
  }

  if (!user?.id) {
    await migrateLegacyDataToGuest();
    return {
      migrationDone: true,
      hasLegacyData: true,
      requiresDecision: false,
    };
  }

  return {
    migrationDone: false,
    hasLegacyData: true,
    requiresDecision: true,
  };
};

export const applyLegacyMigrationDecision = async ({ decision, userId } = {}) => {
  await initAllTables();

  if (decision === 'import-to-account') {
    const targetUserId = requireUserId(userId);
    const storageResult = await copyLegacyStorageToOwner(targetUserId);
    await assignUnscopedSqliteUserDataToGuest();
    await reassignSqliteUserData(GUEST_OWNER_ID, targetUserId);
    await setMigrationDone();
    return {
      decision,
      migrationDone: true,
      ownerId: targetUserId,
      ...storageResult,
    };
  }

  if (decision === 'keep-as-guest') {
    return {
      decision,
      ...await migrateLegacyDataToGuest(),
    };
  }

  if (decision === 'discard') {
    await AsyncStorage.multiRemove(Object.values(LEGACY_KEYS));
    await clearUnscopedSqliteUserData();

    if (!(await getMigrationDone())) {
      await clearSqliteUserData(GUEST_OWNER_ID);
    }

    await setMigrationDone();
    return {
      decision,
      migrationDone: true,
      ownerId: null,
      copiedKeys: [],
      conflicts: [],
    };
  }

  throw new Error(`Unsupported legacy migration decision: ${decision}`);
};
