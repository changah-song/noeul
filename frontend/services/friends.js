import { Linking } from 'react-native';
import { isBookFinished } from './bookFinished';
import { isAccountUser } from './localDataScope';
import { dayKey, goalStats, readReadingDays } from './readingGoal';
import { supabase } from './supabase';

// Friends: an invite link makes two accounts friends, and each friend sees
// the other's card: name, streak, the book they're reading, books finished
// (supabase/friends.sql).
//
// Nothing of a reader's own data is opened to anyone. This phone writes the
// card, a handful of numbers and one book title, and only friends can read
// it. The card is first written when the reader invites someone or accepts an
// invite, and kept up to date from then on; a reader who never uses friends
// shares nothing.

const FILE_TAG = '[friends]';
const CARDS_TABLE = 'friend_cards';
const FRIENDSHIPS_TABLE = 'friendships';

export const INVITE_WEB_URL = 'https://noeul.app/invite';
const CODE_PATTERN = /^[0-9A-Za-z]{6,32}$/;

// ─── Invite links (pure) ─────────────────────────────────────────────────────

/** The link sent to a friend. The page behind it opens the app. */
export const makeInviteUrl = (code) => `${INVITE_WEB_URL}?c=${encodeURIComponent(code)}`;

/**
 * parseInviteUrl — the invite code in a link, or null when the link isn't an
 * invite. Takes the web link (noeul.app/invite?c=CODE, noeul.app/invite/CODE)
 * and the app's own (noeul://invite/CODE, noeul://invite?c=CODE).
 */
