import { useEffect, useState, useCallback } from 'react';
import {
  parsePersistedSession,
  shouldApplyAuthEvent,
  withTimeout,
} from '../services/authSessionCache';
import { readPersistedAuthSession, supabase } from '../services/supabase';

const FILE_TAG = '[useAuth]';
// Upper bound on how long startup waits for Supabase when no session is cached
// on the device. Past this the app opens as a guest and auth keeps going in the
// background.
const AUTH_NETWORK_TIMEOUT_MS = 8000;

const useAuth = () => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let hasUser = false;
    // Set once Supabase reports any auth state, so a slower cached read never
    // overwrites fresher state such as a sign-out.
    let authEventSeen = false;

    const applySession = (nextSession) => {
      if (!isMounted) {
        return;
      }
      hasUser = Boolean(nextSession?.user);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
    };

    const finishLoading = () => {
      if (isMounted) {
        setLoading(false);
      }
    };

    const bootstrapSession = async () => {
      // 1. Offline-first: adopt the session saved on this device before any
      //    network call, so the app opens with the user's own library even when
      //    the token refresh below is slow or never answers.
      try {
        const cachedSession = parsePersistedSession(await readPersistedAuthSession());
        if (cachedSession && !authEventSeen) {
          applySession(cachedSession);
          finishLoading();
        }
      } catch (error) {
        console.warn(`${FILE_TAG} failed to read cached session:`, error?.message ?? error);
      }

      // 2. Let Supabase restore (and refresh) the session in the background.
      //    The timeout only bounds how long startup waits when nothing was
      //    cached; a cached user is kept on timeout or network errors.
      try {
        const {
          data: { session: currentSession },
          error,
        } = await withTimeout(supabase.auth.getSession(), AUTH_NETWORK_TIMEOUT_MS, 'getSession');

        if (error) {
          throw error;
        }

        if (currentSession) {
          applySession(currentSession);
          return;
        }

        if (hasUser) {
          // A cached session exists but Supabase could not confirm it (offline).
          // Keep the cached user; a genuine sign-out arrives as SIGNED_OUT.
          return;
        }

        const {
          data: { session: anonymousSession },
          error: anonymousError,
        } = await withTimeout(supabase.auth.signInAnonymously(), AUTH_NETWORK_TIMEOUT_MS, 'signInAnonymously');

        if (anonymousError) {
          throw anonymousError;
        }

        applySession(anonymousSession);
      } catch (error) {
        const message = error?.message ?? error;
        if (hasUser) {
          console.warn(`${FILE_TAG} offline; continuing with cached session:`, message);
        } else {
          console.warn(`${FILE_TAG} failed to restore or create session:`, message);
        }
      } finally {
        finishLoading();
      }
    };

    bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (shouldApplyAuthEvent(event, nextSession)) {
        authEventSeen = true;
        applySession(nextSession);
      }
      finishLoading();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async (options) => {
    const { error } = await supabase.auth.signOut(options);
    if (error) {
      throw error;
    }
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const { data, error } = await supabase.auth.updateUser({
      data: patch,
    });

    if (error) {
      throw error;
    }

    const nextUser = data?.user
      ? {
          ...data.user,
          user_metadata: {
            ...(user?.user_metadata ?? {}),
            ...(data.user.user_metadata ?? {}),
            ...patch,
          },
        }
      : (user
          ? {
              ...user,
              user_metadata: {
                ...(user.user_metadata ?? {}),
                ...patch,
              },
            }
          : null);

    if (nextUser) {
      setUser(nextUser);
      setSession((prev) => (prev ? { ...prev, user: nextUser } : prev));
    }

    return nextUser;
  }, [user]);

  const updateUsername = useCallback(async (username) => {
    const trimmed = username.trim();

    return updateProfile({
      username: trimmed,
      display_name: trimmed,
    });
  }, [updateProfile]);

  return {
    user,
    session,
    loading,
    signOut,
    updateProfile,
    updateUsername,
  };
};

export default useAuth;
