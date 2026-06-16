import NetInfo from '@react-native-community/netinfo';
import { Audio } from 'expo-av';
import Tts from 'react-native-tts';

let activeSound = null;

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');

const isOnline = async () => {
  const state = await NetInfo.fetch();
  if (state.isConnected === false) {
    return false;
  }
  if (state.isInternetReachable === false) {
    return false;
  }
  return true;
};

const unloadActiveSound = async () => {
  if (!activeSound) {
    return;
  }

  const sound = activeSound;
  activeSound = null;
  try {
    await sound.unloadAsync();
  } catch {
    // Best effort cleanup only.
  }
};

const streamAudioUrl = async (url) => {
  await unloadActiveSound();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
  });

  const { sound } = await Audio.Sound.createAsync(
    { uri: url },
    { shouldPlay: true }
  );
  activeSound = sound;
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status?.didJustFinish) {
      unloadActiveSound();
    }
  });
};

const speakWithDeviceVoice = async (word, language = 'en-US') => {
  const text = cleanValue(word);
  if (!text) {
    return;
  }

  await unloadActiveSound();
  Tts.stop();
  Promise.resolve(Tts.setDefaultLanguage(language)).catch(() => {});
  Tts.speak(text);
};

export const playEnglishPronunciation = async ({
  word,
  audioUs,
  audioUk,
  preferredAccent = 'us',
} = {}) => {
  const isUk = preferredAccent === 'uk';
  const audioUrl = isUk ? cleanValue(audioUk) : cleanValue(audioUs);
  const ttsLanguage = isUk ? 'en-GB' : 'en-US';

  if (audioUrl && await isOnline()) {
    try {
      await streamAudioUrl(audioUrl);
      return 'stream';
    } catch {
      // Fall through to local TTS if streaming fails.
    }
  }

  await speakWithDeviceVoice(word, ttsLanguage);
  return 'tts';
};
