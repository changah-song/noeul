import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { logFriendsError, publishOwnFriendCard } from '../services/friends';
import { isAccountUser } from '../services/localDataScope';
import { subscribeReading } from '../services/readingGoal';

// A little after launch, then a while after the last change (the reader
// updates `books` on every page turn).
const FIRST_DELAY_MS = 8000;
const CHANGE_DELAY_MS = 30000;

/**
 * useFriendCard — keeps the signed-in reader's friend card (services/friends.js)
 * up to date: after launch, when the books or the streak change, and when the
 * app goes to the background. It only ever updates a card that already
 * exists, so readers who don't use friends send nothing.
 */
const useFriendCard = ({ user, ownerId, books, currentBook, ready }) => {
  const latest = useRef({ books, currentBook });
  latest.current = { books, currentBook };
  const scheduleRef = useRef(null);
  const active = Boolean(ready && isAccountUser(user) && ownerId === user.id);

  useEffect(() => {
    if (!active) return undefined;
    let timer = null;
    let stopped = false;

    const publish = () => {
      timer = null;
      if (stopped) return;
      publishOwnFriendCard({
        user,
        ownerId,
        books: latest.current.books,
        currentBookUri: latest.current.currentBook,
      }).catch((error) => logFriendsError('card not sent', error));
    };
    const schedule = (delay) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(publish, delay);
    };
    scheduleRef.current = schedule;
    schedule(FIRST_DELAY_MS);

    // The clock reports every tick; only a changed streak matters here.
    let seen = null;
    const unsubscribeReading = subscribeReading((snapshot) => {
      const mark = `${snapshot?.stats?.dayStreak}|${snapshot?.stats?.totalDays}`;
      if (seen !== null && seen !== mark) schedule(CHANGE_DELAY_MS);
      seen = mark;
    });
    // Leaving the app: send what's waiting now rather than next time.
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && timer) {
        clearTimeout(timer);
        publish();
      }
    });

    return () => {
      stopped = true;
      scheduleRef.current = null;
      if (timer) clearTimeout(timer);
      unsubscribeReading();
      appState.remove();
    };
    // `user` changes identity on token refresh; the account is what matters.
  }, [active, ownerId, user?.id, user?.user_metadata?.username]);

  useEffect(() => {
    scheduleRef.current?.(CHANGE_DELAY_MS);
  }, [books, currentBook]);
};

export default useFriendCard;
