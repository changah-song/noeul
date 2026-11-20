import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetFriends,
  buildFriendCard,
  friendErrorKind,
  liveStreak,
  makeInviteUrl,
  markFriendsStarted,
  parseInviteInput,
  parseInviteUrl,
  publishFriendCard,
} from '../friends';

// A stand-in for the two tables the card code touches: whether the account
// has a card or an invite, and every card it was asked to save.
jest.mock('../supabase', () => {
  const state = { hasCard: false, hasInvite: false, upserts: [], failWith: null };
  const from = (table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: (table === 'friend_cards' ? state.hasCard : state.hasInvite) ? { user_id: 'u1' } : null,
          error: null,
        }),
      }),
    }),
    upsert: async (row) => {
      if (state.failWith) return { error: state.failWith };
      state.upserts.push(row);
      return { error: null };
    },
  });
  return { supabase: { from }, __state: state };
});

const { __state: cloud } = jest.requireMock('../supabase');

const USER = { id: 'u1', email: 'mina@example.com', user_metadata: { username: 'Mina' } };
const met = (iso) => ({ ms: 600000, metAt: iso });

beforeEach(async () => {
  __resetFriends();
  Object.assign(cloud, { hasCard: false, hasInvite: false, upserts: [], failWith: null });
  await AsyncStorage.clear();
});

describe('invite links', () => {
  it('reads the code from the web link and the app link', () => {
    expect(parseInviteUrl('https://noeul.app/invite?c=ab12cd34ef56')).toBe('AB12CD34EF56');
    expect(parseInviteUrl('https://noeul.app/invite/AB12CD34EF56')).toBe('AB12CD34EF56');
    expect(parseInviteUrl('noeul://invite/AB12CD34EF56')).toBe('AB12CD34EF56');
    expect(parseInviteUrl('noeul://invite?c=AB12CD34EF56')).toBe('AB12CD34EF56');
    expect(parseInviteUrl(makeInviteUrl('AB12CD34EF56'))).toBe('AB12CD34EF56');
  });

  it('ignores links that are not invites', () => {
    expect(parseInviteUrl('content://downloads/book.epub')).toBeNull();
    expect(parseInviteUrl('https://example.com/invite?c=AB12CD34EF56')).toBeNull();
    expect(parseInviteUrl('https://noeul.app/privacy.html')).toBeNull();
    expect(parseInviteUrl('noeul://invite/')).toBeNull();
    expect(parseInviteUrl(null)).toBeNull();
  });

  it('takes a pasted code, or a link inside a pasted message', () => {
    expect(parseInviteInput('  ab12cd34ef56 ')).toBe('AB12CD34EF56');
    expect(parseInviteInput('Read with me: https://noeul.app/invite?c=AB12CD34EF56\nOr enter…')).toBe('AB12CD34EF56');
    expect(parseInviteInput('hello there')).toBeNull();
  });
});

describe('buildFriendCard', () => {
  const now = new Date(2026, 10, 19, 21, 0, 0);
  const days = {
    '2026-11-17': met('2026-11-17T10:00:00.000Z'),
    '2026-11-18': met('2026-11-18T10:00:00.000Z'),
    '2026-11-19': met('2026-11-19T10:00:00.000Z'),
    '2026-11-10': met('2026-11-10T10:00:00.000Z'),
    '2026-11-15': { ms: 120000 },
  };
  const books = [
    { uri: 'a', title: 'The Little Prince', author: 'Saint-Exupéry', progress: 0.4267 },
    { uri: 'b', title: 'Done by progress', progress: 1 },
    { uri: 'c', title: 'Done by date', progress: 0.2, finishedAt: '2026-11-01T00:00:00.000Z' },
  ];

  it('sums up the streak, the books and the open book', () => {
    const card = buildFriendCard({ user: USER, books, currentBookUri: 'a', days, now });
    expect(card).toMatchObject({
      user_id: 'u1',
      display_name: 'Mina',
      day_streak: 3,
      streak_day: '2026-11-19',
      total_days: 4,
      books_finished: 2,
      current_book_title: 'The Little Prince',
      current_book_author: 'Saint-Exupéry',
      current_book_progress: 0.43,
    });
  });

  it('leaves the book empty when none is open', () => {
    const card = buildFriendCard({ user: USER, books, currentBookUri: null, days: {}, now });
    expect(card.current_book_title).toBeNull();
    expect(card.current_book_progress).toBeNull();
    expect(card.day_streak).toBe(0);
    expect(card.streak_day).toBeNull();
  });

  it('falls back to the first part of the email for a name', () => {
    const card = buildFriendCard({ user: { id: 'u1', email: 'mina@example.com' }, days: {}, now });
    expect(card.display_name).toBe('mina');
  });
});

