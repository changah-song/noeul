// Content that comes from the backend or bundled data is shown in the
// interface language: backend error codes, level names, catalog blurbs, and
// the header that tells the backend which language to answer in.

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({
        data: { session: { access_token: 'token' } },
        error: null,
      })),
      refreshSession: jest.fn(),
    },
  },
}));
jest.mock('../../config', () => ({ BASE_URL: 'http://api.test' }), { virtual: true });

// catalog.js requires the bundled .txt books, which Jest can't parse; stub them.
const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, '../../assets/data/public-domain/books');
fs.readdirSync(BOOKS_DIR).filter((file) => file.endsWith('.txt')).forEach((file) => {
  jest.doMock(path.join(BOOKS_DIR, file), () => 1);
});

const {
  CONTENT_STRINGS,
  englishFallbackLabel,
  errorKeyForCode,
  localizeApiError,
  localizedEtymologyType,
  localizedLevelLabel,
  translateContent,
} = require('../../i18n/contentStrings');
const { PUBLIC_DOMAIN_TEXTS } = require('../../assets/data/public-domain/catalog');
const {
  CATALOG_TRANSLATION_LANGUAGES,
  getCatalogBookId,
  getPublicDomainBookCopy,
  localizePublicDomainBook,
} = require('../../assets/data/public-domain/catalogI18n');
const { setRuntimeInterfaceLanguage } = require('../interfaceLanguage');

