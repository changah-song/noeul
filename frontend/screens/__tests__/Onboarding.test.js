import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Onboarding: the completion flag helpers, the language choice going through
// the app-context setters, and the reading guide ending the flow.

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
  MaterialIcons: () => null,
  MaterialCommunityIcons: () => null,
}), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    getItem: jest.fn((key) => Promise.resolve(key in store ? store[key] : null)),
    setItem: jest.fn((key, value) => { store[key] = value; return Promise.resolve(); }),
  };
});
const mockSetTargetLanguage = jest.fn();
const mockSetInterfaceLanguage = jest.fn();
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({
    activeProfileId: 'profile-1',
    targetLanguage: 'ko',
    interfaceLanguage: 'en',
    setTargetLanguage: mockSetTargetLanguage,
    setInterfaceLanguage: mockSetInterfaceLanguage,
    setChineseScript: jest.fn(),
    setTargetLanguageLevel: jest.fn(),
  }),
}));
jest.mock('../../contexts/LocalOwnerContext', () => ({
  useLocalOwner: () => ({ activeOwnerId: 'owner-1' }),
}));
jest.mock('../../services/Database', () => ({
  getProfileAbility: jest.fn(() => Promise.resolve(null)),
  setProfileAbilityFromVocab: jest.fn(() => Promise.resolve()),
  getReaderLevel: jest.fn(() => Promise.resolve({ theta: 0, variance: 2 })),
  applyWordCheckResults: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../Auth', () => ({ __esModule: true, default: () => null, AuthModal: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

// Animations finish at once (no timers left running after the test).
const { Animated } = require('react-native');
jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
  start: (callback) => { value.setValue(config.toValue); callback?.({ finished: true }); },
  stop: () => {},
}));

const Onboarding = require('../Onboarding').default;
const { hasCompletedOnboarding, markOnboardingCompleted, ONBOARDING_COMPLETED_KEY } = require('../Onboarding');
const AsyncStorage = require('@react-native-async-storage/async-storage');

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const primary = (tree) => tree.root.findAll((node) => node.props.testID === 'onboarding-primary' && typeof node.props.onPress === 'function')[0];
const radios = (tree) => tree.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function');

it('stores and reads the completion flag', async () => {
  expect(await hasCompletedOnboarding()).toBe(false);
  await markOnboardingCompleted();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_COMPLETED_KEY, '1');
  expect(await hasCompletedOnboarding()).toBe(true);
});

it('walks the four steps, plays the reading guide and finishes with onDone when it closes', async () => {
  const onDone = jest.fn();
  let tree;
  await act(async () => {
    tree = renderer.create(<Onboarding onDone={onDone} />);
  });

  // Welcome → Languages
  await act(async () => { primary(tree).props.onPress(); });
  // Picking Chinese goes through the same setter Profile uses.
  const languageCards = radios(tree);
  expect(languageCards.length).toBeGreaterThanOrEqual(2);
  await act(async () => { languageCards[1].props.onPress(); });
  expect(mockSetTargetLanguage).toHaveBeenCalledWith('zh');

  // Languages → Level; choose "I'm just starting" so no sheet opens.
  await act(async () => { primary(tree).props.onPress(); });
  const levelCards = radios(tree);
  await act(async () => { levelCards[levelCards.length - 1].props.onPress(); });
  await act(async () => { primary(tree).props.onPress(); });

  // Daily goal: pick 15 minutes, then on to the reading guide.
  const goalCards = radios(tree);
  expect(goalCards).toHaveLength(5);
  await act(async () => { goalCards[2].props.onPress(); });
  await act(async () => { primary(tree).props.onPress(); });
  await flush();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('readingGoal.minutes', '15');
  expect(tree.root.findAll((node) => node.props.testID === 'reader-guide').length).toBeGreaterThan(0);
  expect(onDone).not.toHaveBeenCalled();

  // Leaving the guide finishes onboarding.
  const close = tree.root.findAll((node) => node.props.testID === 'guide-close' && typeof node.props.onPress === 'function')[0];
  await act(async () => { close.props.onPress(); });
  await flush();
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_COMPLETED_KEY, '1');
  act(() => { tree.unmount(); });
});
