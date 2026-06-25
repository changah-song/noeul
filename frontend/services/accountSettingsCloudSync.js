import { USER_ACCOUNT_TABLE, supabase } from './supabase';
import {
  assertCanUploadForOwner,
  isCurrentSyncGeneration,
} from './localOwnerCoordinator';
import { normalizeInterfaceLanguageCode } from '../constants/languages';

const FILE_TAG = '[accountSettingsCloudSync]';
const USER_ACCOUNT_SELECT = `
  id,
  interface_language,
  updated_at
`;

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

const toAccountRow = (userId, account = {}) => omitUndefined({
  id: userId,
  interface_language: normalizeInterfaceLanguageCode(
    account.interface_language ?? account.interfaceLanguage
  ),
  updated_at: account.updated_at ?? account.updatedAt ?? new Date().toISOString(),
});

const upsertUserAccountPatchRpc = async (patch) => {
  const { data, error } = await supabase.rpc('upsert_user_account_settings_patch', { patch });

  if (error) {
    throw error;
  }

  return data;
};

export const fetchUserAccountSettings = async (userId) => {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from(USER_ACCOUNT_TABLE)
    .select(USER_ACCOUNT_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.warn(`${FILE_TAG} fetchUserAccountSettings failed`, error);
    throw error;
  }

  return data ?? null;
};

export const upsertUserAccountSettings = async ({
  user,
  ownerId,
  generation,
  account = {},
} = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const row = toAccountRow(userId, account);

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    return await upsertUserAccountPatchRpc(row);
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_account_settings_patch')) {
      console.warn(`${FILE_TAG} upsertUserAccountSettings failed`, error);
      throw error;
    }
  }

  const { data, error } = await supabase
    .from(USER_ACCOUNT_TABLE)
    .upsert(row, {
      onConflict: 'id',
    })
    .select(USER_ACCOUNT_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} upsertUserAccountSettings failed`, error);
    throw error;
  }

  return data;
};

export const updateUserAccountSettingsFields = async ({
  user,
  ownerId,
  generation,
  patch = {},
} = {}) => {
  const userId = assertCloudWriteAllowed({ user, ownerId, generation });
  const rowPatch = omitUndefined({
    interface_language: patch.interface_language !== undefined || patch.interfaceLanguage !== undefined
      ? normalizeInterfaceLanguageCode(patch.interface_language ?? patch.interfaceLanguage)
      : undefined,
    updated_at: patch.updated_at ?? patch.updatedAt ?? new Date().toISOString(),
  });

  try {
    assertCloudWriteAllowed({ user, ownerId, generation });
    return await upsertUserAccountPatchRpc(rowPatch);
  } catch (error) {
    if (!isMissingRpcError(error, 'upsert_user_account_settings_patch')) {
      console.warn(`${FILE_TAG} updateUserAccountSettingsFields failed`, error);
      throw error;
    }
  }

  const existing = await fetchUserAccountSettings(userId);

  if (!existing) {
    return upsertUserAccountSettings({ user, ownerId, generation, account: patch });
  }

  assertCloudWriteAllowed({ user, ownerId, generation });
  const { data, error } = await supabase
    .from(USER_ACCOUNT_TABLE)
    .update(rowPatch)
    .eq('id', userId)
    .select(USER_ACCOUNT_SELECT)
    .single();

  if (error) {
    console.warn(`${FILE_TAG} updateUserAccountSettingsFields failed`, error);
    throw error;
  }

  return data;
};
