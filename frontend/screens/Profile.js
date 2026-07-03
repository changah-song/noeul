import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Screen, Card, GradientButton, IconButton, Press, Switch } from '../components/ui';
import LegalSheet from '../components/profile/LegalSheet';
import AuthSheet from '../components/profile/AuthSheet';
import EditProfileSheet from '../components/profile/EditProfileSheet';
import { useBooks } from '../contexts/BooksContext';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { getProficiencyLevelOptions } from '../constants/proficiencyLevels';
import { getLanguageLabel, getInterfaceLanguageLabel, KRDICT_INTERFACE_LANGUAGE_OPTIONS } from '../constants/languages';
import { CONTACT_EMAIL } from '../constants/legalContent';
import { getAvatarPreset, getAvatarGradient } from '../constants/avatarPresets';
import { viewData } from '../services/Database';
import { getDayStreak } from '../services/dailyProgress';
import { deleteCurrentUserProfile } from '../services/accountDeletion';
import { makeScopedStorageKey } from '../services/localDataScope';
import { elevation, radii, useTheme, withAlpha } from '../theme/tokens';
import { fontFamilies } from '../theme/typography';
import { spacing, insets } from '../theme/spacing';
import { Gradients, Motion } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TARGET_LANGUAGE_CHOICES = [
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'en', label: 'English' },
];

const PERSONALIZED_MODELING_KEY = 'personalized-modeling-v1';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// vocab.created_at is either SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO.
const parseTimestamp = (value) => {
  if (!value) return NaN;
  const raw = String(value).trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const zoned = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(zoned);
};

