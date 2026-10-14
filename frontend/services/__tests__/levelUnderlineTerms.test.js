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

  it('skips malformed rows and attaches pinyin when present', () => {
    const terms = buildLevelUnderlineTerms(
      [
        { surface: '', level_rank: 6 },
        { surface: '缘分', level_rank: null },
        { surface: '邂逅', level_rank: 7, stem_count: 1, ipa: ' xiè hòu ' },
      ],
      'zh',
      -3
    );

    expect(terms).toHaveLength(1);
    expect(terms[0].text).toBe('邂逅');
    expect(terms[0].pinyin).toBe('xiè hòu');
  });
});
