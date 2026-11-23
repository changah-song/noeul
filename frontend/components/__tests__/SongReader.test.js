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
jest.mock('../Read/SelectionExplainPanel', () => {
  const ReactLocal = require('react');
  return (props) => ReactLocal.createElement('ExplainPanel', props);
});
// The player's network calls and the WebView player (no Supabase in CI).
jest.mock('../../services/api/songSearch', () => ({ searchSongs: jest.fn(async () => []) }));
jest.mock('../../services/api/songVideo', () => ({ findSongVideo: jest.fn(async () => null) }));
jest.mock('../../services/chapterTranslations', () => {
  const done = new Set();
  return {
    chapterTranslations: {
      peek: (text) => (done.has(text) ? `EN ${text}` : null),
      prefetchChapter: jest.fn(async ({ paragraphs }) => {
        paragraphs.forEach((text) => done.add(text));
        return { total: paragraphs.length, done: paragraphs.length };
      }),
    },
  };
});
jest.mock('../Songs/SongPlayer', () => ({ __esModule: true, default: () => null, PLAYER_STATE: { PLAYING: 1, BUFFERING: 3 } }));
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
  getReaderLevel: jest.fn(() => Promise.resolve({ theta: -2, variance: 0.3, lookupRate: 0.5, guessRate: 0.05 })),
  onReaderLevelChanged: jest.fn(() => () => {}),
  lookupKnowledgeEvidence: jest.fn(() => Promise.resolve([])),
  getSavedWordFades: jest.fn(() => Promise.resolve(new Map())),
  getBookLookupWords: jest.fn(() => Promise.resolve([])),
  recordSavedWordSightings: jest.fn(() => Promise.resolve({ faded: new Map(), learned: [] })),
  resetSavedWordFade: jest.fn(() => Promise.resolve(0)),
  getWordDifficulties: jest.fn(() => Promise.resolve({})),
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

  it('saves the open word on a second tap, as the book reader does', async () => {
    await act(async () => reader().props.onWordSelected({ text: '그리움', sentence: '그리움' }));
    const toggle = jest.fn();
    panel().props.saveToggleRef.current = toggle;

    // Native marks a second tap on the same word with `again`.
    await act(async () => reader().props.onWordSelected({ text: '그리움', sentence: '그리움', again: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
    // The panel stays open on the word.
    expect(panel().props.highlightedWord).toBe('그리움');

    // A tap on another copy of the word (no `again`) only closes the panel.
    await act(async () => reader().props.onWordSelected({ text: '그리움', sentence: '그리움' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(panel().props.highlightedWord).toBe('');
  });

  it('explains a long-pressed selection with the AI, not the translation card', async () => {
    await act(async () => reader().props.onTextSelected({ text: '그리움' }));
    expect(panel().props.highlightedWord).toBe('');
    const explain = tree.root.findByType('ExplainPanel');
    expect(explain.props.text).toBe('그리움');
    // Native sent no sentence: the lyric line the selection sits in.
    expect(explain.props.sentence).toBe('그리움');

    // The next word tap only closes it.
    await act(async () => reader().props.onWordSelected({ text: '사랑해', sentence: '사랑해' }));
    expect(tree.root.findByType('ExplainPanel').props.text).toBe('');
    expect(panel().props.highlightedWord).toBe('');
  });

  it('draws each line\'s translation under it as an inert block', () => {
    const blocks = reader().props.chapterBlocks;
    expect(blocks.map((block) => block.text)).toEqual(['사랑해', 'EN 사랑해', '그리움', 'EN 그리움']);
    expect(blocks[1].styleTokens.inert).toBe(true);
    expect(blocks[0].styleTokens.inert).toBeUndefined();
  });

  it('toggles focus mode from the header, without the translations', async () => {
    await pressByLabel(tree, 'Focus mode');
    expect(reader().props.renderMode).toBe('focus');
    expect(reader().props.chapterBlocks.map((block) => block.text)).toEqual(['사랑해', '그리움']);
  });

  it('keeps saved words in the menu, as the book reader does', async () => {
    expect(tree.root.findAll((node) => /^Saved/.test(node.props.accessibilityLabel || ''))).toHaveLength(0);
    await pressByLabel(tree, 'Song options');
    expect(JSON.stringify(tree.toJSON())).toContain('Saved (1)');
    await pressByLabel(tree, 'Words');
    expect(JSON.stringify(tree.toJSON())).toContain('Line translations');
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
