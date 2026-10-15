import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Dismissing a translation clears the word and the native-selection flag
// together. During the fade-out the panel must keep showing the translation,
// not mount the dictionary (which would log a fake lookup and stem request).

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }), { virtual: true });
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }), { virtual: true });
jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ interfaceLanguage: 'en', targetLanguage: 'ko' }),
}));
jest.mock('../../theme', () => ({
  fontFamilies: {},
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../Read/TopSection/DictionaryContent', () => {
  const DictionaryContent = () => null;
  return { __esModule: true, default: DictionaryContent };
});
jest.mock('../Read/TopSection/TranslationContent', () => {
  const TranslationContent = () => null;
  return { __esModule: true, default: TranslationContent };
});

const TopSection = require('../Read/TopSection/TopSection').default;
const DictionaryContent = require('../Read/TopSection/DictionaryContent').default;
const TranslationContent = require('../Read/TopSection/TranslationContent').default;

describe('TopSection dismiss', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the translation (not the dictionary) while a translation fades out', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TopSection highlightedWord="오늘은 날씨가 좋다" isNativeSelection onClose={() => {}} />
      );
    });
    expect(tree.root.findAllByType(TranslationContent)).toHaveLength(1);
    expect(tree.root.findAllByType(DictionaryContent)).toHaveLength(0);

    await act(async () => {
      tree.update(<TopSection highlightedWord="" isNativeSelection={false} onClose={() => {}} />);
    });
    expect(tree.root.findAllByType(DictionaryContent)).toHaveLength(0);
    expect(tree.root.findAllByType(TranslationContent)).toHaveLength(1);
  });

  it('shows the dictionary for a tapped word', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TopSection highlightedWord="날씨" isNativeSelection={false} onClose={() => {}} />
      );
    });
    expect(tree.root.findAllByType(DictionaryContent)).toHaveLength(1);
    expect(tree.root.findAllByType(TranslationContent)).toHaveLength(0);
  });
});
