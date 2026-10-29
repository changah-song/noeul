import { dailyLevelSeries, describeLevel, levelRange, startingTheta, wordsForTheta } from '../levelSummary';

describe('describing the reader level', () => {
  it('turns a level and its spread into an 80% range, inside the scale', () => {
    const range = levelRange(0, 1);
    expect(range.estimate).toBe(0);
    expect(range.low).toBeCloseTo(-1.28);
    expect(range.high).toBeCloseTo(1.28);
    expect(levelRange(2.8, 1).high).toBe(3);
  });

  it('reads Korean levels as words known', () => {
    // Between the 1,500 (-0.31) and 2,000 (-0.02) tiers.
    expect(wordsForTheta('ko', -0.165)).toBeCloseTo(1750, -1);
    expect(describeLevel('ko', { estimate: -0.31, low: -0.59, high: -0.02 })).toEqual({
      kind: 'words', estimate: 1500, low: 1000, high: 2000,
    });
  });

  it('reads English and Chinese levels as their tier labels', () => {
    expect(describeLevel('en', { estimate: -0.6, low: -1.8, high: 0.6 })).toEqual({
      kind: 'tiers', estimate: 'B1', low: 'A2', high: 'B2',
    });
    expect(describeLevel('zh', { estimate: 0.2, low: 0.2, high: 0.2 }).estimate).toBe('HSK 4');
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
