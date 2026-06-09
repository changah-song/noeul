import { DEFAULT_TARGET_LANGUAGE, normalizeLanguageCode } from '../constants/languages';

export const DEFAULT_ACTIVE_PROFILE_ID = 'ko_default';

export const getDefaultProfileIdForLanguage = (language = DEFAULT_TARGET_LANGUAGE) => {
  const normalizedLanguage = normalizeLanguageCode(language, DEFAULT_TARGET_LANGUAGE);
  return normalizedLanguage === DEFAULT_TARGET_LANGUAGE
    ? DEFAULT_ACTIVE_PROFILE_ID
    : `${normalizedLanguage}_default`;
};

let runtimeActiveProfileId = DEFAULT_ACTIVE_PROFILE_ID;

export const getRuntimeActiveProfileId = () => runtimeActiveProfileId;

export const setRuntimeActiveProfileId = (profileId, targetLanguage = DEFAULT_TARGET_LANGUAGE) => {
  const fallbackProfileId = getDefaultProfileIdForLanguage(targetLanguage);
  const nextProfileId = typeof profileId === 'string' && profileId.trim()
    ? profileId.trim()
    : fallbackProfileId;
  runtimeActiveProfileId = nextProfileId;
  return runtimeActiveProfileId;
};
