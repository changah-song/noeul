import React from 'react';
import renderer, { act } from 'react-test-renderer';

// A tap inside an English phrase ("gave up") opens the phrase's card first,
// with a chip for the tapped word ("gave"). The word's lookup from the chip
// is not evidence about the reader's level: levelMark 0.

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }), { virtual: true });
jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key) => key, language: 'ko' }),
}));
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ interfaceLanguage: 'ko', targetLanguage: 'en' }),
}));
jest.mock('../../contexts/LocalOwnerContext', () => ({
  useLocalOwner: () => ({ activeOwnerId: 'owner-1' }),
}));
jest.mock('../../theme', () => ({
  fontFamilies: {},
  radii: { pill: 999, md: 8, sm: 4, lg: 12 },
  spacing: { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  textStyles: new Proxy({}, { get: () => ({}) }),
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../../services/api/client', () => ({ api: { get: jest.fn(() => new Promise(() => {})), post: jest.fn() } }));
jest.mock('../../services/appTelemetry', () => ({ logTiming: jest.fn() }));
jest.mock('../../services/Database', () => ({
  getCachedPKnown: jest.fn(async () => null),
  insertData: jest.fn(async () => {}),
  logInteractionEvent: jest.fn(async () => {}),
  lookupCacheByStems: jest.fn(async () => []),
  removeData: jest.fn(async () => {}),
  recordVocabContext: jest.fn(async () => {}),
  updateCacheRomanizations: jest.fn(async () => {}),
  vocabEntryExists: jest.fn(async () => false),
}));
jest.mock('../../services/pronunciationAudio', () => ({ playEnglishPronunciation: jest.fn() }));
jest.mock('../../services/userDataSyncQueue', () => ({ requestUserDataSync: jest.fn() }));
jest.mock('../../services/chapterTranslations', () => ({ chapterTranslations: { get: jest.fn() } }));
jest.mock('../Read/TopSection/HanjaDetails', () => ({ __esModule: true, default: () => null }));
jest.mock('../Read/TopSection/LookupLoadingSkeleton', () => ({ __esModule: true, default: () => null }));
jest.mock('../../services/dictionaryLookup', () => ({
  getEntryFallbackLanguage: () => null,
  normalizeSurfaceWordForLanguage: (word) => String(word || '').trim().toLowerCase(),
  resolveDictionaryLookup: jest.fn(),
}));

const { resolveDictionaryLookup } = require('../../services/dictionaryLookup');
const DictionaryContent = require('../Read/TopSection/DictionaryContent').default;

const entryFor = (stem, gloss) => ({
  stem,
  word: stem,
  language: 'en',
  interface_language: 'ko',
  definition: gloss,
  gloss,
  pos: stem.includes(' ') ? 'phrasal verb' : 'verb',
});

describe('DictionaryContent phrase chip', () => {
  beforeEach(() => {
    resolveDictionaryLookup.mockReset();
    resolveDictionaryLookup.mockImplementation(async ({ surface }) => {
      const stem = surface === 'gave up' ? 'give up' : 'give';
      return {
        cachedResults: [entryFor(stem, stem === 'give up' ? '포기하다' : '주다')],
        stems: [stem],
        dictionaryData: [],
        needsLiveFetch: false,
        liveError: null,
      };
    });
  });

  const render = async (props) => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <DictionaryContent
          highlightedWord="gave up"
          sourceBook={{ language: 'en', uri: 'book-1' }}
          currentBook="book-1"
          levelMarkFor={(surface) => (surface === 'gave up' ? 1 : 2)}
          {...props}
        />
      );
    });
    return tree;
  };

  it('looks the phrase up first, with its level mark, and offers the word as a chip', async () => {
    const tree = await render({ phraseWord: 'gave' });
    expect(resolveDictionaryLookup).toHaveBeenCalledTimes(1);
    expect(resolveDictionaryLookup.mock.calls[0][0]).toMatchObject({ surface: 'gave up', levelMark: 1 });

    const phraseChip = tree.root.findByProps({ testID: 'phrase-chip-phrase' });
    const wordChip = tree.root.findByProps({ testID: 'phrase-chip-word' });
    expect(phraseChip.props.accessibilityState).toEqual({ selected: true });
    expect(wordChip.props.accessibilityState).toEqual({ selected: false });
    expect(wordChip.findByType(require('react-native').Text).props.children).toBe('gave');
  });

  it('switches to the word\'s card from the chip without moving the level', async () => {
    const tree = await render({ phraseWord: 'gave' });
    await act(async () => {
      tree.root.findByProps({ testID: 'phrase-chip-word' }).props.onPress();
    });
    expect(resolveDictionaryLookup).toHaveBeenCalledTimes(2);
    // levelMarkFor('gave') would say 2 (sampled): the chip overrides it.
    expect(resolveDictionaryLookup.mock.calls[1][0]).toMatchObject({ surface: 'gave', levelMark: 0 });
    expect(tree.root.findByProps({ testID: 'phrase-chip-word' }).props.accessibilityState).toEqual({ selected: true });

    // And back to the phrase, which is a lookup of the phrase again.
    await act(async () => {
      tree.root.findByProps({ testID: 'phrase-chip-phrase' }).props.onPress();
    });
    expect(resolveDictionaryLookup.mock.calls[2][0]).toMatchObject({ surface: 'gave up', levelMark: 1 });
  });

  it('shows no chips for a plain word', async () => {
    const tree = await render({ highlightedWord: 'lantern', phraseWord: '' });
    expect(tree.root.findAllByProps({ testID: 'phrase-chips' })).toHaveLength(0);
  });
});
