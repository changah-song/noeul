import { PermissionsAndroid, Platform } from 'react-native';

// The listen player on the notification shade and lock screen needs the
// notification permission on Android 13+. Ask (and wait for the answer)
// before the voice starts: the system dialog pauses the app, so asking while
// speaking cut the first words off. Resolves whether it is granted; playback
// goes ahead either way (only the notification player needs it).
export const ensureNotificationPermission = async () => {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(permission)) return true;
    return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};
