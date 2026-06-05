import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  DEFAULT_LANGUAGE_SETTINGS,
  normalizeLanguageCode,
} from '../constants/languages';
import {
  fetchUserPreferences,
  getTimestampMs,
  updateUserPreferenceFields,
  upsertUserPreferences,
} from '../services/preferencesCloudSync';

const LANGUAGE_SETTINGS_KEY = '@ff/language-settings';

const AppContext = createContext({
  dictMode: true,
  setDictMode: () => {},
  ...DEFAULT_LANGUAGE_SETTINGS,
  setTargetLanguage: () => {},
  setNativeLanguage: () => {},
  setInterfaceLanguage: () => {},
  languageSettingsReady: false,
  updateLanguageSettings: () => {},
  syncLanguagePreferences: () => Promise.resolve(),
});

const normalizeLanguageSettings = (settings = {}) => ({
  targetLanguage: normalizeLanguageCode(
    settings.targetLanguage ?? settings.target_language,
    DEFAULT_LANGUAGE_SETTINGS.targetLanguage
  ),
  nativeLanguage: normalizeLanguageCode(
    settings.nativeLanguage ?? settings.native_language,
    DEFAULT_LANGUAGE_SETTINGS.nativeLanguage
  ),
  interfaceLanguage: normalizeLanguageCode(
    settings.interfaceLanguage
      ?? settings.interface_language,
    DEFAULT_LANGUAGE_SETTINGS.interfaceLanguage
  ),
  updatedAt: settings.updatedAt
    ?? settings.updated_at
    ?? null,
});

const settingsFromCloudPreferences = (preferences = {}) => normalizeLanguageSettings({
  target_language: preferences.target_language,
  native_language: preferences.native_language,
  interface_language: preferences.interface_language,
  updated_at: preferences.updated_at,
});

const toCloudLanguagePatch = (settings) => ({
  target_language: settings.targetLanguage,
  native_language: settings.nativeLanguage,
  interface_language: settings.interfaceLanguage,
  updated_at: settings.updatedAt,
});

export const AppProvider = ({ children, user }) => {
  const [dictMode, setDictMode] = useState(true);
  const [languageSettings, setLanguageSettings] = useState({
    ...DEFAULT_LANGUAGE_SETTINGS,
    updatedAt: null,
  });
  const [languageSettingsReady, setLanguageSettingsReady] = useState(false);
  const latestLanguageSettingsRef = useRef(languageSettings);
  const lastSyncedUserIdRef = useRef(null);

  useEffect(() => {
    latestLanguageSettingsRef.current = languageSettings;
  }, [languageSettings]);

  const persistLocalLanguageSettings = useCallback(async (settings) => {
    await AsyncStorage.setItem(LANGUAGE_SETTINGS_KEY, JSON.stringify(settings));
  }, []);

  const saveLanguageSettings = useCallback((patch, options = {}) => {
    const {
      syncCloud = true,
      updatedAt = new Date().toISOString(),
    } = options;

    setLanguageSettings((current) => {
      const next = normalizeLanguageSettings({
        ...current,
        ...patch,
        updatedAt,
      });

      latestLanguageSettingsRef.current = next;
      persistLocalLanguageSettings(next).catch((error) => {
        console.warn('[AppContext] Failed to persist language settings:', error);
      });

      if (syncCloud && user?.id) {
        updateUserPreferenceFields(user.id, toCloudLanguagePatch(next)).catch((error) => {
          console.warn('[AppContext] Failed to sync language settings:', error?.message ?? error);
        });
      }

      return next;
    });
  }, [persistLocalLanguageSettings, user?.id]);

  const syncLanguagePreferences = useCallback(async (nextUser = user) => {
    if (!languageSettingsReady || !nextUser?.id) {
      return;
    }

    const localSettings = latestLanguageSettingsRef.current;
    const cloudPreferences = await fetchUserPreferences(nextUser.id);

    if (!cloudPreferences) {
      await upsertUserPreferences(nextUser.id, toCloudLanguagePatch({
        ...localSettings,
        updatedAt: localSettings.updatedAt ?? new Date().toISOString(),
      }));
      return;
    }

    const cloudSettings = settingsFromCloudPreferences(cloudPreferences);
    const cloudTimestamp = cloudSettings.updatedAt ?? cloudPreferences.updated_at;
    const localTimestamp = localSettings.updatedAt;

    if (cloudTimestamp && getTimestampMs(cloudTimestamp) > getTimestampMs(localTimestamp)) {
      const nextSettings = {
        ...cloudSettings,
        updatedAt: cloudTimestamp,
      };
      latestLanguageSettingsRef.current = nextSettings;
      setLanguageSettings(nextSettings);
      await persistLocalLanguageSettings(nextSettings);
      return;
    }

    await updateUserPreferenceFields(nextUser.id, toCloudLanguagePatch({
      ...localSettings,
      updatedAt: localSettings.updatedAt ?? new Date().toISOString(),
    }));
  }, [languageSettingsReady, persistLocalLanguageSettings, user]);

  useEffect(() => {
    let isMounted = true;

    const loadLanguageSettings = async () => {
      try {
        const stored = await AsyncStorage.getItem(LANGUAGE_SETTINGS_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        const nextSettings = normalizeLanguageSettings({
          ...DEFAULT_LANGUAGE_SETTINGS,
          ...parsed,
          updatedAt: parsed.updatedAt ?? parsed.updated_at ?? null,
        });

        if (!isMounted) {
          return;
        }

        latestLanguageSettingsRef.current = nextSettings;
        setLanguageSettings(nextSettings);
      } catch (error) {
        console.warn('[AppContext] Failed to load language settings:', error);
      } finally {
        if (isMounted) {
          setLanguageSettingsReady(true);
        }
      }
    };

    loadLanguageSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!languageSettingsReady) {
      return;
    }

    if (!user?.id) {
      lastSyncedUserIdRef.current = null;
      return;
    }

    if (lastSyncedUserIdRef.current === user.id) {
      return;
    }

    lastSyncedUserIdRef.current = user.id;
    syncLanguagePreferences(user).catch((error) => {
      lastSyncedUserIdRef.current = null;
      console.warn('[AppContext] Failed to merge cloud language preferences:', error?.message ?? error);
    });
  }, [languageSettingsReady, syncLanguagePreferences, user]);

  const value = useMemo(() => ({
    dictMode,
    setDictMode,
    targetLanguage: languageSettings.targetLanguage,
    setTargetLanguage: (targetLanguage) => saveLanguageSettings({ targetLanguage }),
    nativeLanguage: languageSettings.nativeLanguage,
    setNativeLanguage: (nativeLanguage) => saveLanguageSettings({ nativeLanguage }),
    interfaceLanguage: languageSettings.interfaceLanguage,
    setInterfaceLanguage: (interfaceLanguage) => saveLanguageSettings({ interfaceLanguage }),
    languageSettingsReady,
    updateLanguageSettings: saveLanguageSettings,
    syncLanguagePreferences,
  }), [
    dictMode,
    languageSettings.interfaceLanguage,
    languageSettings.nativeLanguage,
    languageSettings.targetLanguage,
    languageSettingsReady,
    saveLanguageSettings,
    syncLanguagePreferences,
  ]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
