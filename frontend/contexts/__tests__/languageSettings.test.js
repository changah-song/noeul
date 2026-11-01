// App language vs. learning language: the app can't be shown in the language
// being learned, but choosing a learning language must never lose the
// learner's own app language.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../LocalOwnerContext', () => ({ useLocalOwner: () => ({}) }));
jest.mock('../../services/localOwnerCoordinator', () => ({ isCurrentSyncGeneration: () => true }));
jest.mock('../../services/accountSettingsCloudSync', () => ({}));
jest.mock('../../services/preferencesCloudSync', () => ({ getTimestampMs: () => 0 }));
jest.mock('../../services/profilesCloudSync', () => ({}));
jest.mock('../../services/userDataSyncQueue', () => ({ requestUserDataSync: jest.fn() }));
jest.mock('../../services/Database', () => ({}));
jest.mock('../../theme/tokens', () => ({ ThemeProvider: ({ children }) => children }));

const { applyLanguageSettingsPatch, normalizeLanguageSettings } = require('../AppContext');

const pick = (settings) => ({
  targetLanguage: settings.targetLanguage,
  interfaceLanguage: settings.interfaceLanguage,
  preferredInterfaceLanguage: settings.preferredInterfaceLanguage,
});

it('keeps a Chinese phone in Chinese after trying Chinese as the learning language', () => {
  let settings = normalizeLanguageSettings({ targetLanguage: 'ko', interfaceLanguage: 'zh' });

  settings = applyLanguageSettingsPatch(settings, { targetLanguage: 'zh' });
  expect(pick(settings)).toEqual({ targetLanguage: 'zh', interfaceLanguage: 'en', preferredInterfaceLanguage: 'zh' });

  settings = applyLanguageSettingsPatch(settings, { targetLanguage: 'ko' });
  expect(pick(settings)).toEqual({ targetLanguage: 'ko', interfaceLanguage: 'zh', preferredInterfaceLanguage: 'zh' });
});

it('keeps an English phone in English after trying English as the learning language', () => {
  let settings = normalizeLanguageSettings({ targetLanguage: 'ko', interfaceLanguage: 'en' });

  settings = applyLanguageSettingsPatch(settings, { targetLanguage: 'en' });
  expect(settings.interfaceLanguage).toBe('ko');

  settings = applyLanguageSettingsPatch(settings, { targetLanguage: 'zh' });
  expect(pick(settings)).toEqual({ targetLanguage: 'zh', interfaceLanguage: 'en', preferredInterfaceLanguage: 'en' });
});

it('treats an app-language patch as the learner choosing it', () => {
  let settings = normalizeLanguageSettings({ targetLanguage: 'ko', interfaceLanguage: 'zh' });

  settings = applyLanguageSettingsPatch(settings, { interfaceLanguage: 'fr' });
  settings = applyLanguageSettingsPatch(settings, { targetLanguage: 'zh' });
  expect(pick(settings)).toEqual({ targetLanguage: 'zh', interfaceLanguage: 'fr', preferredInterfaceLanguage: 'fr' });
});

it('reads settings saved before the preference existed as the learner’s choice', () => {
  const settings = normalizeLanguageSettings({ targetLanguage: 'en', interfaceLanguage: 'ja' });
  expect(pick(settings)).toEqual({ targetLanguage: 'en', interfaceLanguage: 'ja', preferredInterfaceLanguage: 'ja' });
});

it('keeps Korean for a Korean speaker learning English', () => {
  const settings = normalizeLanguageSettings({ target_language: 'en', interface_language: 'ko' });
  expect(pick(settings)).toEqual({ targetLanguage: 'en', interfaceLanguage: 'ko', preferredInterfaceLanguage: 'ko' });
});
