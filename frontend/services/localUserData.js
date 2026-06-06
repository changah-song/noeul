import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import {
  clearSqliteUserData,
  hasSqliteUserData,
  reassignSqliteUserData,
} from './Database';
import {
  GUEST_OWNER_ID,
  makeOwnerDataDirectory,
  makeScopedStorageKey,
} from './localDataScope';

const USER_STORAGE_KEYS = [
  'books',
  'current-book',
  'current-book-meta',
  'manual-songs',
  'writing-entries-v1',
  'daily-progress',
];

const ARRAY_STORAGE_KEYS = new Set([
  'books',
  'manual-songs',
  'writing-entries-v1',
]);

const OBJECT_STORAGE_KEYS = new Set([
  'daily-progress',
]);

const TARGET_PREFERRED_STORAGE_KEYS = new Set([
  'current-book',
  'current-book-meta',
]);

const normalizeOwnerId = (ownerId = GUEST_OWNER_ID) => {
  const normalized = typeof ownerId === 'string' ? ownerId.trim() : '';
  return normalized || GUEST_OWNER_ID;
};

const requireTargetOwnerId = (ownerId) => {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new Error('A target owner id is required to reassign local user data');
  }

  return normalizeOwnerId(ownerId);
};

const isMeaningfulStorageValue = (value) => {
  if (!value) {
    return false;
  }

  return value !== '[]' && value !== '{}';
};

const parseJsonStore = (key, rawValue, fallback) => {
  if (!isMeaningfulStorageValue(rawValue)) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`Unable to merge local ${key} storage because it contains invalid JSON`);
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

  if (stableValue) {
    return stableValue;
  }

  return JSON.stringify(item);
};

const mergeArrayStorage = (key, sourceRaw, targetRaw) => {
  const sourceItems = parseJsonStore(key, sourceRaw, []);
  const targetItems = parseJsonStore(key, targetRaw, []);

  if (!Array.isArray(sourceItems) || !Array.isArray(targetItems)) {
    throw new Error(`Unable to merge local ${key} storage because it is not an array`);
  }

  const seen = new Set();
  const merged = [];

  [...targetItems, ...sourceItems].forEach((item) => {
    const stableKey = getStableArrayItemKey(item);
    if (seen.has(stableKey)) {
      return;
    }

    seen.add(stableKey);
    merged.push(item);
  });

  return JSON.stringify(merged);
};

const mergeObjectStorage = (key, sourceRaw, targetRaw) => {
  const sourceObject = parseJsonStore(key, sourceRaw, {});
  const targetObject = parseJsonStore(key, targetRaw, {});

  if (
    !sourceObject
    || !targetObject
    || Array.isArray(sourceObject)
    || Array.isArray(targetObject)
    || typeof sourceObject !== 'object'
    || typeof targetObject !== 'object'
  ) {
    throw new Error(`Unable to merge local ${key} storage because it is not an object`);
  }

  return JSON.stringify({
    ...sourceObject,
    ...targetObject,
  });
};

const getMergedStorageValue = (key, sourceRaw, targetRaw) => {
  const hasSource = isMeaningfulStorageValue(sourceRaw);
  const hasTarget = isMeaningfulStorageValue(targetRaw);

  if (!hasSource) {
    return null;
  }

  if (!hasTarget) {
    return sourceRaw;
  }

  if (ARRAY_STORAGE_KEYS.has(key)) {
    return mergeArrayStorage(key, sourceRaw, targetRaw);
  }

  if (OBJECT_STORAGE_KEYS.has(key)) {
    return mergeObjectStorage(key, sourceRaw, targetRaw);
  }

  if (TARGET_PREFERRED_STORAGE_KEYS.has(key)) {
    return null;
  }

  throw new Error(`Refusing to overwrite local ${key} storage for target owner`);
};

export const getOwnerStorageKeys = (ownerId = GUEST_OWNER_ID) =>
  USER_STORAGE_KEYS.map((key) => makeScopedStorageKey(normalizeOwnerId(ownerId), key));

