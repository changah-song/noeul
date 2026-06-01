import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '../services/supabase';
import { colors, radii, spacing, textStyles } from '../theme';

const FILE_TAG = '[Auth]';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const Auth = ({
  embedded = false,
  title = 'FluentFable',
  subtitle = 'Sign in to sync your books and saved words.',
}) => {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const trimmedEmail = email.trim();

  const handleEmailAuth = async () => {
    if (!trimmedEmail || !password) {
      Alert.alert('Missing info', 'Enter both email and password.');
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
        const { error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        if (error) {
          throw error;
        }
      }
    } catch (error) {
      console.log(`${FILE_TAG} email auth failed:`, error.message);
      Alert.alert('Authentication failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    try {
      if (!GOOGLE_IOS_CLIENT_ID && !GOOGLE_WEB_CLIENT_ID) {
        throw new Error('Missing Google client ID. Add EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to frontend/.env.');
      }

      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signOut();

      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult?.data?.idToken ?? signInResult?.idToken;

      if (!idToken) {
        throw new Error('No Google ID token returned');
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      if (error?.code === 'SIGN_IN_CANCELLED') {
        return;
      }

      console.log(`${FILE_TAG} google auth failed:`, error.message);
      Alert.alert('Google sign in failed', error.message);
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
        throw new Error('No Apple identity token returned');
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      if (error?.code === 'ERR_REQUEST_CANCELED') {
        return;
      }

      console.log(`${FILE_TAG} apple auth failed:`, error.message);
      Alert.alert('Apple sign in failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const content = (
      <View style={[styles.card, embedded && styles.embeddedCard]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Email</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#7b8794"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            autoCapitalize="none"
            placeholder="Password"
            placeholderTextColor="#7b8794"
            secureTextEntry
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          <View style={styles.modeRow}>
            <TouchableOpacity onPress={() => setMode('signin')}>
              <Text style={[styles.modeText, mode === 'signin' && styles.modeActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode('signup')}>
              <Text style={[styles.modeText, mode === 'signup' && styles.modeActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={handleEmailAuth} disabled={loading}>
            <Text style={styles.primaryButtonText}>
              {loading ? 'Working...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Google</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleGoogleAuth} disabled={loading}>
            <Text style={styles.secondaryButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>

        {Platform.OS === 'ios' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Apple</Text>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={styles.appleButton}
              onPress={handleAppleAuth}
            />
          </View>
        ) : null}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundWarm,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  embeddedContainer: {
    flex: 0,
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
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
    borderColor: 'rgba(200, 125, 0, 0.12)',
  },
  primaryButtonText: {
    ...textStyles.label,
    color: colors.accentStrong,
    fontSize: 15,
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
    fontSize: 15,
  },
  appleButton: {
    width: '100%',
    height: 48,
  },
});

export default Auth;
