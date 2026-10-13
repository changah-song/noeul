// A fetch with timeouts for the Supabase client.
//
// React Native's fetch has no timeout. On a network that accepts connections
// but never answers (captive portals, dead Wi-Fi, a stalled proxy), a request
// waits forever. Inside Supabase that is worse than one slow call: the auth
// client's startup token refresh never settles, every later getSession() waits
// on it, and so does every data call, so cloud sync stays stuck until the app
// restarts. Aborting stalled requests turns them into ordinary network errors,
// which Supabase already retries and the app already recovers from.

export const SUPABASE_TIMEOUTS_MS = {
  auth: 15 * 1000,
  storage: 2 * 60 * 1000, // book files can be large on a slow connection
  default: 30 * 1000,
};

const urlOf = (input) => {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return String(input ?? '');
};

export const timeoutForUrl = (url, timeouts = SUPABASE_TIMEOUTS_MS) => {
  if (url.includes('/auth/v1/')) return timeouts.auth;
  if (url.includes('/storage/v1/')) return timeouts.storage;
  return timeouts.default;
};

export class SupabaseTimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`Network request timed out after ${timeoutMs}ms`);
    this.name = 'SupabaseTimeoutError';
    this.url = url;
  }
}

export const createTimeoutFetch = ({
  baseFetch = (...args) => fetch(...args),
  timeouts = SUPABASE_TIMEOUTS_MS,
} = {}) => (input, init = {}) => {
  const url = urlOf(input);
  const timeoutMs = timeoutForUrl(url, timeouts);
  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;

  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener?.('abort', abortFromCaller);
    }
  }

  // Abort the request AND reject on our own, so the call settles even if the
  // underlying fetch ignores the abort signal.
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new SupabaseTimeoutError(url, timeoutMs));
    }, timeoutMs);
  });

  const request = Promise.resolve()
    .then(() => baseFetch(input, { ...init, signal: controller.signal }))
    .catch((error) => {
      if (timedOut) {
        throw new SupabaseTimeoutError(url, timeoutMs);
      }
      throw error;
    });

  return Promise.race([request, timeout]).finally(() => {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.('abort', abortFromCaller);
  });
};
