import { mergeVocabRows, vocabMergeKey } from '../vocabMerge';

const NOW = '2026-10-29T00:00:00.000Z';

describe('merging the same saved word from a guest into an account', () => {
  it('matches words across profiles by language, word, hanja and definition', () => {
    expect(vocabMergeKey({ language: 'ko', word: '학교', hanja: '學校', def_key: 'school', profile_id: 'a' }))
      .toBe(vocabMergeKey({ language: 'ko', word: '학교', hanja: '學校', def_key: 'school', profile_id: 'b' }));
  });

  it('keeps the most progress from either side', () => {
    const target = {
      level: 'unorganized', correct_count: 2, wrong_count: 5, last_reviewed_at: '2026-10-01T00:00:00Z',
      next_review_at: '2026-10-05T00:00:00Z', stability: 2, created_at: '2026-09-01T00:00:00Z', is_favorite: 0,
    };
    const source = {
      level: 'learned', correct_count: 6, wrong_count: 1, last_reviewed_at: '2026-10-20T00:00:00Z',
      next_review_at: '2026-11-20T00:00:00Z', stability: 9, created_at: '2026-08-01T00:00:00Z', is_favorite: 1,
    };
    expect(mergeVocabRows(target, source, NOW)).toMatchObject({
      level: 'learned',
      correct_count: 6,
      wrong_count: 5,
      last_reviewed_at: '2026-10-20T00:00:00Z',
      next_review_at: '2026-11-20T00:00:00Z',
      stability: 9,
      created_at: '2026-08-01T00:00:00Z',
      is_favorite: 1,
      deleted_at: null,
      updated_at: NOW,
    });
  });

  it('keeps a deletion only if it is newer than the other side', () => {
    const live = { updated_at: '2026-10-10T00:00:00Z' };
    expect(mergeVocabRows({ ...live }, { deleted_at: '2026-10-01T00:00:00Z' }, NOW).deleted_at).toBeNull();
    expect(mergeVocabRows({ ...live }, { deleted_at: '2026-10-20T00:00:00Z' }, NOW).deleted_at)
      .toBe('2026-10-20T00:00:00Z');
  });
});
