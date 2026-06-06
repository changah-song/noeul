import {
  clearOwnershipDecision,
  switchActiveOwner,
} from './localOwnerCoordinator';
import { applyLegacyMigrationDecision } from './localOwnerMigration';
import {
  clearLocalUserData,
  hasLocalUserData,
  reassignLocalUserData,
} from './localUserData';
import { GUEST_OWNER_ID } from './localDataScope';

const requireUserId = (user) => {
  if (typeof user?.id !== 'string' || !user.id.trim()) {
    throw new Error('A signed-in user is required to resolve local data ownership');
  }

  return user.id.trim();
};

const finishOwnershipDecision = (userId) => {
  switchActiveOwner(userId);
  clearOwnershipDecision();
};

export const applyOwnershipDecision = async ({ decision, action, user } = {}) => {
  const userId = requireUserId(user);
  const decisionType = decision?.type;

  if (decisionType === 'legacy-signed-in') {
    if (!['import-to-account', 'keep-as-guest', 'discard'].includes(action)) {
      throw new Error(`Unsupported legacy local data action: ${action}`);
    }

    await applyLegacyMigrationDecision({
      decision: action,
      userId,
    });
    finishOwnershipDecision(userId);
    return;
  }

  if (decisionType === 'guest-signup-empty-remote') {
    if (action === 'save-progress') {
      await reassignLocalUserData(GUEST_OWNER_ID, userId);
      finishOwnershipDecision(userId);
      return;
    }

    if (action === 'start-fresh') {
      await clearLocalUserData(GUEST_OWNER_ID);
      finishOwnershipDecision(userId);
      return;
    }

    throw new Error(`Unsupported new-account local data action: ${action}`);
  }

  if (decisionType === 'guest-login-existing-remote') {
    if (action === 'merge') {
      if (await hasLocalUserData(userId)) {
        throw new Error('Merge with existing account data needs dedupe support before it can run safely.');
      }

      await reassignLocalUserData(GUEST_OWNER_ID, userId);
      finishOwnershipDecision(userId);
      return;
    }

    if (action === 'discard') {
      await clearLocalUserData(GUEST_OWNER_ID);
      finishOwnershipDecision(userId);
      return;
    }

    throw new Error(`Unsupported existing-account local data action: ${action}`);
  }

  throw new Error(`Unsupported local ownership decision: ${decisionType || 'none'}`);
};
