import { pickStarterBook, starterThetaFromAbility } from '../starterBook';

const book = (id, language, wordCount, levelRank, extra = {}) => ({
  id,
  language,
  wordCount,
  bookLevel: levelRank == null ? null : { level_rank: levelRank, proficiency_rank: levelRank },
  ...extra,
});

// A slice of the bundled catalog's real shape (ko: 6 levels → rank 4 = +0.6,
// rank 5 = +1.8 on the [-3, 3] ability scale).
const KO_BOOKS = [
  book('potato', 'ko', 1595, 5),
  book('little-match-girl', 'ko', 689, 5),
  book('butterflys-dream', 'ko', 834, 4),
  book('taepyeongcheonha', 'ko', 40222, 5),
];
const ZH_BOOKS = [
  book('ah-q-true-story', 'zh', 12996, 7),
  book('kong-yiji-lu-xun', 'zh', 1584, 7),
  book('madmans-diary-lu-xun', 'zh', 2660, 7),
];
const CATALOG = [...ZH_BOOKS, ...KO_BOOKS];

describe('pickStarterBook', () => {
  it('returns null when the target language has no bundled books', () => {
    expect(pickStarterBook(CATALOG, { language: 'en' })).toBeNull();
    expect(pickStarterBook(CATALOG, { language: 'en', theta: 0.5 })).toBeNull();
  });

  it('returns null for missing input', () => {
    expect(pickStarterBook([], { language: 'ko' })).toBeNull();
    expect(pickStarterBook(null, { language: 'ko' })).toBeNull();
    expect(pickStarterBook(CATALOG, {})).toBeNull();
    expect(pickStarterBook(CATALOG, { language: 'fr' })).toBeNull();
  });

  it('falls back to the shortest book in the language when ability is unknown', () => {
    expect(pickStarterBook(CATALOG, { language: 'ko' }).id).toBe('little-match-girl');
    expect(pickStarterBook(CATALOG, { language: 'ko', theta: null }).id).toBe('little-match-girl');
    expect(pickStarterBook(CATALOG, { language: 'ko', theta: Number.NaN }).id).toBe('little-match-girl');
    expect(pickStarterBook(CATALOG, { language: 'zh' }).id).toBe('kong-yiji-lu-xun');
  });

  it('normalizes language codes', () => {
    expect(pickStarterBook(CATALOG, { language: 'ko-KR' }).id).toBe('little-match-girl');
    expect(pickStarterBook(CATALOG, { language: 'zh-Hans' }).id).toBe('kong-yiji-lu-xun');
  });

  it('prefers the level closest to the reader ability', () => {
    // Beginner (-3) and intermediate (+0.6) readers are closest to rank 4.
    expect(pickStarterBook(CATALOG, { language: 'ko', theta: -3 }).id).toBe('butterflys-dream');
    expect(pickStarterBook(CATALOG, { language: 'ko', theta: 0.6 }).id).toBe('butterflys-dream');
    // Advanced readers are closest to rank 5 → shortest rank-5 book.
    expect(pickStarterBook(CATALOG, { language: 'ko', theta: 1.8 }).id).toBe('little-match-girl');
    expect(pickStarterBook(CATALOG, { language: 'ko', theta: 3 }).id).toBe('little-match-girl');
  });

  it('breaks level ties by word count', () => {
    expect(pickStarterBook(CATALOG, { language: 'zh', theta: -3 }).id).toBe('kong-yiji-lu-xun');
    expect(pickStarterBook(CATALOG, { language: 'zh', theta: 3 }).id).toBe('kong-yiji-lu-xun');
  });

  it('ranks unleveled books after leveled ones when ability is known', () => {
    const books = [
      book('unleveled-tiny', 'ko', 100, null),
      book('leveled-long', 'ko', 5000, 3),
    ];
    expect(pickStarterBook(books, { language: 'ko', theta: 0 }).id).toBe('leveled-long');
    // ...but without ability only length matters.
    expect(pickStarterBook(books, { language: 'ko' }).id).toBe('unleveled-tiny');
  });

  it('puts books without a word count last and breaks full ties by level then id', () => {
    const books = [
      book('no-count', 'ko', null, 1),
      book('b-same', 'ko', 900, 5),
      book('a-same', 'ko', 900, 5),
      book('easier-same-length', 'ko', 900, 2),
    ];
    expect(pickStarterBook(books, { language: 'ko' }).id).toBe('easier-same-length');
    expect(pickStarterBook(books.slice(0, 3), { language: 'ko' }).id).toBe('a-same');
  });

  it('is deterministic regardless of catalog order', () => {
    const reversed = [...CATALOG].reverse();
    [undefined, -3, 0, 1.2, 3].forEach((theta) => {
      expect(pickStarterBook(reversed, { language: 'ko', theta }).id)
        .toBe(pickStarterBook(CATALOG, { language: 'ko', theta }).id);
    });
  });

  it('treats books with no language as Korean (catalog default)', () => {
    const books = [{ id: 'legacy', wordCount: 10, bookLevel: null }];
    expect(pickStarterBook(books, { language: 'ko' }).id).toBe('legacy');
    expect(pickStarterBook(books, { language: 'zh' })).toBeNull();
  });

  it('remaps legacy NIKL Korean levels before measuring distance', () => {
    const books = [
      // Legacy grade 3 (고급) → reading level 5.
      book('legacy-advanced', 'ko', 500, 3, {
        bookLevel: { level_rank: 3, proficiency_system: 'NIKL' },
      }),
      book('modern-level-3', 'ko', 2000, 3),
    ];
    // A level-3 reader (theta -0.6) should NOT be matched with the legacy book.
    expect(pickStarterBook(books, { language: 'ko', theta: -0.6 }).id).toBe('modern-level-3');
  });

  it('does not mutate the input', () => {
    const books = [...KO_BOOKS];
    pickStarterBook(books, { language: 'ko', theta: 1 });
    expect(books.map((b) => b.id)).toEqual(KO_BOOKS.map((b) => b.id));
  });
});

