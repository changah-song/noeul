// Smart-definition results are cached per (word, sentence): the same word in a
// different sentence must not reuse (or receive a late) explanation.

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }), { virtual: true });
jest.mock('../../services/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../../services/pronunciationAudio', () => ({ playEnglishPronunciation: jest.fn() }));

const { makeExplainCacheKey } = require('../Read/TopSection/DictionaryContent');

describe('makeExplainCacheKey', () => {
  it('separates the same word in different sentences', () => {
    expect(makeExplainCacheKey('눈', '눈이 온다.')).not.toBe(makeExplainCacheKey('눈', '눈을 감았다.'));
  });

  it('matches the same word and sentence, ignoring outer whitespace', () => {
    expect(makeExplainCacheKey(' 눈 ', '눈이 온다. ')).toBe(makeExplainCacheKey('눈', '눈이 온다.'));
  });

  it('separates different words in the same sentence', () => {
    expect(makeExplainCacheKey('눈', 's')).not.toBe(makeExplainCacheKey('비', 's'));
  });
});
