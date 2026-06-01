import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

const NativeScreenOcr = Platform.OS === 'android'
    ? requireNativeModule('ScreenOcr')
    : null;

export const recognizeImage = (uri) => {
    if (!NativeScreenOcr) {
        return Promise.reject(new Error('Screenshot OCR is only available on Android.'));
    }

    return NativeScreenOcr.recognizeImage(uri);
};

export default {
    recognizeImage,
};