describe('starterThetaFromAbility', () => {
  it('returns null for a missing or cold, unreported profile', () => {
    expect(starterThetaFromAbility(null)).toBeNull();
    expect(starterThetaFromAbility({ theta: 0, event_count: 0, self_report_rank: null })).toBeNull();
    expect(starterThetaFromAbility({ theta: null, event_count: 5 })).toBeNull();
  });

  it('returns theta once there is a self-report or reading behaviour', () => {
    expect(starterThetaFromAbility({ theta: -1.8, event_count: 0, self_report_rank: 2 })).toBe(-1.8);
    expect(starterThetaFromAbility({ theta: 0.4, event_count: 12, self_report_rank: null })).toBe(0.4);
  });
});

describe('pickStarterBook against the bundled catalog', () => {
  // catalog.js require()s the .txt assets, which Jest can't load, so rebuild the
  // rows the picker reads (id, language, wordCount, bookLevel) from source.
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '../../assets/data/public-domain');
  const levels = require('../../assets/data/public-domain/levels.generated.json');
  const catalogBooks = fs.readFileSync(path.join(dataDir, 'catalog.js'), 'utf8')
    .split(/\n {2}\{\n/).slice(1)
    .map((block) => ({
      id: (block.match(/id: '([^']+)'/) || [])[1],
      language: (block.match(/language: '([a-z]+)'/) || [])[1],
      wordCount: Number((block.match(/wordCount: (\d+)/) || [])[1]),
    }))
    .filter((row) => row.id && row.language)
    .map((row) => ({ ...row, bookLevel: levels[row.id] ?? null }));

  it('parses every bundled book', () => {
    expect(catalogBooks.length).toBeGreaterThanOrEqual(22);
  });

  it('suggests a bundled Korean and Chinese book, and nothing for English', () => {
    const koBooks = catalogBooks.filter((row) => row.language === 'ko');
    const ko = pickStarterBook(catalogBooks, { language: 'ko' });
    expect(ko.language).toBe('ko');
    expect(ko.wordCount).toBe(Math.min(...koBooks.map((row) => row.wordCount)));
    expect(pickStarterBook(catalogBooks, { language: 'ko', theta: -3 }).language).toBe('ko');
    expect(pickStarterBook(catalogBooks, { language: 'zh' }).id).toBe('kong-yiji-lu-xun');
    expect(pickStarterBook(catalogBooks, { language: 'en' })).toBeNull();
  });
});
