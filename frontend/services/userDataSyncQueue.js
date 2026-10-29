import { markSyncPending } from './syncStatus';

const subscribers = new Set();

// Requests that ask for a sync without changing anything locally.
const NO_CHANGE_REASONS = new Set(['manual', 'network-restored']);

export const requestUserDataSync = (reason = 'local-user-data-change') => {
  if (!NO_CHANGE_REASONS.has(reason)) {
    markSyncPending();
  }

  const request = {
    reason,
    requestedAt: Date.now(),
  };

  subscribers.forEach((listener) => {
    try {
      listener(request);
    } catch (error) {
      console.warn('[userDataSyncQueue] sync request listener failed:', error?.message ?? error);
    }
  });
};

export const subscribeUserDataSyncRequests = (listener) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};
