export const MATURITY_LEVELS = {
  NEW: 'new',
  GROWING: 'growing',
  FAMILIAR: 'familiar',
  MATURE: 'mature',
  GRADUATED: 'graduated',
};

export const MATURITY_ORDER = [
  'new',
  'growing',
  'familiar',
  'mature',
  'graduated',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const HIGHLIGHT_TONES = {
  [MATURITY_LEVELS.NEW]: 'strong',
  [MATURITY_LEVELS.GROWING]: 'normal',
  [MATURITY_LEVELS.FAMILIAR]: 'soft',
  [MATURITY_LEVELS.MATURE]: 'faint',
  [MATURITY_LEVELS.GRADUATED]: 'hidden',
};

const MATURITY_META = {
  [MATURITY_LEVELS.NEW]: {
    label: 'New',
    description: 'Saved but not yet reinforced by reading.',
    tone: 'neutral',
  },
  [MATURITY_LEVELS.GROWING]: {
    label: 'Growing',
    description: 'Seen a few times or marked okay.',
    tone: 'warning',
  },
  [MATURITY_LEVELS.FAMILIAR]: {
    label: 'Familiar',
    description: 'Repeatedly encountered or marked easy.',
    tone: 'info',
  },
  [MATURITY_LEVELS.MATURE]: {
    label: 'Mature',
    description: 'Often encountered through reading.',
    tone: 'success',
  },
  [MATURITY_LEVELS.GRADUATED]: {
    label: 'Graduated',
    description: 'Hidden from active review by default.',
    tone: 'muted',
  },
};

const getSafeRow = (row) => (row && typeof row === 'object' ? row : {});

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const toCount = (value) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.trunc(numberValue));
};

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return Boolean(value);
};

const normalizeDateField = (value) => (hasValue(value) ? value : null);

const normalizeMaturity = (maturity) => {
  if (!hasValue(maturity)) return null;
  const normalized = String(maturity).trim().toLowerCase();
  return MATURITY_ORDER.includes(normalized) ? normalized : null;
};

const parseDate = (dateValue) => {
  if (!hasValue(dateValue)) return null;
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const daysSince = (dateValue, now = new Date()) => {
  const date = parseDate(dateValue);
  const nowDate = parseDate(now);

  if (!date || !nowDate) return null;

  return Math.floor((startOfDay(nowDate).getTime() - startOfDay(date).getTime()) / DAY_MS);
};

export const getMaturityForVocab = (row) => {
  const safeRow = getSafeRow(row);
  const encounterCount = toCount(safeRow.encounter_count);
  const level = hasValue(safeRow.level) ? String(safeRow.level).trim().toLowerCase() : '';
  const storedMaturity = normalizeMaturity(safeRow.maturity);

  if (hasValue(safeRow.graduated_at) || storedMaturity === MATURITY_LEVELS.GRADUATED) {
    return MATURITY_LEVELS.GRADUATED;
  }

  if (level === 'bad' && storedMaturity === MATURITY_LEVELS.GROWING) {
    return MATURITY_LEVELS.GROWING;
  }

  if (encounterCount >= 9 || (level === 'good' && encounterCount >= 5)) {
    return MATURITY_LEVELS.MATURE;
  }

  if (encounterCount >= 5 || level === 'good') {
    return MATURITY_LEVELS.FAMILIAR;
  }

  if (encounterCount >= 2 || level === 'mid') {
    return MATURITY_LEVELS.GROWING;
  }

  return MATURITY_LEVELS.NEW;
};

export const normalizeVocabLearningFields = (row) => {
  const safeRow = getSafeRow(row);
  const normalized = {
    ...safeRow,
    encounter_count: toCount(safeRow.encounter_count),
    implicit_review_count: toCount(safeRow.implicit_review_count),
    correct_count: toCount(safeRow.correct_count),
    wrong_count: toCount(safeRow.wrong_count),
    graduated_at: normalizeDateField(safeRow.graduated_at),
    last_encountered_at: normalizeDateField(safeRow.last_encountered_at),
    next_review_at: normalizeDateField(safeRow.next_review_at),
    last_reviewed_at: normalizeDateField(safeRow.last_reviewed_at),
    is_favorite: toBoolean(safeRow.is_favorite),
  };

  normalized.maturity = getMaturityForVocab(normalized);

  return normalized;
};

export const getMaturityMeta = (maturity) => {
  const normalizedMaturity = normalizeMaturity(maturity) || MATURITY_LEVELS.NEW;
  const sortRank = MATURITY_ORDER.indexOf(normalizedMaturity);

  return {
    ...MATURITY_META[normalizedMaturity],
    sortRank,
  };
};

export const isDueForReview = (row, now = new Date()) => {
  const safeRow = getSafeRow(row);
  const nextReviewAt = parseDate(safeRow.next_review_at);
  const nowDate = parseDate(now);

  if (!nextReviewAt || !nowDate) return false;
  if (getMaturityForVocab(safeRow) === MATURITY_LEVELS.GRADUATED) return false;

  return nextReviewAt.getTime() <= nowDate.getTime();
};

export const isLongTailWord = (row, now = new Date()) => {
  const normalized = normalizeVocabLearningFields(row);

  if (normalized.maturity === MATURITY_LEVELS.GRADUATED) return false;
  if (isDueForReview(normalized, now)) return true;

  const daysSinceEncounter = daysSince(normalized.last_encountered_at, now);
  if (daysSinceEncounter !== null && daysSinceEncounter >= 14) return true;

  const daysSinceCreated = daysSince(normalized.created_at, now);
  return normalized.encounter_count <= 1 && daysSinceCreated !== null && daysSinceCreated >= 7;
};

export const getHighlightTone = (row) => {
  const maturity = getMaturityForVocab(row);
  return HIGHLIGHT_TONES[maturity] || HIGHLIGHT_TONES[MATURITY_LEVELS.NEW];
};

export const shouldRecordImplicitReview = (row, now = new Date()) => {
  if (!isDueForReview(row, now)) return false;

  const normalized = normalizeVocabLearningFields(row);
  if (normalized.maturity === MATURITY_LEVELS.GRADUATED) return false;

  const daysSinceEncounter = daysSince(normalized.last_encountered_at, now);
  if (daysSinceEncounter !== 0) return true;

  return daysSince(normalized.last_reviewed_at, now) !== 0;
};
