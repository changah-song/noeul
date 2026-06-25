import { USER_PREFERENCES_TABLE, supabase } from './supabase';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';

const FILE_TAG = '[preferencesCloudSync]';
const USER_PREFERENCES_SELECT = `
  user_id,
  active_profile_id,
  native_language,
  target_language,
  current_book_cloud_id,
  current_book_uri,
  reader_settings,
  flashcard_settings,
  ocr_settings,
  updated_at
`;

const firstDefined = (...values) => values.find((value) => value !== undefined);

const assertCloudWriteAllowed = ({ user, ownerId, generation }) => {
  assertCanUploadForOwner({ ownerId, user });
  if (generation != null && !isCurrentSyncGeneration(generation)) {
    throw new Error('Refusing cloud upload for stale sync generation');
  }

  return user.id;
};

const toPreferencesRow = (userId, preferences = {}) => ({
  user_id: userId,
  active_profile_id: firstDefined(preferences.active_profile_id, preferences.activeProfileId),
  native_language: firstDefined(preferences.native_language, preferences.nativeLanguage),
  target_language: firstDefined(preferences.target_language, preferences.targetLanguage),
  current_book_cloud_id: firstDefined(preferences.current_book_cloud_id, preferences.currentBookCloudId),
  current_book_uri: firstDefined(preferences.current_book_uri, preferences.currentBookUri),
  reader_settings: firstDefined(preferences.reader_settings, preferences.readerSettings),
  flashcard_settings: firstDefined(preferences.flashcard_settings, preferences.flashcardSettings),
  ocr_settings: firstDefined(preferences.ocr_settings, preferences.ocrSettings),
  updated_at: firstDefined(preferences.updated_at, preferences.updatedAt) ?? new Date().toISOString(),
});

const omitUndefined = (value) => Object.fromEntries(
  Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
);

const isMissingRpcError = (error, functionName) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes(functionName.toLowerCase());
};

const upsertUserPreferencesPatchRpc = async (patch) => {
  const { data, error } = await supabase.rpc('upsert_user_preferences_patch', { patch });

  if (error) {
    throw error;
  }

  return data;
};

export const getTimestampMs = (value) => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const fetchUserPreferences = async (userId) => {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from(USER_PREFERENCES_TABLE)
    .select(USER_PREFERENCES_SELECT)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn(`${FILE_TAG} fetchUserPreferences failed`, error);
    throw error;
  }

  return data ?? null;
};

export const upsertUserPreferences = async ({ user, ownerId, generation, preferences = {} } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = omitUndefined(toPreferencesRow(userId, preferences));

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    return await upsertUserPreferencesPatchRpc(row);
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_preferences_patch')) {
      console.warn(`${FILE_TAG} upsertUserPreferences failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_PREFERENCES_TABLE)
    .upsert(row, {
      onConflict: 'user_id',
    })
    .select(USER_PREFERENCES_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} upsertUserPreferences failed`, error);
    throw error;
  }

  return data;
};

export const updateUserPreferenceFields = async ({ user, ownerId, generation, patch = {} } = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });

  const rowPatch = omitUndefined({
    ...toPreferencesRow(userId, patch),
    user_id: undefined,
    updated_at: patch.updated_at ?? patch.updatedAt ?? new Date().toISOString(),
  });

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    return await upsertUserPreferencesPatchRpc(rowPatch);
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_preferences_patch')) {
      console.warn(`${FILE_TAG} updateUserPreferenceFields failed`, error);
      throw error;
    }
  }

  const existing = await fetchUserPreferences(userId);
  if (!existing) {
    return upsertUserPreferences({ user, ownerId, generation, preferences: patch });
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  const { data, error } = await supabase
    .from(USER_PREFERENCES_TABLE)
    .update(rowPatch)
    .eq('user_id', userId)
    .select(USER_PREFERENCES_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} updateUserPreferenceFields failed`, error);
    throw error;
  }

  return data;
};
