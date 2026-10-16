import React from 'react';
import renderer, { act } from 'react-test-renderer';

// The level picker must save under the signed-in account. It used to read the
// owner id from the app context, which has none, so picks went to "guest" and
// never reached the reader's underlines.

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ activeProfileId: 'profile-1', targetLanguage: 'ko', setTargetLanguageLevel: jest.fn() }),
}));
jest.mock('../../contexts/LocalOwnerContext', () => ({
  useLocalOwner: () => ({ activeOwnerId: 'account-123' }),
}));
jest.mock('../../services/Database', () => ({
  getProfileAbility: jest.fn(() => Promise.resolve(null)),
  setProfileAbilityFromVocab: jest.fn(() => Promise.resolve()),
}));

require('react-native').Platform.OS = 'android';
const RN = require('react-native');
RN.ToastAndroid = { show: jest.fn(), SHORT: 0 };
const VocabLevelModal = require('../shared/VocabLevelModal').default;
const AsyncStorage = require('@react-native-async-storage/async-storage');
const Database = require('../../services/Database');

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

it('saves the pick and the ability under the signed-in account', async () => {
  let tree;
  await act(async () => {
    tree = renderer.create(<VocabLevelModal visible onClose={jest.fn()} />);
  });
  await flush();
  const rows = tree.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function');
  await act(async () => { rows[3].props.onPress(); });
  const confirm = tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && node.props.disabled !== undefined)[0];
  await act(async () => { await confirm.props.onPress(); });
  await flush();

  expect(Database.setProfileAbilityFromVocab).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: 'account-123', profileId: 'profile-1', language: 'ko',
  }));
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('vocabLevelPick:account-123:profile-1:ko', expect.any(String));
  expect(AsyncStorage.getItem).toHaveBeenCalledWith('vocabLevelPick:account-123:profile-1:ko');
});
