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
//
// A long sentence is asked for in clause-sized pieces (speechPieces): the
// first piece plays as soon as it is made and the next is made meanwhile,
// instead of the reader waiting for the whole sentence. The model splits a
// long sentence at the same places itself, so it sounds the same.

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

// The model's own rule (underdog_woof/textsplit.py): a sentence over
// CLAUSE_MAX characters is cut at clause punctuation (, ; : and dashes),
// merging clauses back up to CLAUSE_MAX; a piece still too long is cut once
// before a conjunction near its middle. Never at a full stop: the reader
// sends one sentence at a time, and "Mr." is not a sentence end.
export const CLAUSE_MAX = 120;
const MIN_PIECE = 30;
const CLAUSE_END = /[,;:](?=\s)|—|--/g;
const CONJUNCTION = /\s(?=(?:and|but|or|nor|that|which|who|whom|whose|when|where|while|because|although|though|so|if|as|than|until)\b)/g;

const splitAtConjunction = (piece) => {
  if (piece.length <= CLAUSE_MAX) return [piece];
  const cuts = [];
  CONJUNCTION.lastIndex = 0;
  let match = CONJUNCTION.exec(piece);
  while (match) {
    if (match.index >= MIN_PIECE && piece.length - match.index >= MIN_PIECE) cuts.push(match.index);
    match = CONJUNCTION.exec(piece);
  }
  if (!cuts.length) return [piece];
  const middle = piece.length / 2;
  const cut = cuts.reduce((best, at) => (Math.abs(at - middle) < Math.abs(best - middle) ? at : best));
  return [
    ...splitAtConjunction(piece.slice(0, cut).trim()),
    ...splitAtConjunction(piece.slice(cut).trim()),
  ];
};

export const speechPieces = (rawText) => {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (text.length <= CLAUSE_MAX) return text ? [text] : [];
  const clauses = [];
  let start = 0;
  CLAUSE_END.lastIndex = 0;
  let match = CLAUSE_END.exec(text);
  while (match) {
    const end = match.index + match[0].length;
    clauses.push(text.slice(start, end).trim());
    start = end;
    match = CLAUSE_END.exec(text);
  }
  clauses.push(text.slice(start).trim());
  const merged = [];
  let current = '';
  clauses.filter(Boolean).forEach((clause) => {
    if (current && current.length + 1 + clause.length > CLAUSE_MAX) {
      merged.push(current);
      current = clause;
    } else if (!current) {
      current = clause;
    } else {
      current = /(—|--)$/.test(current) ? `${current}${clause}` : `${current} ${clause}`;
    }
  });
  if (current) merged.push(current);
  return merged.flatMap(splitAtConjunction);
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
  // The sentence being read: { done, stopPlayback }.
  let current = null;
  let audioModeSet = false;

  // Play one file to its end. Resolves 'finish', 'cancel' (stop()) or
  // 'error' (the player could not open it, or it never reported an end).
  const playFile = async (reading, fileUri, rate, chars) => {
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
    return new Promise((resolve) => {
      let sound = null;
      let settled = false;
      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        reading.stopPlayback = null;
        sound?.unloadAsync?.().catch(() => {});
        resolve(outcome);
      };
      reading.stopPlayback = () => settle('cancel');
      const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
      Audio.Sound.createAsync(
        { uri: fileUri },
        { shouldPlay: true, rate: speed, shouldCorrectPitch: true },
        (status) => {
          if (status?.didJustFinish) settle('finish');
          else if (status && status.isLoaded === false && status.error) settle('error');
        }
      ).then(({ sound: loaded }) => {
        sound = loaded;
        // stop() arrived while the file was loading.
        if (settled) loaded.unloadAsync().catch(() => {});
      }, () => settle('error'));
      const limit = Math.max(PLAY_TIMEOUT_MIN_MS, chars * PLAY_TIMEOUT_PER_CHAR_MS);
      withListenTimeout(new Promise(() => {}), limit, 'timeout').then(() => settle('error'));
    });
  };

  // Fetches and plays a sentence's pieces in turn, fetching the next piece
  // while one plays.
  const readPieces = async (reading, end, text, voiceName, rate) => {
    const pieces = speechPieces(text);
    if (!pieces.length) return end('finish');
    try {
      for (let i = 0; i < pieces.length; i += 1) {
        const fileUri = await withListenTimeout(fetchSpeech(pieces[i], voiceName), FETCH_TIMEOUT_MS, null);
        if (reading.done) return 'cancel';
        if (!fileUri) return end('error');
        // The next piece is made while this one plays.
        if (i + 1 < pieces.length) fetchSpeech(pieces[i + 1], voiceName).catch(() => {});
        const outcome = await playFile(reading, fileUri, rate, pieces[i].length);
        if (reading.done) return 'cancel';
        if (outcome !== 'finish') return end(outcome);
      }
      return end('finish');
    } catch {
      return reading.done ? 'cancel' : end('error');
    }
  };

  return {
    // Fetch ahead of time, behind the sentence being read, first piece first;
    // failures are left for speak() to meet again.
    prefetch(text, voiceName) {
      const pieces = speechPieces(text);
      listenDelay(PREFETCH_HOLD_MS)
        .then(() => Promise.allSettled([...inFlight.values()]))
        .then(() => pieces.reduce(
          (previous, piece) => previous.then(() => fetchSpeech(piece, voiceName)),
          Promise.resolve()
        ))
        .catch(() => {});
    },

    // Play `text` in `voiceName`, piece by piece. Resolves 'finish', 'cancel'
    // (stop() was called) or 'error' (no network, server down, unplayable file).
    async speak({ text, voiceName, rate }) {
      const reading = { done: false, stopPlayback: null, cancelled: null };
      // stop() answers 'cancel' at once, even while a piece is being fetched.
      const cancelled = new Promise((resolve) => {
        reading.cancelled = () => resolve('cancel');
      });
      current = reading;
      const end = (outcome) => {
        reading.done = true;
        if (current === reading) current = null;
        return outcome;
      };
      return Promise.race([cancelled, readPieces(reading, end, text, voiceName, rate)]);
    },

    stop() {
      const reading = current;
      if (!reading) return;
      reading.done = true;
      current = null;
      reading.stopPlayback?.();
      reading.cancelled?.();
    },
  };
};