describe('liveStreak', () => {
  // A friend nine hours ahead of UTC (Seoul).
  const card = { day_streak: 5, streak_day: '2026-11-19', utc_offset_minutes: 540 };

  it('keeps the streak on the day it was reached and the day after', () => {
    expect(liveStreak(card, new Date('2026-11-19T12:00:00Z'))).toEqual({ streak: 5, readToday: true });
    // 20 Nov in Seoul: yesterday's streak still stands, not yet read today.
    expect(liveStreak(card, new Date('2026-11-20T12:00:00Z'))).toEqual({ streak: 5, readToday: false });
  });

  it('drops it once a whole day was missed', () => {
    // 15:30 UTC on the 20th is already the 21st in Seoul.
    expect(liveStreak(card, new Date('2026-11-20T15:30:00Z'))).toEqual({ streak: 0, readToday: false });
  });

  it('is zero for a friend with no card or no streak', () => {
    expect(liveStreak(null)).toEqual({ streak: 0, readToday: false });
    expect(liveStreak({ day_streak: 0, streak_day: null })).toEqual({ streak: 0, readToday: false });
  });
});

describe('publishFriendCard', () => {
  const card = buildFriendCard({ user: USER, days: {}, now: new Date(2026, 10, 19) });

  it('sends nothing for a reader who has never used friends', async () => {
    expect(await publishFriendCard({ user: USER, card })).toBe(false);
    expect(cloud.upserts).toHaveLength(0);
  });

  it('sends the first card when the reader invites or accepts', async () => {
    expect(await publishFriendCard({ user: USER, card, start: true })).toBe(true);
    expect(cloud.upserts).toEqual([card]);
  });

  it('keeps an existing card up to date, once per change', async () => {
    cloud.hasCard = true;
    expect(await publishFriendCard({ user: USER, card })).toBe(true);
    expect(await publishFriendCard({ user: USER, card })).toBe(false);
    expect(await publishFriendCard({ user: USER, card: { ...card, day_streak: 1 } })).toBe(true);
    expect(cloud.upserts).toHaveLength(2);
  });

  it('sends later when the first card failed but friends were started', async () => {
    cloud.failWith = new Error('offline');
    markFriendsStarted('u1');
    await expect(publishFriendCard({ user: USER, card, start: true })).rejects.toThrow('offline');
    cloud.failWith = null;
    expect(await publishFriendCard({ user: USER, card })).toBe(true);
  });

  it('never sends for a guest or for someone else\'s card', async () => {
    expect(await publishFriendCard({ user: { id: 'u1', is_anonymous: true }, card, start: true })).toBe(false);
    expect(await publishFriendCard({ user: USER, card: { ...card, user_id: 'u2' }, start: true })).toBe(false);
    expect(cloud.upserts).toHaveLength(0);
  });
});

describe('friendErrorKind', () => {
  it('names the failures the app explains', () => {
    expect(friendErrorKind({ message: 'friends_invite_not_found' })).toBe('notFound');
    expect(friendErrorKind({ message: 'friends_invite_own' })).toBe('own');
    expect(friendErrorKind({ message: 'friends_limit_reached' })).toBe('limit');
    expect(friendErrorKind(new Error('network'))).toBe('unknown');
  });
});
