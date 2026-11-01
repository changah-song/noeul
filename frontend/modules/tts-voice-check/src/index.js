import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// Missing in an older build or off Android: callers then fall back to what
// the engine itself reports.
const NativeTtsVoiceCheck = Platform.OS === 'android'
    ? requireOptionalNativeModule('TtsVoiceCheck')
    : null;

// { defaultVoice, voices: { [id]: boolean } } after having each voice say
// `sample` into a file, or null when the check could not run.
export const checkVoices = async (locale, voiceIds, sample) => {
    if (!NativeTtsVoiceCheck) return null;
    try {
        return await NativeTtsVoiceCheck.checkVoices(locale, voiceIds, sample);
    } catch {
        return null;
    }
};

// Opens the speech engine's voice downloads (or Android's text-to-speech
// settings). False when neither could open.
export const openVoiceDownload = () => {
    if (!NativeTtsVoiceCheck) return false;
    try {
        return NativeTtsVoiceCheck.openVoiceDownload();
    } catch {
        return false;
    }
};

export default {
    checkVoices,
    openVoiceDownload,
};
