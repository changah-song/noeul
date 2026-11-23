// Word colours for the lyric views drawn in JS (the sing-along list while a
// song plays, and the plain list on iOS), following the book reader's native
// rules (EpubPageView.kt, levelTextColor):
//   • a word above the reader's level is drawn in one of three colours by its
//     weight (0 nearly known … 1 well above the reader): easy, mid, hard;
//   • once the reader has looked it up, the colour settles most of the way
//     back to the ink (TAPPED_LEVEL_SETTLE): dealt with, but still visible.
// Only the part of the word the level term covers is coloured, as natively
// (a Korean word's particle stays in the ink).

export const TAPPED_LEVEL_SETTLE = 0.6;

const lower = (value) => String(value || '').toLocaleLowerCase();

const parseHex = (color) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

// `from` moved `amount` (0–1) of the way to `to`; `from` if either isn't #rrggbb.
export const lerpColor = (from, to, amount) => {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const t = Math.max(0, Math.min(1, amount));
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * t)
    .toString(16).padStart(2, '0')).join('')}`;
};

export const levelBandColor = (weight, colors) => {
  const w = Math.max(0, Math.min(1, Number.isFinite(weight) ? weight : 1));
  if (w < 1 / 3) return colors.easy;
  if (w < 2 / 3) return colors.mid;
  return colors.hard;
};

// levelTerms: [{ text, weight }] → longest first, so "그리움" wins over "그".
export const buildLevelLookup = (levelTerms) => (levelTerms || [])
  .filter((term) => term && typeof term.text === 'string' && term.text.trim())
  .map((term) => ({ text: term.text.trim(), key: lower(term.text.trim()), weight: term.weight }))
  .sort((a, b) => b.key.length - a.key.length);

// A word split into pieces: [{ text, color? }]. `tapped` is a Set of lower-
// cased surfaces the reader has looked up in this song (the word or the term).
export const tintWord = (word, lookup, colors, tapped) => {
  const text = String(word || '');
  if (!text || !lookup?.length || !colors) return [{ text }];
  const haystack = lower(text);
  const hit = lookup.find((term) => haystack.includes(term.key));
  if (!hit) return [{ text }];
  const start = haystack.indexOf(hit.key);
  const end = start + hit.key.length;
  const looked = tapped?.has(hit.key) || tapped?.has(haystack.trim());
  const base = levelBandColor(hit.weight, colors);
  const color = looked ? lerpColor(base, colors.ink, TAPPED_LEVEL_SETTLE) : base;
  return [
    { text: text.slice(0, start) },
    { text: text.slice(start, end), color },
    { text: text.slice(end) },
  ].filter((piece) => piece.text);
};
