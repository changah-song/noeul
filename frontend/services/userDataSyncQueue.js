const subscribers = new Set();

export const requestUserDataSync = (reason = 'local-user-data-change') => {
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
