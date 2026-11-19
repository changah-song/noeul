import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ProfileAvatar from '../shared/ProfileAvatar';
import { useTranslation } from '../../hooks/useTranslation';
import { formatNumber } from '../../services/interfaceLanguage';
import {
  acceptInvite,
  friendErrorKind,
  getInviteCode,
  listFriends,
  liveStreak,
  logFriendsError,
  makeInviteUrl,
  markFriendsStarted,
  parseInviteInput,
  peekPendingInvite,
  previewInvite,
  publishOwnFriendCard,
  removeFriend,
  setPendingInvite,
  subscribePendingInvite,
} from '../../services/friends';
import { fontFamilies } from '../../theme';

const ERROR_KEYS = {
  notFound: 'friends.inviteNotFound',
  own: 'friends.inviteOwn',
  limit: 'friends.limitReached',
  account: 'friends.signInToAccept',
  unknown: 'common.genericError',
};

const streakLabel = (count, t) => (
  count === 1 ? t('friends.streakOne') : t('friends.streak', { count: formatNumber(count) })
);

const daysLabel = (count, t) => (
  count === 1 ? t('friends.daysOne') : t('friends.days', { count: formatNumber(count) })
);

// One friend: avatar, name, what they're reading, and their streak.
const FriendRow = ({ friend, name, onPress, showDivider, styles, own, t }) => {
  const { streak } = liveStreak(friend.card);
  const title = friend.card?.current_book_title;
  return (
    <>
      {showDivider ? <View style={styles.rowDivider} /> : null}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.row, own.friendRow]}
        accessibilityRole="button"
        accessibilityLabel={[name, title ? t('friends.reading', { title }) : null, streak ? streakLabel(streak, t) : null]
          .filter(Boolean)
          .join(', ')}
      >
        <ProfileAvatar user={{ id: friend.id, user_metadata: { name } }} size={34} />
        <View style={own.friendText}>
          <Text style={styles.rowLabel} numberOfLines={1}>{name}</Text>
          {title ? (
            <Text style={own.friendBook} numberOfLines={1}>{t('friends.reading', { title })}</Text>
          ) : null}
        </View>
        {streak ? <Text style={styles.rowValue} numberOfLines={1}>{streakLabel(streak, t)}</Text> : null}
      </TouchableOpacity>
    </>
  );
};

/**
 * FriendsSection — Profile's Friends card: the reader's friends (streak and
 * current book each, more on a tap), "Invite a friend" (shares the invite
 * link) and "Add with an invite code". It also takes an invite link opened in
 * the app (services/friends.js) and asks before adding that friend. A guest
 * gets one row asking them to sign in.
 *
 * `styles` and `profileColors` are Profile's own, so the rows match its others.
 */
