import { useContext, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from '../hooks/useTranslation';
import { supabase } from '../services/supabase';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../constants/links';
import { fontFamilies, useTheme } from '../theme';

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

/**
 * Auth — the full-screen sign-in / create-account page: close (X), title,
 * subtitle, "Continue with Google", an "or with email" divider, labelled email
 * and password fields, the submit button, a text button that switches between
 * signing in and creating an account, and the legal line at the bottom.
 *
 * Present it with <AuthModal> (a full-screen Modal). `title` / `subtitle`
 * override the mode's default copy; `showHeader={false}` hides them;
 * `showModeToggle={false}` hides the switch-mode button; `showApple` adds
 * Apple sign-in on iOS. `embedded` only stops the page from stretching to the
 * full height; `showSectionLabels` is accepted for compatibility.
 */
const Auth = ({
  embedded = false,
  title = null,
  subtitle = null,
  initialMode = 'signin',
  showApple = true,
  showHeader = true,
  showModeToggle = true,
  // eslint-disable-next-line no-unused-vars
  showSectionLabels = true,
  onAuthenticated,
  onClose,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const safeInsets = useContext(SafeAreaInsetsContext);
  const insetTop = safeInsets?.top ?? 0;
  const insetBottom = safeInsets?.bottom ?? 0;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

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


  const isSignup = mode === 'signup';
  const heading = title || (isSignup ? t('auth.createTitle') : t('auth.signInTitle'));
  const subheading = subtitle || t('auth.signInSubtitle');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, embedded && styles.containerEmbedded]}
    >
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={[
          styles.content,
          { paddingTop: 12 + insetTop, paddingBottom: 24 + insetBottom },
          embedded && styles.contentEmbedded,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {onClose ? (
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel={t('profile.closeSignIn')}
            >
              <Feather name="x" size={22} color={colors.inkSlate} />
            </TouchableOpacity>
          </View>
        ) : null}

        {showHeader ? (
          <>
            <Text style={styles.title} accessibilityRole="header">{heading}</Text>
            <Text style={styles.subtitle}>{subheading}</Text>
          </>
        ) : null}

        <TouchableOpacity
          style={[styles.googleButton, loading && styles.buttonDisabled]}
          onPress={handleGoogleAuth}
          disabled={loading}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="google" size={18} color={colors.text} />
          <Text style={styles.googleButtonText}>{t('auth.continueGoogle')}</Text>
        </TouchableOpacity>

        {showApple && Platform.OS === 'ios' ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={14}
            style={styles.appleButton}
            onPress={handleAppleAuth}
          />
        ) : null}

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('auth.orWithEmail')}</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.fields}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel} nativeID="auth-email-label">{t('auth.email')}</Text>
            <TextInput
              accessibilityLabel={t('auth.email')}
              accessibilityLabelledBy="auth-email-label"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.textSubtle}
              style={[styles.input, focusedField === 'email' && styles.inputFocused]}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              returnKeyType="next"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel} nativeID="auth-password-label">{t('auth.password')}</Text>
            <TextInput
              accessibilityLabel={t('auth.password')}
              accessibilityLabelledBy="auth-password-label"
              autoCapitalize="none"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              secureTextEntry
              style={[styles.input, focusedField === 'password' && styles.inputFocused]}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              onSubmitEditing={handleEmailAuth}
              returnKeyType="go"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.buttonDisabled]}
          onPress={handleEmailAuth}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {loading ? t('common.working') : isSignup ? t('auth.createAccount') : t('auth.signIn')}
          </Text>
        </TouchableOpacity>

        {showModeToggle ? (
          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => setMode(isSignup ? 'signin' : 'signup')}
            accessibilityRole="button"
          >
            <Text style={styles.switchButtonText}>
              {isSignup ? t('auth.haveAccount') : t('auth.newHere')}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.spacer} />

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

/**
 * AuthModal — <Auth> as a full-screen modal that slides up. Used by Profile's
 * "Sign in" / "Create account" and onboarding's "I already have an account".
 */
export const AuthModal = ({ visible, mode = 'signin', onClose, onAuthenticated, showApple = false }) => (
  <Modal
    visible={visible}
    animationType="slide"
    onRequestClose={onClose}
    statusBarTranslucent
  >
    <Auth
      key={mode}
      initialMode={mode}
      showApple={showApple}
      onClose={onClose}
      onAuthenticated={onAuthenticated}
    />
  </Modal>
);

GoogleSignin.configure({
  iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
  webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
});

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  containerEmbedded: {
    flex: 0,
  },
  scroller: {
    flexGrow: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  contentEmbedded: {
    flexGrow: 0,
  },
  topBar: {
    flexDirection: 'row',
    marginLeft: -12,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 18,
    marginBottom: 8,
    fontFamily: fontFamilies.displayMedium,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.4,
    color: colors.text,
  },
  subtitle: {
    marginBottom: 26,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  googleButton: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleButtonText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    color: colors.text,
  },
  appleButton: {
    marginTop: 10,
    width: '100%',
    height: 52,
  },
  dividerRow: {
    marginVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    color: colors.textTertiary,
  },
  fields: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  input: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    color: colors.text,
  },
  inputFocused: {
    borderColor: colors.borderStrong,
  },
  primaryButton: {
    marginTop: 18,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.inkSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 16,
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  switchButton: {
    marginTop: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchButtonText: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  spacer: {
    flexGrow: 1,
    minHeight: 24,
  },
  legalText: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textTertiary,
  },
  legalLink: {
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});

export default Auth;
