import {
  beginnerLevelLabel,
  dailyLevelSeries,
  describeLevel,
  chartColumnFor,
  levelChartSeries,
  levelPlaceForTheta,
  levelRange,
  startingTheta,
  wordGoal,
  wordsForTheta,
} from '../levelSummary';
import { COVERAGE, coverage, vocabularySize } from '../levelScale';
import {
  BEGINNER_THETA,
  beginnerWords,
  getVocabTiers,
  isBeginnerTheta,
  thetaForTier,
} from '../vocabSizeLevels';
import { createWordCheck } from '../wordCheck';
import { LEVEL_THETA_MIN } from '../abilityModel';

describe('below the first tier ("just starting")', () => {
  const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

  it('seeds "just starting" at the bottom of the scale, below every tier', () => {
    expect(BEGINNER_THETA).toBe(LEVEL_THETA_MIN);
    ['ko', 'zh', 'en'].forEach((language) => {
      expect(isBeginnerTheta(language, BEGINNER_THETA)).toBe(true);
      // Seeding the first tier (the old seed) claimed all of HSK 1 / A1.
      const [first] = getVocabTiers(language);
      if (first.label) expect(BEGINNER_THETA).toBeLessThan(thetaForTier(language, first.threshold));
    });
  });

  it('names a reader who knew none of the words a beginner, not the first tier', () => {
    ['ko', 'zh', 'en'].forEach((language) => {
      const check = createWordCheck({ language, reader: { theta: 0, variance: 2 }, seed: 7 });
      while (check.next()) check.answer(0);
      const { theta } = check.result();
      expect(isBeginnerTheta(language, theta)).toBe(true);
      const described = describeLevel(language, { estimate: theta, low: theta, high: theta });
      expect(described.beginner).toEqual({ estimate: true, low: true, high: true });
      expect(levelPlaceForTheta(language, theta).beginner).toBe(true);
    });
    expect(beginnerLevelLabel('ko', t)).toBe('level.preBeginner');
    expect(beginnerLevelLabel('zh', t)).toBe('level.belowTier:{"level":"HSK 1"}');
    expect(beginnerLevelLabel('en', t)).toBe('Pre-A1');
  });

  it('keeps picked tiers above the beginner line', () => {
    ['zh', 'en'].forEach((language) => {
      getVocabTiers(language).forEach((tier) => {
        const theta = thetaForTier(language, tier.threshold);
        expect(isBeginnerTheta(language, theta)).toBe(false);
        expect(levelPlaceForTheta(language, theta).beginner).toBe(false);
      });
    });
    // Korean: from the first frequency tier the scale tells from its floor
    // (100-700 all pick the bottom of the scale).
    expect(beginnerWords('ko')).toBe(1000);
    getVocabTiers('ko').filter((tier) => tier.threshold >= 1000).forEach((tier) => {
      expect(isBeginnerTheta('ko', thetaForTier('ko', tier.threshold))).toBe(false);
    });
    expect(beginnerWords('zh')).toBe(getVocabTiers('zh')[0].threshold);
    expect(beginnerWords('en')).toBe(getVocabTiers('en')[0].threshold);
  });
});

describe('describing the reader level', () => {
  it('turns a level and its spread into an 80% range, inside the scale', () => {
    const range = levelRange(0, 1);
    expect(range.estimate).toBe(0);
    expect(range.low).toBeCloseTo(-1.28);
    expect(range.high).toBeCloseTo(1.28);
    // A reader's level may lie beyond the words' range, up to +5.
    expect(levelRange(4.8, 1).high).toBe(5);
  });

  it('reads Korean levels as the words the reader is expected to know', () => {
    expect(wordsForTheta('ko', 0.5)).toBeCloseTo(vocabularySize('ko', 0.5), 6);
    const described = describeLevel('ko', { estimate: 0.5, low: -0.5, high: 1.5 });
    expect(described.kind).toBe('words');
    expect(described.low).toBeLessThan(described.estimate);
    expect(described.estimate).toBeLessThan(described.high);
  });

  it('labels HSK and CEFR by the highest band known to 80%', () => {
    ['zh', 'en'].forEach((language) => {
      getVocabTiers(language).forEach((tier, i) => {
        // Picking a tier shows that tier...
        const theta = thetaForTier(language, tier.threshold);
        expect(describeLevel(language, { estimate: theta, low: theta, high: theta }).estimate).toBe(tier.label);
        // ...because the reader then knows at least 80% of it.
        if (theta < 5) expect(coverage(language, theta, i + 1)).toBeGreaterThanOrEqual(COVERAGE);
      });
    });
    // Half of HSK 4 is not HSK 4 (it used to be).
    const half = describeLevel('zh', { estimate: 0, low: 0, high: 0 }).estimate;
    expect(half).not.toBe('HSK 4');
  });
});

