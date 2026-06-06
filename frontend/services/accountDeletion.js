import { supabase } from './supabase';

export const ACCOUNT_DELETION_FUNCTION = 'delete-profile';

const readFunctionErrorMessage = async (error) => {
  const fallback = error?.message || 'Could not delete profile.';
  const response = error?.context;

  if (!response || typeof response.json !== 'function') {
    return fallback;
  }

  try {
    const payload = await response.json();
    return payload?.error || payload?.message || fallback;
  } catch {
    return fallback;
  }
};

export const deleteCurrentUserProfile = async () => {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session?.user?.id || !session?.access_token) {
    throw new Error('Please sign in again before deleting your profile.');
  }

  const { data, error } = await supabase.functions.invoke(ACCOUNT_DELETION_FUNCTION, {
    body: { confirm: 'DELETE_PROFILE' },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    throw new Error(await readFunctionErrorMessage(error));
  }

  return data ?? { deleted: true };
};
