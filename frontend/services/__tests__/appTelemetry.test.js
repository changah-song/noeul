import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STALL_THRESHOLD_MS,
  TELEMETRY_QUEUE_KEY,
  createTelemetry,
} from '../appTelemetry';

const deviceInfo = {
  environment: 'production',
  app_version: '1.0.0',
  build_number: '1',
  platform: 'android',
  os_version: '37',
  device_model: 'Pixel',
};
const silentLogger = { warn: () => {} };

const makeTelemetry = (overrides = {}) => createTelemetry({
  storage: AsyncStorage,
  deviceInfo,
  sendBatch: jest.fn(async () => ({ error: null })),
  logger: silentLogger,
  ...overrides,
});

const storedQueue = async () => JSON.parse((await AsyncStorage.getItem(TELEMETRY_QUEUE_KEY)) || '[]');

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('queue', () => {
  it('persists events to storage with device info and the current screen', async () => {
    const t = makeTelemetry();
    t.setScreen('Read');
    await t.record('js_stall', { durationMs: 1500.4 });

    const [event] = await storedQueue();
    expect(event).toMatchObject({
      event_type: 'js_stall',
      duration_ms: 1500,
      screen: 'Read',
      session_id: t.sessionId,
      app_version: '1.0.0',
      platform: 'android',
    });
    expect(event.client_event_id).toBeTruthy();
  });

  it('keeps events queued on disk across a restart', async () => {
    await makeTelemetry().record('app_start', { durationMs: 900 });
    const restarted = makeTelemetry();
    await restarted.ready();
    expect(restarted.getQueue().map((e) => e.event_type)).toEqual(['app_start']);
  });

  it('truncates oversized messages and stacks', async () => {
    const t = makeTelemetry();
    await t.record('error', { message: 'x'.repeat(5000), stack: 'y'.repeat(20000) });
    const [event] = t.getQueue();
    expect(event.message).toHaveLength(2000);
    expect(event.stack).toHaveLength(8000);
  });
});

describe('flush', () => {
  it('does nothing until a user is known', async () => {
    const sendBatch = jest.fn(async () => ({ error: null }));
    const t = makeTelemetry({ sendBatch });
    await t.record('app_start', { durationMs: 1 });
    await t.flush();
    expect(sendBatch).not.toHaveBeenCalled();
    expect(t.getQueue()).toHaveLength(1);
  });

  it('uploads with the signed-in user id and clears the queue', async () => {
    const sendBatch = jest.fn(async () => ({ error: null }));
    const t = makeTelemetry({ sendBatch });
    await t.record('app_start', { durationMs: 1 });
    await t.record('crash', { message: 'boom', isFatal: true });
    t.setUser('user-1');

    await expect(t.flush()).resolves.toEqual({ sent: 2 });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch.mock.calls[0][0].every((row) => row.user_id === 'user-1')).toBe(true);
    expect(t.getQueue()).toHaveLength(0);
    expect(await storedQueue()).toHaveLength(0);
  });

  it('keeps the queue when offline and sends it on the next try', async () => {
    let online = false;
    const sendBatch = jest.fn(async () => (online
      ? { error: null }
      : { error: { message: 'Network request failed' } }));
    const t = makeTelemetry({ sendBatch });
    t.setUser('user-1');
    await t.record('js_stall', { durationMs: 2000 });

    const failed = await t.flush();
    expect(failed.sent).toBe(0);
    expect(await storedQueue()).toHaveLength(1);

    online = true;
    await expect(t.flush()).resolves.toEqual({ sent: 1 });
    expect(await storedQueue()).toHaveLength(0);
  });

  it('sends large queues in batches of 50', async () => {
    const sendBatch = jest.fn(async () => ({ error: null }));
    const t = makeTelemetry({ sendBatch });
    for (let i = 0; i < 120; i += 1) {
      t.record('js_stall', { durationMs: 1200 });
    }
    t.setUser('user-1');
    await expect(t.flush()).resolves.toEqual({ sent: 120 });
    expect(sendBatch.mock.calls.map((call) => call[0].length)).toEqual([50, 50, 20]);
  });
});

describe('crash handler', () => {
  const makeErrorUtils = (previous) => {
    let handler = previous;
    return {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next) => { handler = next; },
      trigger: (error, isFatal) => handler(error, isFatal),
    };
  };

  it('writes a crash event to disk before handing over to the default handler', async () => {
    const order = [];
    const previous = jest.fn(async () => {
      order.push('previous');
      order.push(`stored:${(await storedQueue()).length}`);
    });
    const errorUtils = makeErrorUtils(previous);
    const t = makeTelemetry();
    t.setScreen('Learn');
    t.installCrashHandler(errorUtils);

    const error = new TypeError('undefined is not a function');
    errorUtils.trigger(error, true);
    expect(previous).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(previous).toHaveBeenCalledWith(error, true);
    expect(order).toEqual(['previous', 'stored:1']);
    expect((await storedQueue())[0]).toMatchObject({
      event_type: 'crash',
      is_fatal: true,
      message: 'undefined is not a function',
      screen: 'Learn',
    });
  });

  it('records non-fatal errors and hands over immediately', () => {
    const previous = jest.fn();
    const errorUtils = makeErrorUtils(previous);
    const t = makeTelemetry();
    t.installCrashHandler(errorUtils);
    errorUtils.trigger(new Error('soft'), false);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(t.getQueue()[0]).toMatchObject({ event_type: 'error', is_fatal: false });
  });

  it('installs only once', () => {
    const previous = jest.fn();
    const errorUtils = makeErrorUtils(previous);
    const t = makeTelemetry();
    t.installCrashHandler(errorUtils);
    t.installCrashHandler(errorUtils);
    errorUtils.trigger(new Error('once'), false);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(t.getQueue()).toHaveLength(1);
  });
});

describe('device log line', () => {
  it('logs one parseable line per event for the PR check routine', async () => {
    const info = jest.fn();
    const t = makeTelemetry({ logger: { warn: () => {}, info } });
    t.setScreen('Read');
    await t.record('js_stall', { durationMs: 1500 });
    expect(info).toHaveBeenCalledWith('[noeul-telemetry] event=js_stall duration_ms=1500 screen=Read');
  });
});

describe('freeze detection', () => {
  it('ignores normal timer jitter', () => {
    const t = makeTelemetry();
    expect(t.noteTick(1000, 1000 + STALL_THRESHOLD_MS - 1)).toBe(false);
    expect(t.getQueue()).toHaveLength(0);
  });

  it('records a stall with how long the thread was blocked', () => {
    const t = makeTelemetry();
    t.setScreen('Read');
    expect(t.noteTick(1000, 3400)).toBe(true);
    expect(t.getQueue()[0]).toMatchObject({ event_type: 'js_stall', duration_ms: 2400, screen: 'Read' });
  });

  it('caps stalls per session', () => {
    const t = makeTelemetry();
    for (let i = 0; i < 80; i += 1) {
      t.noteTick(0, 5000);
    }
    expect(t.getQueue()).toHaveLength(50);
  });
});
