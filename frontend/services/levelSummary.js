import { getVocabTiers, isBeginnerTheta, isLegacySeed, legacySeedTheta, tierIndexForTheta } from './vocabSizeLevels';
import { coveredBand, thetaForBandCoverage, vocabularySize } from './levelScale';
import { LEVEL_THETA_MAX, LEVEL_THETA_MIN, seedThetaFromRank } from './abilityModel';

// The reader's level in words a person can read: "about 1,200–2,000 words"
// (Korean, a frequency grid) or "B1–B2" / "HSK 3–4" (English, Chinese). The
// model's level is a mean (theta, -3..3) with a variance; the range shown is
// the middle 80% of that belief.

export const THETA_MIN = LEVEL_THETA_MIN;
export const THETA_MAX = LEVEL_THETA_MAX;
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

// Words known at `theta`: the words counted (services/levelScale.js vocabularySize),
// or, for a language without word data, interpolated between its tiers.
export const wordsForTheta = (language, theta) => {
  const expected = vocabularySize(language, theta);
  if (Number.isFinite(expected)) return expected;
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

// The tier label a level reaches: the highest HSK / CEFR band the reader
// knows at least 80% of (levelScale COVERAGE).
export const tierLabelForTheta = (language, theta) => {
  const tiers = getVocabTiers(language);
  return tiers[tierIndexForTheta(language, theta)]?.label ?? null;
};

/**
 * describeLevel — the words for a theta and for a range, for one language.
 * `{ kind: 'words', estimate, low, high }` (numbers, rounded) or
 * `{ kind: 'tiers', estimate, low, high }` (tier labels), or null. `beginner`
 * flags each of the three that is below the first tier (isBeginnerTheta): show
 * beginnerLevelLabel there, not the number or label.
 */
export const describeLevel = (language, { estimate, low, high }) => {
  const tiers = getVocabTiers(language);
  if (tiers.length === 0) return null;
  const beginner = {
    estimate: isBeginnerTheta(language, estimate),
    low: isBeginnerTheta(language, low),
    high: isBeginnerTheta(language, high),
  };
  if (hasLabels(tiers)) {
    return {
      kind: 'tiers',
      estimate: tierLabelForTheta(language, estimate),
      low: tierLabelForTheta(language, low),
      high: tierLabelForTheta(language, high),
      beginner,
    };
  }
  return {
    kind: 'words',
    estimate: roundWords(wordsForTheta(language, estimate)),
    low: roundWords(wordsForTheta(language, low)),
    high: roundWords(wordsForTheta(language, high)),
    beginner,
  };
};

/**
 * beginnerLevelLabel — the name of the level below the first tier: "Pre-A1"
 * (CEFR's own name), "Below HSK 1", or for Korean "Pre-beginner" (below
 * Beginner 1). `t` is the interface translator.
 */
export const beginnerLevelLabel = (language, t) => {
  const [first] = getVocabTiers(language);
  if (first?.label === 'A1') return 'Pre-A1';
  if (first?.label) return t('level.belowTier', { level: first.label });
  return t('level.preBeginner');
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
export const startingTheta = (rows, language = null) => {
  const list = rows ?? [];
  const first = list.findIndex((row) => row?.signal === 'seed' || row?.signal === 'check_start');
  if (first < 0) return null;
  let theta = Number(list[first].theta_after);
  // A level picked under an older engine may mean something else today
  // (see legacySeedTheta).
  if (language && list[first].signal === 'seed' && isLegacyLevelRow(list[first], language)) {
    theta = legacySeedTheta(language, theta, levelRowEngine(list[first]));
  }
  if (list[first].signal === 'check_start') {
    for (let index = first + 1; index < list.length; index += 1) {
      const row = list[index];
      if (row.signal !== 'check' && row.signal !== 'pseudo') break;
      theta = Number(row.theta_after);
    }
  }
  return Number.isFinite(theta) ? theta : null;
};

/** The engine version a level-log row was written under (null: before 2.4). */
export const levelRowEngine = (row) => {
  let details = row?.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = null;
    }
  }
  const engine = Number.parseFloat(details?.engine);
  return Number.isFinite(engine) ? engine : null;
};

/**
 * Whether a level-log seed row means a different level today: any pick before
 * engine 2.4 (picks meant half a tier then), and with `language` a Korean
 * frequency-tier pick under 2.4 (the words count changed in 2.5).
 */
export const isLegacyLevelRow = (row, language = null) => {
  const engine = levelRowEngine(row);
  if (!language) return engine === null || engine < 2.4;
  return isLegacySeed(language, engine);
};

// ─── The level on the language's own scale, and small goals ──────────────────

const KO_RANKS = [1, 2, 3, 4, 5, 6];

/**
 * levelPlaceForTheta — where a level sits on the language's own scale:
 * Korean's six reading levels (`{ scale: 'ko', rank, nextRank }`), or the
 * HSK / CEFR tier (`{ scale: 'tier', label, nextLabel }`), each with the words
 * known at the next one (`nextWords`, null at the top). `beginner`: below the
 * first tier (name it with beginnerLevelLabel).
 */
export const levelPlaceForTheta = (language, theta) => {
  const value = Number(theta);
  const beginner = isBeginnerTheta(language, value);
  if (language === 'ko') {
    // The highest reading level whose words the reader knows 80% of.
    const covered = coveredBand('ko', value);
    const rank = Number.isFinite(covered) ? Math.max(1, Math.min(KO_RANKS.length, covered)) : 1;
    const nextRank = rank < KO_RANKS.length ? rank + 1 : null;
    const nextTheta = nextRank ? (thetaForBandCoverage('ko', nextRank, 0.8) ?? seedThetaFromRank('ko', nextRank)) : null;
    return {
      scale: 'ko',
      beginner,
      rank,
      nextRank,
      nextWords: nextRank ? wordsForTheta(language, nextTheta) : null,
    };
  }
  const tiers = getVocabTiers(language);
  const index = tierIndexForTheta(language, value);
  const next = tiers[index + 1] ?? null;
  return {
    scale: 'tier',
    beginner,
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
