import axios from 'axios';
import { BASE_URL } from '../../config';
import { supabase } from '../supabase';

export const api = axios.create({
  baseURL: BASE_URL,
});

let pendingRefresh = null;

const refreshSessionOnce = () => {
  if (!pendingRefresh) {
    pendingRefresh = supabase.auth.refreshSession().finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
};

const getAuthenticatedSession = async ({ refresh = false } = {}) => {
  if (refresh) {
    const {
      data: { session },
      error,
    } = await refreshSessionOnce();

    if (error || !session?.access_token) {
      throw new Error('No Supabase session');
    }

    return session;
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error('No Supabase session');
  }

  return session;
};

const withAuthHeader = (config, accessToken) => {
  config.headers = {
    ...(config.headers ?? {}),
    Authorization: `Bearer ${accessToken}`,
  };

  return config;
};

api.interceptors.request.use(async (config) => {
  const session = await getAuthenticatedSession();
  return withAuthHeader(config, session.access_token);
});

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

api.interceptors.response.use(undefined, async (error) => {
  const originalRequest = error.config;

  if (error.response?.status === 401 && originalRequest && !originalRequest._authRetry) {
    originalRequest._authRetry = true;
    const session = await getAuthenticatedSession({ refresh: true });
    return api(withAuthHeader(originalRequest, session.access_token));
  }

  if (RETRYABLE_STATUSES.has(error.response?.status) && originalRequest) {
    originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;
    if (originalRequest._retryCount <= MAX_RETRIES) {
      await delay(RETRY_DELAY_MS * originalRequest._retryCount);
      return api(originalRequest);
    }
  }

  return Promise.reject(error);
});
