import {
  canonicalLocaleTag,
  deviceInterfaceLanguageOf,
  deviceLanguageOf,
} from '../deviceLocale';

describe('deviceLocale', () => {
  it('canonicalizes BCP 47 and Java-style locale identifiers', () => {
    expect(canonicalLocaleTag('vi-VN')).toBe('vi-VN');
    expect(canonicalLocaleTag('en_us')).toBe('en-US');
    expect(canonicalLocaleTag('zh_TW_#Hant')).toBe('zh-TW-Hant');
    expect(canonicalLocaleTag('in_ID')).toBe('id-ID');
    expect(canonicalLocaleTag('')).toBeNull();
    expect(canonicalLocaleTag(null)).toBeNull();
  });

  it('reads the language, telling Traditional from Simplified Chinese', () => {
    expect(deviceLanguageOf('pt-BR')).toBe('pt');
    expect(deviceLanguageOf('zh-Hant-TW')).toBe('zh-Hant');
    expect(deviceLanguageOf('zh-HK')).toBe('zh-Hant');
    expect(deviceLanguageOf('zh_TW_#Hant')).toBe('zh-Hant');
    expect(deviceLanguageOf('zh-Hans-CN')).toBe('zh');
    expect(deviceLanguageOf('zh-Hans-HK')).toBe('zh');
    expect(deviceLanguageOf('zh-CN')).toBe('zh');
  });

  it('maps the phone language to an interface language Noeul offers', () => {
    expect(deviceInterfaceLanguageOf('vi-VN')).toBe('vi');
    expect(deviceInterfaceLanguageOf('in_ID')).toBe('id');
    expect(deviceInterfaceLanguageOf('ar-EG')).toBe('ar');
    expect(deviceInterfaceLanguageOf('zh-Hant-TW')).toBe('zh-Hant');
    expect(deviceInterfaceLanguageOf('zh-CN')).toBe('zh');
    expect(deviceInterfaceLanguageOf('ko-KR')).toBe('ko');
    expect(deviceInterfaceLanguageOf('ja-JP')).toBe('ja');
    expect(deviceInterfaceLanguageOf('pt-BR')).toBe('pt');
    expect(deviceInterfaceLanguageOf('pt-PT')).toBe('pt');
    expect(deviceInterfaceLanguageOf('de-DE')).toBeNull();
    expect(deviceInterfaceLanguageOf(null)).toBeNull();
  });
});
