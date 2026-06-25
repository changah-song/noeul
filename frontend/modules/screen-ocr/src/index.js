import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { translate } from '../../../i18n/translations';
import { getRuntimeInterfaceLanguage } from '../../../services/interfaceLanguage';

const NativeScreenOcr = Platform.OS === 'android'
    ? requireNativeModule('ScreenOcr')
    : null;

export const recognizeImage = (uri) => {
    if (!NativeScreenOcr) {
        return Promise.reject(new Error(
            translate(getRuntimeInterfaceLanguage(), 'ocr.screenshotAndroidOnly')
        ));
    }

    return NativeScreenOcr.recognizeImage(uri);
};

export default {
    recognizeImage,
};
