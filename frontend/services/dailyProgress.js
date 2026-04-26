import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dailyProgress';

const getTodayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const readStore = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[dailyProgress] Failed to read store:', error);
    return {};
  }
};

const writeStore = async (store) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('[dailyProgress] Failed to write store:', error);
  }
};

const ensureTodayEntry = (store) => {
  const key = getTodayKey();
  const today = store[key] ?? { readingMillis: 0, wordsStudied: 0 };
  return { key, today };
};

export const getTodayProgress = async () => {
  const store = await readStore();
  const { today } = ensureTodayEntry(store);
  return today;
};

export const addReadingMillis = async (millis) => {
  if (!Number.isFinite(millis) || millis <= 0) {
    return;
  }

  const store = await readStore();
  const { key, today } = ensureTodayEntry(store);
  store[key] = {
    ...today,
    readingMillis: Math.max(0, (today.readingMillis ?? 0) + millis),
  };
  await writeStore(store);
};

export const incrementWordsStudied = async (count = 1) => {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  const store = await readStore();
  const { key, today } = ensureTodayEntry(store);
  store[key] = {
    ...today,
    wordsStudied: Math.max(0, (today.wordsStudied ?? 0) + count),
  };
  await writeStore(store);
};
