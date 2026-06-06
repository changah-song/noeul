import AsyncStorage from '@react-native-async-storage/async-storage';
import { GUEST_OWNER_ID, makeScopedStorageKey } from './localDataScope';

const LEGACY_STORAGE_KEY = 'dailyProgress';
const getDailyProgressStorageKey = (ownerId) => (
  makeScopedStorageKey(ownerId || GUEST_OWNER_ID, 'daily-progress')
);

const getTodayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const migrateLegacyDailyProgressToGuest = async () => {
  const key = getDailyProgressStorageKey(GUEST_OWNER_ID);

  try {
    const scopedRaw = await AsyncStorage.getItem(key);
    if (scopedRaw) {
      return scopedRaw;
    }

    const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      await AsyncStorage.setItem(key, legacyRaw);
      return legacyRaw;
    }
  } catch (error) {
    console.error('[dailyProgress] Failed to migrate legacy guest store:', error);
  }

  return null;
};

const readStore = async (ownerId) => {
  const resolvedOwnerId = ownerId || GUEST_OWNER_ID;
  const key = getDailyProgressStorageKey(resolvedOwnerId);

  try {
    let raw = await AsyncStorage.getItem(key);
    if (!raw && resolvedOwnerId === GUEST_OWNER_ID) {
      raw = await migrateLegacyDailyProgressToGuest();
    }

    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[dailyProgress] Failed to read store:', error);
    return {};
  }
};

const writeStore = async (ownerId, store) => {
  const key = getDailyProgressStorageKey(ownerId || GUEST_OWNER_ID);

  try {
    await AsyncStorage.setItem(key, JSON.stringify(store));
  } catch (error) {
    console.error('[dailyProgress] Failed to write store:', error);
  }
};

const ensureTodayEntry = (store) => {
  const key = getTodayKey();
  const today = store[key] ?? { readingMillis: 0, wordsStudied: 0 };
  return { key, today };
};

export const getTodayProgress = async (ownerId) => {
  const store = await readStore(ownerId);
  const { today } = ensureTodayEntry(store);
  return today;
};

export const addReadingMillis = async (ownerId, millis) => {
  if (!Number.isFinite(millis) || millis <= 0) {
    return;
  }

  const store = await readStore(ownerId);
  const { key, today } = ensureTodayEntry(store);
  store[key] = {
    ...today,
    readingMillis: Math.max(0, (today.readingMillis ?? 0) + millis),
  };
  await writeStore(ownerId, store);
};

export const incrementWordsStudied = async (ownerId, count = 1) => {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  const store = await readStore(ownerId);
  const { key, today } = ensureTodayEntry(store);
  store[key] = {
    ...today,
    wordsStudied: Math.max(0, (today.wordsStudied ?? 0) + count),
  };
  await writeStore(ownerId, store);
};
