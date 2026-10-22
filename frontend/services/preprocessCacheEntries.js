// Chapter preprocessing returns one dictionary entry per stem, each tagged with
// the language its definition is in. They are saved to dictionary_cache under
// that language, so an English definition never sits in the cache as if it
// were the reader's language (where it would never be replaced).

import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../constants/languages';

const entryLanguage = (entry) => entry?.interfaceLanguage ?? entry?.interface_language;

// Entries ready for insertCacheEntries, each with its interface_language set.
export const tagPreprocessCacheEntries = (results, { language, interfaceLanguage }) => {
  const bookLanguage = normalizeBookLanguage(language);
  const appLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);

  return (results || [])
    .filter((entry) => entry?.stem)
    .map((entry) => {
      if (bookLanguage === 'ko') {
        // Korean definitions come from KRDICT, which the server reads in
        // English. Untagged entries (cache hits from an older server) are
        // English.
        return {
          ...entry,
          interface_language: normalizeInterfaceLanguageCode(entryLanguage(entry) ?? 'en'),
        };
      }

      const tagged = normalizeInterfaceLanguageCode(entryLanguage(entry) ?? appLanguage);
      if (appLanguage !== 'en' && tagged !== appLanguage) {
        return { ...entry, definition: null };
      }
      return entry;
    });
};

// The interface languages whose cache rows can back the book index: the app
// language first, then English for Korean words the server could not give in
// the app language (shown as an English fallback).
export const bookIndexLanguages = ({ language, interfaceLanguage }) => {
  const appLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
  if (normalizeBookLanguage(language) !== 'ko' || appLanguage === 'en') {
    return [appLanguage];
  }
  return [appLanguage, 'en'];
};
