// Machine translation for bundled English content (hanja meanings the
// hanja.db has no column for, Chinese character definitions/hints, radical
// names). Calls the backend's /translate_content/, which caches every string
// server-side; results are also kept on the device (memory + AsyncStorage per
// language) so a meaning is fetched once and then works offline.
//
// Callers get `{ translations: Map(english -> translated), fallback }`:
// strings missing from the map stay in English, and `fallback` says why
// ('offline' when the request never reached the server, 'unavailable' when the
// server had no translation) so the UI can label them as English.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeInterfaceLanguageCode } from '../constants/languages';
import { api } from './api/client';

const STORAGE_KEY_PREFIX = '@ff/content-translations:';
const MAX_STORED_PER_LANGUAGE = 4000;
const MAX_TEXTS_PER_REQUEST = 64;
const MAX_TEXT_CHARS = 400;
const REQUEST_TIMEOUT_MS = 12000;

const memory = new Map(); // language -> Map(english -> translated)
const loading = new Map(); // language -> Promise

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

const loadLanguage = (language) => {
  if (memory.has(language)) return Promise.resolve(memory.get(language));
  if (!loading.has(language)) {
    loading.set(language, (async () => {
      let entries = [];
      try {
        const raw = await AsyncStorage.getItem(`${STORAGE_KEY_PREFIX}${language}`);
        const parsed = raw ? JSON.parse(raw) : null;
        entries = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        entries = [];
      }
      const table = new Map(entries.filter((pair) => Array.isArray(pair) && pair.length === 2));
      memory.set(language, table);
      loading.delete(language);
      return table;
    })());
  }
  return loading.get(language);
};

const persistLanguage = async (language) => {
  const table = memory.get(language);
  if (!table) return;
  // Keep the most recent entries (Map preserves insertion order).
  while (table.size > MAX_STORED_PER_LANGUAGE) {
    table.delete(table.keys().next().value);
  }
  try {
    await AsyncStorage.setItem(`${STORAGE_KEY_PREFIX}${language}`, JSON.stringify([...table.entries()]));
  } catch (error) {
    // Storage full or unavailable: the memory copy still serves this session.
  }
};

// Languages that need no translation for English source content.
export const isEnglishInterface = (language) => normalizeInterfaceLanguageCode(language) === 'en';

/**
 * Translate English content strings into `language`.
 * @param {string[]} texts English strings (duplicates and blanks are fine)
 * @param {string} language interface language code
 * @param {{ kind?: string }} [options] what the strings are (backend logging/limits)
 * @returns {Promise<{ translations: Map<string,string>, fallback: null|'offline'|'unavailable' }>}
 */
export const translateContentTexts = async (texts, language, { kind = 'other' } = {}) => {
  const normalized = normalizeInterfaceLanguageCode(language);
  const translations = new Map();
  const unique = [...new Set((texts || []).map(cleanText).filter((text) => text && text.length <= MAX_TEXT_CHARS))];
  if (normalized === 'en' || unique.length === 0) {
    return { translations, fallback: null };
  }

  const table = await loadLanguage(normalized);
  const missing = [];
  unique.forEach((text) => {
    const hit = table.get(text);
    if (hit) {
      translations.set(text, hit);
    } else {
      missing.push(text);
    }
  });
  if (missing.length === 0) {
    return { translations, fallback: null };
  }

  let fallback = null;
  let learned = false;
  for (let start = 0; start < missing.length; start += MAX_TEXTS_PER_REQUEST) {
    const chunk = missing.slice(start, start + MAX_TEXTS_PER_REQUEST);
    try {
      const response = await api.post(
        '/translate_content/',
        { texts: chunk, kind, interface_language: normalized },
        { timeout: REQUEST_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
      );
      const results = Array.isArray(response?.data?.translations) ? response.data.translations : [];
      chunk.forEach((text, index) => {
        const translated = cleanText(results[index]);
        if (translated) {
          translations.set(text, translated);
          table.set(text, translated);
          learned = true;
        } else if (!fallback) {
          fallback = 'unavailable';
        }
      });
    } catch (error) {
      // No response at all (offline, DNS, timeout before headers) vs a server answer.
      fallback = error?.response ? 'unavailable' : 'offline';
      break;
    }
  }
  if (learned) {
    persistLanguage(normalized);
  }
  return { translations, fallback };
};

// Test helper.
export const __resetContentTranslationCache = () => {
  memory.clear();
  loading.clear();
};
