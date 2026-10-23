import { addScriptCounts, dominantScriptLanguage, emptyScriptCounts } from '../textScript';

const languageOf = (text) => dominantScriptLanguage(addScriptCounts(emptyScriptCounts(), text));

describe('dominantScriptLanguage', () => {
  it('reads the language off the text, not the tag', () => {
    expect(languageOf('복녀는 원래 가난은 하나마 정직한 농가에서 처녀였었다. '.repeat(20))).toBe('ko');
    expect(languageOf('他原来是个诚实的农民，每天都在田里干活。'.repeat(20))).toBe('zh');
    expect(languageOf('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。'.repeat(10))).toBe('ja');
    expect(languageOf('It was the best of times, it was the worst of times. '.repeat(10))).toBe('en');
  });

  it('keeps Korean with hanja and English quotes Korean', () => {
    const korean = '그는 學校에 갔다. "Hello" 하고 인사했다. 오늘은 날씨가 좋다. '.repeat(15);
    expect(languageOf(korean)).toBe('ko');
  });

  it('says nothing for too little or mixed text', () => {
    expect(languageOf('Short.')).toBeNull();
    expect(dominantScriptLanguage({ hangul: 0, kana: 0, han: 150, latin: 400 })).toBeNull();
  });
});
