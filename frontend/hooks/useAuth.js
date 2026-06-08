import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';

const FILE_TAG = '[useAuth]';

const useAuth = () => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const bootstrapSession = async () => {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        let session = currentSession;

        if (!session) {
          const {
            data: { session: anonymousSession },
            error: anonymousError,
          } = await supabase.auth.signInAnonymously();

          if (anonymousError) {
            throw anonymousError;
          }

          session = anonymousSession;
        }

        if (!isMounted) {
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
      } catch (error) {
        console.warn(`${FILE_TAG} failed to restore or create session:`, error.message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
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
