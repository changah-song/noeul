// Translated catalog copy for the bundled public-domain books: the translated
// title, genre line and blurb (`snippet`) in each interface language. The
// English lives in catalog.js; i18n/<lang>.json holds the other 13 languages
// keyed by catalog book id. Missing languages/books/fields fall back to the
// English in catalog.js (or whatever the stored book carries).
//
// Bundled, so this works offline. Regenerate a language by translating the
// English fields of catalog.js (same ids, same "\n\n" paragraph breaks).

import { normalizeInterfaceLanguageCode } from '../../../constants/languages';

const CATALOG_TRANSLATIONS = {
  zh: require('./i18n/zh.json'),
  'zh-Hant': require('./i18n/zh-Hant.json'),
  ko: require('./i18n/ko.json'),
  ja: require('./i18n/ja.json'),
  fr: require('./i18n/fr.json'),
  es: require('./i18n/es.json'),
  pt: require('./i18n/pt.json'),
  ar: require('./i18n/ar.json'),
  mn: require('./i18n/mn.json'),
  vi: require('./i18n/vi.json'),
  th: require('./i18n/th.json'),
  id: require('./i18n/id.json'),
  ru: require('./i18n/ru.json'),
};

export const CATALOG_TRANSLATION_LANGUAGES = Object.keys(CATALOG_TRANSLATIONS);

const PUBLIC_DOMAIN_ID_PREFIX = 'public-domain-';
const PUBLIC_DOMAIN_URI_PREFIX = 'public-domain:';

// The catalog id of a bundled book, whichever shape it arrives in: a catalog
// entry ({ id }), a shelf book ({ publicDomainId, id: "public-domain-<id>",
// uri: "public-domain:<id>" }), or a bare id string.
export const getCatalogBookId = (bookOrId) => {
  if (typeof bookOrId === 'string') {
    return bookOrId.replace(PUBLIC_DOMAIN_URI_PREFIX, '').replace(PUBLIC_DOMAIN_ID_PREFIX, '');
  }
  if (!bookOrId || typeof bookOrId !== 'object') return '';
  if (bookOrId.publicDomainId) return String(bookOrId.publicDomainId);
  const uri = String(bookOrId.uri || '');
  if (uri.startsWith(PUBLIC_DOMAIN_URI_PREFIX)) return uri.slice(PUBLIC_DOMAIN_URI_PREFIX.length);
  const id = String(bookOrId.id || '');
  return id.startsWith(PUBLIC_DOMAIN_ID_PREFIX) ? id.slice(PUBLIC_DOMAIN_ID_PREFIX.length) : id;
};

// { title, genre, snippet } for a bundled book in `language`, or null (English
// or no translation).
export const getPublicDomainBookCopy = (bookOrId, language) => {
  const normalized = normalizeInterfaceLanguageCode(language);
  const table = CATALOG_TRANSLATIONS[normalized];
  if (!table) return null;
  const copy = table[getCatalogBookId(bookOrId)];
  return copy && typeof copy === 'object' ? copy : null;
};

// The book with its translated title/genre/blurb swapped in for `language`.
// Only bundled public-domain books are touched; anything else is returned as-is.
export const localizePublicDomainBook = (book, language) => {
  if (!book || typeof book !== 'object') return book;
  const isPublicDomain = book.publicDomain || book.publicDomainId
    || String(book.uri || '').startsWith(PUBLIC_DOMAIN_URI_PREFIX);
  if (!isPublicDomain) return book;
  const copy = getPublicDomainBookCopy(book, language);
  if (!copy) return book;
  return {
    ...book,
    titleTranslation: copy.title || book.titleTranslation,
    genre: copy.genre || book.genre,
    snippet: copy.snippet || book.snippet,
  };
};
