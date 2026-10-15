import {
  joinKoreanInBlocks,
  joinKoreanInTerms,
  joinKoreanSyllables,
  stripJoinersDeep,
  WORD_JOINER,
} from '../../modules/native-epub-reader/src/koreanLineBreak';

const J = WORD_JOINER;

describe('koreanLineBreak', () => {
  it('joins syllables inside a word but not across spaces or punctuation', () => {
    expect(joinKoreanSyllables('어린 소녀는 길을!')).toBe(`어${J}린 소${J}녀${J}는 길${J}을!`);
    expect(joinKoreanSyllables('1센트도')).toBe(`1센${J}트${J}도`);
    expect(joinKoreanSyllables('abc')).toBe('abc');
    expect(joinKoreanSyllables('')).toBe('');
  });

  it('strips joiners from every string in a payload', () => {
    const payload = { text: `소${J}녀`, sentence: `어${J}린 소${J}녀${J}는`, nested: [{ text: `길${J}을` }], n: 3 };
    expect(stripJoinersDeep(payload)).toEqual({ text: '소녀', sentence: '어린 소녀는', nested: [{ text: '길을' }], n: 3 });
  });

  it('transforms block spans and terms the same way, so they still match', () => {
    const blocks = joinKoreanInBlocks([{ id: 'b', text: '소녀는 웃었다', spans: [{ text: '소녀는 ', marks: [] }, { text: '웃었다', marks: ['bold'] }] }]);
    expect(blocks[0].spans.map((s) => s.text).join('')).toBe(joinKoreanSyllables('소녀는 웃었다'));
    expect(blocks[0].spans[1].marks).toEqual(['bold']);
    const terms = joinKoreanInTerms([{ text: '소녀는', weight: 0.4 }, '웃었다']);
    expect(terms[0]).toEqual({ text: joinKoreanSyllables('소녀는'), weight: 0.4 });
    expect(blocks[0].text).toContain(terms[0].text);
    expect(stripJoinersDeep(terms[1])).toBe('웃었다');
  });
});