const FriendsSection = ({ user, isGuest, ownerId, books, currentBook, navigation, onSignIn, styles, profileColors }) => {
  const { t } = useTranslation();
  const own = useMemo(() => createStyles(profileColors), [profileColors]);
  const [friends, setFriends] = useState([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openFriend, setOpenFriend] = useState(null);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [pendingCode, setPendingCode] = useState(peekPendingInvite);
  const userId = isGuest ? null : user?.id;

  const nameOf = useCallback(
    (friend) => friend?.card?.display_name || t('friends.defaultName'),
    [t],
  );

  const reload = useCallback(async () => {
    if (!userId) {
      setFriends([]);
      return;
    }
    try {
      setFriends(await listFriends(userId));
      setLoadFailed(false);
    } catch (error) {
      logFriendsError('friends not loaded', error);
      setLoadFailed(true);
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => navigation?.addListener?.('focus', reload), [navigation, reload]);

  // The first card goes out when the reader invites or accepts.
  const startSharing = useCallback(() => {
    markFriendsStarted(userId);
    return publishOwnFriendCard({ user, ownerId, books, currentBookUri: currentBook, start: true })
      .catch((error) => logFriendsError('card not sent', error));
  }, [books, currentBook, ownerId, user, userId]);

  const showError = useCallback((error) => {
    logFriendsError('failed', error);
    Alert.alert('', t(ERROR_KEYS[friendErrorKind(error)]));
  }, [t]);

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const code = await getInviteCode();
      await startSharing();
      await Share.share({ message: t('friends.inviteMessage', { link: makeInviteUrl(code), code }) });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const accept = useCallback(async (code) => {
    try {
      const preview = await previewInvite(code);
      if (!preview) {
        Alert.alert('', t('friends.inviteNotFound'));
        return;
      }
      const name = preview.name || t('friends.defaultName');
      if (preview.isSelf) {
        Alert.alert('', t('friends.inviteOwn'));
        return;
      }
      if (preview.alreadyFriends) {
        Alert.alert('', t('friends.alreadyFriends', { name }));
        return;
      }
      Alert.alert(t('friends.acceptTitle', { name }), t('friends.acceptBody'), [
        { text: t('friends.notNow'), style: 'cancel' },
        {
          text: t('friends.acceptConfirm'),
          onPress: async () => {
            try {
              await acceptInvite(code);
              await startSharing();
              await reload();
            } catch (error) {
              showError(error);
            }
          },
        },
      ]);
    } catch (error) {
      showError(error);
    }
  }, [reload, showError, startSharing, t]);

  // An invite link opened in the app. A guest is asked to sign in and the
  // invite waits; once there's an account it is taken and offered.
  useEffect(() => subscribePendingInvite(setPendingCode), []);
  const askedSignInFor = useRef(null);
  useEffect(() => {
    if (!pendingCode) return;
    if (!userId) {
      if (askedSignInFor.current === pendingCode) return;
      askedSignInFor.current = pendingCode;
      Alert.alert(t('friends.signInToAccept'), t('friends.signInToAcceptBody'), [
        { text: t('friends.notNow'), style: 'cancel', onPress: () => setPendingInvite(null) },
        { text: t('profile.signIn'), onPress: () => onSignIn?.() },
      ]);
      return;
    }
    setPendingInvite(null);
    accept(pendingCode);
    // Only a new invite or a new account should ask again.
  }, [pendingCode, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCode = () => {
    const code = parseInviteInput(codeDraft);
    if (!code) {
      Alert.alert('', t('friends.codeInvalid'));
      return;
    }
    setShowCodeEntry(false);
    setCodeDraft('');
    accept(code);
  };

  const confirmRemove = (friend) => {
    Alert.alert(t('friends.removeTitle', { name: nameOf(friend) }), t('friends.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFriend(friend.id);
            setOpenFriend(null);
            await reload();
          } catch (error) {
            showError(error);
          }
        },
      },
    ]);
  };

  const actionRow = ({ icon, label, onPress, showDivider, disabled }) => (
    <>
      {showDivider ? <View style={styles.rowDivider} /> : null}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        disabled={disabled}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Feather name={icon} size={18} color={profileColors.body} />
        <Text style={[styles.rowLabel, styles.rowLabelFlex]} numberOfLines={1}>{label}</Text>
        <Feather name="chevron-right" size={16} color={profileColors.faint} />
      </TouchableOpacity>
    </>
  );

  const open = openFriend ? friends.find((friend) => friend.id === openFriend) ?? null : null;
  const openCard = open?.card ?? null;
  const openStreak = liveStreak(openCard).streak;
  const openProgress = Number(openCard?.current_book_progress);
  const stats = open ? [
    [t('friends.statStreak'), daysLabel(openStreak, t)],
    [t('friends.statDays'), formatNumber(Number(openCard?.total_days) || 0)],
    [t('friends.statBooks'), formatNumber(Number(openCard?.books_finished) || 0)],
  ] : [];

  return (
    <>
      <Text style={styles.sectionLabel}>{t('friends.title')}</Text>
      <View style={styles.card}>
        {isGuest ? actionRow({ icon: 'user-plus', label: t('friends.signIn'), onPress: () => onSignIn?.() }) : (
          <>
            {friends.map((friend, index) => (
              <FriendRow
                key={friend.id}
                friend={friend}
                name={nameOf(friend)}
                onPress={() => setOpenFriend(friend.id)}
                showDivider={index > 0}
                styles={styles}
                own={own}
                t={t}
              />
            ))}
            {loadFailed && friends.length === 0 ? (
              <TouchableOpacity activeOpacity={0.7} onPress={reload} style={styles.row} accessibilityRole="button">
                <Feather name="alert-circle" size={18} color={profileColors.body} />
                <Text style={[styles.rowLabel, styles.rowLabelFlex]} numberOfLines={1}>{t('friends.loadFailed')}</Text>
                <Text style={styles.rowValue}>{t('common.tryAgain')}</Text>
              </TouchableOpacity>
            ) : null}
            {actionRow({
              icon: 'user-plus',
              label: t('friends.invite'),
              onPress: invite,
              disabled: busy,
              showDivider: friends.length > 0 || loadFailed,
            })}
            {actionRow({
              icon: 'link',
              label: t('friends.enterCode'),
              onPress: () => setShowCodeEntry(true),
              showDivider: true,
            })}
          </>
        )}
      </View>
      {!isGuest ? <Text style={own.note}>{t('friends.note')}</Text> : null}

      {/* One friend's numbers. */}
      <Modal visible={!!open} animationType="fade" transparent onRequestClose={() => setOpenFriend(null)}>
        <TouchableWithoutFeedback onPress={() => setOpenFriend(null)}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalCard}>
                <View style={own.detailHeader}>
                  <ProfileAvatar user={open ? { id: open.id, user_metadata: { name: nameOf(open) } } : null} size={44} />
                  <Text style={[styles.modalTitle, own.detailName]} numberOfLines={1}>{nameOf(open)}</Text>
                </View>
                <View>
                  {stats.map(([label, value], index) => (
                    <View key={label} style={[own.statRow, index > 0 && own.statRowDivider]}>
                      <Text style={own.statLabel}>{label}</Text>
                      <Text style={own.statValue}>{value}</Text>
                    </View>
                  ))}
                  {openCard?.current_book_title ? (
                    <View style={[own.statRow, own.statRowDivider, own.bookRow]}>
                      <Text style={own.statLabel}>{t('friends.statReading')}</Text>
                      <View style={own.bookText}>
                        <Text style={own.statValue} numberOfLines={2}>{openCard.current_book_title}</Text>
                        <Text style={own.bookMeta} numberOfLines={1}>
                          {[
                            openCard.current_book_author,
                            Number.isFinite(openProgress) && openCard.current_book_progress != null
                              ? t('common.percent', { value: formatNumber(Math.round(openProgress * 100)) })
                              : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                <View style={styles.modalActions}>
                  <Pressable onPress={() => open && confirmRemove(open)} style={styles.modalButton}>
                    <Text style={[styles.modalButtonText, { color: profileColors.danger }]}>{t('friends.remove')}</Text>
                  </Pressable>
                  <Pressable onPress={() => setOpenFriend(null)} style={[styles.modalButton, styles.modalPrimaryButton]}>
                    <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>{t('common.close')}</Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Adding a friend from a pasted link or code. */}
      <Modal visible={showCodeEntry} animationType="fade" transparent onRequestClose={() => setShowCodeEntry(false)}>
        <TouchableWithoutFeedback onPress={() => setShowCodeEntry(false)}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>{t('friends.codeTitle')}</Text>
                <Text style={styles.modalHelper}>{t('friends.codeHelper')}</Text>
                <TextInput
                  value={codeDraft}
                  onChangeText={setCodeDraft}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={t('friends.codePlaceholder')}
                  placeholderTextColor={profileColors.faint}
                  style={styles.usernameInput}
                  onSubmitEditing={submitCode}
                  returnKeyType="done"
                />
                <View style={styles.modalActions}>
                  <Pressable onPress={() => setShowCodeEntry(false)} style={styles.modalButton}>
                    <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                  </Pressable>
                  <Pressable onPress={submitCode} style={[styles.modalButton, styles.modalPrimaryButton]}>
                    <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>{t('common.add')}</Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const createStyles = (profileColors) => StyleSheet.create({
  friendRow: {
    minHeight: 60,
    gap: 12,
  },
  friendText: {
    flex: 1,
    minWidth: 0,
  },
  friendBook: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: profileColors.body,
  },
  note: {
    marginTop: 8,
    marginHorizontal: 20,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 17,
    color: profileColors.sub,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailName: {
    flex: 1,
    minWidth: 0,
  },
  statRow: {
    minHeight: 44,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  statRowDivider: {
    borderTopWidth: 1,
    borderTopColor: profileColors.border,
  },
  statLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: profileColors.body,
  },
  statValue: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: profileColors.ink,
    textAlign: 'right',
  },
  bookRow: {
    alignItems: 'flex-start',
  },
  bookText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  bookMeta: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: profileColors.body,
    textAlign: 'right',
  },
});

export default FriendsSection;
