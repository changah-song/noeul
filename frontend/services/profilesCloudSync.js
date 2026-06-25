import {
  getLanguageLabel,
  normalizeChineseScript,
  normalizeLanguageCode,
} from '../constants/languages';
import { USER_PREFERENCES_TABLE, USER_PROFILES_TABLE, supabase } from './supabase';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';

const FILE_TAG = '[profilesCloudSync]';
const USER_PROFILE_SELECT_BASE = `
  id,
  user_id,
  target_language,
  display_name,
  created_at,
  updated_at
`;
const USER_PROFILE_SELECT = `
  id,
  user_id,
  target_language,
  script,
  display_name,
  created_at,
  updated_at
`;

const isMissingScriptColumnError = (error) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === '42703'
    || error?.code === 'PGRST204'
    || (message.includes('script') && message.includes('column'));
};

const assertCloudWriteAllowed = ({ user, ownerId, generation }) => {
  assertCanUploadForOwner({ ownerId, user });
  if (generation != null && !isCurrentSyncGeneration(generation)) {
    throw new Error('Refusing cloud upload for stale sync generation');
  }

  return user.id;
};

const omitUndefined = (value) => Object.fromEntries(
  Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
);

const isMissingRpcError = (error, functionName) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes(functionName.toLowerCase());
};

const isAmbiguousEnsureProfileRpcError = (error) => {
  const message = String(error?.message ?? error?.details ?? '').toLowerCase();
  return error?.code === '42702'
    && message.includes('target_language')
    && message.includes('ambiguous');
};

const toProfileRow = (userId, profile = {}) => {
  const targetLanguage = normalizeLanguageCode(
    profile.target_language ?? profile.targetLanguage
  );

  return omitUndefined({
    user_id: userId,
    target_language: targetLanguage,
    script: targetLanguage === 'zh'
      ? normalizeChineseScript(profile.script ?? profile.chineseScript)
      : undefined,
    display_name: profile.display_name
      ?? profile.displayName
      ?? getLanguageLabel(targetLanguage),
    updated_at: profile.updated_at ?? profile.updatedAt ?? new Date().toISOString(),
  });
};

const ensureUserProfileRpc = async ({
  targetLanguage,
  script,
  displayName,
  makeActive = false,
} = {}) => {
  const { data, error } = await supabase.rpc('ensure_user_profile', {
    target_language: targetLanguage,
    script: script ?? null,
    display_name: displayName ?? null,
    make_active: makeActive,
  });

  if (error) {
    throw error;
  }

  return data;
};

export const fetchUserProfiles = async (userId) => {
  if (!userId) {
    return [];
  }

  let { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .select(USER_PROFILE_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error && isMissingScriptColumnError(error)) {
    ({ data, error } = await supabase
      .from(USER_PROFILES_TABLE)
      .select(USER_PROFILE_SELECT_BASE)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }));
  }

  if (error) {
    console.warn(`${FILE_TAG} fetchUserProfiles failed`, error);
    throw error;
  }

  return data ?? [];
};

export const upsertUserProfile = async ({
  user,
  ownerId,
  generation,
  targetLanguage,
  script,
  displayName,
} = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toProfileRow(userId, {
    targetLanguage,
    script,
    displayName,
  });

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    return await ensureUserProfileRpc({
      targetLanguage: row.target_language,
      script: row.script,
      displayName: row.display_name,
    });
  } catch (error) {
    if (
      !isMissingRpcError(error, 'ensure_user_profile')
      && !isMissingScriptColumnError(error)
      && !isAmbiguousEnsureProfileRpcError(error)
    ) {
      console.warn(`${FILE_TAG} upsertUserProfile failed`, error);
      throw error;
    }
  }

  let { data, error } = await supabase
    .from(USER_PROFILES_TABLE)
    .upsert(row, {
      onConflict: 'user_id,target_language',
    })
    .select(USER_PROFILE_SELECT)
    .single();

  if (error && isMissingScriptColumnError(error)) {
    const fallbackRow = { ...row };
    delete fallbackRow.script;
    ({ data, error } = await supabase
      .from(USER_PROFILES_TABLE)
      .upsert(fallbackRow, {
        onConflict: 'user_id,target_language',
      })
      .select(USER_PROFILE_SELECT_BASE)
      .single());
  }

  if (error) {
    console.warn(`${FILE_TAG} upsertUserProfile failed`, error);
    throw error;
  }

  return data;
};

export const setActiveProfile = async ({
  user,
  ownerId,
  generation,
  profileId,
} = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    const { data, error } = await supabase.rpc('upsert_user_preferences_patch', {
      patch: {
        active_profile_id: profileId,
        updated_at: new Date().toISOString(),
      },
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_preferences_patch')) {
      console.warn(`${FILE_TAG} setActiveProfile failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_PREFERENCES_TABLE)
    .update({
      active_profile_id: profileId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select('user_id, active_profile_id, target_language, native_language, updated_at')
    .single();

  if (error) {
    console.warn(`${FILE_TAG} setActiveProfile failed`, error);
    throw error;
  }

  return data;
};
