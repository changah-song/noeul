// The shared API client must time out stalled requests by default, while
// per-call timeouts (chapter preprocessing uses 45s) still win.

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({
        data: { session: { access_token: 'token' } },
        error: null,
      })),
      refreshSession: jest.fn(),
    },
  },
}));
jest.mock('../../config', () => ({ BASE_URL: 'http://api.test' }), { virtual: true });

const { api, DEFAULT_API_TIMEOUT_MS } = require('../api/client');

const captureConfig = () => {
  const seen = [];
  api.defaults.adapter = (config) => {
    seen.push(config);
    return Promise.resolve({ data: { result: [] }, status: 200, statusText: 'OK', headers: {}, config });
  };
  return seen;
};

describe('api client timeout', () => {
  it('sets a finite default timeout', () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBeGreaterThan(0);
    expect(api.defaults.timeout).toBe(DEFAULT_API_TIMEOUT_MS);
  });

  it('applies the default to requests without their own timeout', async () => {
    const seen = captureConfig();
    await api.get('/romanize/', { params: { text: 'a' } });
    expect(seen[0].timeout).toBe(DEFAULT_API_TIMEOUT_MS);
  });

  it('lets an explicit per-request timeout override the default', async () => {
    const seen = captureConfig();
    await api.post('/preprocess_chapter/', { text: 'x' }, { timeout: 45000 });
    expect(seen[0].timeout).toBe(45000);
  });

  it('gives stemWord requests a timeout', async () => {
    const seen = captureConfig();
    const stemWord = require('../api/stemWord').default;
    await stemWord({ query: '먹었다', language: 'ko' });
    expect(seen[0].timeout).toBeGreaterThan(0);
  });
});
