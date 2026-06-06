import { GUEST_OWNER_ID, getLocalOwnerId } from './localDataScope';

let activeOwnerId = GUEST_OWNER_ID;
let syncPaused = false;
let syncGeneration = 0;
let ownershipBlocked = false;
let pendingOwnershipDecision = null;
let lastAuthEvent = null;
const subscribers = new Set();

const notify = () => {
  subscribers.forEach((listener) => listener(getLocalOwnerSnapshot()));
};

export const getLocalOwnerSnapshot = () => ({
  activeOwnerId,
  syncPaused,
  syncGeneration,
  ownershipBlocked,
  pendingOwnershipDecision,
  lastAuthEvent,
});

export const subscribeLocalOwner = (listener) => {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
};

export const getActiveOwnerId = () => activeOwnerId;

export const isCloudSyncPaused = () => syncPaused;

export const getSyncGeneration = () => syncGeneration;

export const bumpSyncGeneration = () => {
  syncGeneration += 1;
  notify();
  return syncGeneration;
};

export const pauseCloudSync = () => {
  syncPaused = true;
  notify();
};

export const resumeCloudSync = () => {
  if (ownershipBlocked || pendingOwnershipDecision) {
    syncPaused = true;
    notify();
    return;
  }

  syncPaused = false;
  notify();
};

export const setOwnershipBlocked = (blocked) => {
  if (blocked) {
    ownershipBlocked = true;
    syncPaused = true;
    notify();
    return;
  }

  clearOwnershipDecision();
};

export const blockOwnershipForDecision = (decision) => {
  ownershipBlocked = true;
  pendingOwnershipDecision = decision ?? null;
  pauseCloudSync();
  notify();
};

export const clearOwnershipDecision = () => {
  ownershipBlocked = false;
  pendingOwnershipDecision = null;
  notify();
};

export const switchActiveOwner = (ownerId, options = {}) => {
  const { bumpGeneration = true } = options;
  activeOwnerId = ownerId || GUEST_OWNER_ID;

  if (bumpGeneration) {
    bumpSyncGeneration();
    return activeOwnerId;
  }

  notify();
  return activeOwnerId;
};

export const transitionLocalOwner = async ({
  previousOwnerId,
  nextOwnerId,
  authEvent,
  user,
  hasGuestData = false,
  hasRemoteData = false,
  hasLegacyDecisionRequired = false,
} = {}) => {
  const resolvedNextOwnerId = nextOwnerId || getLocalOwnerId(user);
  const resolvedPreviousOwnerId = previousOwnerId || activeOwnerId;

  if (
    user?.id
    && activeOwnerId === resolvedNextOwnerId
    && !ownershipBlocked
    && !pendingOwnershipDecision
    && !hasLegacyDecisionRequired
  ) {
    lastAuthEvent = authEvent ?? null;
    notify();
    return {
      status: 'unchanged',
      ownerId: activeOwnerId,
      generation: syncGeneration,
    };
  }

  pauseCloudSync();
  lastAuthEvent = authEvent ?? null;
  const generation = bumpSyncGeneration();
  let shouldResumeCloudSync = false;

  try {
    if (!user?.id) {
      switchActiveOwner(GUEST_OWNER_ID, { bumpGeneration: false });
      clearOwnershipDecision();
      return { status: 'switched', ownerId: GUEST_OWNER_ID, generation };
    }

    if (hasLegacyDecisionRequired) {
      blockOwnershipForDecision({
        type: 'legacy-signed-in',
        userId: user.id,
        nextOwnerId: resolvedNextOwnerId,
        authEvent,
      });
      return { status: 'blocked', reason: 'legacy-signed-in', generation };
    }

    if (
      resolvedPreviousOwnerId === GUEST_OWNER_ID
      && resolvedNextOwnerId === user.id
      && hasGuestData
    ) {
      blockOwnershipForDecision({
        type: hasRemoteData
          ? 'guest-login-existing-remote'
          : 'guest-signup-empty-remote',
        userId: user.id,
        previousOwnerId: resolvedPreviousOwnerId,
        nextOwnerId: resolvedNextOwnerId,
        hasRemoteData,
        authEvent,
      });
      return { status: 'blocked', reason: 'guest-data', generation };
    }

    switchActiveOwner(user.id, { bumpGeneration: false });
    clearOwnershipDecision();
    shouldResumeCloudSync = true;
    return { status: 'switched', ownerId: user.id, generation };
  } finally {
    if (!ownershipBlocked && shouldResumeCloudSync) {
      resumeCloudSync();
    }
  }
};

export const assertCanUploadForOwner = ({ ownerId, user }) => {
  const userOwnerId = getLocalOwnerId(user);
  if (!user?.id || ownerId !== userOwnerId) {
    throw new Error('Refusing cloud upload for inactive or mismatched local owner');
  }
};

export const isCurrentSyncGeneration = (generation) => (
  generation === syncGeneration
);
