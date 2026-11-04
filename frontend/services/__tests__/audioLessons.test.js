import {
  AUDIO_LESSON_SIZES,
  DEFAULT_AUDIO_LESSON_SIZE,
  episodeTitle,
  lessonIntroText,
  lessonSizeFor,
  lessonWordKey,
  pickLessonSentence,
  planLesson,
  rankByUsage,
  rotationUsedKeys,
  sentenceTooLong,
  shortenSentence,
  themeForDomain,
  withLessonSize,
} from '../audioLessons';

const row = (word, extra = {}) => ({ word, hanja: null, def: `${word} def`, ...extra });
const t = (key, params = {}) => `${key}${Object.keys(params).length ? JSON.stringify(params) : ''}`;

describe('lesson size', () => {
  it('offers 3 / 5 / 10 / 15 with 5 by default, remembered per language', () => {
    expect(AUDIO_LESSON_SIZES).toEqual([3, 5, 10, 15]);
    expect(lessonSizeFor(null, 'ko')).toBe(DEFAULT_AUDIO_LESSON_SIZE);
    const prefs = withLessonSize(withLessonSize({}, 'ko', 10), 'en', 3);
    expect(lessonSizeFor(prefs, 'ko')).toBe(10);
    expect(lessonSizeFor(prefs, 'en')).toBe(3);
    expect(lessonSizeFor(withLessonSize(prefs, 'zh', 7), 'zh')).toBe(5);
  });
});

describe('rankByUsage', () => {
  it('puts the most common (lowest difficulty) first and unknown words last', () => {
    const rows = [row('rare'), row('unknown'), row('common'), row('mid')];
    const ranked = rankByUsage(rows, {
      rare: { difficulty: 2.5, zipf: 2.9 },
      unknown: { difficulty: 3, isFallback: true },
      common: { difficulty: -2, zipf: 6.1 },
      mid: { difficulty: 0.5, zipf: 4.4 },
    });
    expect(ranked.map((r) => r.word)).toEqual(['common', 'mid', 'rare', 'unknown']);
  });

  it('keeps the saved order on ties and without any data', () => {
    expect(rankByUsage([row('b'), row('a')], {}).map((r) => r.word)).toEqual(['b', 'a']);
  });
});

describe('themeForDomain', () => {
  it('maps KRDICT topic categories to coarse themes', () => {
    expect(themeForDomain('음식 주문하기')).toBe('food');
    expect(themeForDomain('감정, 기분 표현하기')).toBe('feelings');
    expect(themeForDomain('날씨와 계절')).toBe('nature');
    expect(themeForDomain('외모 표현하기')).toBe('body');
    expect(themeForDomain('공공 기관 이용하기(도서관)')).toBe('society');
    expect(themeForDomain('')).toBeNull();
    expect(themeForDomain('전화하기')).toBeNull();
  });
});

describe('planLesson', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((w) => row(w));

  it('takes the next most useful words in plain order without a theme', () => {
    const plan = planLesson({ ranked: words, size: 3 });
    expect(plan.words.map((r) => r.word)).toEqual(['a', 'b', 'c']);
    expect(plan.theme).toBeNull();
  });

  it('rotates: words already in an episode are skipped, then the list starts over', () => {
    const used = new Set(['a', 'b', 'c'].map((w) => lessonWordKey(row(w))));
    expect(planLesson({ ranked: words, size: 3, usedKeys: used }).words.map((r) => r.word)).toEqual(['d', 'e', 'f']);
    const all = new Set(words.map(lessonWordKey));
    const again = planLesson({ ranked: words, size: 3, usedKeys: all });
    expect(again.restarted).toBe(true);
    expect(again.words.map((r) => r.word)).toEqual(['a', 'b', 'c']);
  });

  it('groups a topic when enough of the next words share it, filling with useful words', () => {
    const themes = { b: 'food', d: 'food', e: 'food', a: 'time' };
    const plan = planLesson({ ranked: words, size: 5, themeOf: (r) => themes[r.word] ?? null });
    expect(plan.theme).toEqual({ kind: 'topic', key: 'food' });
    // 3 food words (60% of 5) + the 2 most useful others, in usage order.
    expect(plan.words.map((r) => r.word)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const plan3 = planLesson({ ranked: words, size: 3, themeOf: (r) => themes[r.word] ?? null });
    expect(plan3.words.map((r) => r.word)).toEqual(['b', 'd', 'e']);
  });

  it('falls back to the source book, then to plain order', () => {
    const books = { c: 'Peter Rabbit', f: 'Peter Rabbit', g: 'Peter Rabbit' };
    const plan = planLesson({ ranked: words, size: 3, bookOf: (r) => books[r.word] });
    expect(plan.theme).toEqual({ kind: 'book', key: 'Peter Rabbit' });
    expect(plan.words.map((r) => r.word)).toEqual(['c', 'f', 'g']);
    // A theme outside the next 3×size words doesn't pull them forward.
    const far = { h: 'food', g: 'food' };
    expect(planLesson({ ranked: words, size: 2, themeOf: (r) => far[r.word] }).theme).toBeNull();
  });

  it('copes with fewer words than the size, and with none', () => {
    expect(planLesson({ ranked: [row('x')], size: 5 }).words).toHaveLength(1);
    expect(planLesson({ ranked: [], size: 5 })).toEqual({ words: [], theme: null, restarted: false });
  });
});

