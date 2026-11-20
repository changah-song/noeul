// Crash and error reporting with Sentry, next to appTelemetry.js.
//
// appTelemetry sees JavaScript errors and freezes; Sentry adds what it can't:
// native crashes in the Swift/Kotlin reader, readable stack traces, and the
// steps (screens, taps, requests) that led up to a crash.
//
// Off unless EXPO_PUBLIC_SENTRY_DSN is set, and off in debug builds unless
// EXPO_PUBLIC_SENTRY_IN_DEV=1. Nothing identifying is sent: the account id
// only (no email, no IP), and request URLs lose their query strings, which can
// carry book text.
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || '';
const IN_DEV = process.env.EXPO_PUBLIC_SENTRY_IN_DEV === '1';

let enabled = false;

export const isCrashReportingEnabled = () => enabled;

export const stripQuery = (url) => {
  if (typeof url !== 'string') {
    return url;
  }
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

const MAX_BREADCRUMB_MESSAGE = 200;

// Exported for tests.
export const scrubBreadcrumb = (breadcrumb) => {
  if (!breadcrumb) {
    return breadcrumb;
  }
  if (breadcrumb.category === 'console') {
    // Logs can quote book text and looked-up words: keep warnings and errors
    // only, and only their start.
    if (breadcrumb.level !== 'warning' && breadcrumb.level !== 'error') {
      return null;
    }
    const message = String(breadcrumb.message ?? '');
    return {
      ...breadcrumb,
      message: message.slice(0, MAX_BREADCRUMB_MESSAGE),
      data: undefined,
    };
  }
  if ((breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') && breadcrumb.data) {
    return { ...breadcrumb, data: { ...breadcrumb.data, url: stripQuery(breadcrumb.data.url) } };
  }
  return breadcrumb;
};

// Exported for tests.
export const scrubEvent = (event) => {
  if (event?.request) {
    if (event.request.url) {
      event.request.url = stripQuery(event.request.url);
    }
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
  }
  if (event?.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  return event;
};

export const initCrashReporting = () => {
  if (enabled || !DSN || (__DEV__ && !IN_DEV)) {
    return false;
  }
  try {
    Sentry.init({
      dsn: DSN,
      environment: __DEV__ ? 'development' : 'production',
      sendDefaultPii: false,
      // Performance traces: a small sample is enough to see slow screens.
      tracesSampleRate: 0.05,
      attachScreenshot: false,
      attachViewHierarchy: false,
      maxBreadcrumbs: 60,
      beforeBreadcrumb: scrubBreadcrumb,
      beforeSend: scrubEvent,
    });
    enabled = true;
  } catch (error) {
    console.warn('[sentry] init failed:', error?.message ?? error);
  }
  return enabled;
};

export const setCrashReportingUser = (id) => {
  if (!enabled) {
    return;
  }
  Sentry.setUser(id ? { id: String(id) } : null);
};

export const setCrashReportingScreen = (name) => {
  if (!enabled || !name) {
    return;
  }
  Sentry.setTag('screen', name);
  Sentry.addBreadcrumb({ category: 'navigation', message: name, level: 'info' });
};

// Report a caught error that should not crash the app but deserves a look.
export const reportError = (error, context) => {
  if (!enabled) {
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
};

// Sentry.wrap adds touch breadcrumbs and an error boundary; with reporting off
// the component is returned as is. Call after initCrashReporting.
export const wrapRoot = (Component) => (enabled ? Sentry.wrap(Component) : Component);
