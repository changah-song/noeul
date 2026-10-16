import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Smoke test for the song reader's parity with the book reader: it renders the
// native reader with saved-word highlights AND level underlines, the lookup
// panel follows the book reader's tap rules, focus mode switches the render
// mode, and the options menu carries the shared reader settings.

jest.mock('@expo/vector-icons', () => {
  const icon = () => null;
  return { Feather: icon, MaterialIcons: icon, MaterialCommunityIcons: icon };
}, { virtual: true });
jest.mock('react-native-elements', () => ({ Slider: () => null }), { virtual: true });
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}), { virtual: true });
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({
    targetLanguage: 'ko',
    chineseScript: 'simplified',
    interfaceLanguage: 'en',
    isDarkMode: false,
  }),
}));
jest.mock('../../contexts/LocalOwnerContext', () => ({
  useLocalOwner: () => ({ activeOwnerId: 'owner-1' }),
}));
jest.mock('../../services/songPreprocess', () => ({
  ensureSongPreprocessed: jest.fn(() => Promise.resolve()),
  getSongBookUri: (id) => (id ? `song:${id}` : null),
}));
jest.mock('../Read/TopSection/TopSection', () => {
  const ReactLocal = require('react');
  return (props) => ReactLocal.createElement('LookupPanel', props);
});
jest.mock('../Read/SavedWordsPanel', () => () => null);
jest.mock('../../services/haptics', () => ({
  tapSelect: jest.fn(),
  tapCommit: jest.fn(),
  tapUndo: jest.fn(),
}));
jest.mock('../../services/Database', () => ({
  applyExposureBatch: jest.fn(() => Promise.resolve()),
  getBookSavedWords: jest.fn(() => Promise.resolve([{ id: 1, word: '사랑' }])),
  getBookWordCandidates: jest.fn(() => Promise.resolve([])),
  getSavedWords: jest.fn(() => Promise.resolve(['사랑'])),
  lookupBookHighlightSurfaces: jest.fn(() => Promise.resolve([{ surface: '사랑해' }])),
  lookupBookWordEvidence: jest.fn(() => Promise.resolve([])),
  recordVocabContextForSurface: jest.fn(() => Promise.resolve(null)),
  getProfileAbility: jest.fn(() => Promise.resolve({ theta: -2 })),
  lookupBookLevelSurfaces: jest.fn(() => Promise.resolve([
    { surface: '그리움', level_rank: 3, stem_count: 1 },
  ])),
}));
jest.mock('../../modules/native-epub-reader/src/NativeEpubReaderView', () => {
  const ReactLocal = require('react');
  const View = ReactLocal.forwardRef((props, ref) => ReactLocal.createElement('NativeReader', { ...props, ref }));
  return { __esModule: true, default: View, supportsImperativeFocusNav: false, sendFocusNavCommand: jest.fn() };
});

require('react-native').Platform.OS = 'android';
const SongReader = require('../Songs/SongReader').default;
const Database = require('../../services/Database');

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const pressByLabel = (tree, label) => act(async () => {
  tree.root
    .findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]
    .props.onPress();
});

describe('SongReader', () => {
  let tree;
  const song = { id: 's1', title: '노래', artist: 'IU', lyrics: '사랑해\n그리움', savedTerms: [] };

  beforeEach(async () => {
    await act(async () => {
      tree = renderer.create(<SongReader song={song} onClose={() => {}} />);
    });
    await flush();
  });

  afterEach(async () => {
    await act(async () => tree.unmount());
  });

  const reader = () => tree.root.findByType('NativeReader');
  const panel = () => tree.root.findByType('LookupPanel');

  it('draws saved-word highlights and level underlines from the song index', () => {
    expect(reader().props.renderMode).toBe('continuous');
    expect(reader().props.highlightTerms).toEqual(expect.arrayContaining(['사랑', '사랑해']));
    expect(reader().props.levelTerms.map((term) => term.text)).toEqual(['그리움']);
    expect(Database.lookupBookLevelSurfaces).toHaveBeenCalledWith(
      'owner-1',
      'song:s1',
      expect.any(Number),
      { language: 'ko' }
    );
  });

  it('closes the open lookup panel on the next word tap instead of opening a new lookup', async () => {
    await act(async () => reader().props.onWordSelected({ text: '그리움', sentence: '그리움' }));
    expect(panel().props.highlightedWord).toBe('그리움');

    await act(async () => reader().props.onWordSelected({ text: '사랑해', sentence: '사랑해' }));
    expect(panel().props.highlightedWord).toBe('');
  });

  it('toggles focus mode from the header', async () => {
    await pressByLabel(tree, 'Focus mode');
    expect(reader().props.renderMode).toBe('focus');
  });

  it('opens the shared reader options menu', async () => {
    await pressByLabel(tree, 'Song options');
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Song settings');
    expect(json).toContain('Edit lyrics');
    expect(json).toContain('Delete song');
    expect(json).toContain('Font size');
  });
});