export const parseInviteUrl = (url) => {
  const match = String(url ?? '').trim().match(
    /^(?:noeul:\/\/|https?:\/\/(?:www\.)?noeul\.app\/)invite\/?(?:\?(?:[^#]*&)?c=|\/)([0-9A-Za-z]+)/i
  );
  const code = match?.[1] ?? '';
  return CODE_PATTERN.test(code) ? code.toUpperCase() : null;
};

/** What someone typed or pasted: a link (anywhere in the text) or a bare code. */
export const parseInviteInput = (text) => {
  const value = String(text ?? '').trim();
  if (CODE_PATTERN.test(value)) return value.toUpperCase();
  const link = value.match(/(?:noeul:\/\/|https?:\/\/(?:www\.)?noeul\.app\/)invite\S*/i);
  return link ? parseInviteUrl(link[0]) : null;
};

// ─── The card (pure) ─────────────────────────────────────────────────────────

const clampText = (value, max) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

/** The name friends see: the username, else the account's first name. */
export const friendDisplayName = (user) => {
  const meta = user?.user_metadata || {};
  const name = meta.username
    || meta.display_name
    || meta.given_name
    || meta.full_name
    || meta.name
    || String(user?.email || '').split('@')[0];
  return clampText(name, 80);
};

/**
 * buildFriendCard — this reader's card as a `friend_cards` row, from what the
 * phone has: the day log, the book list and the open book.
 */
export const buildFriendCard = ({ user, books = [], currentBookUri = null, days = {}, now = new Date() }) => {
  const today = dayKey(now);
  const stats = goalStats(days, today);
  const lastMetDay = Object.keys(days)
    .filter((key) => days[key]?.metAt && key <= today)
    .sort()
    .pop() ?? null;

  const list = Array.isArray(books) ? books.filter(Boolean) : [];
  const current = currentBookUri ? list.find((book) => book.uri === currentBookUri) : null;
  const progress = Number(current?.progress);

  return {
    user_id: user.id,
    display_name: friendDisplayName(user),
    day_streak: stats.dayStreak,
    streak_day: lastMetDay,
    utc_offset_minutes: -now.getTimezoneOffset(),
    total_days: stats.totalDays,
    books_finished: list.filter(isBookFinished).length,
    current_book_title: clampText(current?.title, 300),
    current_book_author: clampText(current?.author, 300),
    // Whole percents, so a page turn doesn't make a new card.
    current_book_progress: current && Number.isFinite(progress)
      ? Math.round(Math.min(1, Math.max(0, progress)) * 100) / 100
      : null,
  };
};

export const friendCardSignature = (card) => JSON.stringify(card);

const shiftDay = (key, count) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10);
};

/**
 * liveStreak — a friend's streak as it stands now. Their card says how long
 * the streak was on the last day they reached their goal; it is still running
 * if that day is today or yesterday on their calendar.
 *
 * @returns {{ streak: number, readToday: boolean }}
 */
export const liveStreak = (card, now = new Date()) => {
  const streak = Math.max(0, Math.round(Number(card?.day_streak) || 0));
  const lastDay = typeof card?.streak_day === 'string' ? card.streak_day.slice(0, 10) : null;
  if (!streak || !lastDay) return { streak: 0, readToday: false };

  const offsetMs = (Number(card.utc_offset_minutes) || 0) * 60000;
  const theirToday = new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
  if (lastDay >= theirToday) return { streak, readToday: true };
  if (lastDay === shiftDay(theirToday, -1)) return { streak, readToday: false };
  return { streak: 0, readToday: false };
};

// ─── Errors ──────────────────────────────────────────────────────────────────

const ERROR_KINDS = {
  friends_account_required: 'account',
  friends_invite_not_found: 'notFound',
  friends_invite_own: 'own',
  friends_limit_reached: 'limit',
};

/** 'account' | 'notFound' | 'own' | 'limit' | 'unknown' for a failed call. */
export const friendErrorKind = (error) => {
  const message = String(error?.message || error || '');
  const key = Object.keys(ERROR_KINDS).find((name) => message.includes(name));
  return key ? ERROR_KINDS[key] : 'unknown';
};

// ─── Sharing the card ────────────────────────────────────────────────────────

// Per account, this session: whether a card exists in the account (null
// until looked up) and the last card sent.
const sharing = new Map();
const lastSent = new Map();

const isSharing = async (userId) => {
  if (sharing.has(userId)) return sharing.get(userId);
  const { data, error } = await supabase
    .from(CARDS_TABLE)
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    sharing.set(userId, true);
    return true;
  }
  // No card yet, but an invite was made (the first card didn't get out).
  const { data: invite, error: inviteError } = await supabase
    .from('friend_invites')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (inviteError) throw inviteError;
  sharing.set(userId, Boolean(invite));
  return Boolean(invite);
};

/**
 * markFriendsStarted — the reader has invited or accepted someone: their card
 * is kept up to date from now on, even if the first one couldn't be sent.
 */
export const markFriendsStarted = (userId) => {
  if (userId) sharing.set(userId, true);
};

/**
 * publishFriendCard — send this reader's card if it changed. Without `start`
 * it only updates a card that already exists; `start` (inviting someone,
 * accepting an invite) writes the first one.
 *
 * @returns {Promise<boolean>} whether a card was sent.
 */
export const publishFriendCard = async ({ user, card, start = false }) => {
  if (!isAccountUser(user) || card?.user_id !== user.id) return false;
  if (!start && !(await isSharing(user.id))) return false;

  const signature = friendCardSignature(card);
  if (lastSent.get(user.id) === signature) return false;

  const { error } = await supabase.from(CARDS_TABLE).upsert(card, { onConflict: 'user_id' });
  if (error) throw error;
  sharing.set(user.id, true);
  lastSent.set(user.id, signature);
  return true;
};

/** Build the card from what the phone has now and send it (see above). */
export const publishOwnFriendCard = async ({ user, ownerId, books, currentBookUri, start = false }) => {
  if (!isAccountUser(user) || ownerId !== user.id) return false;
  // null when the log can't be read: never send a streak of 0 for that.
  const days = await readReadingDays(ownerId);
  if (!days) return false;
  return publishFriendCard({
    user,
    card: buildFriendCard({ user, books, currentBookUri, days }),
    start,
  });
};