describe('rotationUsedKeys', () => {
  const words = ['a', 'b', 'c', 'd'].map((w) => row(w));
  const episode = (...ws) => ({ words: ws.map((w) => row(w)) });

  it('collects the words of recent episodes until a full pass', () => {
    // Newest first: [c, d] then [a, b] covers everything, so only [c, d] counts.
    const used = rotationUsedKeys([episode('c', 'd'), episode('a', 'b')], words);
    expect([...used].map((key) => key.split('\u0000')[0]).sort()).toEqual(['c', 'd']);
    expect(planLesson({ ranked: words, size: 2, usedKeys: used }).words.map((r) => r.word)).toEqual(['a', 'b']);
  });

  it('is empty without episodes', () => {
    expect(rotationUsedKeys([], words).size).toBe(0);
  });
});

describe('short example sentences', () => {
  it('keeps a short sentence whole', () => {
    expect(shortenSentence('A brook ran through the hollow.', 'hollow', 'en')).toBe('A brook ran through the hollow.');
  });

  it('measures English in words and Korean / Chinese in characters', () => {
    expect(sentenceTooLong('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen', 'en')).toBe(true);
    expect(sentenceTooLong('가'.repeat(40), 'ko')).toBe(false);
    expect(sentenceTooLong('가'.repeat(41), 'ko')).toBe(true);
    expect(sentenceTooLong('我'.repeat(41), 'zh')).toBe(true);
  });

  it('cuts a long English sentence to the clause with the word', () => {
    const long = 'Peter was very naughty that afternoon, and he squeezed under the gate of the garden while his sisters picked berries.';
    expect(shortenSentence(long, 'gate', 'en')).toBe('and he squeezed under the gate of the garden');
  });

  it('cuts a long Korean sentence at a comma or a connective ending', () => {
    const long = '이전에는 이 마을에 큰 나무가 있었는데, 사람들이 그 나무를 베어 버린 뒤로 마을 사람들은 여름마다 더위에 시달리며 그늘을 찾아 먼 산까지 걸어가야 했다.';
    expect(shortenSentence(long, '이전', 'ko')).toBe('이전에는 이 마을에 큰 나무가 있었는데');
    const noComma = '아버지는 아침마다 일찍 일어나서 밭에 나가 일을 하셨지만 저녁이 되면 늘 엄하게 우리를 꾸짖으셨다 그래도 우리는 아버지를 사랑했다';
    expect(shortenSentence(noComma, '엄하다', 'ko')).toBe('저녁이 되면 늘 엄하게 우리를 꾸짖으셨다 그래도 우리는 아버지를 사랑했다');
  });

  it('cuts a long Chinese sentence at its commas', () => {
    const long = '那天下午天气非常好，我们一家人带着很多吃的东西去公园里散步，看见湖边有一只小狗在追着一只蝴蝶跑来跑去。';
    expect(shortenSentence(long, '蝴蝶', 'zh')).toBe('看见湖边有一只小狗在追着一只蝴蝶跑来跑去。');
  });

  it('gives up (word and meaning only) when no short clause has the word', () => {
    const long = 'The old man who had lived alone in the house at the end of the lane for more than forty years finally opened the door.';
    expect(shortenSentence(long, 'door', 'en')).toBeNull();
  });

  it('picks the shortest usable sentence, preferring whole ones', () => {
    const contexts = [
      { sentence: 'Peter was very naughty that afternoon, and he squeezed under the gate of the garden while his sisters picked berries.' },
      { sentence: 'The gate was shut.' },
    ];
    expect(pickLessonSentence(contexts, 'gate', 'en')).toBe('The gate was shut.');
    expect(pickLessonSentence([], 'gate', 'en')).toBeNull();
  });
});

describe('titles and intro', () => {
  it('names the theme, the book, or a mixed episode', () => {
    expect(episodeTitle({ theme: { kind: 'topic', key: 'food' } }, t)).toBe('learn.audioLessonTheme.food');
    expect(episodeTitle({ theme: { kind: 'book', key: 'Peter Rabbit' } }, t)).toBe('learn.audioLessonFromBook{"title":"Peter Rabbit"}');
    expect(episodeTitle({ theme: null }, t)).toBe('learn.audioLessonMixed');
  });

  it('announces the word count and theme', () => {
    const words = [row('a'), row('b'), row('c'), row('d'), row('e')];
    expect(lessonIntroText({ words, theme: null }, t)).toBe('learn.audioLessonIntro{"count":5}');
    expect(lessonIntroText({ words, theme: { kind: 'topic', key: 'food' } }, t))
      .toBe('learn.audioLessonIntroTheme{"count":5,"theme":"learn.audioLessonTheme.food"}');
  });
});
