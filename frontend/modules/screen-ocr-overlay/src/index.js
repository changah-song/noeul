import { Platform } from 'react-native';
import { EventEmitter, requireNativeModule } from 'expo-modules-core';

const NativeScreenOcrOverlay = Platform.OS === 'android'
    ? requireNativeModule('ScreenOcrOverlay')
    : null;

const eventEmitter = NativeScreenOcrOverlay
    ? new EventEmitter(NativeScreenOcrOverlay)
    : null;

const androidOnly = () => Promise.reject(new Error('Floating OCR is only available on Android.'));
const emptySubscription = { remove: () => {} };

export const requestOverlayPermission = () => (
    NativeScreenOcrOverlay?.requestOverlayPermission() ?? androidOnly()
);

export const isOverlayPermissionGranted = () => (
    NativeScreenOcrOverlay?.isOverlayPermissionGranted?.() ?? false
);

export const requestScreenCapture = () => (
    NativeScreenOcrOverlay?.requestScreenCapture() ?? androidOnly()
);

export const isScreenCaptureActive = () => (
    NativeScreenOcrOverlay?.isScreenCaptureActive?.() ?? false
);

export const startFloatingWidget = () => (
    NativeScreenOcrOverlay?.startFloatingWidget() ?? androidOnly()
);

export const stopFloatingWidget = () => (
    NativeScreenOcrOverlay?.stopFloatingWidget() ?? androidOnly()
);

export const analyzeCurrentScreen = () => (
    NativeScreenOcrOverlay?.analyzeCurrentScreen() ?? androidOnly()
);

export const resolveOverlayLookup = (requestId, result) => (
    NativeScreenOcrOverlay?.resolveOverlayLookup(requestId, result) ?? androidOnly()
);

export const rejectOverlayLookup = (requestId, message) => (
    NativeScreenOcrOverlay?.rejectOverlayLookup(requestId, message) ?? androidOnly()
);

export const resolveOverlaySave = (requestId, result) => (
    NativeScreenOcrOverlay?.resolveOverlaySave(requestId, result) ?? androidOnly()
);

export const rejectOverlaySave = (requestId, message) => (
    NativeScreenOcrOverlay?.rejectOverlaySave(requestId, message) ?? androidOnly()
);

export const resolveOverlayHanja = (requestId, result) => (
    NativeScreenOcrOverlay?.resolveOverlayHanja(requestId, result) ?? androidOnly()
);

export const rejectOverlayHanja = (requestId, message) => (
    NativeScreenOcrOverlay?.rejectOverlayHanja(requestId, message) ?? androidOnly()
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
    rejectOverlayLookup,
    resolveOverlaySave,
    rejectOverlaySave,
    resolveOverlayHanja,
    rejectOverlayHanja,
    addOverlayStatusListener,
    addOcrResultListener,
    addOcrWordSelectedListener,
    addOverlayLookupRequestedListener,
    addOverlaySaveRequestedListener,
    addOverlayHanjaRequestedListener,
    addOverlayRelatedKnownToggleRequestedListener,
    addOverlayErrorListener,
    onOverlayStatus,
    onOcrResult,
    onOcrWordSelected,
    onOverlayLookupRequested,
    onOverlaySaveRequested,
    onOverlayHanjaRequested,
    onOverlayRelatedKnownToggleRequested,
    onOverlayError,
};
