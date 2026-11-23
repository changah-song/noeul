// Timed lyrics (LRC, as LRCLIB serves them): "[01:02.35] a line of the song".
// The song reader lights the line the video has reached, so each line of the
// song's own lyrics (which the reader may have edited) gets the time of the
// timed line it matches.

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

// "[00:12.30][01:40.00] text" -> [{ time: 12.3, text }, { time: 100, text }],
// sorted by time. Metadata tags ([ar:...], [offset:...]) are skipped.
export const parseLrc = (lrc) => {
  const lines = [];
  String(lrc || '').split(/\r?\n/).forEach((raw) => {
    const times = [];
    let lastIndex = 0;
    let match;
    TIME_TAG.lastIndex = 0;
    while ((match = TIME_TAG.exec(raw)) !== null) {
      if (match.index !== lastIndex) break;
      const [, minutes, seconds, fraction = '0'] = match;
      const fractionSeconds = Number(fraction) / (10 ** fraction.length);
      times.push(Number(minutes) * 60 + Number(seconds) + fractionSeconds);
      lastIndex = TIME_TAG.lastIndex;
    }
    if (times.length === 0) return;
    const text = raw.slice(lastIndex).trim();
    times.forEach((time) => lines.push({ time, text }));
  });
  return lines.sort((a, b) => a.time - b.time);
};

const normalizeLine = (text) => String(text || '')
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');

// For each lyric line (the reader's own text), the time it starts, or null.
// Lines are matched in order: the next timed line with the same text, looking
// a few lines ahead so an added or removed line doesn't throw off the rest.
export const lyricLineTimes = (lyricLines, timedLines, { lookAhead = 6 } = {}) => {
  const timed = (timedLines || []).filter((line) => normalizeLine(line.text));
  let cursor = 0;
  return (lyricLines || []).map((line) => {
    const key = normalizeLine(typeof line === 'string' ? line : line?.text);
    if (!key) return null;
    const end = Math.min(timed.length, cursor + lookAhead);
    for (let index = cursor; index < end; index += 1) {
      if (normalizeLine(timed[index].text) === key) {
        cursor = index + 1;
        return timed[index].time;
      }
    }
    return null;
  });
};

// The index of the line being sung at `time` (seconds), or -1 before the first.
export const activeLineIndex = (times, time) => {
  let active = -1;
  let activeTime = -Infinity;
  (times || []).forEach((lineTime, index) => {
    if (lineTime == null) return;
    if (lineTime <= time && lineTime >= activeTime) {
      active = index;
      activeTime = lineTime;
    }
  });
  return active;
};

// When the line at `index` ends: the next timed line's start, or null.
export const lineEndTime = (times, index) => {
  const start = times?.[index];
  if (start == null) return null;
  let next = null;
  (times || []).forEach((lineTime) => {
    if (lineTime != null && lineTime > start && (next == null || lineTime < next)) {
      next = lineTime;
    }
  });
  return next;
};
