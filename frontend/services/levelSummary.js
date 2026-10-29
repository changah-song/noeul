import { getVocabTiers } from './vocabSizeLevels';

// The reader's level in words a person can read: "about 1,200–2,000 words"
// (Korean, a frequency grid) or "B1–B2" / "HSK 3–4" (English, Chinese). The
// model's level is a mean (theta, -3..3) with a variance; the range shown is
// the middle 80% of that belief.

export const THETA_MIN = -3;
export const THETA_MAX = 3;
const RANGE_Z = 1.28;

const clampTheta = (value) => Math.max(THETA_MIN, Math.min(THETA_MAX, value));

export const levelRange = (theta, variance) => {
  const mean = clampTheta(Number(theta) || 0);
  const sd = Math.sqrt(Math.max(0, Number(variance) || 0));
  return {
    estimate: mean,
    low: clampTheta(mean - RANGE_Z * sd),
    high: clampTheta(mean + RANGE_Z * sd),
  };
};

const hasLabels = (tiers) => tiers.some((tier) => tier.label);

// Words known at `theta`, interpolated between the tiers around it.
export const wordsForTheta = (language, theta) => {
  const tiers = getVocabTiers(language).filter((tier) => !tier.advanced);
  if (tiers.length === 0) return null;
  const value = Number(theta);
  if (value <= tiers[0].theta) return tiers[0].threshold;
  for (let index = 1; index < tiers.length; index += 1) {
    const below = tiers[index - 1];
    const above = tiers[index];
    if (value <= above.theta) {
      const share = (value - below.theta) / Math.max(1e-6, above.theta - below.theta);
      return below.threshold + share * (above.threshold - below.threshold);
    }
  }
  return tiers[tiers.length - 1].threshold;
};

// Two significant figures: 1,234 -> 1,200; 87 -> 90.
const roundWords = (words) => {
  if (!Number.isFinite(words) || words <= 0) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(words)) - 1);
  return Math.round(words / magnitude) * magnitude;
};

// The tier label a theta falls in (the last tier at or below it).
export const tierLabelForTheta = (language, theta) => {
  const tiers = getVocabTiers(language);
  let label = tiers[0]?.label ?? null;
  tiers.forEach((tier) => {
    if (tier.label && tier.theta <= Number(theta) + 1e-6) label = tier.label;
  });
  return label;
};

/**
 * describeLevel — the words for a theta and for a range, for one language.
 * `{ kind: 'words', estimate, low, high }` (numbers, rounded) or
 * `{ kind: 'tiers', estimate, low, high }` (tier labels), or null.
 */
export const describeLevel = (language, { estimate, low, high }) => {
  const tiers = getVocabTiers(language);
  if (tiers.length === 0) return null;
  if (hasLabels(tiers)) {
    return {
      kind: 'tiers',
      estimate: tierLabelForTheta(language, estimate),
      low: tierLabelForTheta(language, low),
      high: tierLabelForTheta(language, high),
    };
  }
  return {
    kind: 'words',
    estimate: roundWords(wordsForTheta(language, estimate)),
    low: roundWords(wordsForTheta(language, low)),
    high: roundWords(wordsForTheta(language, high)),
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (value) => String(value || '').slice(0, 10);

/**
 * dailyLevelSeries — one point per day for the last `days` days, from the
 * level log (rows with created_at, theta_after, var_after; any order): the
 * day's last value, carried forward over days with no reading. Days before
 * the first log row are left out.
 */
export const dailyLevelSeries = (rows, { days = 30, now = Date.now() } = {}) => {
  const sorted = [...(rows ?? [])]
    .filter((row) => Number.isFinite(Number(row?.theta_after)) && row?.created_at)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (sorted.length === 0) return [];
  const lastByDay = new Map();
  sorted.forEach((row) => lastByDay.set(dayKey(row.created_at), row));

  const points = [];
  let current = null;
  const firstDay = dayKey(sorted[0].created_at);
  // Values from before the window start it off.
  const start = now - (days - 1) * DAY_MS;
  const startDay = new Date(start).toISOString().slice(0, 10);
  sorted.forEach((row) => {
    if (dayKey(row.created_at) < startDay) current = row;
  });
  for (let index = 0; index < days; index += 1) {
    const day = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    if (lastByDay.has(day)) current = lastByDay.get(day);
    if (!current || day < firstDay) continue;
    points.push({
      day,
      index,
      theta: Number(current.theta_after),
      variance: Number(current.var_after) || 0,
    });
  }
  return points;
};

/**
 * startingTheta — where the reader started: the first time their level was
 * set (onboarding's pick or "just starting", a 'seed'; or a word check, its
 * level after the last answer). Later picks don't move it. Rows: the level
 * log's seed / check rows, oldest first. Null when there is none.
 */
export const startingTheta = (rows) => {
  const list = rows ?? [];
  const first = list.findIndex((row) => row?.signal === 'seed' || row?.signal === 'check_start');
  if (first < 0) return null;
  let theta = Number(list[first].theta_after);
  if (list[first].signal === 'check_start') {
    for (let index = first + 1; index < list.length; index += 1) {
      const row = list[index];
      if (row.signal !== 'check' && row.signal !== 'pseudo') break;
      theta = Number(row.theta_after);
    }
  }
  return Number.isFinite(theta) ? theta : null;
};