const animateExpand = () => {
  LayoutAnimation.configureNext(
    LayoutAnimation.create(250, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
  );
};

// Section label — the prototype's .sect-label (10px/700, tracking 1.8).
const SectLabel = ({ children, color }) => (
  <Text style={[styles.sectLabel, { color }]}>{children}</Text>
);

// Expandable preference row — icon tile, title (+ current value), a chevron
// that rotates 180° over 250ms, and slide-under content.
const ExpandRow = ({ icon, title, value, open, onToggle, colors, children }) => {
  const rotate = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(rotate, {
      toValue: open ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [open, rotate]);

  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Card tone="glass" padded={false}>
      <Press onPress={onToggle} style={styles.expandHeader}>
        <View style={styles.expandHeaderLeft}>
          <View style={[styles.iconTile, { backgroundColor: colors.accentSoft }]}>
            {icon}
          </View>
          <View>
            <Text style={[styles.expandTitle, { color: colors.text }]}>{title}</Text>
            {value ? (
              <Text style={[styles.expandValue, { color: colors.textMuted }]}>{value}</Text>
            ) : null}
          </View>
        </View>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Feather name="chevron-down" size={18} color={colors.textSubtle} />
        </Animated.View>
      </Press>
      {open ? children : null}
    </Card>
  );
};

export default function Profile({ navigation }) {
  const { colors, isDarkMode } = useTheme();
  const { user, signOut } = useBooks();
  const { activeOwnerId } = useLocalOwner();
  const {
    targetLanguage,
    setTargetLanguage,
    interfaceLanguage,
    setInterfaceLanguage,
    targetLanguageLevel,
    setTargetLanguageLevel,
    setIsDarkMode,
  } = useAppContext();

  const isSignedIn = Boolean(user) && !user.is_anonymous;

  const levelOptions = useMemo(
    () => getProficiencyLevelOptions(targetLanguage),
    [targetLanguage]
  );

  const meta = user?.user_metadata ?? {};
  const displayName = isSignedIn
    ? (meta.username ?? meta.display_name ?? meta.full_name ?? user?.email?.split('@')[0] ?? 'Reader')
    : 'Guest';
  const email = user?.email ?? '';
  const joinYear = user?.created_at ? new Date(user.created_at).getFullYear() : new Date().getFullYear();
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const avatarPreset = getAvatarPreset(meta.avatar_preset);
  const gradientColors = isDarkMode ? Gradients.accentDusk : Gradients.accent;

  // ── Stats (real data) ────────────────────────────────────────────────────
  const [stats, setStats] = useState({ streak: 0, newThisWeek: 0, saved: 0 });

  useFocusEffect(useCallback(() => {
    let active = true;

    const loadStats = async () => {
      if (!activeOwnerId) return;
      try {
        const [rows, streak] = await Promise.all([
          viewData({ ownerId: activeOwnerId, language: targetLanguage }),
          getDayStreak(activeOwnerId),
        ]);
        if (!active) return;
        const words = rows ?? [];
        const weekAgo = Date.now() - WEEK_MS;
        setStats({
          streak,
          newThisWeek: words.filter((w) => {
            const ts = parseTimestamp(w.created_at);
            return Number.isFinite(ts) && ts >= weekAgo;
          }).length,
          saved: words.length,
        });
      } catch {
        if (active) setStats({ streak: 0, newThisWeek: 0, saved: 0 });
      }
    };

    loadStats();
    return () => { active = false; };
  }, [activeOwnerId, targetLanguage]));

  // ── Personalized vocabulary modeling (persisted preference) ─────────────
  const [personalized, setPersonalized] = useState(true);

  useEffect(() => {
    let active = true;
    if (!activeOwnerId) return undefined;
    AsyncStorage.getItem(makeScopedStorageKey(activeOwnerId, PERSONALIZED_MODELING_KEY))
      .then((raw) => { if (active && raw != null) setPersonalized(raw === 'true'); })
      .catch(() => {});
    return () => { active = false; };
  }, [activeOwnerId]);

  const togglePersonalized = useCallback((next) => {
    setPersonalized(next);
    if (activeOwnerId) {
      AsyncStorage.setItem(
        makeScopedStorageKey(activeOwnerId, PERSONALIZED_MODELING_KEY),
        String(next)
      ).catch(() => {});
    }
  }, [activeOwnerId]);

  // ── Expandables, sheets, copy state ──────────────────────────────────────
  const [openTargetLang, setOpenTargetLang] = useState(false);
  const [openAppLang, setOpenAppLang] = useState(false);
  const [openSupport, setOpenSupport] = useState(false);
  const [openContact, setOpenContact] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);
  const [legalVisible, setLegalVisible] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const openLegal = useCallback((doc) => {
    setLegalDoc(doc);
    setLegalVisible(true);
  }, []);

  const handleCopyEmail = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(CONTACT_EMAIL);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), Motion.copiedRevertDelay);
    } catch {}
  }, []);

  // ── Account actions ──────────────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      Alert.alert('Log out failed', error?.message ?? 'Please try again.');
    }
  }, [signOut]);

  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const handleDeleteAccount = useCallback(() => {
    setDeleteError(null);
    setConfirmDeleteVisible(true);
  }, []);

  const performDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCurrentUserProfile();
      await signOut();
      setConfirmDeleteVisible(false);
    } catch (error) {
      setDeleteError(error?.message ?? 'Could not delete account. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [signOut]);

  // ── Renderers ────────────────────────────────────────────────────────────
  const renderOptionRows = (options, isActive, onSelect) => (
    <View style={styles.optionList}>
      {options.map((option) => {
        const active = isActive(option);
        return (
          <Press
            key={option.code}
            onPress={() => onSelect(option)}
            style={[styles.optionRow, { borderTopColor: colors.divider }]}
          >
            <Text
              style={[
                styles.optionLabel,
                active
                  ? { color: colors.accent, fontFamily: fontFamilies.sansBold }
                  : { color: colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
            {active ? <Feather name="check" size={16} color={colors.accent} /> : null}
          </Press>
        );
      })}
    </View>
  );

  const supportRow = (label, onPress, { icon = 'chevron-right' } = {}) => (
    <Press
      onPress={onPress}
      style={[styles.supportRow, { borderTopColor: colors.divider }]}
    >
      <Text style={[styles.supportLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Feather name={icon} size={16} color={colors.textSubtle} />
    </Press>
  );

  return (
    <Screen gradient edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Press onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <Feather name="chevron-left" size={24} color={colors.textMuted} />
        </Press>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <Card tone="glass" padded={false} contentStyle={styles.userCard} style={styles.userCardWrap}>
          {isSignedIn ? (
            <LinearGradient
              colors={getAvatarGradient(avatarPreset, isDarkMode)}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={[styles.avatar, elevation.fab]}
            >
              <Text style={[styles.avatarLetter, { color: avatarPreset.letter }]}>
                {avatarLetter}
              </Text>
            </LinearGradient>
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surfaceStrong }]}>
              <Feather name="user" size={30} color={colors.textSubtle} />
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.userSub, { color: colors.textMuted }]}>
              {isSignedIn ? `${email} · Immersion since ${joinYear}` : 'Not signed in'}
            </Text>
          </View>
          {isSignedIn ? (
            <IconButton
              tone="muted"
              size={38}
              onPress={() => setEditVisible(true)}
              icon={<Feather name="edit-2" size={17} color={colors.textMuted} />}
            />
          ) : null}
        </Card>

        {/* Sign-in card (logged out) */}
        {!isSignedIn ? (
          <Card tone="glass" padded={false} contentStyle={styles.signInCard} style={styles.userCardWrap}>
            <Text style={[styles.signInTitle, { color: colors.text }]}>
              Sign in to sync your progress
            </Text>
            <Text style={[styles.signInSub, { color: colors.textMuted }]}>
              Keep your vocabulary, reading, and streaks across devices.
            </Text>
            <Press onPress={() => setAuthVisible(true)}>
              <LinearGradient
                colors={gradientColors}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={[styles.signInBtn, elevation.fab]}
              >
                <Text style={styles.signInBtnLabel}>Create account · Log in</Text>
              </LinearGradient>
            </Press>
            <Text style={[styles.finePrint, { color: colors.textTertiary }]}>
              {'By creating an account, you agree with our '}
              <Text style={[styles.finePrintLink, { color: colors.accent }]} onPress={() => openLegal('terms')}>
                Terms of Service
              </Text>
              {' & '}
              <Text style={[styles.finePrintLink, { color: colors.accent }]} onPress={() => openLegal('privacy')}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Card>
        ) : null}

        {/* Stats (logged in) */}
        {isSignedIn ? (
          <>
            <SectLabel color={colors.textTertiary}>Your stats</SectLabel>
            <Card tone="glass" padded={false} contentStyle={styles.statsCard}>
              {[
                { value: String(stats.streak), label: 'Day streak' },
                { value: String(stats.newThisWeek), label: 'New words\nthis week' },
                { value: String(stats.saved), label: 'Words\nsaved' },
              ].map((stat, i) => (
                <React.Fragment key={stat.label}>
                  {i > 0 ? <View style={[styles.statDivider, { backgroundColor: colors.divider }]} /> : null}
                  <View style={styles.statCol}>
                    <Text style={[styles.statNumber, { color: colors.text }]}>{stat.value}</Text>
                    <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{stat.label}</Text>
                  </View>
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : null}

        {/* Language level */}
        <SectLabel color={colors.textTertiary}>Language level</SectLabel>
        <Card tone="glass" padded={false} contentStyle={styles.levelCard}>
          <Text style={[styles.levelSubtitle, { color: colors.textMuted }]}>
            Set the difficulty of recommended texts. You decide your level.
          </Text>
          <View style={styles.levelRow}>
            {levelOptions.map((option) => {
              const active = option.rank === targetLanguageLevel?.rank;
              const wide = levelOptions.length > 4;
              return (
                <Press
                  key={option.value}
                  onPress={() => setTargetLanguageLevel(option.rank)}
                  containerStyle={wide ? styles.levelBtnWideWrap : styles.levelBtnWrap}
                  style={[
                    styles.levelBtn,
                    active
                      ? elevation.fab
                      : { borderWidth: 1, borderColor: colors.borderStrong },
                  ]}
                >
                  {active ? (
                    <LinearGradient
                      colors={gradientColors}
                      start={{ x: 0.2, y: 0 }}
                      end={{ x: 0.8, y: 1 }}
                      style={[StyleSheet.absoluteFill, { borderRadius: radii.sm }]}
                    />
                  ) : null}
                  <Text
                    style={[
                      styles.levelBtnLabel,
                      { color: active ? '#FFFFFF' : colors.textMuted },
                    ]}
                  >
                    {option.shortLabel ?? option.label}
                  </Text>
                </Press>
              );
            })}
          </View>
        </Card>

        {/* Preferences */}
        <SectLabel color={colors.textTertiary}>Preferences</SectLabel>
        <View style={styles.prefStack}>
          <ExpandRow
            icon={<Feather name="globe" size={19} color={colors.accent} />}
            title="Target language"
            value={getLanguageLabel(targetLanguage)}
            open={openTargetLang}
            onToggle={() => { animateExpand(); setOpenTargetLang((v) => !v); }}
            colors={colors}
          >
            {renderOptionRows(
              TARGET_LANGUAGE_CHOICES,
              (option) => option.code === targetLanguage,
              (option) => setTargetLanguage(option.code)
            )}
          </ExpandRow>

          <ExpandRow
            icon={<MaterialCommunityIcons name="translate" size={19} color={colors.accent} />}
            title="App language"
            value={getInterfaceLanguageLabel(interfaceLanguage)}
            open={openAppLang}
            onToggle={() => { animateExpand(); setOpenAppLang((v) => !v); }}
            colors={colors}
          >
            {renderOptionRows(
              KRDICT_INTERFACE_LANGUAGE_OPTIONS,
              (option) => option.code === interfaceLanguage,
              (option) => setInterfaceLanguage(option.code)
            )}
          </ExpandRow>
        </View>

        {/* Personalized vocabulary modeling */}
        <SectLabel color={colors.textTertiary}>Personalized vocabulary modeling</SectLabel>
        <Card tone="glass" padded={false} contentStyle={styles.persCard}>
          <View style={styles.persTopRow}>
            <View style={styles.persCopy}>
              <Text style={[styles.persTitle, { color: colors.text }]}>Learn from my reading</Text>
              <Text style={[styles.persSub, { color: colors.textMuted }]}>
                Allow the app to learn from your reading and interactions to better estimate which words you know and recommend texts at the right level.
              </Text>
            </View>
            <Switch value={personalized} onValueChange={togglePersonalized} />
          </View>
          <Text
            style={[
              styles.persNote,
              { color: colors.textTertiary, borderTopColor: colors.divider },
              !personalized && { opacity: 0.7 },
            ]}
          >
            When enabled, the app continuously refines your vocabulary profile based on the words you look up, skip, review, and understand. Turning this off means recommendations and difficulty estimates may be less accurate.
          </Text>
        </Card>

        {/* Appearance */}
        <SectLabel color={colors.textTertiary}>Appearance</SectLabel>
        <Card tone="glass" padded={false} contentStyle={styles.themeCard}>
          <Press
            onPress={() => setIsDarkMode(false)}
            containerStyle={styles.themeOptWrap}
            style={[styles.themeOpt, !isDarkMode && { backgroundColor: colors.surfaceStrong }]}
          >
            <Feather name="sun" size={20} color={!isDarkMode ? colors.accent : colors.textMuted} />
            <Text style={[styles.themeOptLabel, { color: !isDarkMode ? colors.accent : colors.textMuted }]}>
              Daylight
            </Text>
          </Press>
          <Press
            onPress={() => setIsDarkMode(true)}
            containerStyle={styles.themeOptWrap}
            style={[styles.themeOpt, isDarkMode && { backgroundColor: colors.surfaceStrong }]}
          >
            <MaterialCommunityIcons name="weather-night" size={20} color={isDarkMode ? colors.accent : colors.textMuted} />
            <Text style={[styles.themeOptLabel, { color: isDarkMode ? colors.accent : colors.textMuted }]}>
              Dusk
            </Text>
          </Press>
        </Card>

        {/* Support & legal (logged in) */}
        {isSignedIn ? (
          <>
            <SectLabel color={colors.textTertiary}>Support &amp; legal</SectLabel>
            <ExpandRow
              icon={<Feather name="life-buoy" size={19} color={colors.accent} />}
              title="Support & legal"
              open={openSupport}
              onToggle={() => { animateExpand(); setOpenSupport((v) => !v); }}
              colors={colors}
            >
              {supportRow('Terms of Service', () => openLegal('terms'))}
              {supportRow('Privacy Policy', () => openLegal('privacy'))}
              {supportRow(
                'Contact us',
                () => { animateExpand(); setOpenContact((v) => !v); },
                { icon: openContact ? 'chevron-down' : 'chevron-right' }
              )}
              {openContact ? (
                <View style={[styles.contactRow, { borderTopColor: colors.divider }]}>
                  <Text style={[styles.contactEmail, { color: colors.textSecondary }]} selectable>
                    {CONTACT_EMAIL}
                  </Text>
                  <Press onPress={handleCopyEmail} hitSlop={10}>
                    <Feather
                      name={copied ? 'check' : 'copy'}
                      size={16}
                      color={copied ? colors.accent : colors.textMuted}
                    />
                  </Press>
                </View>
              ) : null}
            </ExpandRow>
          </>
        ) : null}

        {/* Account actions (logged in) */}
        {isSignedIn ? (
          <View style={styles.accountActions}>
            <Press
              onPress={handleSignOut}
              style={[
                styles.accountBtn,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
              ]}
            >
              <Feather name="log-out" size={17} color={colors.text} />
              <Text style={[styles.accountBtnLabel, { color: colors.text }]}>Log out</Text>
            </Press>
            <Press
              onPress={handleDeleteAccount}
              style={[styles.accountBtn, { borderColor: withAlpha('#C0362C', 0.4) }]}
            >
              <Feather name="trash-2" size={17} color={colors.danger} />
              <Text style={[styles.accountBtnLabel, { color: colors.danger }]}>Delete account</Text>
            </Press>
          </View>
        ) : null}

        <View style={{ height: insets.screenBottom + spacing.md }} />
      </ScrollView>

      <Modal
        transparent
        visible={confirmDeleteVisible}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { if (!deleting) setConfirmDeleteVisible(false); }}
      >
        <View style={styles.confirmOverlay}>
          {Platform.OS === 'ios' ? (
            <BlurView
              intensity={30}
              tint={isDarkMode ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
            onPress={() => { if (!deleting) setConfirmDeleteVisible(false); }}
          />
          <Card tone="solid" glow radius="lg" contentStyle={styles.confirmContent}>
            <Text style={[styles.confirmText, { color: colors.text }]}>
              Delete your account? This permanently removes your account and synced data.
              {' '}This can't be undone.
            </Text>
            {deleteError ? (
              <Text style={[styles.confirmError, { color: colors.danger }]}>{deleteError}</Text>
            ) : null}
            <View style={styles.confirmActions}>
              <GradientButton
                label="Cancel"
                variant="secondary"
                size="sm"
                disabled={deleting}
                onPress={() => setConfirmDeleteVisible(false)}
              />
              <GradientButton
                label={deleting ? 'Deleting…' : 'Delete'}
                variant="danger"
                size="sm"
                disabled={deleting}
                onPress={performDeleteAccount}
              />
            </View>
          </Card>
        </View>
      </Modal>

      <LegalSheet
        visible={legalVisible}
        doc={legalDoc}
        onClose={() => setLegalVisible(false)}
      />
      <AuthSheet visible={authVisible} onClose={() => setAuthVisible(false)} />
      <EditProfileSheet visible={editVisible} onClose={() => setEditVisible(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: insets.screenHorizontal,
    paddingTop: insets.screenTop,
  },
  backBtn: {
    width: 38,
    height: 38,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 26,
    lineHeight: 32,
  },
  scrollContent: {
    paddingHorizontal: insets.screenHorizontal,
  },
  sectLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 12,
    marginHorizontal: 4,
  },

  // Profile card
  userCardWrap: {
    marginTop: 16,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 18,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 26,
    color: '#FFFFFF',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 20,
    lineHeight: 26,
  },
  userSub: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },

  // Sign-in card
  signInCard: {
    paddingVertical: 20,
    paddingHorizontal: 18,
  },
  signInTitle: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 18,
    lineHeight: 24,
  },
  signInSub: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  signInBtn: {
    height: 46,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  signInBtnLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  finePrint: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 12,
    textAlign: 'center',
  },
  finePrintLink: {
    fontFamily: fontFamilies.sansSemiBold,
    textDecorationLine: 'underline',
  },

  // Stats
  statsCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 16,
    paddingHorizontal: 6,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  statDivider: {
    width: 1,
    marginVertical: 2,
  },
  statNumber: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 28,
    lineHeight: 28,
  },
  statLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 8.5,
    lineHeight: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 7,
  },

  // Language level
  levelCard: {
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  levelSubtitle: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    lineHeight: 19,
  },
  levelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 13,
  },
  levelBtnWrap: {
    flexGrow: 1,
    flexBasis: 0,
  },
  levelBtnWideWrap: {
    flexGrow: 1,
    flexBasis: '22%',
  },
  levelBtn: {
    paddingVertical: 10,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  levelBtnLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
  },

  // Expandable preference rows
  prefStack: {
    gap: spacing.sm,
  },
  expandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  expandHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  expandValue: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 1,
  },
  optionList: {
    paddingLeft: 66,
    paddingRight: 16,
    paddingTop: 2,
    paddingBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderTopWidth: 1,
  },
  optionLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
  },

  // Personalization
  persCard: {
    paddingVertical: 16,
    paddingHorizontal: 17,
  },
  persTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  persCopy: {
    flex: 1,
    minWidth: 0,
  },
  persTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 14,
    lineHeight: 19,
  },
  persSub: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 5,
  },
  persNote: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },

  // Appearance
  themeCard: {
    flexDirection: 'row',
    padding: 6,
    gap: 6,
  },
  themeOptWrap: {
    flex: 1,
  },
  themeOpt: {
    paddingVertical: 13,
    borderRadius: 15,
    alignItems: 'center',
    gap: 7,
  },
  themeOptLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 12,
    lineHeight: 16,
  },

  // Support & legal
  supportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 66,
    paddingRight: 16,
    borderTopWidth: 1,
  },
  supportLabel: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingLeft: 66,
    paddingRight: 16,
    borderTopWidth: 1,
  },
  contactEmail: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13,
    lineHeight: 18,
  },

  // Account actions
  accountActions: {
    marginTop: 26,
    gap: 10,
  },
  accountBtn: {
    height: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  accountBtnLabel: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
  },

  // Delete-account confirm — centered opaque card over a blurred backdrop
  confirmOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: insets.screenHorizontal,
  },
  confirmContent: {
    padding: 19,
    gap: 14,
  },
  confirmText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmError: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 12,
    lineHeight: 17,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
