import AsyncStorage from '@react-native-async-storage/async-storage';

// Word goals the reader has reached (Profile's level card): a congratulations
// when the estimate passes the next one, and a flag on the chart that day.
// The first time it is seen the current goal is the baseline (nothing to
// celebrate yet); only goals passed after that count.

const key = (ownerId, profileId, language) => `levelMilestones:${ownerId || 'guest'}:${profileId || ''}:${language}`;

export const loadMilestones = async (ownerId, profileId, language) => {
  try {
    const raw = await AsyncStorage.getItem(key(ownerId, profileId, language));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      baseline: Number(parsed.baseline) || 0,
      reached: Array.isArray(parsed.reached) ? parsed.reached : [],
      celebrated: Number(parsed.celebrated) || 0,
    };
  } catch {
    return null;
  }
};

const save = (ownerId, profileId, language, value) => (
  AsyncStorage.setItem(key(ownerId, profileId, language), JSON.stringify(value)).catch(() => {})
);

/**
 * recordGoal — given the goal the estimate has now passed, the updated
 * record and, if it is a new one, `newGoal` (to celebrate).
 */
export const recordGoal = async (ownerId, profileId, language, reachedGoal, at = new Date().toISOString()) => {
  const current = await loadMilestones(ownerId, profileId, language);
  if (!current) {
    const first = { baseline: reachedGoal, reached: [], celebrated: reachedGoal };
    await save(ownerId, profileId, language, first);
    return { record: first, newGoal: null };
  }
  const best = Math.max(current.baseline, ...current.reached.map((item) => Number(item.words) || 0));
  if (reachedGoal <= best) return { record: current, newGoal: null };
  const record = { ...current, reached: [...current.reached, { words: reachedGoal, at }] };
  await save(ownerId, profileId, language, record);
  return { record, newGoal: reachedGoal > current.celebrated ? reachedGoal : null };
};

// The congratulations was seen (closed): it doesn't show again.
export const markGoalCelebrated = async (ownerId, profileId, language, goal) => {
  const current = await loadMilestones(ownerId, profileId, language);
  if (!current || goal <= current.celebrated) return;
  await save(ownerId, profileId, language, { ...current, celebrated: goal });
};
