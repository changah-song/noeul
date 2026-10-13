import {
  AuthTimeoutError,
  parsePersistedSession,
  shouldApplyAuthEvent,
  withTimeout,
} from '../authSessionCache';

const storedSession = (overrides = {}) => ({
  access_token: 'access',
  refresh_token: 'refresh',
  token_type: 'bearer',
  expires_in: 3600,
  // Expired an hour ago: the offline case that used to hang the splash.
  expires_at: Math.floor(Date.now() / 1000) - 3600,
  user: { id: 'user-1', is_anonymous: true },
  ...overrides,
});

describe('parsePersistedSession', () => {
  it('accepts an expired session string so the user is known offline', () => {
    const session = parsePersistedSession(JSON.stringify(storedSession()));
    expect(session?.user.id).toBe('user-1');
  });

  it('accepts an already-parsed object', () => {
    expect(parsePersistedSession(storedSession())?.user.id).toBe('user-1');
  });

  it.each([
    ['null', null],
    ['empty string', ''],
    ['invalid JSON', '{not json'],
    ['missing refresh token', JSON.stringify(storedSession({ refresh_token: undefined }))],
    ['missing access token', JSON.stringify(storedSession({ access_token: '' }))],
    ['missing expires_at', JSON.stringify((({ expires_at, ...rest }) => rest)(storedSession()))],
    ['missing user id', JSON.stringify(storedSession({ user: {} }))],
    ['missing user', JSON.stringify(storedSession({ user: null }))],
  ])('rejects %s', (_label, raw) => {
    expect(parsePersistedSession(raw)).toBeNull();
  });
});

describe('shouldApplyAuthEvent', () => {
  it('applies any event that carries a session', () => {
    expect(shouldApplyAuthEvent('SIGNED_IN', storedSession())).toBe(true);
    expect(shouldApplyAuthEvent('TOKEN_REFRESHED', storedSession())).toBe(true);
    expect(shouldApplyAuthEvent('INITIAL_SESSION', storedSession())).toBe(true);
  });

  it('clears the user only on an explicit sign-out', () => {
    expect(shouldApplyAuthEvent('SIGNED_OUT', null)).toBe(true);
  });

  it('ignores a null INITIAL_SESSION from a failed offline refresh', () => {
    expect(shouldApplyAuthEvent('INITIAL_SESSION', null)).toBe(false);
  });
});

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('passes through rejections', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('rejects when the promise never settles', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 8000, 'getSession');
    jest.advanceTimersByTime(8000);
    await expect(pending).rejects.toBeInstanceOf(AuthTimeoutError);
    await expect(pending).rejects.toThrow('getSession timed out after 8000ms');
  });
});
