import {
  ENTRY_MAX_CHARS,
  ENTRY_MIN_CHARS,
  countEntryCharacters,
  countEntryWords,
  measureEntry,
  usesCharacterCount,
} from '../entryLength';

describe('entryLength', () => {
  test('Chinese and Japanese are measured in characters', () => {
    expect(usesCharacterCount('zh')).toBe(true);
    expect(usesCharacterCount('zh-Hant')).toBe(true);
    expect(usesCharacterCount('ja')).toBe(true);
    expect(usesCharacterCount('ko')).toBe(false);
    expect(usesCharacterCount('en')).toBe(false);
    expect(usesCharacterCount(undefined)).toBe(false);
  });

  test('a spaceless Chinese essay is not counted as one word', () => {
    const essay = '今天我和朋友一起去公园散步。天气很好，我们聊了很多事情。';
    expect(countEntryWords(essay)).toBe(1);
    // 25 Han characters; punctuation is not counted.
    expect(countEntryCharacters(essay)).toBe(25);
  });

  test('mixed-in non-CJK words count once each', () => {
    // 我喜欢 (3) + coffee (1) + 和 (1) + tea (1)
    expect(countEntryCharacters('我喜欢 coffee 和 tea')).toBe(6);
    expect(countEntryCharacters('我很happy')).toBe(3);
    expect(countEntryCharacters('  ，。!? ')).toBe(0);
  });

  test('Japanese kana and kanji are counted', () => {
    expect(countEntryCharacters('きょうはカフェで勉強した')).toBe(12);
  });

  test('measureEntry applies character limits for zh', () => {
    const short = measureEntry('我'.repeat(ENTRY_MIN_CHARS - 1), 'zh');
    expect(short).toMatchObject({ unit: 'characters', tooShort: true, tooLong: false });

    const ok = measureEntry('我'.repeat(ENTRY_MIN_CHARS), 'zh');
    expect(ok).toMatchObject({ unit: 'characters', count: ENTRY_MIN_CHARS, tooShort: false, tooLong: false });

    const long = measureEntry('我'.repeat(ENTRY_MAX_CHARS + 1), 'zh-Hant');
    expect(long).toMatchObject({ tooShort: false, tooLong: true, max: ENTRY_MAX_CHARS });
  });

  test('measureEntry keeps the 30–500 word limits for spaced languages', () => {
    const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    expect(measureEntry(words(29), 'ko')).toMatchObject({ unit: 'words', tooShort: true });
    expect(measureEntry(words(30), 'en')).toMatchObject({ unit: 'words', tooShort: false, tooLong: false });
    expect(measureEntry(words(501), 'ko')).toMatchObject({ tooLong: true });
    expect(measureEntry('', 'ko')).toMatchObject({ count: 0, tooShort: true });
  });
});
