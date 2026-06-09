import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_INTERFACE_LANGUAGE,
  normalizeInterfaceLanguageCode,
} from '../constants/languages';

export const LANGUAGE_SETTINGS_KEY = '@ff/language-settings';

let runtimeInterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE;

export const getRuntimeInterfaceLanguage = () => runtimeInterfaceLanguage;

export const setRuntimeInterfaceLanguage = (language) => {
  runtimeInterfaceLanguage = normalizeInterfaceLanguageCode(language);
  return runtimeInterfaceLanguage;
};

export const readStoredInterfaceLanguage = async () => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_SETTINGS_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    return normalizeInterfaceLanguageCode(
      parsed.interfaceLanguage ?? parsed.interface_language
    );
  } catch (error) {
    console.warn('[interfaceLanguage] Failed to load interface language:', error);
    return DEFAULT_INTERFACE_LANGUAGE;
  }
};

export const loadRuntimeInterfaceLanguage = async () => {
  const language = await readStoredInterfaceLanguage();
  return setRuntimeInterfaceLanguage(language);
};
