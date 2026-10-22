import { annotationsBySurface, buildAnnotatedLevelTerms } from '../readerAnnotations';

const rows = [
  { surface: '学习', ipa: 'xué xí', gloss: 'to study', interface_language: 'en' },
  { surface: '学习', ipa: 'xué xí', gloss: 'estudiar', interface_language: 'es' },
  { surface: '我们', ipa: 'wǒ men', gloss: 'we', interface_language: 'en' },
  { surface: '中文', ipa: '', gloss: 'Chinese', interface_language: 'en' },
  { surface: '소녀가', ipa: '', gloss: null, definition: 'girl', interface_language: 'en' },
];
const levelTerms = [{ text: '学习', weight: 0.6, category: 'study' }];

describe('annotationsBySurface', () => {
  it('prefers the interface-language gloss, then English', () => {
    expect(annotationsBySurface(rows, 'es').get('学习').gloss).toBe('estudiar');
    expect(annotationsBySurface(rows, 'fr').get('学习').gloss).toBe('to study');
    expect(annotationsBySurface(rows, 'en').get('我们').pinyin).toBe('wǒ men');
  });
});

describe('annotationsBySurface after a language switch', () => {
  it('never shows a gloss saved under a previous app language', () => {
    const switched = [
      { surface: '원래', stem: '원래', ipa: '', gloss: '元々', interface_language: 'ja' },
      { surface: '가난', stem: '가난', gloss: '貧しさ', interface_language: 'ja' },
      { surface: '가난', stem: '가난', gloss: 'pobreza', interface_language: 'es' },
      { surface: '学习', ipa: 'xué xí', gloss: '学ぶ', interface_language: 'ja' },
    ];
    const index = annotationsBySurface(switched, 'es');
    expect(index.get('가난').gloss).toBe('pobreza');
    // Only the old language: no gloss rather than the wrong language.
    expect(index.get('원래').gloss).toBe('');
    // The old row still gives its pinyin.
    expect(index.get('学习').gloss).toBe('');
    expect(index.get('学习').pinyin).toBe('xué xí');
  });
});

describe('annotationsBySurface fallback', () => {
  it('uses the definition when there is no gloss', () => {
    expect(annotationsBySurface(rows, 'en').get('소녀가').gloss).toBe('girl');
  });
});

describe('annotationsBySurface compounds', () => {
  it('joins the components of a compound in reading order', () => {
    const compound = [
      { surface: '공동묘지', stem: '묘지', definition: 'graveyard', interface_language: 'en' },
      { surface: '공동묘지', stem: '공동', definition: 'joint', interface_language: 'en' },
      { surface: '근로자문화예술제에서', stem: '근로자', definition: 'worker', interface_language: 'en' },
      { surface: '근로자문화예술제에서', stem: '예술제', definition: 'arts festival', interface_language: 'en' },
      { surface: '근로자문화예술제에서', stem: '문화', definition: 'culture', interface_language: 'en' },
    ];
    const index = annotationsBySurface(compound, 'en');
    expect(index.get('공동묘지').gloss).toBe('joint · graveyard');
    expect(index.get('근로자문화예술제에서').gloss).toBe('worker · culture · arts festival');
  });

  it('keeps one gloss for alternatives of the same span and for a whole-surface stem', () => {
    const alternatives = [
      { surface: '길', stem: '길', definition: 'road', interface_language: 'en' },
      { surface: '길', stem: '길다', definition: 'to be long', interface_language: 'en' },
      { surface: '김선희', stem: '김선희', definition: 'Kim Seon-hui', interface_language: 'en' },
      { surface: '김선희', stem: '김선', definition: 'Kim Seon', interface_language: 'en' },
      { surface: '김선희', stem: '희', definition: 'hope', interface_language: 'en' },
      { surface: '날아올랐다', stem: '날다', definition: 'to fly', interface_language: 'en' },
      { surface: '날아올랐다', stem: '오르다', definition: 'to rise', interface_language: 'en' },
    ];
    const index = annotationsBySurface(alternatives, 'en');
    expect(index.get('길').gloss).toBe('road');
    expect(index.get('김선희').gloss).toBe('Kim Seon-hui');
    // Conjugated parts do not appear literally, so no join is attempted.
    expect(index.get('날아올랐다').gloss).toBe('to fly');
  });
});

