// With no session at all (just signed out, or started offline), backend calls
// continue as a guest instead of failing: lookups and translation need a token.

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      signInAnonymously: jest.fn(() => Promise.resolve({
        data: { session: { access_token: 'guest-token' } },
        error: null,
      })),
      refreshSession: jest.fn(),
    },
  },
}));
jest.mock('../../config', () => ({ BASE_URL: 'http://api.test' }), { virtual: true });

const { supabase } = require('../supabase');
const { getAccessToken } = require('../api/client');

describe('api client without a session', () => {
  it('starts one guest session, shared by requests waiting on it', async () => {
    const tokens = await Promise.all([getAccessToken(), getAccessToken()]);
    expect(tokens).toEqual(['guest-token', 'guest-token']);
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });
});
