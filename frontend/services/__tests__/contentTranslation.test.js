// Bundled English content (hanja meanings, Chinese character data) is
// machine-translated through the backend, cached, and labelled as English when
// that isn't possible.

jest.mock('../api/client', () => ({ api: { post: jest.fn() } }));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { api } = require('../api/client');
const {
  __resetContentTranslationCache,
  translateContentTexts,
} = require('../contentTranslation');
const { localizeHanjaResult } = require('../api/hanjaRelated');
const { localizeChineseCharacterRows } = require('../chineseCharacterDatabase');

beforeEach(async () => {
  __resetContentTranslationCache();
  await (AsyncStorage.default ?? AsyncStorage).clear();
  api.post.mockReset();
});

describe('translateContentTexts', () => {
  it('translates once and then serves from the cache', async () => {
    api.post.mockResolvedValue({ data: { translations: ['水 (ja)', '火 (ja)'] } });
    const first = await translateContentTexts(['water', 'fire', 'water'], 'ja', { kind: 'hanja_meaning' });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][1]).toEqual({ texts: ['water', 'fire'], kind: 'hanja_meaning', interface_language: 'ja' });
    expect(first.translations.get('water')).toBe('水 (ja)');
    expect(first.fallback).toBeNull();

    const second = await translateContentTexts(['fire'], 'ja');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(second.translations.get('fire')).toBe('火 (ja)');
  });

  it('does nothing for English', async () => {
    const result = await translateContentTexts(['water'], 'en');
    expect(api.post).not.toHaveBeenCalled();
    expect(result.translations.size).toBe(0);
    expect(result.fallback).toBeNull();
  });

  it('reports offline vs unavailable', async () => {
    api.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    expect((await translateContentTexts(['water'], 'pt')).fallback).toBe('offline');
    api.post.mockResolvedValueOnce({ data: { translations: [null] } });
    expect((await translateContentTexts(['water'], 'pt')).fallback).toBe('unavailable');
  });
});

describe('hanja meanings', () => {
  const result = {
    firstTableData: [
      { hanja: '水', reading: '수', meaning: '', hun_english: 'water', hun_display: '' },
      { hanja: '水', reading: '수', meaning: 'eau', hun_english: 'water', hun_display: 'eau' },
    ],
    similarWordsTableData: [
      { hanja: '水道', korean: '수도', meaning: 'waterworks', definition_english: 'waterworks', definition_display: '' },
    ],
  };

  it('fills missing meanings with machine translations', async () => {
    api.post
      .mockResolvedValueOnce({ data: { translations: ['água'] } })
      .mockResolvedValueOnce({ data: { translations: ['abastecimento de água'] } });
    const localized = await localizeHanjaResult(result, 'pt');
    expect(localized.firstTableData[0].meaning).toBe('água');
    expect(localized.firstTableData[1].meaning).toBe('eau');
    expect(localized.similarWordsTableData[0].meaning).toBe('abastecimento de água');
    expect(localized.englishFallback).toBeNull();
  });

  it('keeps English, flagged, when offline', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    const localized = await localizeHanjaResult(result, 'ja');
    expect(localized.firstTableData[0].meaning).toBe('water');
    expect(localized.firstTableData[0].meaning_language).toBe('en');
    expect(localized.englishFallback).toBe('offline');
  });

  it('leaves English interfaces alone', async () => {
    const localized = await localizeHanjaResult(result, 'en');
    expect(api.post).not.toHaveBeenCalled();
    expect(localized.firstTableData).toBe(result.firstTableData);
  });
});

describe('Chinese character rows', () => {
  const rows = [{
    character: '好',
    definition: 'good',
    hint: 'A woman with a son',
    etymology_type: 'ideographic',
    phonetic_definition: '',
    semantic_radical_english_name: 'Woman',
    semantic_radical_korean_name: '계집 녀',
    primary_radical_english_name: 'Woman',
    primary_radical_korean_name: '계집 녀',
  }, { character: '㐀', missingEtymology: true }];

  it('translates definition/hint/radicals and the formation type', async () => {
    api.post.mockImplementation(async (_path, body) => ({
      data: { translations: body.texts.map((text) => `fr:${text}`) },
    }));
    const [row, missing] = await localizeChineseCharacterRows(rows, 'fr');
    expect(row.definition).toBe('fr:good');
    expect(row.hint).toBe('fr:A woman with a son');
    expect(row.semantic_radical_english_name).toBe('fr:Woman');
    expect(row.etymology_type).not.toBe('ideographic');
    expect(row.englishFallback).toBeNull();
    expect(missing).toEqual(rows[1]);
  });

  it('uses Korean radical names for a Korean interface', async () => {
    api.post.mockImplementation(async (_path, body) => ({
      data: { translations: body.texts.map((text) => `ko:${text}`) },
    }));
    const [row] = await localizeChineseCharacterRows(rows, 'ko');
    expect(row.semantic_radical_english_name).toBe('계집 녀');
    expect(api.post.mock.calls.every(([, body]) => body.kind !== 'radical_name')).toBe(true);
  });

  it('flags English left behind', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    const [row] = await localizeChineseCharacterRows(rows, 'th');
    expect(row.definition).toBe('good');
    expect(row.englishFallback).toBe('offline');
  });
});
