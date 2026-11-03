import { refitReaderLevel } from './Database';

// When the batch refit (Database.refitReaderLevel) runs: after a reading
// session, and when the app opens. Not mid-read: it re-shades the open book.
// At most once per MIN_GAP_MS per reader and language, after a session at
// most once per SESSION_GAP_MS.

const MIN_GAP_MS = 30 * 60 * 1000;
const SESSION_GAP_MS = 2 * 60 * 1000;
const lastRun = new Map();

/**
 * scheduleLevelRefit — refit the reader's level unless it was refit
 * recently. `afterSession` uses the shorter gap: new reading just ended.
 * Never throws.
 */
export const scheduleLevelRefit = ({ ownerId, language, afterSession = false, now = Date.now() } = {}) => {
    if (!language) return Promise.resolve(null);
    const key = `${ownerId || ''}|${language}`;
    const gap = afterSession ? SESSION_GAP_MS : MIN_GAP_MS;
    if (now - (lastRun.get(key) ?? -Infinity) < gap) return Promise.resolve(null);
    lastRun.set(key, now);
    return refitReaderLevel({ ownerId, language }).catch((error) => {
        console.warn('[levelRefit] Refit failed:', error?.message ?? error);
        return null;
    });
};

export const resetLevelRefitSchedule = () => lastRun.clear();
