import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from '../hooks/useTranslation';
import { supabase } from '../services/supabase';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../constants/links';
import { colors, fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';
import { PaperButton } from '../components/ui';

const openLegalLink = (url, t) => {
  Linking.openURL(url).catch(() => {
    Alert.alert('', t('profile.linkUnavailable'));
  });
};

const FILE_TAG = '[Auth]';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const isAnonymousUser = (user) => Boolean(user?.is_anonymous);

const getCurrentSession = async () => {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return session;
};

const Auth = ({
  embedded = false,
  title = null,
  subtitle = null,
  initialMode = 'signin',
  showApple = true,
  showHeader = true,
  showModeToggle = true,
  showSectionLabels = true,
  onAuthenticated,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const trimmedEmail = email.trim();

  const handleEmailAuth = async () => {
    if (!trimmedEmail || !password) {
      Alert.alert(t('auth.missingInfoTitle'), t('auth.missingInfoBody'));
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) {
          throw error;
        }
      } else {
        const currentSession = await getCurrentSession();

        if (isAnonymousUser(currentSession?.user)) {
          const { error: emailError } = await supabase.auth.updateUser({
            email: trimmedEmail,
          });

          if (emailError) {
            throw emailError;
          }

          const { error: passwordError } = await supabase.auth.updateUser({
            password,
          });

          if (passwordError) {
            throw passwordError;
          }

          Alert.alert(t('auth.checkEmailTitle'), t('auth.checkEmailBody'));
        } else {
          const { error } = await supabase.auth.signUp({
            email: trimmedEmail,
            password,
          });

          if (error) {
            throw error;
          }
        }
      }
      onAuthenticated?.();
    } catch (error) {
      Alert.alert(t('auth.failedTitle'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    try {
      if (!GOOGLE_IOS_CLIENT_ID && !GOOGLE_WEB_CLIENT_ID) {
        throw new Error(t('auth.missingGoogleClientId'));
      }

      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();

      const signInResult = await GoogleSignin.signIn();
      // google-signin 13.x resolves (not rejects) when the user backs out of
      // the account picker: { type: 'cancelled' }. 'noSavedCredentialFound' is
      // the silent/one-tap equivalent of "nothing chosen". Neither is an error.
      if (signInResult?.type === 'cancelled' || signInResult?.type === 'noSavedCredentialFound') {
        return;
      }
      const idToken = signInResult?.data?.idToken ?? signInResult?.idToken;
      let accessToken = signInResult?.data?.accessToken ?? signInResult?.accessToken;

      if (!idToken) {
        throw new Error(t('auth.noGoogleIdToken'));
      }

      if (!accessToken) {
        try {
          const tokens = await GoogleSignin.getTokens();
          accessToken = tokens?.accessToken;
        } catch {
          accessToken = null;
        }
      }

      const currentSession = await getCurrentSession();
      const shouldLinkIdentity = mode === 'signup' && isAnonymousUser(currentSession?.user);

      const { error } = shouldLinkIdentity
        ? await supabase.auth.linkIdentity({
            provider: 'google',
            token: idToken,
            ...(accessToken ? { access_token: accessToken } : {}),
          })
        : await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
            ...(accessToken ? { access_token: accessToken } : {}),
          });

      if (error) {
        throw error;
      }
      onAuthenticated?.();
    } catch (error) {
      // Older native paths still reject with a cancel / in-progress code.
      if (
        error?.code === 'SIGN_IN_CANCELLED'
        || (statusCodes?.SIGN_IN_CANCELLED != null && error?.code === statusCodes.SIGN_IN_CANCELLED)
        || (statusCodes?.IN_PROGRESS != null && error?.code === statusCodes.IN_PROGRESS)
      ) {
        return;
      }

      Alert.alert(t('auth.googleFailedTitle'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleAuth = async () => {
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error(t('auth.noAppleIdentityToken'));
      }

      const currentSession = await getCurrentSession();
      const shouldLinkIdentity = mode === 'signup' && isAnonymousUser(currentSession?.user);

      const { error } = shouldLinkIdentity
        ? await supabase.auth.linkIdentity({
            provider: 'apple',
            token: credential.identityToken,
          })
        : await supabase.auth.signInWithIdToken({
            provider: 'apple',
            token: credential.identityToken,
          });

      if (error) {
        throw error;
      }
      onAuthenticated?.();
    } catch (error) {
      if (error?.code === 'ERR_REQUEST_CANCELED') {
        return;
      }

      Alert.alert(t('auth.appleFailedTitle'), error.message);
    } finally {
      setLoading(false);
    }
  };

  const content = (
      <View style={[styles.card, embedded && styles.embeddedCard]}>
        {showHeader ? (
          <>
            <Text style={styles.title}>{title ?? t('auth.defaultTitle')}</Text>
            <Text style={styles.subtitle}>{subtitle ?? t('auth.defaultSubtitle')}</Text>
          </>
        ) : null}

        <View style={[styles.section, !showSectionLabels && styles.sectionFlush]}>
          {showSectionLabels ? <Text style={styles.sectionTitle}>{t('auth.email')}</Text> : null}
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder={t('auth.emailPlaceholder')}
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            autoCapitalize="none"
            placeholder={t('auth.passwordPlaceholder')}
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          {showModeToggle ? (
            <View style={styles.modeRow}>
              <TouchableOpacity onPress={() => setMode('signin')} style={styles.modeButton}>
                <Text style={[styles.modeText, mode === 'signin' && styles.modeActive]}>{t('auth.signIn')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setMode('signup')} style={styles.modeButton}>
                <Text style={[styles.modeText, mode === 'signup' && styles.modeActive]}>{t('auth.signUp')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <PaperButton
            label={loading ? t('common.working') : mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
            onPress={handleEmailAuth}
            disabled={loading}
            style={styles.fullButton}
          />
        </View>

        <View style={styles.section}>
          {showSectionLabels ? <Text style={styles.sectionTitle}>{t('auth.google')}</Text> : null}
          <PaperButton
            variant="secondary"
            label={mode === 'signup' ? t('auth.signUpGoogle') : t('auth.signInGoogle')}
            onPress={handleGoogleAuth}
            disabled={loading}
            style={styles.fullButton}
          />
        </View>

        {showApple && Platform.OS === 'ios' ? (
          <View style={styles.section}>
            {showSectionLabels ? <Text style={styles.sectionTitle}>{t('auth.apple')}</Text> : null}
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={styles.appleButton}
              onPress={handleAppleAuth}
            />
          </View>
        ) : null}

        <Text style={styles.legalText}>
          {t('auth.legalPrefix')}{' '}
          <Text
            style={styles.legalLink}
            onPress={() => openLegalLink(PRIVACY_POLICY_URL, t)}
          >
            {t('profile.privacyPolicy')}
          </Text>
          {' '}{t('auth.legalAnd')}{' '}
          <Text
            style={styles.legalLink}
            onPress={() => openLegalLink(TERMS_OF_SERVICE_URL, t)}
          >
            {t('profile.termsOfService')}
          </Text>
          .
        </Text>
      </View>
  );

  if (embedded) {
    return content;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, embedded && styles.embeddedContainer]}
    >
      {content}
    </KeyboardAvoidingView>
  );
};

GoogleSignin.configure({
  iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
  webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
});

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundWarm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  embeddedContainer: {
    flex: 0,
    justifyContent: 'flex-start',
    backgroundColor: colors.transparent,
    paddingHorizontal: 0,
  },
  // Paper: no shadow; a hairline sheet on the full-screen form, and nothing
  // at all when embedded (the host dialog is the surface).
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  embeddedCard: {
    backgroundColor: colors.transparent,
    borderWidth: 0,
    borderRadius: 0,
    padding: 0,
  },
  title: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: colors.text,
  },
  subtitle: {
    ...textStyles.bodyMuted,
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  section: {
    marginTop: spacing.md,
  },
  sectionFlush: {
    marginTop: 0,
  },
  sectionTitle: {
    ...textStyles.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.xs,
  },
  modeButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  modeText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textMuted,
  },
  modeActive: {
    fontFamily: fontFamilies.sansSemiBold,
    color: colors.text,
    textDecorationLine: 'underline',
    textDecorationColor: colors.tint,
  },
  fullButton: {
    alignSelf: 'stretch',
    marginTop: spacing.xxs,
  },
  appleButton: {
    width: '100%',
    height: 50,
  },
  legalText: {
    marginTop: spacing.lg,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textMuted,
  },
  legalLink: {
    color: colors.tint,
    textDecorationLine: 'underline',
  },
});

const styles = createStyles(colors);

export default Auth;
