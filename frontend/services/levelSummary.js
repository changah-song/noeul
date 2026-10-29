import { getVocabTiers } from './vocabSizeLevels';
import { seedThetaFromRank } from './abilityModel';

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
export const roundWords = (words) => {
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

export const LEVEL_CHART_RANGES = ['30', '180', 'all'];
// Most columns a chart draws; longer spans group days into weeks or more.
const MAX_COLUMNS = 30;

/**
 * levelChartSeries — the chart's columns for a range ('30' days, '180' days,
 * or 'all' since the first log row): `{ points, columns, groupDays, startDay }`. Each
 * column is the last value of its group of days (a day, a week, ...), with
 * `index` in 0..columns-1.
 */
export const levelChartSeries = (rows, range = '30', { now = Date.now() } = {}) => {
  let days = Number(range) || 30;
  if (range === 'all') {
    const first = (rows ?? []).reduce((min, row) => {
      const at = Date.parse(row?.created_at || '');
      return Number.isFinite(at) && at < min ? at : min;
    }, now);
    days = Math.max(30, Math.ceil((now - first) / DAY_MS) + 1);
  }
  const groupDays = Math.max(1, Math.ceil(days / MAX_COLUMNS));
  const columns = Math.ceil(days / groupDays);
  const daily = dailyLevelSeries(rows, { days, now });
  const byColumn = new Map();
  daily.forEach((point) => {
    // Grouped from the end, so today closes the last column.
    const column = columns - 1 - Math.floor((days - 1 - point.index) / groupDays);
    byColumn.set(column, { ...point, index: column });
  });
  const startDay = new Date(now - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { points: [...byColumn.values()].sort((a, b) => a.index - b.index), columns, groupDays, startDay };
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

// ─── The level on the language's own scale, and small goals ──────────────────

const KO_RANKS = [1, 2, 3, 4, 5, 6];

/**
 * levelPlaceForTheta — where a level sits on the language's own scale:
 * Korean's six reading levels (`{ scale: 'ko', rank, nextRank }`), or the
 * HSK / CEFR tier (`{ scale: 'tier', label, nextLabel }`), each with the words
 * known at the next one (`nextWords`, null at the top).
 */
export const levelPlaceForTheta = (language, theta) => {
  const value = Number(theta);
  if (language === 'ko') {
    let rank = 1;
    KO_RANKS.forEach((candidate) => {
      if (seedThetaFromRank('ko', candidate) <= value + 1e-6) rank = candidate;
    });
    const nextRank = rank < KO_RANKS.length ? rank + 1 : null;
    return {
      scale: 'ko',
      rank,
      nextRank,
      nextWords: nextRank ? wordsForTheta(language, seedThetaFromRank('ko', nextRank)) : null,
    };
  }
  const tiers = getVocabTiers(language);
  let index = 0;
  tiers.forEach((tier, i) => {
    if (tier.theta <= value + 1e-6) index = i;
  });
  const next = tiers[index + 1] ?? null;
  return {
    scale: 'tier',
    label: tiers[index]?.label ?? null,
    nextLabel: next?.label ?? null,
    nextWords: next ? next.threshold : null,
  };
};

// Small goals between levels: every 100 words early on, then 250, 500, 1,000.
export const goalStep = (words) => {
  if (words < 1000) return 100;
  if (words < 3000) return 250;
  if (words < 10000) return 500;
  return 1000;
};

/**
 * wordGoal — the goal just passed and the next one, and how far along:
 * `{ reached, next, progress }` with progress in 0..1.
 */
export const wordGoal = (words) => {
  const value = Math.max(0, Number(words) || 0);
  const step = goalStep(value);
  const reached = Math.floor(value / step) * step;
  return { reached, next: reached + step, progress: (value - reached) / step };
};

// The chart column a moment falls in (null when it's before the chart).
export const chartColumnFor = (at, { columns, groupDays }, now = Date.now()) => {
  const time = Date.parse(at || '');
  if (!Number.isFinite(time)) return null;
  const column = columns - 1 - Math.floor(Math.floor((now - time) / DAY_MS) / groupDays);
  return column >= 0 ? column : null;
};
