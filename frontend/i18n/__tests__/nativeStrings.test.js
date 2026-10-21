import fs from 'fs';
import path from 'path';

import {
  NATIVE_STRINGS,
  buildOverlayNativeExtras,
  buildReaderNativeStrings,
} from '../nativeStrings';
import { UI_TRANSLATIONS } from '../translations';
import { KRDICT_INTERFACE_LANGUAGE_OPTIONS } from '../../constants/languages';

const placeholders = (value) => [...String(value).matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

const MODULES = path.join(__dirname, '..', '..', 'modules');
const READER_TEXT_KT = path.join(
  MODULES,
  'native-epub-reader/android/src/main/java/expo/modules/nativeepubreader/ReaderText.kt'
);
const OVERLAY_DIR = path.join(
  MODULES,
  'screen-ocr-overlay/android/src/main/java/expo/modules/screenocroverlay'
);

// Keys of the `private val EN = mapOf(...)` fallback in a Kotlin strings object.
const kotlinFallbackKeys = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const block = source.match(/private val EN = mapOf\(([\s\S]*?)\n\s*\)/)[1];
  return [...block.matchAll(/"([^"]+)" to "/g)].map((match) => match[1]);
};

const interfaceLanguages = KRDICT_INTERFACE_LANGUAGE_OPTIONS.map(({ code }) => code);
const enKeys = Object.keys(NATIVE_STRINGS.en);

describe('native strings', () => {
  it('has a table for every interface language and no others', () => {
    expect(Object.keys(NATIVE_STRINGS).sort()).toEqual([...interfaceLanguages].sort());
  });

  it.each(interfaceLanguages)('%s has every English key, non-empty, with matching placeholders', (language) => {
    const table = NATIVE_STRINGS[language];
    expect(Object.keys(table)).toEqual(enKeys);
    enKeys.forEach((key) => {
      expect(typeof table[key]).toBe('string');
      expect(table[key].trim()).not.toBe('');
      expect(placeholders(table[key])).toEqual(placeholders(NATIVE_STRINGS.en[key]));
    });
  });

  it.each(interfaceLanguages)('%s reader map covers every key ReaderText.kt draws', (language) => {
    const strings = buildReaderNativeStrings(language);
    const nativeKeys = kotlinFallbackKeys(READER_TEXT_KT);
    expect(Object.keys(strings).sort()).toEqual([...nativeKeys].sort());
    nativeKeys.forEach((key) => {
      expect(strings[key].trim()).not.toBe('');
      // A reused translations.js key that went missing would fall back to the key name.
      expect(strings[key]).not.toMatch(/^(home|learn|read|native)\./);
    });
    // Native fills {{count}} in; it must survive the build untouched.
    expect(strings.reviewWordsOther).toContain('{{count}}');
    expect(strings.chaptersOther).toContain('{{count}}');
  });

  it('localizes reader text away from English', () => {
    expect(buildReaderNativeStrings('ko').bookFinished).not.toBe(buildReaderNativeStrings('en').bookFinished);
    expect(buildReaderNativeStrings('ja').listenPlay).toBe(UI_TRANSLATIONS.ja['read.listenPlay']);
  });

  it('every OverlayText key used in Kotlin is supplied by JS for every language', () => {
    const files = fs.readdirSync(OVERLAY_DIR).filter((name) => name.endsWith('.kt'));
    const used = new Set();
    files.forEach((name) => {
      const source = fs.readFileSync(path.join(OVERLAY_DIR, name), 'utf8');
      for (const match of source.matchAll(/OverlayText\.t\("([^"]+)"\)/g)) {
        used.add(match[1]);
      }
    });
    expect(used.size).toBeGreaterThan(0);

    interfaceLanguages.forEach((language) => {
      const table = UI_TRANSLATIONS[language];
      const extras = buildOverlayNativeExtras(language);
      const missing = [...used].filter((key) => !(`overlay.${key}` in table) && !(key in extras));
      expect({ language, missing }).toEqual({ language, missing: [] });
    });
  });

  it('overlay extras name every interface language for the translation header', () => {
    const extras = buildOverlayNativeExtras('pt');
    ['ar', 'mn', 'vi', 'th', 'id', 'ru', 'pt'].forEach((code) => {
      expect(extras[`languageName.${code}`]).toBeTruthy();
    });
    expect(extras.virtualDisplayCreateFailed).toBe(NATIVE_STRINGS.pt['native.overlay.virtualDisplayCreateFailed']);
  });
});
