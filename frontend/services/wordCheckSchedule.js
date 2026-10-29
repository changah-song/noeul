import AsyncStorage from '@react-native-async-storage/async-storage';

// The word check adds evidence to the reader's level; taken over and over it
// would act like resetting the level, so it is offered once a week.
export const WORD_CHECK_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const key = (ownerId, profileId, language) => `wordCheckAt:${ownerId || 'guest'}:${profileId || ''}:${language}`;

export const recordWordCheckTaken = (ownerId, profileId, language, at = Date.now()) => (
  AsyncStorage.setItem(key(ownerId, profileId, language), String(at)).catch(() => {})
);

// Days until the word check can be taken again (0: now).
export const daysUntilWordCheck = async (ownerId, profileId, language, now = Date.now()) => {
  try {
    const last = Number(await AsyncStorage.getItem(key(ownerId, profileId, language)));
    if (!Number.isFinite(last) || last <= 0) return 0;
    return Math.max(0, Math.ceil((last + WORD_CHECK_INTERVAL_DAYS * DAY_MS - now) / DAY_MS));
  } catch {
    return 0;
  }
};