const LOCALES = ['en', 'zh', 'zh-Hant', 'ko', 'ja', 'fr', 'es', 'pt', 'ar', 'mn', 'vi', 'th', 'id', 'ru'];
const placeholders = (text) => [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('contentStrings', () => {
  it('has every key in all 14 locales with the same placeholders', () => {
    expect(Object.keys(CONTENT_STRINGS).sort()).toEqual([...LOCALES].sort());
    const keys = Object.keys(CONTENT_STRINGS.en);
    LOCALES.forEach((locale) => {
      expect(Object.keys(CONTENT_STRINGS[locale]).sort()).toEqual([...keys].sort());
      keys.forEach((key) => {
        expect(CONTENT_STRINGS[locale][key]).toBeTruthy();
        expect(placeholders(CONTENT_STRINGS[locale][key])).toEqual(placeholders(CONTENT_STRINGS.en[key]));
      });
    });
  });

  it('maps backend error codes to the interface language', () => {
    const error = {
      isAxiosError: true,
      response: { status: 429, data: { detail: 'English', code: 'explain_daily_limit', params: { limit: 250 } } },
    };
    expect(localizeApiError(error, 'ko')).toBe(translateContent('ko', 'error.explain_daily_limit', { limit: 250 }));
    expect(localizeApiError(error, 'ko')).toContain('250');
    expect(localizeApiError(error, 'ko')).not.toBe('English');
  });

  it('falls back to status, then network/timeout, never to English detail', () => {
    expect(localizeApiError({ response: { status: 503, data: { detail: 'x' } } }, 'fr'))
      .toBe(CONTENT_STRINGS.fr['error.service_unavailable']);
    expect(localizeApiError({ isAxiosError: true, message: 'Network Error' }, 'th'))
      .toBe(CONTENT_STRINGS.th['error.network']);
    expect(localizeApiError({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }, 'vi'))
      .toBe(CONTENT_STRINGS.vi['error.timeout']);
  });

  it('does not show a message with unfilled numbers', () => {
    expect(errorKeyForCode('entry_too_short_words', {})).toBe('error.invalid_request');
    expect(errorKeyForCode('entry_too_short_words', { length: 3, min: 30 })).toBe('error.entry_too_short_words');
    expect(errorKeyForCode('request_too_large')).toBe('error.invalid_request');
    expect(errorKeyForCode('made_up_code')).toBeNull();
  });

  it('translates Korean level names and keeps HSK/CEFR names', () => {
    expect(localizedLevelLabel('ko', 'Lower Intermediate', 'ko')).toBe(CONTENT_STRINGS.ko['level.ko.3']);
    expect(localizedLevelLabel('ko', 3, 'ja')).toBe(CONTENT_STRINGS.ja['level.ko.3']);
    expect(localizedLevelLabel('zh', 'HSK 3', 'ja')).toBe('HSK 3');
    expect(localizedLevelLabel('zh', 3, 'ja', 'HSK 3')).toBe('HSK 3');
    expect(localizedLevelLabel('ko', null, 'ja')).toBe('');
  });

  it('labels English fallbacks and formation types', () => {
    expect(englishFallbackLabel('ar', 'offline')).toBe(CONTENT_STRINGS.ar['content.englishFallbackOffline']);
    expect(englishFallbackLabel('ar', 'unavailable')).toBe(CONTENT_STRINGS.ar['content.englishFallback']);
    expect(localizedEtymologyType('pictophonetic', 'ko')).toBe(CONTENT_STRINGS.ko['chinese.etymology.pictophonetic']);
    expect(localizedEtymologyType('', 'ko')).toBe('');
  });
});

describe('catalog translations', () => {
  it('covers every bundled book in all 13 non-English languages', () => {
    expect([...CATALOG_TRANSLATION_LANGUAGES].sort()).toEqual(LOCALES.filter((l) => l !== 'en').sort());
    CATALOG_TRANSLATION_LANGUAGES.forEach((language) => {
      PUBLIC_DOMAIN_TEXTS.forEach((book) => {
        const copy = getPublicDomainBookCopy(book.id, language);
        expect(copy?.title).toBeTruthy();
        expect(copy?.genre).toBeTruthy();
        expect(copy?.snippet).toBeTruthy();
        expect(copy.snippet.split('\n\n')).toHaveLength(book.snippet.split('\n\n').length);
      });
    });
  });

  it('localizes shelf books and leaves other books alone', () => {
    const shelfBook = {
      id: 'public-domain-snow-queen',
      publicDomainId: 'snow-queen',
      uri: 'public-domain:snow-queen',
      publicDomain: true,
      snippet: 'English blurb',
      genre: 'English genre',
      titleTranslation: 'The Snow Queen',
    };
    expect(getCatalogBookId(shelfBook)).toBe('snow-queen');
    expect(getCatalogBookId('public-domain:snow-queen')).toBe('snow-queen');
    const localized = localizePublicDomainBook(shelfBook, 'es');
    expect(localized.snippet).toBe(getPublicDomainBookCopy('snow-queen', 'es').snippet);
    expect(localized.titleTranslation).toBe(getPublicDomainBookCopy('snow-queen', 'es').title);
    expect(localizePublicDomainBook(shelfBook, 'en')).toBe(shelfBook);
    const imported = { id: 'x', uri: 'file:///x.epub', snippet: 'mine' };
    expect(localizePublicDomainBook(imported, 'es')).toBe(imported);
  });
});

describe('api client language header and error text', () => {
  it('sends X-Interface-Language and localizes coded errors', async () => {
    const { api } = require('../api/client');
    setRuntimeInterfaceLanguage('ja');
    const seen = [];
    api.defaults.adapter = (config) => {
      seen.push(config);
      const error = new Error('Request failed with status code 429');
      error.isAxiosError = true;
      error.config = config;
      error.response = {
        status: 429,
        data: { detail: "You've used all 5 AI assessments", code: 'assess_daily_limit', params: { limit: 5 } },
        headers: {},
        config,
      };
      return Promise.reject(error);
    };

    let caught = null;
    try {
      await api.post('/assess_entry/', { body: 'x' });
    } catch (error) {
      caught = error;
    }
    expect(seen[0].headers['X-Interface-Language']).toBe('ja');
    const expected = translateContent('ja', 'error.assess_daily_limit', { limit: 5 });
    expect(caught.message).toBe(expected);
    expect(caught.response.data.detail).toBe(expected);
    expect(caught.response.data.detail_en).toBe("You've used all 5 AI assessments");
    setRuntimeInterfaceLanguage('en');
  });
});
