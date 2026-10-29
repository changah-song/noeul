export const GUEST_OWNER_ID = 'guest';

// An anonymous Supabase session (made at launch so a guest can call the
// backend) is not an account: its data stays local, as the guest's, until the
// reader signs in or signs up.
export const isAccountUser = (user) => Boolean(
  typeof user?.id === 'string' && user.id.trim() && !user.is_anonymous
);

export const getLocalOwnerId = (user) => (
  isAccountUser(user) ? user.id.trim() : GUEST_OWNER_ID
);

export const makeScopedStorageKey = (ownerId, key) => {
  const safeOwnerId = encodeURIComponent(ownerId || GUEST_OWNER_ID);
  const safeKey = String(key || '').replace(/^@ff\/?/, '');
  return `@ff/user-data/${safeOwnerId}/${safeKey}`;
};

export const makeOwnerDataDirectory = (ownerId) => {
  const safeOwnerId = encodeURIComponent(ownerId || GUEST_OWNER_ID);
  return `user-data/${safeOwnerId}/`;
};
