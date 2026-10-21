// Helpers that turn data and errors into text safe to show in the interface
// language. Services and storage keep English sentinels ("Untitled", "Page 3")
// and English developer error messages; these map them at display time so a
// language switch never leaves English (or a stale language) on screen.
import { UI_TRANSLATIONS } from './translations';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Errors ──────────────────────────────────────────────────────────────────

const templateMatchers = new Map();

const getTemplateMatchers = (language) => {
  if (!templateMatchers.has(language)) {
    const table = UI_TRANSLATIONS[language] ?? UI_TRANSLATIONS.en;
    // Templates that are mostly placeholder ("{{count}} {{noun}}") would match
    // any text, so only templates with real wording take part.
    const matchers = Object.values(table)
      .map(String)
      .filter((template) => template.replace(/\{\{\w+\}\}/g, '').replace(/[\s\d.,:;!?'"()[\]\-–—…/·%×+→،。，、：！？（）「」]/g, '').length >= 4)
      .map((template) => new RegExp(
        `^${template.split(/\{\{\w+\}\}/).map(escapeRegExp).join('[\\s\\S]*')}$`
      ));
    templateMatchers.set(language, matchers);
  }
  return templateMatchers.get(language);
};

// True when `message` is one of the interface language's own UI strings
// (with any placeholder filled in) — i.e. it was produced with t() upstream.
export const isLocalizedMessage = (message, language) => {
  const text = String(message ?? '').trim();
  if (!text) {
    return false;
  }
  return getTemplateMatchers(language).some((matcher) => matcher.test(text));
};

const AUTH_ERROR_CODE_KEYS = {
  invalid_credentials: 'auth.errorInvalidCredentials',
  invalid_grant: 'auth.errorInvalidCredentials',
  user_already_exists: 'auth.errorUserExists',
  email_exists: 'auth.errorUserExists',
  email_not_confirmed: 'auth.errorEmailNotConfirmed',
  weak_password: 'auth.errorWeakPassword',
  email_address_invalid: 'auth.errorInvalidEmail',
  validation_failed: 'auth.errorInvalidEmail',
  over_email_send_rate_limit: 'auth.errorRateLimited',
  over_request_rate_limit: 'auth.errorRateLimited',
  over_sms_send_rate_limit: 'auth.errorRateLimited',
  signup_disabled: 'auth.errorSignupDisabled',
};

const AUTH_ERROR_MESSAGE_KEYS = [
  [/invalid login credentials|invalid credentials/i, 'auth.errorInvalidCredentials'],
  [/already registered|already exists|already been registered/i, 'auth.errorUserExists'],
  [/email not confirmed/i, 'auth.errorEmailNotConfirmed'],
  [/password should|password must|weak password|at least \d+ characters/i, 'auth.errorWeakPassword'],
  [/invalid email|unable to validate email|email address .* invalid/i, 'auth.errorInvalidEmail'],
  [/rate limit|too many requests|security purposes/i, 'auth.errorRateLimited'],
  [/signups? not allowed|signup is disabled/i, 'auth.errorSignupDisabled'],
];

const NETWORK_ERROR_PATTERN = /network|internet|offline|failed to fetch|fetch failed|timed? ?out|timeout/i;

// Every error shown to the user goes through here. A message that is already
// in the interface language is kept; anything else (English from a service,
// Supabase, the OS) becomes the translated fallback.
export const getUserFacingErrorMessage = (error, t, fallbackKey, language) => {
  const message = typeof error === 'string' ? error : error?.message;
  if (error?.localized && message) {
    return message;
  }
  if (language && isLocalizedMessage(message, language)) {
    return message;
  }
  if (NETWORK_ERROR_PATTERN.test(String(message ?? '')) || error?.code === 'TIMEOUT') {
    return t('common.networkError');
  }
  return t(fallbackKey);
};

export const getAuthErrorMessage = (error, t, language, fallbackKey = 'common.genericError') => {
  if (language && isLocalizedMessage(error?.message, language)) {
    return error.message;
  }
  const code = String(error?.code ?? error?.error_code ?? '').toLowerCase();
  if (AUTH_ERROR_CODE_KEYS[code]) {
    return t(AUTH_ERROR_CODE_KEYS[code]);
  }
  const message = String(error?.message ?? '');
  const match = AUTH_ERROR_MESSAGE_KEYS.find(([pattern]) => pattern.test(message));
  if (match) {
    return t(match[1]);
  }
  if (NETWORK_ERROR_PATTERN.test(message)) {
    return t('common.networkError');
  }
  return t(fallbackKey);
};

// ─── Stored placeholders ─────────────────────────────────────────────────────

// Placeholders that older code stored in book/song records when the source had
// no value: the English sentinels from imports (JS and the native PDF importer)
// and, from the edit/add flows, these labels in whatever interface language was
// active then. New code stores an empty string; all of them count as "missing"
// and are shown translated in the current language.
const PLACEHOLDER_LABEL_KEYS = ['common.untitled', 'common.unknownAuthor', 'common.unknownArtist', 'song.untitled'];

const STORED_PLACEHOLDER_KEYS = (() => {
  const keys = {
    untitled: 'common.untitled',
    'unknown author': 'common.unknownAuthor',
    'untitled song': 'song.untitled',
    'unknown artist': 'common.unknownArtist',
    unknown: 'common.unknown',
  };
  Object.values(UI_TRANSLATIONS).forEach((table) => {
    PLACEHOLDER_LABEL_KEYS.forEach((key) => {
      const label = String(table[key] ?? '').trim().toLowerCase();
      if (label && !keys[label]) {
        keys[label] = key;
      }
    });
  });
  return keys;
})();

// The stored value with legacy English placeholders treated as missing ('').
export const stripStoredPlaceholder = (value) => {
  const text = String(value ?? '').trim();
  return STORED_PLACEHOLDER_KEYS[text.toLowerCase()] ? '' : text;
};

export const localizeStoredPlaceholder = (value, t) => {
  const text = String(value ?? '').trim();
  const key = STORED_PLACEHOLDER_KEYS[text.toLowerCase()];
  return key ? t(key) : text;
};

// PDF sections without an outline get generated English names in
// services/pdfMetadata.js (and may already be cached that way).
export const localizeGeneratedSectionLabel = (value, t) => {
  const text = String(value ?? '').trim();
  let match = /^Page (\d+)$/i.exec(text);
  if (match) {
    return t('read.pageNumber', { page: match[1] });
  }
  match = /^Pages (\d+)\s*[-–]\s*(\d+)$/i.exec(text);
  if (match) {
    return t('read.pageRange', { start: match[1], end: match[2] });
  }
  if (/^front matter$/i.test(text)) {
    return t('read.frontMatter');
  }
  return localizeStoredPlaceholder(text, t);
};

// ─── Languages and levels ────────────────────────────────────────────────────

// Name of a language code in the interface language; codes without a
// language.* key fall back to the bare code (never an English name).
export const getLocalizedLanguageName = (code, t) => {
  const raw = String(code ?? '').trim();
  if (!raw) {
    return t('common.unknown');
  }
  if (UI_TRANSLATIONS.en[`language.${raw}`]) {
    return t(`language.${raw}`);
  }
  const short = raw.toLowerCase().split(/[-_]/)[0];
  if (UI_TRANSLATIONS.en[`language.${short}`]) {
    return t(`language.${short}`);
  }
  return raw.toUpperCase();
};

// The Korean book grades are stored as their Korean names (초급/중급/고급).
const KOREAN_GRADE_KEYS = {
  초급: 'bookLevel.koBeginner',
  중급: 'bookLevel.koIntermediate',
  고급: 'bookLevel.koAdvanced',
};

export const localizeBookLevelLabel = (value, t) => {
  const text = String(value ?? '').trim();
  return KOREAN_GRADE_KEYS[text] ? t(KOREAN_GRADE_KEYS[text]) : localizeStoredPlaceholder(text, t);
};

// Reading-level options (constants/proficiencyLevels.js): Korean levels carry
// a labelKey; HSK and CEFR names are the same in every language.
export const getProficiencyLevelLabel = (option, t) => {
  if (!option) {
    return '';
  }
  return option.labelKey ? t(option.labelKey) : option.label;
};
