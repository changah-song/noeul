// App health telemetry: crashes, UI freezes and startup time.
//
// Events go into a queue persisted in AsyncStorage first, so nothing is lost
// offline or when the app is about to die, and are uploaded to the Supabase
// `app_events` table later (see supabase/app_telemetry.sql). The admin
// dashboard (dashboard/index.html) reads them from there.
//
// What gets recorded:
// - app_start: once per launch, with how long the JS side took to get from
//   evaluating this module to the first rendered screen.
// - crash: a fatal JS error, captured by wrapping the global error handler.
//   The handler waits briefly for the queue write before letting React
// Native kill the app.
// - error: a non-fatal error that reached the global handler.
// - js_stall: the JS thread was blocked long enough for the UI to freeze.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

// Captured as early as possible: App.js imports this module near the top.
const JS_START_MS = Date.now();

export const TELEMETRY_QUEUE_KEY = '@noeul/telemetry-queue/v1';
export const APP_EVENTS_TABLE = 'app_events';

const MAX_QUEUE = 300;
const FLUSH_BATCH = 50;
const FLUSH_INTERVAL_MS = 60 * 1000;
const NETWORK_TIMEOUT_MS = 10 * 1000;
const CRASH_PERSIST_TIMEOUT_MS = 1500;
const STALL_TICK_MS = 500;
// A tick that lands this much later than scheduled means the JS thread was
// blocked; at ~1s users notice the app is frozen.
export const STALL_THRESHOLD_MS = 1000;
const MAX_STALLS_PER_SESSION = 50;

const LIMITS = { message: 2000, stack: 8000, screen: 200 };

const truncate = (value, max) => {
  if (value == null) {
    return null;
  }
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
};

export const makeId = () => {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
};

const withTimeout = (promise, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  Promise.resolve(promise).then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); }
  );
});

export const getDeviceInfo = () => {
  const expoConfig = Constants.expoConfig ?? {};
  return {
    environment: __DEV__ ? 'development' : 'production',
    app_version: expoConfig.version ?? null,
    build_number: String(
      Platform.OS === 'android'
        ? (expoConfig.android?.versionCode ?? '')
        : (expoConfig.ios?.buildNumber ?? '')
    ) || null,
    platform: Platform.OS,
    os_version: Platform.Version != null ? String(Platform.Version) : null,
    device_model: Platform.constants?.Model ?? Platform.constants?.interfaceIdiom ?? null,
  };
};

