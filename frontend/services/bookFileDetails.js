// What a book file says about itself (title, author, cover, word count),
// read once and kept.
//
// Reading these means unzipping the book and counting its words. Home asks
// for them each time it appears, for every featured book already on the
// device; the answer only changes when the file does, so it is saved beside
// the file's size and date and reused while those stay the same.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const KEY_PREFIX = 'bookFileDetails:v1:';

const inFlight = new Map();

// Size and date of the file, or null when it can't be told (never reused then).
const fileStamp = async (uri) => {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (!info?.exists || !Number.isFinite(Number(info.size))) return null;
    return `${info.size}:${info.modificationTime ?? ''}`;
};

// A saved cover is a file of its own, which can be gone (cleared storage, or
// a new app folder after an update on iOS).
const coverStillThere = async (cover) => {
    if (typeof cover !== 'string' || !cover.startsWith('file:')) return true;
    const info = await FileSystem.getInfoAsync(cover).catch(() => null);
    return Boolean(info?.exists);
};

// A read that found neither words nor a cover most likely failed part-way.
const worthKeeping = (details) => Boolean(
    details && typeof details === 'object' && (details.wordCount != null || details.cover)
);

const readSaved = async (storageKey, stamp) => {
    if (!stamp) return null;
    try {
        const saved = JSON.parse(await AsyncStorage.getItem(storageKey) || 'null');
        if (!saved || saved.stamp !== stamp || !worthKeeping(saved.details)) return null;
        if (!(await coverStillThere(saved.details.cover))) return null;
        return saved.details;
    } catch {
        return null;
    }
};

/**
 * bookFileDetails — the details of the book file at `uri`, from the last read
 * of the same file when there is one, otherwise from `read()` (whose result is
 * then saved). `key` names the book and must not change between launches (a
 * storage path, not a file address). `read` must give plain JSON-safe data.
 */
export const bookFileDetails = ({ key, uri, read }) => {
    if (!key || !uri) return read();
    const storageKey = `${KEY_PREFIX}${key}`;
    const running = inFlight.get(storageKey);
    if (running) return running;

    const work = (async () => {
        const stamp = await fileStamp(uri);
        const saved = await readSaved(storageKey, stamp);
        if (saved) return saved;

        const details = await read();
        if (stamp && worthKeeping(details)) {
            await AsyncStorage.setItem(storageKey, JSON.stringify({ stamp, details })).catch(() => {});
        }
        return details;
    })().finally(() => {
        inFlight.delete(storageKey);
    });
    inFlight.set(storageKey, work);
    return work;
};
