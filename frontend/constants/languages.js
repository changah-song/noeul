export const SUPPORTED_LANGUAGES = {
  ko: 'Korean',
  en: 'English',
};

export const DEFAULT_TARGET_LANGUAGE = 'ko';

export const DEFAULT_LANGUAGE_SETTINGS = {
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  nativeLanguage: 'en',
  interfaceLanguage: 'en',
};

export const normalizeLanguageCode = (code, fallback = DEFAULT_TARGET_LANGUAGE) => {
  const raw = String(code || '').trim().toLowerCase();
  const shortCode = raw.split(/[-_]/)[0];

  return SUPPORTED_LANGUAGES[shortCode] ? shortCode : fallback;
};

export const normalizeBookLanguage = (value, fallback = DEFAULT_TARGET_LANGUAGE) => {
  const raw = String(value || '').trim().toLowerCase();

  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('en')) return 'en';

  return fallback;
};

export const isKoreanLanguage = (language) => normalizeBookLanguage(language) === 'ko';

export const getLanguageLabel = (code) => (
  SUPPORTED_LANGUAGES[normalizeLanguageCode(code)] ?? SUPPORTED_LANGUAGES[DEFAULT_TARGET_LANGUAGE]
);