describe('the level over time', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');

  it('keeps each day\'s last value and carries it over quiet days', () => {
    const rows = [
      { created_at: '2026-10-28T08:00:00Z', theta_after: 0.1, var_after: 0.5 },
      { created_at: '2026-10-28T20:00:00Z', theta_after: 0.3, var_after: 0.4 },
      { created_at: '2026-10-30T09:00:00Z', theta_after: 0.5, var_after: 0.3 },
    ];
    expect(dailyLevelSeries(rows, { days: 4, now }).map((point) => [point.day, point.theta])).toEqual([
      ['2026-10-28', 0.3],
      ['2026-10-29', 0.3],
      ['2026-10-30', 0.5],
    ]);
  });

  it('starts from the value before the window', () => {
    const rows = [{ created_at: '2026-09-01T00:00:00Z', theta_after: -1, var_after: 1 }];
    const series = dailyLevelSeries(rows, { days: 3, now });
    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({ day: '2026-10-28', theta: -1 });
  });
});

describe('where the reader started', () => {
  it('is the first pick, and later picks do not move it', () => {
    expect(startingTheta([
      { signal: 'seed', theta_after: -1.25 },
      { signal: 'seed', theta_after: 0.55 },
    ])).toBe(-1.25);
  });

  it('reads a pick made before engine 2.4 in today\'s meaning', () => {
    const zh = getVocabTiers('zh');
    // Old rows have no engine tag; the HSK 4 pick seeded its band position, 0.
    expect(startingTheta([{ signal: 'seed', theta_after: 0 }], 'zh')).toBeCloseTo(thetaForTier('zh', zh[3].threshold), 10);
    expect(startingTheta([{ signal: 'seed', theta_after: 2.02, details: '{"engine":"2.4"}' }], 'zh')).toBe(2.02);
  });

  it('is the level after the last answer of a first word check', () => {
    expect(startingTheta([
      { signal: 'check_start', theta_after: 0 },
      { signal: 'check', theta_after: 0.4 },
      { signal: 'pseudo', theta_after: 0.3 },
      { signal: 'seed', theta_after: 2 },
    ])).toBe(0.3);
  });

  it('is unknown without a start', () => {
    expect(startingTheta([])).toBeNull();
  });
});

describe('the level on the language scale, and goals', () => {
  it('places Korean on its six reading levels, with the next one', () => {
    expect(levelPlaceForTheta('ko', -4)).toMatchObject({ scale: 'ko', rank: 1, nextRank: 2 });
    expect(levelPlaceForTheta('ko', 5).nextRank).toBeNull();
    const mid = levelPlaceForTheta('ko', 1);
    expect(mid.nextWords).toBeGreaterThan(wordsForTheta('ko', 1));
  });

  it('places English and Chinese on CEFR and HSK, with the next tier\'s words', () => {
    const en = getVocabTiers('en');
    const b1 = thetaForTier('en', en[2].threshold);
    expect(levelPlaceForTheta('en', b1)).toMatchObject({ scale: 'tier', label: 'B1', nextLabel: 'B2', nextWords: en[3].threshold });
    const zh = getVocabTiers('zh');
    expect(levelPlaceForTheta('zh', thetaForTier('zh', zh[3].threshold))).toMatchObject({ label: 'HSK 4', nextLabel: 'HSK 5' });
  });

  it('sets small goals that grow with the level', () => {
    const early = wordGoal(730);
    expect(early).toMatchObject({ reached: 700, next: 800 });
    expect(early.progress).toBeCloseTo(0.3);
    expect(wordGoal(1600)).toMatchObject({ reached: 1500, next: 1750 });
    expect(wordGoal(4200)).toMatchObject({ reached: 4000, next: 4500 });
    expect(wordGoal(12500)).toMatchObject({ reached: 12000, next: 13000 });
  });
});

describe('the chart over longer spans', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const rows = [
    { created_at: '2026-01-10T08:00:00Z', theta_after: -1, var_after: 0.5 },
    { created_at: '2026-06-01T08:00:00Z', theta_after: 0, var_after: 0.4 },
    { created_at: '2026-10-30T08:00:00Z', theta_after: 0.5, var_after: 0.3 },
  ];

  it('keeps 30 days as one column a day', () => {
    const chart = levelChartSeries(rows, '30', { now });
    expect(chart).toMatchObject({ columns: 30, groupDays: 1 });
    expect(chart.points[chart.points.length - 1]).toMatchObject({ index: 29, theta: 0.5 });
  });

  it('groups longer spans into at most 30 columns, ending today', () => {
    const half = levelChartSeries(rows, '180', { now });
    expect(half.columns).toBeLessThanOrEqual(30);
    expect(half.points[half.points.length - 1]).toMatchObject({ index: half.columns - 1, theta: 0.5 });

    const all = levelChartSeries(rows, 'all', { now });
    expect(all.columns).toBeLessThanOrEqual(30);
    expect(all.points[0].theta).toBe(-1);
  });

  it('finds the column a goal falls in', () => {
    const chart = levelChartSeries(rows, '30', { now });
    expect(chartColumnFor('2026-10-30T09:00:00Z', chart, now)).toBe(29);
    expect(chartColumnFor('2026-01-01T00:00:00Z', chart, now)).toBeNull();
  });
});
