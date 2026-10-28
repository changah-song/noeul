// The phone's language, read once without a native module: Hermes' Intl
// reports the device (or per-app) locale, and React Native's I18nManager
// constants are the fallback.
//
// Used to start a fresh install in the user's own language and to record
// which phone languages people use, including ones Noeul doesn't offer yet.

import { I18nManager } from 'react-native';
import { DEFAULT_TARGET_LANGUAGE, normalizeInterfaceLanguageCode } from '../constants/languages';

// Java still reports a few ISO 639 codes by their pre-1989 names.
const LEGACY_LANGUAGE_CODES = { in: 'id', iw: 'he', ji: 'yi' };

const readIntlLocale = () => {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    return tag && tag !== 'und' ? tag : null;
  } catch {
    return null;
  }
};

const readNativeLocale = () => {
  try {
    const constants = I18nManager.getConstants?.() ?? I18nManager;
    return constants?.localeIdentifier ?? null;
  } catch {
    return null;
  }
};

/**
 * A BCP 47 style tag such as "vi-VN" or "zh-Hant-TW". Java-style identifiers
 * ("in_ID", "zh_TW_#Hant") are rewritten. Null when nothing can be read.
 */
export const canonicalLocaleTag = (raw) => {
  const parts = String(raw || '')
    .trim()
    .replace(/#/g, '')
    .split(/[-_]+/)
    .filter(Boolean);
  if (!parts.length) {
    return null;
  }
  const language = parts[0].toLowerCase();
  const rest = parts.slice(1).map((part) => (
    part.length === 4
      ? part[0].toUpperCase() + part.slice(1).toLowerCase()
      : part.length === 2 ? part.toUpperCase() : part
  ));
  return [LEGACY_LANGUAGE_CODES[language] ?? language, ...rest].join('-');
};

export const getDeviceLocaleTag = () => canonicalLocaleTag(readIntlLocale() ?? readNativeLocale());

/** Just the language part ("vi", "zh-Hant", "pt"), for counting. */
export const deviceLanguageOf = (tag) => {
  const canonical = canonicalLocaleTag(tag);
  if (!canonical) {
    return null;
  }
  const [language, ...rest] = canonical.split('-');
  if (language === 'zh') {
    const traditional = rest.includes('Hant')
      || (!rest.includes('Hans') && rest.some((part) => ['TW', 'HK', 'MO'].includes(part)));
    return traditional ? 'zh-Hant' : 'zh';
  }
  return language;
};

/** The phone's language if Noeul's interface offers it, else null. */
export const deviceInterfaceLanguageOf = (tag) => {
  const language = deviceLanguageOf(tag);
  return language ? normalizeInterfaceLanguageCode(language, null) : null;
};

export const getDeviceInterfaceLanguage = () => deviceInterfaceLanguageOf(getDeviceLocaleTag());

/**
 * The language a fresh install learns. Korean by default, but nobody learns
 * their own language: a Korean phone starts on English (Korean speakers
 * learning English come first), which also lets the app itself appear in
 * Korean (the interface can't be the language being learned).
 */
export const defaultTargetLanguageFor = (deviceLanguage) => (
  deviceLanguage === DEFAULT_TARGET_LANGUAGE ? 'en' : DEFAULT_TARGET_LANGUAGE
);

export const getDefaultTargetLanguage = () => defaultTargetLanguageFor(getDeviceInterfaceLanguage());
