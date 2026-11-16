import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { BASE_URL } from '../config';
import { getAccessToken } from './api/client';
import { listenDelay, withListenTimeout } from './listenDelay';

// Listen mode's online voices: the backend turns one sentence into audio
// (GET /speak/, backend/woof_tts.py) and this plays the file. The voice ids
// and the choice between this and the phone's engine live in listenPlayer.js.
//
// Each sentence is kept as a small MP3 in the cache folder, so a sentence
// heard once plays again without the network, and the next sentence can be
// fetched while the current one plays.

const CACHE_FOLDER = `${FileSystem.cacheDirectory || ''}listen-voice/`;
// A sentence's audio arrives in a second or two; past this the phone's own
// voice reads it instead.
const FETCH_TIMEOUT_MS = 12000;
// The server makes one sentence at a time, so a sentence fetched ahead waits
// this long for the one being read to be asked for, and then for its audio.
const PREFETCH_HOLD_MS = 200;
// Playback that never reports an end (a file the player cannot open) must
// not hold the reader on one sentence for ever.
const PLAY_TIMEOUT_MIN_MS = 20000;
const PLAY_TIMEOUT_PER_CHAR_MS = 400;

// Two 32-bit FNV-1a passes: enough to name a sentence's cache file.
const hashText = (text) => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${text.length.toString(16)}`;
};

export const speechFileName = (text, voiceName) => `${voiceName}-${hashText(text)}.mp3`;

export const speechUrl = (text, voiceName, baseUrl = BASE_URL) => (
  `${baseUrl}/speak/?voice=${encodeURIComponent(voiceName)}&text=${encodeURIComponent(text)}`
);

let folderReady = null;
const ensureFolder = () => {
  if (!folderReady) {
    folderReady = FileSystem.makeDirectoryAsync(CACHE_FOLDER, { intermediates: true }).catch(() => {});
  }
  return folderReady;
};

const download = async (url, fileUri, { refresh = false } = {}) => {
  const token = await getAccessToken({ refresh });
  return FileSystem.downloadAsync(url, fileUri, { headers: { Authorization: `Bearer ${token}` } });
};

const inFlight = new Map();

// The local file holding `text` read by `voiceName`; fetched once, then reused.
export const fetchSpeech = (rawText, voiceName) => {
  // The server reads runs of spaces as one; so one file for both.
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  const fileUri = `${CACHE_FOLDER}${speechFileName(text, voiceName)}`;
  const pending = inFlight.get(fileUri);
  if (pending) return pending;
  const request = (async () => {
    await ensureFolder();
    const existing = await FileSystem.getInfoAsync(fileUri).catch(() => null);
    if (existing?.exists && existing.size > 0) return fileUri;
    const url = speechUrl(text, voiceName);
    let result = await download(url, fileUri);
    if (result?.status === 401) result = await download(url, fileUri, { refresh: true });
    if (result?.status !== 200) {
      // An error response was written to the file; it is not audio.
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      throw new Error(`speech request failed (${result?.status})`);
    }
    return fileUri;
  })().finally(() => {
    inFlight.delete(fileUri);
  });
  inFlight.set(fileUri, request);
  return request;
};

export const createCloudSpeaker = () => {
  let current = null; // { sound, resolve }
  let audioModeSet = false;

  const finish = (entry, outcome) => {
    if (!entry || entry.done) return;
    entry.done = true;
    if (current === entry) current = null;
    entry.sound?.unloadAsync?.().catch(() => {});
    entry.resolve(outcome);
  };

  return {
    // Fetch ahead of time, behind the sentence being read; failures are left
    // for speak() to meet again.
    prefetch(text, voiceName) {
      listenDelay(PREFETCH_HOLD_MS)
        .then(() => Promise.allSettled([...inFlight.values()]))
        .then(() => fetchSpeech(text, voiceName))
        .catch(() => {});
    },

    // Play `text` in `voiceName`. Resolves 'finish', 'cancel' (stop() was
    // called) or 'error' (no network, server down, unplayable file).
    async speak({ text, voiceName, rate }) {
      const entry = { sound: null, done: false, resolve: () => {} };
      const outcome = new Promise((resolve) => {
        entry.resolve = resolve;
      });
      current = entry;
      try {
        const fileUri = await withListenTimeout(fetchSpeech(text, voiceName), FETCH_TIMEOUT_MS, null);
        if (entry.done) return outcome;
        if (!fileUri) {
          finish(entry, 'error');
          return outcome;
        }
        if (!audioModeSet) {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            // Listen mode keeps reading with the screen off.
            staysActiveInBackground: true,
            shouldDuckAndroid: true,
          });
          audioModeSet = true;
        }
        const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
        const { sound } = await Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true, rate: speed, shouldCorrectPitch: true },
          (status) => {
            if (status?.didJustFinish) finish(entry, 'finish');
            else if (status && status.isLoaded === false && status.error) finish(entry, 'error');
          }
        );
        if (entry.done) {
          // stop() arrived while the file was loading.
          sound.unloadAsync().catch(() => {});
          return outcome;
        }
        entry.sound = sound;
        const limit = Math.max(PLAY_TIMEOUT_MIN_MS, text.length * PLAY_TIMEOUT_PER_CHAR_MS);
        withListenTimeout(outcome, limit, 'timeout').then((result) => {
          if (result === 'timeout') finish(entry, 'error');
        });
      } catch {
        finish(entry, 'error');
      }
      return outcome;
    },

    stop() {
      finish(current, 'cancel');
    },
  };
};
