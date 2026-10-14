import { EXPOSURE_MAX_PER_UNIT, selectExposureCredits } from '../readerExposure';

// A unit long enough and read slowly enough to pass the dwell gate.
const READ = { chars: 100, dwellMs: 20000 };

describe('selectExposureCredits', () => {
  it('credits nothing for an empty unit', () => {
    expect(selectExposureCredits({ ...READ, terms: [] })).toEqual([]);
    expect(selectExposureCredits({ ...READ, terms: undefined })).toEqual([]);
  });

  it('credits nothing when the unit was skimmed', () => {
    expect(selectExposureCredits({ terms: ['a'], chars: 1000, dwellMs: 100 })).toEqual([]);
  });

  it('excludes looked-up and saved words', () => {
    const result = selectExposureCredits({
      ...READ,
      terms: ['looked', 'saved', 'skipped'],
      lookedUp: new Set(['looked']),
      saved: new Set(['saved']),
    });
    expect(result).toEqual(['skipped']);
  });

  it('ranks by model uncertainty (weight nearest 0.5) and caps the unit', () => {
    const terms = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
    const weights = new Map([
      ['w0', 0.1],
      ['w1', 0.5],
      ['w2', 0.9],
      ['w3', 0.45],
      ['w4', 0.7],
      ['w5', 0.3],
      ['w6', 1],
    ]);
    const result = selectExposureCredits({ ...READ, terms, weights });

    expect(result).toHaveLength(EXPOSURE_MAX_PER_UNIT);
    expect(result.slice(0, 2)).toEqual(['w1', 'w3']);
    expect(result).not.toContain('w6');
  });

  it('ignores non-strings and duplicates', () => {
    const result = selectExposureCredits({ ...READ, terms: ['a', null, 3, 'a', ''] });
    expect(result).toEqual(['a']);
  });
});
