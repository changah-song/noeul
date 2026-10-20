import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Render test for the review flashcard: the card-settings popover closes on a
// tap outside it, the grade buttons show when each grade brings the word back,
// and the last card leads to the all-caught-up screen.

jest.mock('@expo/vector-icons', () => {
  const icon = () => null;
  return { Feather: icon, MaterialIcons: icon, MaterialCommunityIcons: icon };
}, { virtual: true });
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ interfaceLanguage: 'en', isDarkMode: false }),
}));
// Keys instead of copy, so the assertions do not depend on the English text.
jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key, params = {}) => (
      Object.keys(params).length > 0 ? `${key}(${Object.values(params).join(',')})` : key
    ),
  }),
}));
jest.mock('../../services/Database', () => ({
  ...jest.requireActual('../../services/Database'),
  getVocabContexts: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../services/preferencesCloudSync', () => ({
  fetchUserPreferences: jest.fn(() => Promise.resolve(null)),
  getTimestampMs: () => 0,
  updateUserPreferenceFields: jest.fn(() => Promise.resolve()),
}));

require('react-native').Platform.OS = 'android';
jest.setTimeout(30000);
// Animated timings (progress bar) run on timers; fake them so none fire after
// the test environment is torn down.
jest.useFakeTimers();

const Flashcard = require('../Learn/Flashcard').default;

const vocab = {
  word: '정직',
  hanja: '正直',
  def: 'honesty; integrity',
  language: 'ko',
  stability: 1,
  difficulty: 5,
  last_reviewed_at: null,
};

const text = (tree) => JSON.stringify(tree.toJSON());
const byLabel = (tree, label) => tree.root.findAll(
  (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
)[0];

const render = async (props = {}) => {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <Flashcard
        vocab={vocab}
        index={0}
        total={1}
        onClose={jest.fn()}
        onMark={jest.fn()}
        {...props}
      />
    );
  });
  return tree;
};

describe('Flashcard', () => {
  it('closes the card settings when tapping outside the popover', async () => {
    const tree = await render();
    expect(text(tree)).not.toContain('learn.frontOfCard');

    await act(async () => byLabel(tree, 'learn.cardSettings').props.onPress());
    expect(text(tree)).toContain('learn.frontOfCard');

    // The backdrop behind the popover closes it.
    await act(async () => byLabel(tree, 'common.close').props.onPress());
    expect(text(tree)).not.toContain('learn.frontOfCard');
  });

  it('shows when each grade brings the word back and records the grade', async () => {
    const onMark = jest.fn();
    const reviewed = {
      ...vocab,
      stability: 4,
      last_reviewed_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    };
    const tree = await render({ onMark, vocab: reviewed });

    await act(async () => byLabel(tree, 'learn.showAnswer').props.onPress());
    const json = text(tree);
    expect(json).toContain('learn.when.tomorrow');
    expect(json).toMatch(/learn\.when\.inDays\(\d+\)/);

    await act(async () => byLabel(tree, 'learn.hard, learn.when.tomorrow').props.onPress());
    expect(onMark).toHaveBeenCalledWith('bad');
  });

  it('leaves out the hint line when every grade gives the same interval', async () => {
    const tree = await render();
    await act(async () => byLabel(tree, 'learn.showAnswer').props.onPress());
    expect(text(tree)).not.toContain('learn.when.');
  });

  it('shows the all-caught-up screen after the last card', async () => {
    const onKeepReading = jest.fn();
    const onBackToLearn = jest.fn();
    const tree = await render({
      completed: true,
      total: 3,
      index: 2,
      completionNote: 'The next one comes back tomorrow.',
      onKeepReading,
      onBackToLearn,
    });
    const json = text(tree);
    expect(json).toContain('learn.allCaughtUp');
    expect(json).toContain('learn.reviewedOther(3) The next one comes back tomorrow.');
    expect(json).toContain('learn.progress(3,3)');
    expect(json).not.toContain('learn.showAnswer');

    const press = async (handler) => {
      const node = tree.root.findAll((n) => n.props.onPress === handler)[0];
      await act(async () => node.props.onPress());
    };
    await press(onKeepReading);
    expect(onKeepReading).toHaveBeenCalled();
    await press(onBackToLearn);
    expect(onBackToLearn).toHaveBeenCalled();
  });
});
