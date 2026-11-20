import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Render test for Profile's Friends card: a guest is asked to sign in, an
// account sees its friends (streak and current book each), and an invite link
// opened in the app is offered once there is an account.

jest.mock('@expo/vector-icons', () => {
  const icon = () => null;
  return { Feather: icon, MaterialIcons: icon, MaterialCommunityIcons: icon };
}, { virtual: true });
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ interfaceLanguage: 'en', isDarkMode: false }),
}));
jest.mock('../../services/friends', () => {
  const actual = jest.requireActual('../../services/friends');
  return {
    ...actual,
    listFriends: jest.fn(),
    previewInvite: jest.fn(),
    acceptInvite: jest.fn(),
    getInviteCode: jest.fn(),
    removeFriend: jest.fn(),
    publishOwnFriendCard: jest.fn(async () => true),
  };
});
jest.mock('../../services/supabase', () => ({ supabase: {} }));

jest.setTimeout(30000);
const { Alert, Text } = require('react-native');
const friends = require('../../services/friends');
const FriendsSection = require('../Friends/FriendsSection').default;

const USER = { id: 'u1', email: 'me@example.com' };
const today = new Date().toISOString().slice(0, 10);
const MINA = {
  id: 'u2',
  since: null,
  card: {
    user_id: 'u2',
    display_name: 'Mina',
    day_streak: 12,
    streak_day: today,
    utc_offset_minutes: 0,
    total_days: 40,
    books_finished: 3,
    current_book_title: 'The Little Prince',
    current_book_progress: 0.4,
  },
};

const mounted = [];
const mount = async (props) => {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <FriendsSection user={USER} isGuest={false} ownerId="u1" books={[]} styles={{}} profileColors={{}} {...props} />
    );
  });
  mounted.push(tree);
  return tree;
};
// A screen left mounted would take the next test's invite.
afterEach(() => act(() => mounted.splice(0).forEach((tree) => tree.unmount())));
const texts = (tree) => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

beforeEach(() => {
  jest.clearAllMocks();
  friends.setPendingInvite(null);
  friends.listFriends.mockResolvedValue([]);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

it('asks a guest to sign in', async () => {
  const onSignIn = jest.fn();
  const tree = await mount({ user: null, isGuest: true, onSignIn });
  expect(texts(tree)).toContain('Sign in to add friends');
  expect(friends.listFriends).not.toHaveBeenCalled();
  act(() => tree.root.findByProps({ accessibilityLabel: 'Sign in to add friends' }).props.onPress());
  expect(onSignIn).toHaveBeenCalled();
});

it('lists friends with their streak and book', async () => {
  friends.listFriends.mockResolvedValue([MINA, { id: 'u3', since: null, card: null }]);
  const tree = await mount();
  const shown = texts(tree);
  expect(shown).toEqual(expect.arrayContaining(['Mina', 'Reading The Little Prince', '12-day streak', 'Reader', 'Invite a friend']));
});

it('offers an invite that was opened as a link, then adds the friend', async () => {
  friends.previewInvite.mockResolvedValue({ inviterId: 'u2', name: 'Mina', isSelf: false, alreadyFriends: false });
  friends.acceptInvite.mockResolvedValue('u2');
  friends.setPendingInvite('AB12CD34EF56');
  await mount();

  expect(friends.previewInvite).toHaveBeenCalledWith('AB12CD34EF56');
  expect(friends.peekPendingInvite()).toBeNull();
  const [title, , buttons] = Alert.alert.mock.calls[0];
  expect(title).toBe('Add Mina as a friend?');
  await act(async () => { await buttons[1].onPress(); });
  expect(friends.acceptInvite).toHaveBeenCalledWith('AB12CD34EF56');
  expect(friends.publishOwnFriendCard).toHaveBeenCalledWith(expect.objectContaining({ start: true }));
});

it('keeps the invite waiting while the reader is a guest', async () => {
  friends.setPendingInvite('AB12CD34EF56');
  await mount({ user: null, isGuest: true });
  expect(Alert.alert.mock.calls[0][0]).toBe('Sign in to add your friend');
  expect(friends.previewInvite).not.toHaveBeenCalled();
  expect(friends.peekPendingInvite()).toBe('AB12CD34EF56');
});
