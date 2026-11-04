describe('listenDelay', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-modules-core');
    jest.useRealTimers();
  });

  const loadOnAndroid = (nativeModule) => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    jest.doMock('expo-modules-core', () => ({
      requireOptionalNativeModule: jest.fn(() => nativeModule),
    }));
    return require('../listenDelay');
  };

  it('waits on the native main-looper delay on Android (screen-off safe)', async () => {
    const native = { listenDelay: jest.fn(async () => null) };
    const { listenDelay } = loadOnAndroid(native);
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    await listenDelay(800);
    expect(native.listenDelay).toHaveBeenCalledWith(800);
    expect(timeoutSpy.mock.calls.filter(([, ms]) => ms === 800)).toHaveLength(0);
    timeoutSpy.mockRestore();
  });

  it('falls back to setTimeout without the native module', async () => {
    jest.useFakeTimers();
    const { listenDelay } = loadOnAndroid(null);
    let done = false;
    listenDelay(500).then(() => { done = true; });
    jest.advanceTimersByTime(499);
    await Promise.resolve();
    expect(done).toBe(false);
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('withListenTimeout resolves the fallback when the wait wins', async () => {
    const native = { listenDelay: jest.fn(async () => null) };
    const { withListenTimeout } = loadOnAndroid(native);
    await expect(withListenTimeout(new Promise(() => {}), 6000, '')).resolves.toBe('');
    await expect(withListenTimeout(Promise.resolve('hi'), 6000, '')).resolves.toBe('hi');
  });
});
