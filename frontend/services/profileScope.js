import { DEFAULT_TARGET_LANGUAGE, normalizeLanguageCode } from '../constants/languages';

export const DEFAULT_ACTIVE_PROFILE_ID = 'ko_default';

export const getDefaultProfileIdForLanguage = (language = DEFAULT_TARGET_LANGUAGE) => {
  const normalizedLanguage = normalizeLanguageCode(language, DEFAULT_TARGET_LANGUAGE);
  return normalizedLanguage === DEFAULT_TARGET_LANGUAGE
    ? DEFAULT_ACTIVE_PROFILE_ID
    : `${normalizedLanguage}_default`;
};

// The language's placeholder profile ('ko_default', 'zh_default', ...): rows
// live there until the account's real (cloud) profile id is known.
export const isPlaceholderProfileId = (profileId, language = DEFAULT_TARGET_LANGUAGE) => (
  profileId === getDefaultProfileIdForLanguage(language)
);

// null until AppContext loads the saved language settings. Until then the getter
// falls back to the placeholder, but sync must not file pulled rows under it.
let runtimeActiveProfileId = null;

export const getRuntimeActiveProfileId = () => runtimeActiveProfileId ?? DEFAULT_ACTIVE_PROFILE_ID;

export const isRuntimeActiveProfileLoaded = () => runtimeActiveProfileId !== null;

export const resetRuntimeActiveProfileId = () => {
  runtimeActiveProfileId = null;
};

export const setRuntimeActiveProfileId = (profileId, targetLanguage = DEFAULT_TARGET_LANGUAGE) => {
  const fallbackProfileId = getDefaultProfileIdForLanguage(targetLanguage);
  const nextProfileId = typeof profileId === 'string' && profileId.trim()
    ? profileId.trim()
    : fallbackProfileId;
  runtimeActiveProfileId = nextProfileId;
  return runtimeActiveProfileId;
};
