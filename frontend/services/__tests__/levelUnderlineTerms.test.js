import { buildLevelUnderlineTerms } from '../levelUnderlineTerms';
import { difficultyFromLevelRank, pKnown, underlineCategory } from '../abilityModel';

// buildLevelUnderlineTerms is shared by the book reader and the song reader, so
// both shade graded words from the same rows identically.

describe('buildLevelUnderlineTerms', () => {
  it('returns nothing without a usable theta', () => {
    const rows = [{ surface: '사랑', level_rank: 3, stem_count: 2 }];
    expect(buildLevelUnderlineTerms(rows, 'ko', undefined)).toEqual([]);
    expect(buildLevelUnderlineTerms(rows, 'ko', 'not-a-number')).toEqual([]);
  });

  it('matches underlineCategory(pKnown(theta, difficulty)) for each surface', () => {
    const theta = -2;
    const rows = [{ surface: 'serendipity', level_rank: 6, stem_count: 1 }];
    const [term] = buildLevelUnderlineTerms(rows, 'en', theta);
    const expected = underlineCategory(pKnown(theta, difficultyFromLevelRank('en', 6)), 1);

    expect(expected).not.toBeNull();
    expect(term).toEqual({ text: 'serendipity', weight: expected.weight, category: expected.category });
  });

  it('drops words the model already thinks are known', () => {
    const rows = [{ surface: 'the', level_rank: 1, stem_count: 40 }];
    expect(buildLevelUnderlineTerms(rows, 'en', 3)).toEqual([]);
  });

  it('keeps the hardest rank for an ambiguous surface', () => {
    const theta = -1;
    const hardOnly = buildLevelUnderlineTerms(
      [{ surface: 'bank', level_rank: 6, stem_count: 1 }],
      'en',
      theta
    );
    const ambiguous = buildLevelUnderlineTerms(
      [
        { surface: 'bank', level_rank: 6, stem_count: 1 },
        { surface: 'bank', level_rank: 2, stem_count: 5 },
      ],
      'en',
      theta
    );

    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]).toEqual(hardOnly[0]);
  });

  it('skips malformed rows, keeps ungraded words as hardest, and attaches pinyin', () => {
    const terms = buildLevelUnderlineTerms(
      [
        { surface: '', level_rank: 6 },
        { surface: '缘分', level_rank: null },
        { surface: '邂逅', level_rank: 7, stem_count: 1, ipa: ' xiè hòu ' },
      ],
      'zh',
      -3
    );

    expect(terms.map((t) => t.text).sort()).toEqual(['缘分', '邂逅']);
    const ungraded = terms.find((t) => t.text === '缘分');
    const hardestBand = terms.find((t) => t.text === '邂逅');
    // Outside the graded lists: shaded like the hardest band.
    expect(ungraded.weight).toBe(hardestBand.weight);
    expect(hardestBand.pinyin).toBe('xiè hòu');
  });

  it('falls back to the band when the percentile is null (not "easiest")', () => {
    const theta = -1;
    const [nullPercentile] = buildLevelUnderlineTerms(
      [{ surface: '邂逅', level_rank: 7, difficulty_percentile: null, stem_count: 1 }], 'zh', theta
    );
    const [bandOnly] = buildLevelUnderlineTerms(
      [{ surface: '邂逅', level_rank: 7, stem_count: 1 }], 'zh', theta
    );
    expect(nullPercentile).toBeDefined();
    expect(nullPercentile.weight).toBe(bandOnly.weight);
  });

  it('uses the difficulty percentile over the band when present', () => {
    const theta = 0;
    const [easyInBand] = buildLevelUnderlineTerms(
      [{ surface: '가', level_rank: 4, difficulty_percentile: 0.55, stem_count: 1 }], 'ko', theta
    );
    const [hardInBand] = buildLevelUnderlineTerms(
      [{ surface: '나', level_rank: 4, difficulty_percentile: 0.95, stem_count: 1 }], 'ko', theta
    );
    expect(hardInBand.weight).toBeGreaterThan(easyInBand.weight);
  });

  it('moves a word with the reader\'s own evidence', () => {
    const theta = 0;
    const row = { surface: '눕다', stem: '눕다', level_rank: 4, stem_count: 1 };
    const now = Date.parse('2026-10-15T00:00:00Z');
    const [plain] = buildLevelUnderlineTerms([row], 'ko', theta, { now });
    const [lookedUp] = buildLevelUnderlineTerms([row], 'ko', theta, {
      now,
      evidence: new Map([['눕다', { lookups: 3, lastLookupAt: now, exposures: 0, reviewsGood: 0, reviewsBad: 0, saved: false }]]),
    });
    const recalled = buildLevelUnderlineTerms([row], 'ko', theta, {
      now,
      evidence: new Map([['눕다', { lookups: 0, lastLookupAt: null, exposures: 0, reviewsGood: 4, reviewsBad: 0, saved: false }]]),
    });
    expect(lookedUp.weight).toBeGreaterThan(plain.weight);
    // Recalled four times in review: known well enough to lose its mark.
    expect(recalled).toEqual([]);
  });
});
