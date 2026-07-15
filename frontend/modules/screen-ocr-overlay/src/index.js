import { Platform } from 'react-native';
import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import { translate } from '../../../i18n/translations';
import { getRuntimeInterfaceLanguage } from '../../../services/interfaceLanguage';

const NativeScreenOcrOverlay = Platform.OS === 'android'
    ? requireNativeModule('ScreenOcrOverlay')
    : null;

const eventEmitter = NativeScreenOcrOverlay
    ? new EventEmitter(NativeScreenOcrOverlay)
    : null;

const androidOnly = () => Promise.reject(new Error(
    translate(getRuntimeInterfaceLanguage(), 'ocr.androidOnly')
));
const emptySubscription = { remove: () => {} };

export const setOverlayInterfaceLanguage = (language = getRuntimeInterfaceLanguage()) => {
    NativeScreenOcrOverlay?.setInterfaceLanguage?.(language);
};

const callNative = (method, ...args) => {
    if (!NativeScreenOcrOverlay?.[method]) {
        return androidOnly();
    }
    setOverlayInterfaceLanguage();
    return NativeScreenOcrOverlay[method](...args);
};

export const requestOverlayPermission = () => (
    callNative('requestOverlayPermission')
);

export const isOverlayPermissionGranted = () => (
    NativeScreenOcrOverlay
        ? (setOverlayInterfaceLanguage(), NativeScreenOcrOverlay.isOverlayPermissionGranted?.() ?? false)
        : false
);

export const requestScreenCapture = () => (
    callNative('requestScreenCapture')
);

export const isScreenCaptureActive = () => (
    NativeScreenOcrOverlay
        ? (setOverlayInterfaceLanguage(), NativeScreenOcrOverlay.isScreenCaptureActive?.() ?? false)
        : false
);

export const startFloatingWidget = () => (
    callNative('startFloatingWidget')
);

export const stopFloatingWidget = () => (
    callNative('stopFloatingWidget')
);

export const analyzeCurrentScreen = () => (
    callNative('analyzeCurrentScreen')
);

export const resolveOverlayLookup = (requestId, result) => (
    callNative('resolveOverlayLookup', requestId, result)
);

export const updateOverlayLookup = (requestId, result) => (
    callNative('updateOverlayLookup', requestId, result)
);

export const rejectOverlayLookup = (requestId, message) => (
    callNative('rejectOverlayLookup', requestId, message)
);

export const resolveOverlaySave = (requestId, result) => (
    callNative('resolveOverlaySave', requestId, result)
);

export const rejectOverlaySave = (requestId, message) => (
    callNative('rejectOverlaySave', requestId, message)
);

export const resolveOverlayHanja = (requestId, result) => (
    callNative('resolveOverlayHanja', requestId, result)
);

export const rejectOverlayHanja = (requestId, message) => (
    callNative('rejectOverlayHanja', requestId, message)
);

export const addOverlayStatusListener = (listener) => (
    eventEmitter?.addListener('onOverlayStatus', listener) ?? emptySubscription
);

export const onOverlayStatus = addOverlayStatusListener;

export const addOcrResultListener = (listener) => (
    eventEmitter?.addListener('onOcrResult', listener) ?? emptySubscription
);

export const onOcrResult = addOcrResultListener;

export const addOcrWordSelectedListener = (listener) => (
    eventEmitter?.addListener('onOcrWordSelected', listener) ?? emptySubscription
);

export const onOcrWordSelected = addOcrWordSelectedListener;

export const addOverlayLookupRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayLookupRequested', listener) ?? emptySubscription
);

export const onOverlayLookupRequested = addOverlayLookupRequestedListener;

export const addOverlayTranslationRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayTranslationRequested', listener) ?? emptySubscription
);

export const onOverlayTranslationRequested = addOverlayTranslationRequestedListener;

export const addOverlayExplainRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayExplainRequested', listener) ?? emptySubscription
);

export const onOverlayExplainRequested = addOverlayExplainRequestedListener;

export const addOverlaySaveRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlaySaveRequested', listener) ?? emptySubscription
);

export const onOverlaySaveRequested = addOverlaySaveRequestedListener;

export const addOverlayHanjaRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayHanjaRequested', listener) ?? emptySubscription
);

export const onOverlayHanjaRequested = addOverlayHanjaRequestedListener;

export const addOverlayRelatedKnownToggleRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayRelatedKnownToggleRequested', listener) ?? emptySubscription
);

export const onOverlayRelatedKnownToggleRequested = addOverlayRelatedKnownToggleRequestedListener;

export const addOverlayErrorListener = (listener) => (
    eventEmitter?.addListener('onOverlayError', listener) ?? emptySubscription
);

export const onOverlayError = addOverlayErrorListener;

export default {
    requestOverlayPermission,
    isOverlayPermissionGranted,
    requestScreenCapture,
    isScreenCaptureActive,
    startFloatingWidget,
    stopFloatingWidget,
    analyzeCurrentScreen,
    resolveOverlayLookup,
    updateOverlayLookup,
    rejectOverlayLookup,
    resolveOverlaySave,
    rejectOverlaySave,
    resolveOverlayHanja,
    rejectOverlayHanja,
    setOverlayInterfaceLanguage,
    addOverlayStatusListener,
    addOcrResultListener,
    addOcrWordSelectedListener,
    addOverlayLookupRequestedListener,
    addOverlayTranslationRequestedListener,
    addOverlayExplainRequestedListener,
    addOverlaySaveRequestedListener,
    addOverlayHanjaRequestedListener,
    addOverlayRelatedKnownToggleRequestedListener,
    addOverlayErrorListener,
    onOverlayStatus,
    onOcrResult,
    onOcrWordSelected,
    onOverlayLookupRequested,
    onOverlayExplainRequested,
    onOverlaySaveRequested,
    onOverlayHanjaRequested,
    onOverlayRelatedKnownToggleRequested,
    onOverlayError,
};
