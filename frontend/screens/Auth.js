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
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from '../hooks/useTranslation';
import { supabase } from '../services/supabase';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../constants/links';
import { colors, radii, spacing, textStyles, useTheme } from '../theme';

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
      if (error?.code === 'SIGN_IN_CANCELLED') {
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
              <TouchableOpacity onPress={() => setMode('signin')}>
                <Text style={[styles.modeText, mode === 'signin' && styles.modeActive]}>{t('auth.signIn')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setMode('signup')}>
                <Text style={[styles.modeText, mode === 'signup' && styles.modeActive]}>{t('auth.signUp')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity style={styles.primaryButton} onPress={handleEmailAuth} disabled={loading}>
            <Text style={styles.primaryButtonText}>
              {loading ? t('common.working') : mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          {showSectionLabels ? <Text style={styles.sectionTitle}>{t('auth.google')}</Text> : null}
          <TouchableOpacity style={styles.secondaryButton} onPress={handleGoogleAuth} disabled={loading}>
            <Text style={styles.secondaryButtonText}>
              {mode === 'signup' ? t('auth.signUpGoogle') : t('auth.signInGoogle')}
            </Text>
          </TouchableOpacity>
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
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  embeddedCard: {
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  title: {
    ...textStyles.title,
    fontSize: 28,
  },
  subtitle: {
    ...textStyles.bodyMuted,
    marginTop: spacing.xxs,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionFlush: {
    marginTop: 0,
  },
  sectionTitle: {
    ...textStyles.eyebrow,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    marginBottom: spacing.sm,
    ...textStyles.body,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  modeText: {
    ...textStyles.label,
    color: colors.textMuted,
  },
  modeActive: {
    color: colors.accentStrong,
  },
  primaryButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryButtonText: {
    ...textStyles.label,
    color: colors.accentStrong,
    fontSize: 14,
    lineHeight: 20,
  },
  secondaryButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...textStyles.label,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  appleButton: {
    width: '100%',
    height: 48,
  },
  legalText: {
    marginTop: spacing.xs,
    ...textStyles.bodyMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    color: colors.textTertiary,
  },
  legalLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
});

const styles = createStyles(colors);

export default Auth;
