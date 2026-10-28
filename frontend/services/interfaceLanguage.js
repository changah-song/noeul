import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_TARGET_LANGUAGE,
  DEFAULT_INTERFACE_LANGUAGE,
  DEFAULT_CHINESE_SCRIPT,
  normalizeBookLanguage,
  normalizeChineseScript,
  normalizeInterfaceLanguageCode,
  normalizeInterfaceLanguageForTarget,
} from '../constants/languages';
import { getDefaultTargetLanguage, getDeviceInterfaceLanguage } from './deviceLocale';
import { translate } from '../i18n/translations';

export const LANGUAGE_SETTINGS_KEY = '@ff/language-settings';

let runtimeTargetLanguage = getDefaultTargetLanguage();
let runtimeInterfaceLanguage = getDeviceInterfaceLanguage() ?? DEFAULT_INTERFACE_LANGUAGE;
let runtimeChineseScript = DEFAULT_CHINESE_SCRIPT;

export const getRuntimeTargetLanguage = () => runtimeTargetLanguage;

export const getRuntimeInterfaceLanguage = () => runtimeInterfaceLanguage;

// The learner's preferred Han script. Dictionary/preprocess calls read this so
// Traditional users see Traditional headwords without every call site passing it.
export const getRuntimeChineseScript = () => runtimeChineseScript;

export const setRuntimeTargetLanguage = (language) => {
  runtimeTargetLanguage = normalizeBookLanguage(language, DEFAULT_TARGET_LANGUAGE);
  return runtimeTargetLanguage;
};

// Native modules that draw their own text (i18n/nativeStrings.js) subscribe here
// so they get the new strings as soon as the interface language changes.
const interfaceLanguageListeners = new Set();

export const subscribeRuntimeInterfaceLanguage = (listener) => {
  interfaceLanguageListeners.add(listener);
  return () => interfaceLanguageListeners.delete(listener);
};

export const setRuntimeInterfaceLanguage = (language) => {
  const previous = runtimeInterfaceLanguage;
  runtimeInterfaceLanguage = normalizeInterfaceLanguageCode(language);
  if (runtimeInterfaceLanguage !== previous) {
    interfaceLanguageListeners.forEach((listener) => {
      try {
        listener(runtimeInterfaceLanguage);
      } catch (error) {
        console.warn('[interfaceLanguage] Listener failed:', error?.message ?? error);
      }
    });
  }
  return runtimeInterfaceLanguage;
};

export const setRuntimeChineseScript = (script) => {
  runtimeChineseScript = normalizeChineseScript(script, DEFAULT_CHINESE_SCRIPT);
  return runtimeChineseScript;
};

export const readStoredLanguageSettings = async () => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_SETTINGS_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    const targetLanguage = normalizeBookLanguage(
      parsed.targetLanguage ?? parsed.target_language,
      getDefaultTargetLanguage()
    );
    return {
      targetLanguage,
      // Until the user picks one, follow the phone's language.
      interfaceLanguage: normalizeInterfaceLanguageForTarget(
        parsed.interfaceLanguage ?? parsed.interface_language ?? getDeviceInterfaceLanguage(),
        targetLanguage
      ),
      chineseScript: normalizeChineseScript(
        parsed.chineseScript ?? parsed.chinese_script,
        DEFAULT_CHINESE_SCRIPT
      ),
    };
  } catch (error) {
    console.warn('[interfaceLanguage] Failed to load language settings:', error);
    return {
      targetLanguage: DEFAULT_TARGET_LANGUAGE,
      interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
      chineseScript: DEFAULT_CHINESE_SCRIPT,
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
  setRuntimeChineseScript(settings.chineseScript);
  return setRuntimeInterfaceLanguage(settings.interfaceLanguage);
};

// ─── Locale-aware formatting ─────────────────────────────────────────────────
// toLocaleString()/toLocaleDateString() with no locale follow the PHONE's
// language, not the app's. Everything user-visible formats through these so
// numbers and dates match the interface language.

// Arabic keeps Western digits: counts inside translated sentences and page
// numbers render Latin digits, and mixing two digit systems on one screen
// reads as a bug.
const LOCALE_OVERRIDES = {
  ar: 'ar-u-nu-latn',
};

export const getInterfaceLocale = (language = runtimeInterfaceLanguage) => {
  const code = normalizeInterfaceLanguageCode(language);
  return LOCALE_OVERRIDES[code] ?? code;
};

export const formatNumber = (value, options = {}, language = runtimeInterfaceLanguage) => {
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) {
    return String(value ?? '');
  }
  try {
    return number.toLocaleString(getInterfaceLocale(language), options);
  } catch {
    return String(number);
  }
};

export const formatDate = (value, options = {}, language = runtimeInterfaceLanguage) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleDateString(getInterfaceLocale(language), options);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

// t() for code that runs outside React (services, module-level helpers).
export const tRuntime = (key, params = {}) => translate(runtimeInterfaceLanguage, key, params);
