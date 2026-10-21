import { UI_TRANSLATIONS, translate } from '../translations';
import { KRDICT_INTERFACE_LANGUAGE_OPTIONS } from '../../constants/languages';

const placeholders = (value) => [...String(value).matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

// Translations that intentionally drop an English placeholder because the
// language folds it into grammar (e.g. Korean counters replace the noun).
// Anything else must carry exactly the English placeholders.
const ALLOWED_PLACEHOLDER_OMISSIONS = {
  ko: [
    'home.sortPublicDomain',
    'home.pdfReady',
    'home.pdfPageCount',
    'home.songStorageLimitBody',
    'write.toggleFormat',
  ],
};

const en = UI_TRANSLATIONS.en;
const enKeys = Object.keys(en);
const locales = Object.keys(UI_TRANSLATIONS).filter((language) => language !== 'en');

describe('UI translations', () => {
  it('has a table for every interface language the app offers', () => {
    KRDICT_INTERFACE_LANGUAGE_OPTIONS.forEach(({ code }) => {
      expect(UI_TRANSLATIONS[code]).toBeDefined();
    });
  });

  it.each(locales)('%s has exactly the English key set, in the same order', (language) => {
    expect(Object.keys(UI_TRANSLATIONS[language])).toEqual(enKeys);
  });

  it.each(locales)('%s has a non-empty string for every key', (language) => {
    const table = UI_TRANSLATIONS[language];
    const empty = enKeys.filter((key) => (
      typeof table[key] !== 'string' || (table[key].trim() === '' && en[key].trim() !== '')
    ));
    expect(empty).toEqual([]);
  });

  it.each(locales)('%s keeps the English {{placeholders}} for every key', (language) => {
    const table = UI_TRANSLATIONS[language];
    const allowedOmissions = new Set(ALLOWED_PLACEHOLDER_OMISSIONS[language] ?? []);
    const mismatched = enKeys.filter((key) => {
      const expected = placeholders(en[key]);
      const actual = placeholders(table[key]);
      if (allowedOmissions.has(key)) {
        return actual.some((name) => !expected.includes(name));
      }
      return actual.join(',') !== expected.join(',');
    });
    expect(mismatched).toEqual([]);
  });

  it('renders Japanese and Brazilian Portuguese strings', () => {
    expect(translate('ja', 'tabs.home')).toBe('ホーム');
    expect(translate('pt', 'tabs.home')).toBe('Início');
    expect(translate('pt', 'learn.reviewWordsOther', { count: 3 })).toBe('Revisar 3 palavras');
  });
});
