import {
  AUDIO_REVIEW_PAUSES,
  buildAudioReviewScript,
  pickSentence,
  shortMeaning,
  spokenMeaning,
} from '../audioReview';

describe('spokenMeaning', () => {
  it('reads the gloss, a few equivalents at most', () => {
    expect(spokenMeaning({ gloss: '이름, 성함, 명칭, 평판', definition: '특정한 사람, 장소…' })).toBe('이름, 성함, 명칭');
  });

  it('falls back to the definition without a gloss', () => {
    expect(spokenMeaning({ gloss: null, definition: '1. to slope down; to dip' })).toBe('to slope down');
  });
});

describe('shortMeaning', () => {
  it('keeps the first sense without numbering or asides', () => {
    expect(shortMeaning('1. (of a road) to slope down; to dip\n2. to lower')).toBe('to slope down');
    expect(shortMeaning('주변, 가장자리')).toBe('주변, 가장자리');
  });

  it('cuts a long sense at a word break', () => {
    const long = 'a very long definition that goes on and on, describing every possible nuance of the word';
    expect(shortMeaning(long).length).toBeLessThanOrEqual(60);
    expect(long.startsWith(shortMeaning(long))).toBe(true);
  });
});

describe('pickSentence', () => {
  it('prefers the shortest reasonable sentence that has the word', () => {
    const contexts = [
      { sentence: 'The hollow was fringed with alders and ladies eardrops, a long and winding description.' },
      { sentence: 'A brook ran through the hollow.' },
      { sentence: 'Hollow.' },
      { sentence: 'She went home early that day.' },
    ];
    expect(pickSentence(contexts, 'hollow')).toBe('A brook ran through the hollow.');
  });

  it('falls back to any sentence, and to nothing', () => {
    expect(pickSentence([{ sentence: '마을 이야기입니다.' }], '호랑이')).toBe('마을 이야기입니다.');
    expect(pickSentence([], 'x')).toBeNull();
  });
});

describe('buildAudioReviewScript', () => {
  it('reads word, meaning, sentence, translation in their own voices', () => {
    const items = buildAudioReviewScript({
      word: 'hollow',
      meaning: '분지',
      sentence: 'A brook ran through the hollow.',
      translation: '시냇물이 분지를 지나 흘렀다.',
      targetLocale: 'en-US',
      interfaceLocale: 'ko-KR',
      rate: 1,
    });
    const spoken = items.filter((item) => item.text).map((item) => [item.text, item.locale]);
    expect(spoken).toEqual([
      ['hollow', 'en-US'],
      ['분지', 'ko-KR'],
      ['A brook ran through the hollow.', 'en-US'],
      ['시냇물이 분지를 지나 흘렀다.', 'ko-KR'],
    ]);
    expect(items[items.length - 1]).toEqual({ pauseMs: AUDIO_REVIEW_PAUSES.betweenWords });
  });

  it('skips a missing sentence and translation', () => {
    const items = buildAudioReviewScript({
      word: '호랑이', meaning: 'tiger', targetLocale: 'ko-KR', interfaceLocale: 'en-US', rate: 1,
    });
    expect(items.filter((item) => item.text).map((item) => item.text)).toEqual(['호랑이', 'tiger']);
  });
});
