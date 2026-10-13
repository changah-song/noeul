// Offline-first auth bootstrap helpers.
//
// Supabase's `getSession()` waits on the client's initialize step, which
// refreshes an expired access token over the network before resolving. On a
// connection that accepts sockets but never answers, that refresh never
// settles, so anything gated on it (the splash screen) hangs forever. These
// helpers let the app read the persisted session straight from device storage
// and treat its user as the local owner without touching the network.

// Parse the raw value Supabase persists under its storage key. Returns the
// session only when it has the fields Supabase itself requires plus a user id;
// an expired access token is fine, because the user identity is what scopes
// local data and the refresh can happen later in the background.
export const parsePersistedSession = (raw) => {
  if (!raw) {
    return null;
  }

  let session = raw;
  if (typeof raw === 'string') {
    try {
      session = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (
    !session
    || typeof session !== 'object'
    || !session.access_token
    || !session.refresh_token
    || !('expires_at' in session)
    || !session.user?.id
  ) {
    return null;
  }

  return session;
};

export class AuthTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'AuthTimeoutError';
  }
}

export const withTimeout = (promise, timeoutMs, label = 'Auth request') => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new AuthTimeoutError(label, timeoutMs)), timeoutMs);
  Promise.resolve(promise).then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    }
  );
});

// Decide what an auth state change means for the app's current user. A null
// session only clears the user on an explicit SIGNED_OUT. Supabase emits
// INITIAL_SESSION with a null session when an offline refresh fails with a
// network error even though the session is still persisted, and clearing the
// user then would switch the local owner to guest and hide the user's library.
export const shouldApplyAuthEvent = (event, nextSession) => (
  Boolean(nextSession) || event === 'SIGNED_OUT'
);
