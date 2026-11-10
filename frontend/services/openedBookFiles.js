import { useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { Linking } from 'react-native';
import { contentDisplayName } from '../modules/native-epub-reader/src/NativeEpubReaderView';

// Books opened in Noeul from another app ("Open with", "Copy to Noeul", the
// share sheet). They arrive as a URL:
//   iOS: file://…/Documents/Inbox/<name>.epub (the system's copy for us)
//   Android: content://… (another app's file, readable while we hold the intent)
// Each one is copied into Documents/books right away, then queued until Home
// is on screen to import it, since a file can come in during onboarding or
// while another tab is showing.

const OPENED_FILE_PREFIX = 'opened-';
const PDF_HEADER = 'JVBERg=='; // "%PDF"
const ZIP_HEADER = 'UEsDBA=='; // "PK\x03\x04"

export const isOpenedFileUrl = (url) => typeof url === 'string' && /^(file|content):\/\//i.test(url);

const fileNameFromUrl = (url) => {
  const last = String(url).split(/[?#]/)[0].split('/').pop() || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

export const formatFromName = (name) => {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.epub')) return 'epub';
  return null;
};

// What the file is from its first bytes, for names without an extension.
export const formatFromHeader = (base64) => {
  if (base64 === PDF_HEADER) return 'pdf';
  if (base64 === ZIP_HEADER) return 'epub';
  return null;
};

const createId = () => (
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
);

const isOwnOpenedCopy = (uri) => (
  typeof uri === 'string'
  && !!FileSystem.documentDirectory
  && uri.startsWith(`${FileSystem.documentDirectory}books/${OPENED_FILE_PREFIX}`)
);

// Remove a copy made by stageOpenedBookFile that no book ended up using.
export const discardOpenedCopy = async (uri) => {
  if (!isOwnOpenedCopy(uri)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    console.warn('[openedBookFiles] Could not remove an unused copy:', error?.message ?? error);
  }
};

// Copy an opened file into Documents/books. Resolves to
// { uri, name, format, size } or { unsupported: true, name }.
export const stageOpenedBookFile = async (url) => {
  const isContent = /^content:\/\//i.test(url);
  const name = (isContent ? await contentDisplayName(url).catch(() => null) : null) || fileNameFromUrl(url);
  const dir = `${FileSystem.documentDirectory}books`;
  const id = createId();
  const staging = `${dir}/${OPENED_FILE_PREFIX}${id}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.copyAsync({ from: url, to: staging });

  // iOS leaves its copy in Documents/Inbox; ours replaces it.
  if (!isContent && url.includes('/Documents/Inbox/')) {
    FileSystem.deleteAsync(url, { idempotent: true }).catch(() => {});
  }

  let header = null;
  try {
    header = await FileSystem.readAsStringAsync(staging, { encoding: 'base64', position: 0, length: 4 });
  } catch {}
  // The bytes decide when they can; a .pdf named zip is still a zip.
  const format = formatFromHeader(header) ?? formatFromName(name);
  if (!format) {
    await FileSystem.deleteAsync(staging, { idempotent: true }).catch(() => {});
    return { unsupported: true, name };
  }

  const uri = `${staging}.${format}`;
  await FileSystem.moveAsync({ from: staging, to: uri });
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return {
    uri,
    name: formatFromName(name) ? name : `${name || 'book'}.${format}`,
    format,
    mimeType: format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
    size: info?.size ?? null,
  };
};

// The queue of opened files waiting for Home.
const pending = [];
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

const enqueue = (url) => {
  if (!isOpenedFileUrl(url) || pending.includes(url)) return false;
  pending.push(url);
  notify();
  return true;
};

let listening = false;

// Start collecting opened files (the launch URL and later ones). onOpened
// runs for each new one, e.g. to bring Home on screen.
export const listenForOpenedBookFiles = (onOpened) => {
  if (listening) return () => {};
  listening = true;
  Linking.getInitialURL()
    .then((url) => { if (enqueue(url)) onOpened?.(url); })
    .catch(() => {});
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (enqueue(url)) onOpened?.(url);
  });
  return () => {
    listening = false;
    subscription.remove();
  };
};

// Hand queued files, one at a time, to importFile while enabled (Home is
// focused). importFile resolves when that import is done.
export const useOpenedBookFiles = (importFile, enabled) => {
  const [version, setVersion] = useState(0);
  const busyRef = useRef(false);
  const importRef = useRef(importFile);
  importRef.current = importFile;

  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    if (!enabled || busyRef.current || pending.length === 0) return;
    const url = pending.shift();
    busyRef.current = true;
    Promise.resolve()
      .then(() => importRef.current(url))
      .catch((error) => console.warn('[openedBookFiles] Import failed:', error?.message ?? error))
      .finally(() => {
        busyRef.current = false;
        setVersion((value) => value + 1);
      });
  }, [enabled, version]);
};

// Tests only.
export const __resetOpenedBookFiles = () => {
  pending.length = 0;
  listeners.clear();
  listening = false;
};
