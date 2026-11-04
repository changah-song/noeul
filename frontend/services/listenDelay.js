import { Platform } from 'react-native';

// A wait that keeps time with the screen off, for the listen voice's gaps.
//
// React Native's setTimeout is driven by frame callbacks, and those stop while
// the activity is paused (screen off, app in the background), even with the
// listen foreground service keeping the process alive. A JS timer between two
// utterances then never fires and the voice goes quiet: audio review stopped
// after its first word once the phone locked. On Android this waits on the
// main looper instead (NativeEpubReaderModule.listenDelay); elsewhere, or
// without the native module, it falls back to setTimeout.

let nativeModule;
const loadNative = () => {
  if (nativeModule !== undefined) return nativeModule;
  nativeModule = null;
  if (Platform.OS !== 'android') return nativeModule;
  try {
    // eslint-disable-next-line global-require
    const { requireOptionalNativeModule } = require('expo-modules-core');
    const module = requireOptionalNativeModule?.('NativeEpubReader');
    if (typeof module?.listenDelay === 'function') nativeModule = module;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
};

const timerDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const listenDelay = (ms) => {
  const wait = Math.max(0, Number(ms) || 0);
  const native = loadNative();
  if (!native) return timerDelay(wait);
  try {
    return Promise.resolve(native.listenDelay(wait)).catch(() => timerDelay(wait));
  } catch {
    return timerDelay(wait);
  }
};

// `promise`, or `fallback` once `ms` pass first (screen-off safe).
export const withListenTimeout = (promise, ms, fallback = null) => Promise.race([
  Promise.resolve(promise).catch(() => fallback),
  listenDelay(ms).then(() => fallback),
]);
