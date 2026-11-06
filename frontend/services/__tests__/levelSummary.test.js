import {
  beginnerLevelLabel,
  dailyLevelSeries,
  describeLevel,
  chartColumnFor,
  LEVEL_LABEL_MARGIN,
  levelChartSeries,
  levelPlaceForTheta,
  levelPlaceKey,
  levelRange,
  roundWords,
  startingTheta,
  stickyLevelPlace,
  wordGoal,
  wordsForTheta,
} from '../levelSummary';
import {
  COUNT_FLOOR, COVERAGE, coverage, coveredBand, countedShare, legacyVocabularySize, vocabularySize,
} from '../levelScale';
import {
  BEGINNER_THETA,
  beginnerWords,
  getVocabTiers,
  isBeginnerTheta,
  legacySeedTheta,
  thetaForTier,
  tierIndexForTheta,
} from '../vocabSizeLevels';
import { createWordCheck } from '../wordCheck';
import { LEVEL_THETA_MAX, LEVEL_THETA_MIN } from '../abilityModel';
import { ITEM_SLOPE } from '../levelEngine';

const LANGUAGES = ['ko', 'zh', 'en'];
const cumulative = (language, band) => getVocabTiers(language)
  .filter((tier) => !tier.advanced)
  .reduce((sum, tier, i) => (tier.label && i < band ? tier.threshold : sum), 0);

describe('counting the words a reader knows', () => {
  it('counts a band from COUNT_FLOOR coverage, in full from COVERAGE', () => {
    expect(countedShare(COUNT_FLOOR)).toBe(0);
    expect(countedShare(0.3)).toBe(0);
    expect(countedShare(COVERAGE)).toBe(1);
    expect(countedShare(0.95)).toBe(1);
    expect(countedShare((COUNT_FLOOR + COVERAGE) / 2)).toBeCloseTo(0.5, 10);
  });

  it('credits a reader at the bottom of the scale with no words', () => {
    LANGUAGES.forEach((language) => {
      expect(vocabularySize(language, LEVEL_THETA_MIN)).toBe(0);
      expect(wordsForTheta(language, LEVEL_THETA_MIN)).toBe(0);
    });
    // The old count credited ~730 Korean words there.
    expect(legacyVocabularySize('ko', LEVEL_THETA_MIN)).toBeGreaterThan(500);
  });

  it('never falls as the level rises, up to every graded word', () => {
    LANGUAGES.forEach((language) => {
      let previous = -1;
      for (let theta = LEVEL_THETA_MIN; theta <= LEVEL_THETA_MAX; theta += 0.05) {
        const words = vocabularySize(language, theta);
        expect(words).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = words;
      }
    });
  });

  it('seeds each Korean frequency tier at its own, higher level, showing that many words', () => {
    const tiers = getVocabTiers('ko').filter((tier) => !tier.advanced);
    let previous = LEVEL_THETA_MIN;
    tiers.forEach((tier, index) => {
      const theta = thetaForTier('ko', tier.threshold);
      expect(theta).toBeGreaterThan(previous);
      previous = theta;
      expect(vocabularySize('ko', theta)).toBeCloseTo(tier.threshold, 3);
      expect(describeLevel('ko', { estimate: theta, low: theta, high: theta }).estimate).toBe(roundWords(tier.threshold));
      // ...and the picker reads the pick back as that row.
      expect(tierIndexForTheta('ko', theta)).toBe(index);
    });
  });

  it('credits an "HSK N" / CEFR reader with the words up to N and a share of the next', () => {
    ['zh', 'en'].forEach((language) => {
      const tiers = getVocabTiers(language);
      for (let theta = -1; theta <= LEVEL_THETA_MAX; theta += 0.1) {
        const band = coveredBand(language, theta);
        if (band >= 1) {
          const words = vocabularySize(language, theta);
          // Every word of the bands up to the label...
          expect(words).toBeGreaterThanOrEqual(cumulative(language, band) - 1e-6);
          // ...and less than the two bands after it.
          if (band + 2 <= tiers.length) expect(words).toBeLessThan(cumulative(language, band + 2));
        }
      }
    });
    // Picking HSK 4 no longer reads as ~12,000 of HSK 1-9's 17,676 words.
    const hsk4 = thetaForTier('zh', getVocabTiers('zh')[3].threshold);
    expect(vocabularySize('zh', hsk4)).toBeLessThan(8000);
    expect(legacyVocabularySize('zh', hsk4)).toBeGreaterThan(11000);
  });

  it('reads the reader measured at HSK 4 (θ 1.72 ± 0.74) as HSK 4 with a sensible count', () => {
    const range = levelRange(1.72, 0.74 ** 2);
    const described = describeLevel('zh', range);
    expect(described.estimate).toBe('HSK 4');
    const words = wordsForTheta('zh', 1.72);
    expect(words).toBeGreaterThan(cumulative('zh', 4));
    expect(words).toBeLessThan(cumulative('zh', 6));
  });

  it('leaves coverage, labels and the engine\'s P(known) alone', () => {
    // The engine's curve keeps its item-variance flattening.
    expect(ITEM_SLOPE).toBeCloseTo(1 / Math.sqrt(1 + (Math.PI / 8) * 0.6), 10);
    // A picked HSK / CEFR tier still seeds PICK_COVERAGE of its band.
    ['zh', 'en'].forEach((language) => {
      getVocabTiers(language).forEach((tier, i) => {
        const theta = thetaForTier(language, tier.threshold);
        if (theta < LEVEL_THETA_MAX) expect(coverage(language, theta, i + 1)).toBeCloseTo(0.85, 6);
      });
    });
  });

  it('reads a Korean pick made under engine 2.4 as the same word count today', () => {
    const old = -1.99; // 2.4 seeded "3,000 words" here
    expect(legacyVocabularySize('ko', old)).toBeCloseTo(3000, -1);
    const today = legacySeedTheta('ko', old, 2.4);
    expect(vocabularySize('ko', today)).toBeCloseTo(legacyVocabularySize('ko', old), 3);
    // The bottom of the scale stays there; 2.4 HSK / CEFR picks and 2.5 picks are kept.
    expect(legacySeedTheta('ko', LEVEL_THETA_MIN, 2.4)).toBe(LEVEL_THETA_MIN);
    expect(legacySeedTheta('zh', 2.02, 2.4)).toBe(2.02);
    expect(legacySeedTheta('ko', 1.19, 2.5)).toBe(1.19);
    expect(startingTheta([{ signal: 'seed', theta_after: old, details: '{"engine":"2.4"}' }], 'ko')).toBeCloseTo(today, 10);
    expect(startingTheta([{ signal: 'seed', theta_after: 1.19, details: '{"engine":"2.5"}' }], 'ko')).toBe(1.19);
  });
});

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
    // Korean: from the first frequency tier, 100 words; every tier picks a
    // level of its own above the bottom of the scale.
    expect(beginnerWords('ko')).toBe(100);
    getVocabTiers('ko').forEach((tier) => {
      const theta = thetaForTier('ko', tier.threshold);
      expect(theta).toBeGreaterThan(LEVEL_THETA_MIN);
      expect(isBeginnerTheta('ko', theta)).toBe(false);
    });
    // Fewer than the first tier's words is still a beginner.
    expect(isBeginnerTheta('ko', thetaForTier('ko', 100) - 0.05)).toBe(true);
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

