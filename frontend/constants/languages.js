export const SUPPORTED_LANGUAGES = {
  ko: 'Korean',
  en: 'English',
};

export const TARGET_LANGUAGE_OPTIONS = Object.entries(SUPPORTED_LANGUAGES).map(([code, label]) => ({
  code,
  label,
}));

export const KRDICT_INTERFACE_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
  { code: 'mn', label: 'Монгол' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ru', label: 'Русский' },
];

export const SUPPORTED_INTERFACE_LANGUAGES = KRDICT_INTERFACE_LANGUAGE_OPTIONS.reduce(
  (languages, option) => ({
    ...languages,
    [option.code]: option.label,
  }),
  {}
);

export const DEFAULT_TARGET_LANGUAGE = 'ko';
export const DEFAULT_INTERFACE_LANGUAGE = 'en';

export const getInterfaceLanguageFallbackForTarget = (targetLanguage = DEFAULT_TARGET_LANGUAGE) => (
  KRDICT_INTERFACE_LANGUAGE_OPTIONS.find((option) => option.code !== targetLanguage)?.code
    ?? DEFAULT_INTERFACE_LANGUAGE
);

export const DEFAULT_LANGUAGE_SETTINGS = {
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  nativeLanguage: 'en',
  interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
};

export const normalizeLanguageCode = (code, fallback = DEFAULT_TARGET_LANGUAGE) => {
  const raw = String(code || '').trim().toLowerCase();
  const shortCode = raw.split(/[-_]/)[0];

  return SUPPORTED_LANGUAGES[shortCode] ? shortCode : fallback;
};

export const normalizeInterfaceLanguageCode = (code, fallback = DEFAULT_INTERFACE_LANGUAGE) => {
  const raw = String(code || '').trim().toLowerCase();
  const shortCode = raw.split(/[-_]/)[0];

  return SUPPORTED_INTERFACE_LANGUAGES[shortCode] ? shortCode : fallback;
};

export const normalizeInterfaceLanguageForTarget = (
  code,
  targetLanguage = DEFAULT_TARGET_LANGUAGE
) => {
  const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage, DEFAULT_TARGET_LANGUAGE);
  const fallback = getInterfaceLanguageFallbackForTarget(normalizedTargetLanguage);
  const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(code, fallback);

  return normalizedInterfaceLanguage === normalizedTargetLanguage
    ? fallback
    : normalizedInterfaceLanguage;
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

export const getInterfaceLanguageLabel = (code) => (
  SUPPORTED_INTERFACE_LANGUAGES[normalizeInterfaceLanguageCode(code)]
    ?? SUPPORTED_INTERFACE_LANGUAGES[DEFAULT_INTERFACE_LANGUAGE]
);
