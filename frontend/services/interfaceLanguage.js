import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_TARGET_LANGUAGE,
  DEFAULT_INTERFACE_LANGUAGE,
  normalizeBookLanguage,
  normalizeInterfaceLanguageCode,
} from '../constants/languages';

export const LANGUAGE_SETTINGS_KEY = '@ff/language-settings';

let runtimeTargetLanguage = DEFAULT_TARGET_LANGUAGE;
let runtimeInterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE;

export const getRuntimeTargetLanguage = () => runtimeTargetLanguage;

export const getRuntimeInterfaceLanguage = () => runtimeInterfaceLanguage;

export const setRuntimeTargetLanguage = (language) => {
  runtimeTargetLanguage = normalizeBookLanguage(language, DEFAULT_TARGET_LANGUAGE);
  return runtimeTargetLanguage;
};

export const setRuntimeInterfaceLanguage = (language) => {
  runtimeInterfaceLanguage = normalizeInterfaceLanguageCode(language);
  return runtimeInterfaceLanguage;
};

export const readStoredLanguageSettings = async () => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_SETTINGS_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    const targetLanguage = normalizeBookLanguage(
      parsed.targetLanguage ?? parsed.target_language,
      DEFAULT_TARGET_LANGUAGE
    );
    return {
      targetLanguage,
      interfaceLanguage: normalizeInterfaceLanguageCode(
        parsed.interfaceLanguage ?? parsed.interface_language
      ),
    };
  } catch (error) {
    console.warn('[interfaceLanguage] Failed to load language settings:', error);
    return {
      targetLanguage: DEFAULT_TARGET_LANGUAGE,
      interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
    };
  }
};

export const readStoredInterfaceLanguage = async () => {
  const settings = await readStoredLanguageSettings();
  return settings.interfaceLanguage;
};

export const loadRuntimeInterfaceLanguage = async () => {
  const settings = await readStoredLanguageSettings();
  setRuntimeTargetLanguage(settings.targetLanguage);
  return setRuntimeInterfaceLanguage(settings.interfaceLanguage);
};
