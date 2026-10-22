import { bookIndexLanguages, tagPreprocessCacheEntries } from '../preprocessCacheEntries';

describe('tagPreprocessCacheEntries', () => {
  it('keeps each Korean entry in the language the server says it is in', () => {
    const entries = tagPreprocessCacheEntries([
      { stem: '사람', definition: 'người', interface_language: 'vi' },
      { stem: '희한하다', definition: 'strange', interface_language: 'en', fallback_language: 'en' },
    ], { language: 'ko', interfaceLanguage: 'vi' });

    expect(entries.map((entry) => [entry.stem, entry.interface_language, entry.definition])).toEqual([
      ['사람', 'vi', 'người'],
      ['희한하다', 'en', 'strange'],
    ]);
  });

  it('files untagged Korean entries as English, never as the app language', () => {
    const [entry] = tagPreprocessCacheEntries(
      [{ stem: '가격', definition: 'price' }],
      { language: 'ko', interfaceLanguage: 'vi' }
    );
    expect(entry.interface_language).toBe('en');
    expect(entry.definition).toBe('price');
  });

  it('keeps the old rule for Chinese books: other-language definitions are dropped', () => {
    const entries = tagPreprocessCacheEntries([
      { stem: '是', definition: 'là', interface_language: 'vi' },
      { stem: '的', definition: 'of', interface_language: 'en' },
      { stem: '了', definition: 'xong' },
    ], { language: 'zh', interfaceLanguage: 'vi' });

    expect(entries.map((entry) => entry.definition)).toEqual(['là', null, 'xong']);
  });

  it('skips entries without a stem', () => {
    expect(tagPreprocessCacheEntries([{ definition: 'x' }, null], { language: 'ko', interfaceLanguage: 'en' }))
      .toEqual([]);
  });
});

describe('bookIndexLanguages', () => {
  it('falls back to English rows for Korean books in another app language', () => {
    expect(bookIndexLanguages({ language: 'ko', interfaceLanguage: 'vi' })).toEqual(['vi', 'en']);
  });

  it('uses only the app language otherwise', () => {
    expect(bookIndexLanguages({ language: 'ko', interfaceLanguage: 'en' })).toEqual(['en']);
    expect(bookIndexLanguages({ language: 'zh', interfaceLanguage: 'vi' })).toEqual(['vi']);
  });
});