describe('stickyLevelPlace', () => {
  // The θ where a Chinese band's label changes (coverage reaches 80%).
  const boundaryOf = (label) => {
    let theta = 0;
    while (levelPlaceForTheta('zh', theta).label !== label) theta += 0.005;
    return theta;
  };

  it('keeps the shown band until the level is clearly past the boundary', () => {
    const edge = boundaryOf('HSK 6');
    const hsk5 = levelPlaceKey(levelPlaceForTheta('zh', edge - 0.2));
    expect(levelPlaceForTheta('zh', edge + 0.02).label).toBe('HSK 6');
    // Just over the line: still HSK 5, as shown before.
    expect(stickyLevelPlace('zh', edge + 0.02, hsk5)).toMatchObject({ key: hsk5, place: { label: 'HSK 5' } });
    // Clearly past it: HSK 6.
    expect(stickyLevelPlace('zh', edge + LEVEL_LABEL_MARGIN + 0.02, hsk5).place.label).toBe('HSK 6');
    // And once HSK 6 is shown, a small dip back keeps it.
    const hsk6 = levelPlaceKey(levelPlaceForTheta('zh', edge + 0.2));
    expect(stickyLevelPlace('zh', edge - 0.02, hsk6).place.label).toBe('HSK 6');
  });

  it('shows the plain place with nothing shown before', () => {
    expect(stickyLevelPlace('zh', 1.0, null).place).toEqual(levelPlaceForTheta('zh', 1.0));
  });
});
