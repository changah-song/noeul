export const GUEST_OWNER_ID = 'guest';

export const getLocalOwnerId = (user) => {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  return userId || GUEST_OWNER_ID;
};

export const makeScopedStorageKey = (ownerId, key) => {
  const safeOwnerId = encodeURIComponent(ownerId || GUEST_OWNER_ID);
  const safeKey = String(key || '').replace(/^@ff\/?/, '');
  return `@ff/user-data/${safeOwnerId}/${safeKey}`;
};

export const makeOwnerDataDirectory = (ownerId) => {
  const safeOwnerId = encodeURIComponent(ownerId || GUEST_OWNER_ID);
  return `user-data/${safeOwnerId}/`;
};