describe('buildAnnotatedLevelTerms', () => {
  it('passes level terms through untouched when annotations are off', () => {
    expect(buildAnnotatedLevelTerms({ levelTerms, annotationRows: rows })).toBe(levelTerms);
    expect(buildAnnotatedLevelTerms({ levelTerms, marksEnabled: false })).toEqual([]);
  });

  it('annotates only underlined words with the underlined scope', () => {
    const terms = buildAnnotatedLevelTerms({ levelTerms, annotationRows: rows, pinyin: true, gloss: true });
    expect(terms).toEqual([
      { text: '学习', weight: 0.6, category: 'study', pinyin: 'xué xí', gloss: 'to study' },
    ]);
  });

  it('adds every other word as annotation-only with the all scope', () => {
    const terms = buildAnnotatedLevelTerms({
      levelTerms, annotationRows: rows, gloss: true, glossScope: 'all',
    });
    expect(terms.find((t) => t.text === '学习').annotationOnly).toBeUndefined();
    expect(terms.find((t) => t.text === '我们')).toEqual({ text: '我们', weight: 0, annotationOnly: true, gloss: 'we' });
    expect(terms.find((t) => t.text === '中文').gloss).toBe('Chinese');
  });

  it('skips words with nothing to show', () => {
    const terms = buildAnnotatedLevelTerms({ levelTerms, annotationRows: rows, pinyin: true, pinyinScope: 'all' });
    expect(terms.map((t) => t.text).sort()).toEqual(['学习', '我们']);
    expect(terms.some((t) => t.text === '소녀가')).toBe(false);
  });

  it('keeps graded words annotated but not underlined when marks are off', () => {
    const terms = buildAnnotatedLevelTerms({
      levelTerms, annotationRows: rows, marksEnabled: false, pinyin: true,
    });
    expect(terms).toEqual([
      { text: '学习', weight: 0.6, category: 'study', pinyin: 'xué xí', annotationOnly: true },
    ]);
  });

  it('applies each scope separately', () => {
    const terms = buildAnnotatedLevelTerms({
      levelTerms, annotationRows: rows, pinyin: true, gloss: true, pinyinScope: 'all', glossScope: 'underlined',
    });
    const extra = terms.find((t) => t.text === '我们');
    expect(extra).toEqual({ text: '我们', weight: 0, annotationOnly: true, pinyin: 'wǒ men' });
    expect(terms.find((t) => t.text === '学习').gloss).toBe('to study');
  });

  it('drops pinyin when only glosses are on', () => {
    const terms = buildAnnotatedLevelTerms({
      levelTerms: [{ text: '学习', weight: 0.5, pinyin: 'xué xí' }], annotationRows: rows, gloss: true,
    });
    expect(terms[0].pinyin).toBeUndefined();
    expect(terms[0].gloss).toBe('to study');
  });
});

describe('buildAnnotatedLevelTerms hidden saved words', () => {
  it('gives saved words no pinyin or gloss, underlined or not', () => {
    const terms = buildAnnotatedLevelTerms({
      levelTerms,
      annotationRows: rows,
      pinyin: true,
      gloss: true,
      pinyinScope: 'all',
      glossScope: 'all',
      interfaceLanguage: 'en',
      hiddenSurfaces: new Set(['学习', '我们']),
    });
    const studied = terms.find((term) => term.text === '学习');
    // Still underlined, just unannotated.
    expect(studied).toBeTruthy();
    expect(studied.annotationOnly).toBeUndefined();
    expect(studied.pinyin).toBeUndefined();
    expect(studied.gloss).toBeUndefined();
    // Not added as an annotation-only word either.
    expect(terms.find((term) => term.text === '我们')).toBeUndefined();
    // Other words keep theirs.
    expect(terms.find((term) => term.text === '中文').gloss).toBe('Chinese');
  });
});

