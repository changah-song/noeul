import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Learn: due words are listed for swiping on the Today tab, words waiting
// for their next review sit in their stage tab with when they come back. A
// swipe moves a word to its stage, Undo brings it back. The avatar opens Profile.

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
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/Database', () => ({
  addRelatedKnownWord: jest.fn(),
  fsrsSchedule: jest.fn(() => null),
  getAllBooksWordCandidates: jest.fn(() => Promise.resolve([])),
  getCachedPKnown: jest.fn(),
  getVocabContexts: jest.fn(() => Promise.resolve([])),
  getRelatedKnownWords: jest.fn(() => Promise.resolve([])),
  insertData: jest.fn(),
  logInteractionEvent: jest.fn(() => Promise.resolve()),
  recordReviewOutcome: jest.fn(() => Promise.resolve()),
  removeData: jest.fn(),
  removeRelatedKnownWord: jest.fn(),
  updateFavorite: jest.fn(),
  restoreLearnedWord: jest.fn(),
  viewData: jest.fn(() => Promise.resolve(mockRows)),
  vocabEntryExists: jest.fn(),
}));
// The audio review player drives the phone's text-to-speech engine.
jest.mock('../../components/Learn/AudioReview', () => () => null);
// The shared top bar reads the reading goal; only its profile button matters here.
jest.mock('../../components/shared/AppTopBar', () => {
  const { TouchableOpacity } = require('react-native');
  return ({ onProfilePress }) => (
    <TouchableOpacity accessibilityLabel="tabs.profile" onPress={onProfilePress} />
  );
});
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

const Database = require('../../services/Database');
const mounted = [];
// Learn reads the safe-area insets (to place the timeline scrubber).
const { SafeAreaProvider } = require('react-native-safe-area-context');
const SAFE_AREA = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };
const withSafeArea = (node) => <SafeAreaProvider initialMetrics={SAFE_AREA}>{node}</SafeAreaProvider>;
// For tests on fake timers: no real-time wait for the first load.
const renderLearnSync = async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(withSafeArea(<Learn navigation={{ navigate: jest.fn() }} user={null} />));
  });
  mounted.push(tree);
  await act(async () => {});
  return tree;
};

const renderLearn = async (navigation = { navigate: jest.fn() }) => {
  let tree;
  await act(async () => {
    tree = renderer.create(withSafeArea(<Learn navigation={navigation} user={null} />));
  });
  mounted.push(tree);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return tree;
};

// What the screen shows, as one string (tab labels carry their counts).
const textOf = (tree) => JSON.stringify(tree.toJSON());
const pressTab = async (tree, label) => {
  const tab = tree.root.findAll((node) => typeof node.props.onPress === 'function'
    && node.findAll((child) => child.type === 'Text' && [].concat(child.props.children).join('').startsWith(label)).length > 0)
    .pop();
  await act(async () => tab.props.onPress());
};
// A due word's swipe row: the only rows with the known / unknown actions.
const swipeRows = (tree) => tree.root.findAll((node) => (
  Array.isArray(node.props.accessibilityActions) && typeof node.props.onAccessibilityAction === 'function'
));

beforeEach(() => {
  mockRows.length = 0;
});
// Unmount so no timer (the first-visit swipe nudge) fires after the test.
afterEach(() => {
  act(() => { mounted.splice(0).forEach((tree) => tree.unmount()); });
});

it('lists a newly saved word for swiping under New words', async () => {
  mockRows.push(row({}));
  const tree = await renderLearn();
  expect(textOf(tree)).toContain('Learn.when.today 1');
  expect(swipeRows(tree).length).toBeGreaterThan(0);
  expect(textOf(tree)).toContain('learn.sectionNew');
  expect(textOf(tree)).not.toContain('learn.sectionReturning');
});

it('keeps a word scheduled for later out of the due list and in its queue', async () => {
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
  expect(textOf(tree)).toContain('Learn.when.today 1');
  expect(textOf(tree)).toContain('learn.stageLearningTab 1');
  await pressTab(tree, 'learn.stageLearningTab');
  // A card in the stack, with its day on the timeline beside it.
  expect(textOf(tree)).toContain('정직');
  // The row capitalises the label's first letter.
  expect(textOf(tree).toLowerCase()).toContain('learn.when.indays(3)');
});

it('says all caught up when nothing is due', async () => {
  mockRows.push(row({
    level: 'good',
    last_reviewed_at: new Date().toISOString(),
    next_review_at: new Date(Date.now() + 5 * day).toISOString(),
    correct_count: 2,
  }));
  const tree = await renderLearn();
  expect(textOf(tree)).toContain('learn.allCaughtUp');
  expect(swipeRows(tree)).toHaveLength(0);
});

it('moves a swiped word to its queue at once and Undo brings it back', async () => {
  jest.useFakeTimers();
  mockRows.push(row({}));
  const tree = await renderLearnSync();
  await act(async () => {
    swipeRows(tree)[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'unknown' } });
  });
  expect(textOf(tree)).toContain('learn.stageLearningTab 1');
  expect(swipeRows(tree)).toHaveLength(0);
  expect(Database.recordReviewOutcome).not.toHaveBeenCalled();
  // A never-reviewed word is scheduled as a first review (no elapsed days),
  // the same way the stored review will be, so it does not change tabs later.
  expect(Database.fsrsSchedule.mock.calls.every(([word, , days]) => word.last_reviewed_at || days === null)).toBe(true);

  const undo = tree.root.findAll((node) => node.props.accessibilityLabel === 'common.undo'
    && typeof node.props.onPress === 'function')[0];
  await act(async () => undo.props.onPress());
  expect(textOf(tree)).toContain('Learn.when.today 1');
  expect(swipeRows(tree).length).toBeGreaterThan(0);

  // Swiped again and left alone, the grade is stored once Undo times out.
  await act(async () => {
    swipeRows(tree)[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'known' } });
  });
  await act(async () => { jest.advanceTimersByTime(7000); });
  expect(Database.recordReviewOutcome).toHaveBeenCalledTimes(1);
  expect(Database.recordReviewOutcome.mock.calls[0][4]).toBe('good');
  jest.useRealTimers();
});

it('opens Profile from the avatar', async () => {
  const navigation = { navigate: jest.fn() };
  const tree = await renderLearn(navigation);
  const avatar = tree.root.findAll((node) => node.props.accessibilityLabel === 'tabs.profile'
    && typeof node.props.onPress === 'function')[0];
  await act(async () => avatar.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('Profile');
});
