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

  it('credits every word, most uncertain first', () => {
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

    expect(result).toHaveLength(terms.length);
    expect(result.slice(0, 2)).toEqual(['w1', 'w3']);
    expect(result[result.length - 1]).toBe('w6');
  });

  it('caps a very dense unit, keeping the most uncertain words', () => {
    const terms = Array.from({ length: EXPOSURE_MAX_PER_UNIT + 10 }, (_, i) => `w${i}`);
    const weights = new Map(terms.map((term, i) => [term, i === 0 ? 1 : 0.5]));
    const result = selectExposureCredits({ ...READ, chars: 100000, dwellMs: 10000000, terms, weights });

    expect(result).toHaveLength(EXPOSURE_MAX_PER_UNIT);
    expect(result).not.toContain('w0');
  });

  it('ignores non-strings and duplicates', () => {
    const result = selectExposureCredits({ ...READ, terms: ['a', null, 3, 'a', ''] });
    expect(result).toEqual(['a']);
  });
});

describe('level sample', () => {
    const { isLevelSample, LEVEL_SAMPLE_RATE } = require('../levelSample');
    const { buildLevelExposureTerms } = require('../levelUnderlineTerms');

    it('picks a stable share of words', () => {
        const words = Array.from({ length: 4000 }, (_, i) => `词${i}`);
        const share = words.filter((w) => isLevelSample(w)).length / words.length;
        expect(Math.abs(share - LEVEL_SAMPLE_RATE)).toBeLessThan(0.03);
        expect(words.map((w) => isLevelSample(w))).toEqual(words.map((w) => isLevelSample(` ${w} `)));
        expect(isLevelSample('')).toBe(false);
        expect(isLevelSample(null)).toBe(false);
    });

    it('reports the sampled known words, not the underlined ones', () => {
        const stems = Array.from({ length: 200 }, (_, i) => `w${i}`);
        const sampled = stems.filter((s) => isLevelSample(s));
        const rows = stems.map((stem) => ({ surface: `${stem}s`, stem }));
        const underlined = [{ text: `${sampled[0]}s`, stem: sampled[0] }];
        const terms = buildLevelExposureTerms(rows, underlined);
        expect(terms.map((t) => t.stem)).toEqual(sampled.slice(1));
        expect(terms[0]).toEqual({ text: `${sampled[1]}s`, stem: sampled[1] });
    });

    it('caps underlined and unmarked words separately', () => {
        const marked = Array.from({ length: 50 }, (_, i) => `m${i}`);
        const unmarked = Array.from({ length: 50 }, (_, i) => `u${i}`);
        const weights = new Map(marked.map((t, i) => [t, i / 50]));
        const out = selectExposureCredits({
            terms: [...unmarked, ...marked], chars: 10, dwellMs: 60000, weights, max: 40,
        });
        expect(out.filter((t) => t.startsWith('m'))).toHaveLength(40);
        expect(out.filter((t) => t.startsWith('u'))).toHaveLength(40);
        // The most uncertain underlined words (weight nearest 0.5) are kept.
        expect(out).toContain('m25');
        expect(out).not.toContain('m0');
    });
});

describe('words shown with a translation', () => {
    const { isObservedLevelMark, LEVEL_MARK } = require('../levelSample');

    it('are not credited as read past', () => {
        const out = selectExposureCredits({
            terms: ['走廊', '蒲公英'], chars: 10, dwellMs: 60000,
            weights: new Map([['走廊', 0.5], ['蒲公英', 0.5]]), glossed: new Set(['走廊']),
        });
        expect(out).toEqual(['蒲公英']);
    });

    it('and their lookups do not count', () => {
        expect(isObservedLevelMark(LEVEL_MARK.underlined)).toBe(true);
        expect(isObservedLevelMark(LEVEL_MARK.sampled)).toBe(true);
        expect(isObservedLevelMark(LEVEL_MARK.glossed)).toBe(false);
        expect(isObservedLevelMark(LEVEL_MARK.none)).toBe(false);
    });
});
