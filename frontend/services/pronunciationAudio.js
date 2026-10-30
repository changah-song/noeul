import NetInfo from '@react-native-community/netinfo';
import { Audio } from 'expo-av';
import Tts from 'react-native-tts';

let activeSound = null;
// Incremented per playback request. A request that resolves after a newer one
// started (e.g. a quick second tap) must not become the active sound.
let playbackRequestId = 0;

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

// Unload one specific sound, clearing activeSound only if it is still that
// sound — a finished older sound must never stop the one now playing.
const unloadSound = async (sound) => {
  if (!sound) {
    return;
  }
  if (activeSound === sound) {
    activeSound = null;
  }
  try {
    await sound.unloadAsync();
  } catch {
    // Best effort cleanup only.
  }
};

const streamAudioUrl = async (url) => {
  const requestId = ++playbackRequestId;
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
  if (requestId !== playbackRequestId) {
    // A newer tap superseded this one while it was loading.
    await unloadSound(sound);
    return;
  }
  activeSound = sound;
  sound.setOnPlaybackStatusUpdate((status) => {
    if (status?.didJustFinish) {
      unloadSound(sound);
    }
  });
};

const speakWithDeviceVoice = async (word, language = 'en-US') => {
  const text = cleanValue(word);
  if (!text) {
    return;
  }

  const requestId = ++playbackRequestId;
  await unloadActiveSound();
  // No engine the app can reach (or none installed): say so rather than
  // staying silent.
  const ready = await Promise.race([
    Promise.resolve(Tts.getInitStatus()).then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(true), 2500)),
  ]);
  if (!ready) {
    return false;
  }
  Tts.stop();
  // Set the voice before speaking, otherwise the first word after an accent
  // change is read with the previous language.
  // Bounded so a TTS engine that never settles can't swallow the tap.
  try {
    await Promise.race([
      Promise.resolve(Tts.setDefaultLanguage(language)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Unsupported language: speak with the current default voice.
  }
  if (requestId !== playbackRequestId) {
    return;
  }
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

  const spoke = await speakWithDeviceVoice(word, ttsLanguage);
  return spoke === false ? 'unavailable' : 'tts';
};
