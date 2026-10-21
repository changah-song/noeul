import axios from 'axios';
import { BASE_URL } from '../../config';
import { supabase } from '../supabase';
import { getRuntimeInterfaceLanguage } from '../interfaceLanguage';
import { localizeApiError } from '../../i18n/contentStrings';

// Without a timeout a stalled connection leaves callers (e.g. word lookups)
// waiting forever. Long-running calls such as chapter preprocessing pass
// their own `timeout`, which overrides this default per request.
export const DEFAULT_API_TIMEOUT_MS = 15000;

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: DEFAULT_API_TIMEOUT_MS,
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Supabase's own session bootstrap/refresh can hit a transient network error
// (e.g. device just woke up, brief connectivity blip), which surfaces here as
// an `error` with no session even though the user is actually logged in. Only
// retry that case — if Supabase cleanly reports no session (no error), the
// user is genuinely signed out and retrying won't help.
const AUTH_SESSION_RETRIES = 2;
const AUTH_SESSION_RETRY_DELAY_MS = 500;

const getAuthenticatedSession = async ({ refresh = false } = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt <= AUTH_SESSION_RETRIES; attempt += 1) {
    const {
      data: { session },
      error,
    } = await (refresh ? refreshSessionOnce() : supabase.auth.getSession());

    if (session?.access_token) {
      return session;
    }

    if (!error) {
      break;
    }

    lastError = error;
    if (attempt < AUTH_SESSION_RETRIES) {
      await delay(AUTH_SESSION_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No Supabase session');
};

// For requests that can't go through axios (e.g. the streaming explanation,
// which needs XMLHttpRequest progress events): the current access token.
export const getAccessToken = async ({ refresh = false } = {}) => {
  const session = await getAuthenticatedSession({ refresh });
  return session.access_token;
};

// The learner's interface language rides on every request, so endpoints that
// produce user-facing text (AI feedback, explanations, content translations)
// know it even when the request body doesn't carry `interface_language`.
export const INTERFACE_LANGUAGE_HEADER = 'X-Interface-Language';

const withAuthHeader = (config, accessToken) => {
  config.headers = {
    ...(config.headers ?? {}),
    [INTERFACE_LANGUAGE_HEADER]: getRuntimeInterfaceLanguage(),
    Authorization: `Bearer ${accessToken}`,
  };

  return config;
};

// Backend errors carry a stable `code` (backend/content_i18n.py); their
// `detail` is English. Swap in text in the learner's language so every caller
// that shows `error.message` or `response.data.detail` shows translated text.
// The English stays available as `error.originalMessage` / `data.detail_en`.
export const localizeErrorInPlace = (error, language = getRuntimeInterfaceLanguage()) => {
  if (!error || typeof error !== 'object' || error.localizedMessage) {
    return error;
  }
  const localized = localizeApiError(error, language);
  error.localizedMessage = localized;
  error.originalMessage = error.message;
  error.message = localized;
  const data = error.response?.data;
  if (data && typeof data === 'object' && data.code && typeof data.detail === 'string') {
    data.detail_en = data.detail;
    data.detail = localized;
  }
  return error;
};

api.interceptors.request.use(async (config) => {
  const session = await getAuthenticatedSession();
  return withAuthHeader(config, session.access_token);
});

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

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

  return Promise.reject(localizeErrorInPlace(error));
});