export const getOwnerDataDirectoryUri = (ownerId = GUEST_OWNER_ID) => (
  `${FileSystem.documentDirectory}${makeOwnerDataDirectory(normalizeOwnerId(ownerId))}`
);

export const clearLocalUserFiles = async (ownerId = GUEST_OWNER_ID) => {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const ownerDirectory = getOwnerDataDirectoryUri(ownerId);
  const info = await FileSystem.getInfoAsync(ownerDirectory);

  if (!info.exists) {
    return;
  }

  await FileSystem.deleteAsync(ownerDirectory, { idempotent: true });
};

export const readOwnerStorageState = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = normalizeOwnerId(ownerId);

  return {
    booksRaw: await AsyncStorage.getItem(makeScopedStorageKey(scopedOwnerId, 'books')),
    currentBook: await AsyncStorage.getItem(makeScopedStorageKey(scopedOwnerId, 'current-book')),
    currentBookMetaRaw: await AsyncStorage.getItem(makeScopedStorageKey(scopedOwnerId, 'current-book-meta')),
    songsRaw: await AsyncStorage.getItem(makeScopedStorageKey(scopedOwnerId, 'manual-songs')),
    writingRaw: await AsyncStorage.getItem(makeScopedStorageKey(scopedOwnerId, 'writing-entries-v1')),
    dailyProgressRaw: await AsyncStorage.getItem(makeScopedStorageKey(scopedOwnerId, 'daily-progress')),
  };
};

export const hasLocalUserData = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = normalizeOwnerId(ownerId);
  const pairs = await AsyncStorage.multiGet(getOwnerStorageKeys(scopedOwnerId));
  const hasStorageData = pairs.some(([, value]) => isMeaningfulStorageValue(value));

  if (hasStorageData) {
    return true;
  }

  return hasSqliteUserData(scopedOwnerId);
};

export const clearLocalUserData = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = normalizeOwnerId(ownerId);
  await AsyncStorage.multiRemove(getOwnerStorageKeys(scopedOwnerId));
  await clearSqliteUserData(scopedOwnerId);
  await clearLocalUserFiles(scopedOwnerId);
};

export const reassignLocalUserData = async (fromOwnerId = GUEST_OWNER_ID, toOwnerId) => {
  const sourceOwnerId = normalizeOwnerId(fromOwnerId);
  const targetOwnerId = requireTargetOwnerId(toOwnerId);

  if (sourceOwnerId === targetOwnerId) {
    return;
  }

  if (await hasSqliteUserData(targetOwnerId)) {
    throw new Error('Refusing to reassign local user data because target owner already has SQLite rows');
  }

  const sourceKeys = getOwnerStorageKeys(sourceOwnerId);
  const targetKeys = getOwnerStorageKeys(targetOwnerId);
  const [sourcePairs, targetPairs] = await Promise.all([
    AsyncStorage.multiGet(sourceKeys),
    AsyncStorage.multiGet(targetKeys),
  ]);
  const targetValueByKey = new Map(targetPairs);
  const writes = [];
  const sourceKeysToRemove = [];

  USER_STORAGE_KEYS.forEach((storageKey, index) => {
    const sourceKey = sourceKeys[index];
    const targetKey = targetKeys[index];
    const sourceRaw = sourcePairs[index]?.[1] ?? null;
    const targetRaw = targetValueByKey.get(targetKey) ?? null;

    if (sourceRaw !== null) {
      sourceKeysToRemove.push(sourceKey);
    }

    const mergedValue = getMergedStorageValue(storageKey, sourceRaw, targetRaw);
    if (mergedValue !== null) {
      writes.push([targetKey, mergedValue]);
    }
  });

  if (writes.length > 0) {
    await AsyncStorage.multiSet(writes);
  }

  await reassignSqliteUserData(sourceOwnerId, targetOwnerId);

  if (sourceKeysToRemove.length > 0) {
    await AsyncStorage.multiRemove(sourceKeysToRemove);
  }
};