// The queue/flush logic, with every side effect injected so it can be tested
// without a device.
export const createTelemetry = ({
  storage,
  sendBatch,
  deviceInfo,
  now = () => Date.now(),
  sessionId = makeId(),
  logger = console,
}) => {
  let queue = [];
  let screen = null;
  let userId = null;
  let flushing = null;
  let stallCount = 0;
  let warnedMissingTable = false;

  const loaded = (async () => {
    try {
      const raw = await storage.getItem(TELEMETRY_QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      // Merge in anything recorded before the load finished.
      queue = [...(Array.isArray(parsed) ? parsed : []), ...queue].slice(-MAX_QUEUE);
    } catch (error) {
      logger.warn?.('[telemetry] failed to load queue:', error?.message ?? error);
    }
  })();

  const persist = async () => {
    await loaded;
    await storage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(queue));
  };

  const record = (eventType, fields = {}) => {
    const event = {
      client_event_id: makeId(),
      session_id: sessionId,
      event_type: eventType,
      message: truncate(fields.message, LIMITS.message),
      stack: truncate(fields.stack, LIMITS.stack),
      screen: truncate(fields.screen ?? screen, LIMITS.screen),
      duration_ms: Number.isFinite(fields.durationMs) ? Math.round(fields.durationMs) : null,
      is_fatal: typeof fields.isFatal === 'boolean' ? fields.isFatal : null,
      metadata: fields.metadata ?? {},
      occurred_at: new Date(now()).toISOString(),
      ...deviceInfo,
    };
    queue.push(event);
    if (queue.length > MAX_QUEUE) {
      queue = queue.slice(-MAX_QUEUE);
    }
    return persist().catch((error) => {
      logger.warn?.('[telemetry] failed to persist event:', error?.message ?? error);
    });
  };

  const flush = () => {
    if (flushing) {
      return flushing;
    }

    flushing = (async () => {
      await loaded;
      if (!userId || queue.length === 0) {
        return { sent: 0 };
      }

      let sent = 0;
      while (queue.length > 0) {
        const batch = queue.slice(0, FLUSH_BATCH);
        // Events recorded before sign-in are attributed to whoever is signed
        // in when they upload; RLS only accepts the caller's own user id.
        const rows = batch.map((event) => ({ ...event, user_id: userId }));
        const { error } = await withTimeout(sendBatch(rows), NETWORK_TIMEOUT_MS);
        if (error) {
          const missingTable = error.code === '42P01' || error.code === 'PGRST205';
          if (missingTable && !warnedMissingTable) {
            warnedMissingTable = true;
            logger.warn?.('[telemetry] app_events table not found; apply supabase/app_telemetry.sql. Events stay queued.');
          }
          throw error;
        }
        const sentIds = new Set(batch.map((event) => event.client_event_id));
        queue = queue.filter((event) => !sentIds.has(event.client_event_id));
        sent += batch.length;
        await persist();
      }
      return { sent };
    })()
      .catch((error) => {
        // Offline or server error: keep the queue and try again later.
        return { sent: 0, error };
      })
      .finally(() => {
        flushing = null;
      });

    return flushing;
  };

  // Wrap React Native's global handler. For fatal errors, wait (bounded) for
  // the event to reach disk before handing over, because the default handler
  // terminates the app in release builds.
  const installCrashHandler = (errorUtils) => {
    if (!errorUtils?.getGlobalHandler || errorUtils.__noeulTelemetryInstalled) {
      return;
    }
    const previousHandler = errorUtils.getGlobalHandler();
    let handling = false;
    errorUtils.setGlobalHandler((error, isFatal) => {
      if (handling) {
        previousHandler?.(error, isFatal);
        return;
      }
      handling = true;
      let written;
      try {
        written = record(isFatal ? 'crash' : 'error', {
          message: error?.message ?? String(error),
          stack: error?.stack ?? null,
          isFatal: Boolean(isFatal),
          metadata: { name: error?.name ?? null },
        });
      } catch {
        written = Promise.resolve();
      }
      const handOver = () => {
        handling = false;
        previousHandler?.(error, isFatal);
      };
      if (isFatal) {
        withTimeout(written, CRASH_PERSIST_TIMEOUT_MS).catch(() => {}).finally(handOver);
      } else {
        handOver();
      }
    });
    errorUtils.__noeulTelemetryInstalled = true;
  };

  // Call from a timer tick: `expectedAt` is when the tick should have fired.
  const noteTick = (expectedAt, firedAt = now()) => {
    const lateBy = firedAt - expectedAt;
    if (lateBy < STALL_THRESHOLD_MS || stallCount >= MAX_STALLS_PER_SESSION) {
      return false;
    }
    stallCount += 1;
    record('js_stall', { durationMs: lateBy });
    return true;
  };

  return {
    record,
    flush,
    installCrashHandler,
    noteTick,
    setUser: (id) => { userId = id ?? null; },
    setScreen: (name) => { screen = name ?? null; },
    getQueue: () => queue.slice(),
    ready: () => loaded,
    sessionId,
  };
};

// ─── App wiring ──────────────────────────────────────────────────────────────

let telemetry = null;

const getTelemetry = () => {
  if (!telemetry) {
    // Required lazily so importing this module never pulls in the Supabase
    // client before App.js has finished its own imports.
    const { supabase } = require('./supabase');
    telemetry = createTelemetry({
      storage: AsyncStorage,
      deviceInfo: getDeviceInfo(),
      sendBatch: (rows) => supabase
        .from(APP_EVENTS_TABLE)
        .upsert(rows, { onConflict: 'user_id,client_event_id', ignoreDuplicates: true }),
    });
  }
  return telemetry;
};

export const installCrashReporting = () => {
  try {
    getTelemetry().installCrashHandler(global.ErrorUtils);
  } catch (error) {
    console.warn('[telemetry] failed to install crash handler:', error?.message ?? error);
  }
};

export const setTelemetryUser = (id) => {
  getTelemetry().setUser(id);
  if (id) {
    getTelemetry().flush();
  }
};

export const setTelemetryScreen = (name) => getTelemetry().setScreen(name);

let started = false;

// Call once, when the first screen is ready to show.
export const startTelemetry = () => {
  if (started) {
    return () => {};
  }
  started = true;
  const t = getTelemetry();

  t.record('app_start', { durationMs: Date.now() - JS_START_MS });

  let appState = AppState.currentState;
  let expectedAt = Date.now() + STALL_TICK_MS;
  const stallTimer = setInterval(() => {
    const firedAt = Date.now();
    // Timers pause in the background; only measure while the user can see it.
    if (appState === 'active') {
      t.noteTick(expectedAt, firedAt);
    }
    expectedAt = firedAt + STALL_TICK_MS;
  }, STALL_TICK_MS);

  const flushTimer = setInterval(() => { t.flush(); }, FLUSH_INTERVAL_MS);

  const subscription = AppState.addEventListener('change', (nextState) => {
    appState = nextState;
    expectedAt = Date.now() + STALL_TICK_MS;
    // Upload when going to the background (likely the last chance) and when
    // coming back (likely back online).
    t.flush();
  });

  t.flush();

  return () => {
    clearInterval(stallTimer);
    clearInterval(flushTimer);
    subscription?.remove?.();
    started = false;
  };
};
