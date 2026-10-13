import {
  SUPABASE_TIMEOUTS_MS,
  SupabaseTimeoutError,
  createTimeoutFetch,
  timeoutForUrl,
} from '../supabaseFetch';

const AUTH_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const REST_URL = 'https://x.supabase.co/rest/v1/user_books?select=*';
const STORAGE_URL = 'https://x.supabase.co/storage/v1/object/user-books/a.epub';

const hangingFetch = () => jest.fn(() => new Promise(() => {}));

describe('timeoutForUrl', () => {
  it('gives auth, storage and data requests their own timeouts', () => {
    expect(timeoutForUrl(AUTH_URL)).toBe(SUPABASE_TIMEOUTS_MS.auth);
    expect(timeoutForUrl(STORAGE_URL)).toBe(SUPABASE_TIMEOUTS_MS.storage);
    expect(timeoutForUrl(REST_URL)).toBe(SUPABASE_TIMEOUTS_MS.default);
  });
});

describe('createTimeoutFetch', () => {
  afterEach(() => jest.useRealTimers());

  it('passes through a response that arrives in time', async () => {
    const response = { ok: true };
    const baseFetch = jest.fn(async () => response);
    const timeoutFetch = createTimeoutFetch({ baseFetch });
    await expect(timeoutFetch(REST_URL, { method: 'GET' })).resolves.toBe(response);
    expect(baseFetch.mock.calls[0][1].method).toBe('GET');
    expect(baseFetch.mock.calls[0][1].signal).toBeDefined();
  });

  it('rejects a request that never answers, and aborts it', async () => {
    jest.useFakeTimers();
    const baseFetch = hangingFetch();
    const pending = createTimeoutFetch({ baseFetch })(AUTH_URL);
    const signal = baseFetch.mock.calls.length ? baseFetch.mock.calls[0][1].signal : null;
    await Promise.resolve();
    jest.advanceTimersByTime(SUPABASE_TIMEOUTS_MS.auth - 1);
    let settled = false;
    pending.catch(() => {}).finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(pending).rejects.toBeInstanceOf(SupabaseTimeoutError);
    expect((signal || baseFetch.mock.calls[0][1].signal).aborted).toBe(true);
  });

  it('settles even if the underlying fetch ignores the abort signal', async () => {
    jest.useFakeTimers();
    const pending = createTimeoutFetch({ baseFetch: hangingFetch(), timeouts: { auth: 50, storage: 50, default: 50 } })(REST_URL);
    jest.advanceTimersByTime(50);
    await expect(pending).rejects.toThrow('timed out after 50ms');
  });

  it('passes through ordinary network errors', async () => {
    const error = new TypeError('Network request failed');
    const timeoutFetch = createTimeoutFetch({ baseFetch: jest.fn(async () => { throw error; }) });
    await expect(timeoutFetch(REST_URL)).rejects.toBe(error);
  });

  it("aborts when the caller's own signal aborts", async () => {
    const caller = new AbortController();
    const baseFetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted by caller')));
    }));
    const pending = createTimeoutFetch({ baseFetch })(REST_URL, { signal: caller.signal });
    await Promise.resolve();
    caller.abort();
    await expect(pending).rejects.toThrow('aborted by caller');
  });
});

describe('the real Supabase auth client on a network that never answers', () => {
  // The case that used to hang the splash screen and cloud sync: an expired
  // saved session makes the client refresh its token before getSession()
  // can resolve. With a plain fetch that never answers, it never resolves.
  const { GoTrueClient } = require('@supabase/auth-js');
  const expired = {
    access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 3600,
    user: { id: 'u1', aud: 'authenticated' },
  };
  const makeClient = (fetchImpl) => {
    const store = { 'sb-test-auth-token': JSON.stringify(expired) };
    return new GoTrueClient({
      url: 'https://x.supabase.co/auth/v1',
      storageKey: 'sb-test-auth-token',
      storage: {
        getItem: async (k) => store[k] ?? null,
        setItem: async (k, v) => { store[k] = v; },
        removeItem: async (k) => { delete store[k]; },
      },
      fetch: fetchImpl,
      autoRefreshToken: false,
      persistSession: true,
    });
  };
  const within = (promise, ms) => Promise.race([
    promise.then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('still waiting'), ms)),
  ]);

  it('hangs with a plain fetch (the old behavior)', async () => {
    const client = makeClient(hangingFetch());
    await expect(within(client.getSession(), 1500)).resolves.toBe('still waiting');
  });

  it('resolves getSession() once stalled requests time out', async () => {
    // The auth client retries a failed refresh with backoff for up to 30 s
    // (its AUTO_REFRESH_TICK_DURATION), so a stall now ends after ~30 s
    // instead of never.
    const timeoutFetch = createTimeoutFetch({
      baseFetch: hangingFetch(),
      timeouts: { auth: 200, storage: 200, default: 200 },
    });
    const client = makeClient(timeoutFetch);
    const started = Date.now();
    await expect(within(client.getSession(), 35000)).resolves.toBe('resolved');
    expect(Date.now() - started).toBeLessThan(35000);
  }, 40000);
});
