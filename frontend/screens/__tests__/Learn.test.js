import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Learn: the stats card and the review button read the same list, so a newly
// saved (never reviewed) word shows as due and not seen yet, never 0 / 0 / 0
// next to "Review 1 word". The avatar opens Profile.

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  MaterialIcons: () => null,
  MaterialCommunityIcons: () => null,
}), { virtual: true });
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (effect) => useEffect(effect, [effect]) };
});
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ targetLanguage: 'ko', interfaceLanguage: 'en' }),
}));
jest.mock('../../contexts/LocalOwnerContext', () => ({
  useLocalOwner: () => ({ activeOwnerId: 'owner-1', syncGeneration: 1, syncPaused: false }),
}));
jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key, params = {}) => (
      Object.keys(params).length > 0 ? `${key}(${Object.values(params).join(',')})` : key
    ),
  }),
}));
const mockRows = [];
jest.mock('../../services/Database', () => ({
  addRelatedKnownWord: jest.fn(),
  fsrsSchedule: jest.fn(() => null),
  getAllBooksWordCandidates: jest.fn(() => Promise.resolve([])),
  getCachedPKnown: jest.fn(),
  getVocabContexts: jest.fn(() => Promise.resolve([])),
  getRelatedKnownWords: jest.fn(() => Promise.resolve([])),
  insertData: jest.fn(),
  logInteractionEvent: jest.fn(() => Promise.resolve()),
  recordReviewOutcome: jest.fn(),
  removeData: jest.fn(),
  removeRelatedKnownWord: jest.fn(),
  updateFavorite: jest.fn(),
  restoreLearnedWord: jest.fn(),
  viewData: jest.fn(() => Promise.resolve(mockRows)),
  vocabEntryExists: jest.fn(),
}));
jest.mock('../../services/supabase', () => ({
  recordCloudVocabReview: jest.fn(),
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) } },
  toggleCloudRelatedKnownWord: jest.fn(),
}));
jest.mock('../../services/preferencesCloudSync', () => ({
  fetchUserPreferences: jest.fn(() => Promise.resolve(null)),
  getTimestampMs: () => 0,
  updateUserPreferenceFields: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/api/hanjaRelated', () => ({ fetchHanjaRelated: jest.fn() }));
jest.mock('../../services/userDataSyncQueue', () => ({ requestUserDataSync: jest.fn() }));
jest.mock('../../services/dailyProgress', () => ({ incrementWordsStudied: jest.fn() }));
jest.mock('../../services/localOwnerCoordinator', () => ({ isCurrentSyncGeneration: () => true }));

const { Animated } = require('react-native');
jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
  start: (callback) => { value.setValue(config.toValue); callback?.({ finished: true }); },
  stop: () => {},
}));
jest.setTimeout(30000);

const Learn = require('../Learn').default;

const day = 86_400_000;
const row = (overrides) => ({
  word: '정직',
  hanja: '正直',
  def: 'honesty; integrity',
  language: 'ko',
  level: 'unorganized',
  created_at: new Date(Date.now() - day).toISOString(),
  next_review_at: null,
  last_reviewed_at: null,
  correct_count: 0,
  wrong_count: 0,
  ...overrides,
});

const renderLearn = async (navigation = { navigate: jest.fn() }) => {
  let tree;
  await act(async () => {
    tree = renderer.create(<Learn navigation={navigation} user={null} />);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return tree;
};

// [matured, due today, not seen yet] in the order the card shows them.
const stats = (tree) => {
  const labels = ['learn.statMatured', 'learn.statDueToday', 'learn.statNotSeenYet'];
  const texts = tree.root.findAll((node) => node.type === 'Text').map((node) => node.props.children);
  // Each value is the text right before its label.
  // Values are formatted for the interface language (formatNumber), so compare as numbers.
  return labels.map((label) => Number(texts[texts.indexOf(label) - 1]));
};
// The label of the review button: the only button whose accessibilityState
// carries a boolean `disabled`.
const reviewButtonText = (tree) => tree.root
  .findAll((node) => node.props.accessibilityRole === 'button'
    && typeof node.props.accessibilityState?.disabled === 'boolean')[0]
  .findAll((node) => node.type === 'Text')
  .map((node) => node.props.children)
  .join(' ');

beforeEach(() => {
  mockRows.length = 0;
});

it('counts a newly saved word as due and not seen yet, matching the review button', async () => {
  mockRows.push(row({}));
  const tree = await renderLearn();
  expect(stats(tree)).toEqual([0, 1, 1]);
  expect(reviewButtonText(tree)).toContain('learn.reviewWordsOne');
});

it('leaves a word scheduled for later out of due and the button', async () => {
  mockRows.push(row({
    level: 'mid',
    last_reviewed_at: new Date(Date.now() - day).toISOString(),
    next_review_at: new Date(Date.now() + 3 * day).toISOString(),
    correct_count: 1,
  }));
  mockRows.push(row({
    word: '처녀',
    hanja: '處女',
    def: 'maiden',
    level: 'bad',
    last_reviewed_at: new Date(Date.now() - 3 * day).toISOString(),
    next_review_at: new Date(Date.now() - day).toISOString(),
    wrong_count: 1,
  }));
  const tree = await renderLearn();
  expect(stats(tree)).toEqual([0, 1, 0]);
  expect(reviewButtonText(tree)).toContain('learn.reviewWordsOne');
});

it('says no reviews are due when nothing is due', async () => {
  mockRows.push(row({
    level: 'good',
    last_reviewed_at: new Date().toISOString(),
    next_review_at: new Date(Date.now() + 5 * day).toISOString(),
    correct_count: 2,
  }));
  const tree = await renderLearn();
  expect(stats(tree)[1]).toBe(0);
  expect(reviewButtonText(tree)).toContain('learn.noReviews');
});

it('opens Profile from the avatar', async () => {
  const navigation = { navigate: jest.fn() };
  const tree = await renderLearn(navigation);
  const avatar = tree.root.findAll((node) => node.props.accessibilityLabel === 'tabs.profile'
    && typeof node.props.onPress === 'function')[0];
  await act(async () => avatar.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('Profile');
});
