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

describe('annotationsBySurface fallback', () => {
  it('uses the definition when there is no gloss', () => {
    expect(annotationsBySurface(rows, 'en').get('소녀가').gloss).toBe('girl');
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
      levelTerms, annotationRows: rows, gloss: true, scope: 'all',
    });
    expect(terms.find((t) => t.text === '学习').annotationOnly).toBeUndefined();
    expect(terms.find((t) => t.text === '我们')).toEqual({ text: '我们', weight: 0, annotationOnly: true, gloss: 'we' });
    expect(terms.find((t) => t.text === '中文').gloss).toBe('Chinese');
  });

  it('skips words with nothing to show', () => {
    const terms = buildAnnotatedLevelTerms({ levelTerms, annotationRows: rows, pinyin: true, scope: 'all' });
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

  it('drops pinyin when only glosses are on', () => {
    const terms = buildAnnotatedLevelTerms({
      levelTerms: [{ text: '学习', weight: 0.5, pinyin: 'xué xí' }], annotationRows: rows, gloss: true,
    });
    expect(terms[0].pinyin).toBeUndefined();
    expect(terms[0].gloss).toBe('to study');
  });
});
