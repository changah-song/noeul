import { normalizeBookLanguage } from '../constants/languages';
import { difficultyFromLevelRank } from './abilityModel';
import { normalizeLegacyKoreanStats } from './bookEase';

// ─── Starter book ────────────────────────────────────────────────────────────
//
// A brand-new reader with an empty shelf gets one bundled public-domain book
// suggested on Home ("Start reading") instead of a dead-end empty state. The pick
// is deterministic — same catalog + same ability → same book — so the card never
// reshuffles between renders or launches.
//
// Rule:
//   1. Only books in the reader's target language are eligible. None → null (the
//      caller keeps the plain empty state).
//   2. When the reader's ability is known (`theta` on the shared [-3, 3] scale),
//      prefer the book whose graded level sits closest to it: distance =
//      |difficultyFromLevelRank(book level) − theta|. Unleveled books rank last.
//   3. Ties (and the no-ability fallback) go to the SHORTEST book (wordCount), then
//      the easier level, then the id so the order is total.
//
// Pure (no SQLite / React Native) so it is unit-testable; Home supplies theta.

const toFiniteNumber = (value) => {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getWordCount = (book) => {
  const count = toFiniteNumber(book?.wordCount ?? book?.word_count);
  return count != null && count > 0 ? count : null;
};

export const getStarterBookLevelRank = (book, language) => {
  const stats = normalizeLegacyKoreanStats(book?.bookLevel ?? null, language);
  return toFiniteNumber(stats?.level_rank ?? stats?.proficiency_rank);
};

const compareNullableAsc = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
};

/**
 * pickStarterBook — choose the one bundled book to suggest on an empty shelf.
 *
 * @param {Array<object>} books  catalog rows (getPublicDomainBooks shape:
 *        { id, language, wordCount, bookLevel: { level_rank } })
 * @param {object} options
 * @param {string} options.language      the reader's target language
 * @param {number|null} [options.theta]  the reader's ability, or null/undefined
 *        when we know nothing about them yet (→ shortest book)
 * @returns {object|null} the chosen book, or null when the language has none
 */
export const pickStarterBook = (books, { language, theta = null } = {}) => {
  if (!Array.isArray(books) || !language) {
    return null;
  }

  const targetLanguage = normalizeBookLanguage(language, null);
  if (!targetLanguage) {
    return null;
  }

  const abilityTheta = toFiniteNumber(theta);
  const candidates = books
    .filter((book) => book && normalizeBookLanguage(book.language ?? 'ko', null) === targetLanguage)
    .map((book) => {
      const levelRank = getStarterBookLevelRank(book, targetLanguage);
      const levelDistance = abilityTheta != null && levelRank != null
        // Rounded so float noise never outranks the word-count tie-break.
        ? Math.round(Math.abs(difficultyFromLevelRank(targetLanguage, levelRank) - abilityTheta) * 1000) / 1000
        : null;
      return {
        book,
        levelRank,
        levelDistance,
        wordCount: getWordCount(book),
        id: String(book.id ?? book.publicDomainId ?? book.uri ?? ''),
      };
    });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => (
    (abilityTheta != null ? compareNullableAsc(a.levelDistance, b.levelDistance) : 0)
    || compareNullableAsc(a.wordCount, b.wordCount)
    || compareNullableAsc(a.levelRank, b.levelRank)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  ));

  return candidates[0].book;
};

/**
 * starterThetaFromAbility — the theta to feed pickStarterBook from a
 * profile_ability row, or null when the row carries no real signal yet.
 *
 * A cold profile is seeded at a neutral theta 0 with no self-report and no
 * events; that 0 is a placeholder, not a measurement, so it falls back to the
 * shortest-book rule. A self-reported level, a calibration quiz or any reading
 * behaviour (event_count > 0) makes theta meaningful.
 */
export const starterThetaFromAbility = (ability) => {
  if (!ability) {
    return null;
  }
  const theta = toFiniteNumber(ability.theta);
  if (theta == null) {
    return null;
  }
  const eventCount = toFiniteNumber(ability.event_count) ?? 0;
  const selfReportRank = toFiniteNumber(ability.self_report_rank);
  return eventCount > 0 || selfReportRank != null ? theta : null;
};

// The first-book tutorial's book, by language: one whose opening pages are the
// story itself (short sentences, underlined words), not a title page and a
// long contents list. Ids are public_library ids / bundled catalog ids.
export const TUTORIAL_BOOK_IDS = {
  en: ['2ea64ae3-c4c3-4ed3-bed6-42b7e0961895'], // The Tale of Peter Rabbit
};

/**
 * pickTutorialBook — the tutorial's preferred book when the catalog has it,
 * else the starter book (pickStarterBook).
 */
export const pickTutorialBook = (books, { language, theta = null } = {}) => {
  const targetLanguage = normalizeBookLanguage(language, null);
  const preferred = TUTORIAL_BOOK_IDS[targetLanguage] ?? [];
  for (const id of preferred) {
    const match = (books ?? []).find((book) => (
      book && (book.publicLibraryId === id || book.publicDomainId === id)
    ));
    if (match) return match;
  }
  return pickStarterBook(books, { language, theta });
};