// ─── Friends ─────────────────────────────────────────────────────────────────

/** This account's invite code (made the first time). */
export const getInviteCode = async () => {
  const { data, error } = await supabase.rpc('get_friend_invite_code');
  if (error) throw error;
  if (!data) throw new Error('friends_invite_unavailable');
  return String(data);
};

/**
 * previewInvite — who an invite is from, before accepting it.
 *
 * @returns {Promise<{ inviterId: string, name: string|null, isSelf: boolean, alreadyFriends: boolean } | null>}
 *   null when no invite has that code.
 */
export const previewInvite = async (code) => {
  const { data, error } = await supabase.rpc('preview_friend_invite', { invite_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.inviter_id) return null;
  return {
    inviterId: row.inviter_id,
    name: row.display_name ?? null,
    isSelf: Boolean(row.is_self),
    alreadyFriends: Boolean(row.already_friends),
  };
};

export const acceptInvite = async (code) => {
  const { data, error } = await supabase.rpc('accept_friend_invite', { invite_code: code });
  if (error) throw error;
  return data ?? null;
};

export const removeFriend = async (friendId) => {
  const { error } = await supabase.rpc('remove_friend', { friend: friendId });
  if (error) throw error;
};

/**
 * listFriends — this account's friends with their cards, by name. A friend
 * whose card hasn't arrived yet comes back with `card: null`.
 *
 * @returns {Promise<Array<{ id: string, since: string|null, card: object|null }>>}
 */
export const listFriends = async (userId) => {
  const { data: links, error: linksError } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .select('friend_id, created_at')
    .eq('user_id', userId);
  if (linksError) throw linksError;
  if (!links?.length) return [];

  const { data: cards, error: cardsError } = await supabase
    .from(CARDS_TABLE)
    .select('user_id, display_name, day_streak, streak_day, utc_offset_minutes, total_days, books_finished, current_book_title, current_book_author, current_book_progress, updated_at')
    .in('user_id', links.map((link) => link.friend_id));
  if (cardsError) throw cardsError;

  const cardById = new Map((cards ?? []).map((card) => [card.user_id, card]));
  return links
    .map((link) => ({
      id: link.friend_id,
      since: link.created_at ?? null,
      card: cardById.get(link.friend_id) ?? null,
    }))
    .sort((a, b) => String(a.card?.display_name ?? '￿').localeCompare(String(b.card?.display_name ?? '￿')));
};

// ─── An invite link opened in the app ────────────────────────────────────────

// The code from the last invite link opened, until Profile's Friends section
// takes it (it may have to wait for the reader to sign in).
let pendingInvite = null;
const inviteListeners = new Set();

export const peekPendingInvite = () => pendingInvite;

export const setPendingInvite = (code) => {
  pendingInvite = code || null;
  inviteListeners.forEach((listener) => listener(pendingInvite));
};

export const subscribePendingInvite = (listener) => {
  inviteListeners.add(listener);
  return () => inviteListeners.delete(listener);
};

let listening = false;

// Start watching for invite links (the launch URL and later ones). onInvite
// runs for each, e.g. to bring Profile on screen.
export const listenForInviteLinks = (onInvite) => {
  if (listening) return () => {};
  listening = true;
  const take = (url) => {
    const code = parseInviteUrl(url);
    if (!code) return;
    setPendingInvite(code);
    onInvite?.(code);
  };
  Linking.getInitialURL().then(take).catch(() => {});
  const subscription = Linking.addEventListener('url', ({ url }) => take(url));
  return () => {
    listening = false;
    subscription.remove();
  };
};

export const logFriendsError = (what, error) => {
  console.warn(`${FILE_TAG} ${what}:`, error?.message ?? error);
};

// Tests only.
export const __resetFriends = () => {
  sharing.clear();
  lastSent.clear();
  pendingInvite = null;
  inviteListeners.clear();
  listening = false;
};
