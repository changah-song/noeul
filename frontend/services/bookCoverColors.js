const FALLBACK_COVER_COLOR = '#8a6741';
let missingNativeModuleWarned = false;

const GENERATED_COVER_PALETTES = [
  { bg: '#e7ddc8', accent: '#bf5b3e', ink: '#2f2820', soft: '#f3ecdc' },
  { bg: '#dde4d6', accent: '#5f7a4a', ink: '#27331f', soft: '#eef2e8' },
  { bg: '#d7dfe7', accent: '#3f6184', ink: '#1f2a35', soft: '#eaeff4' },
  { bg: '#ece1c8', accent: '#c0902f', ink: '#3a2f17', soft: '#f6efda' },
  { bg: '#e9d9d6', accent: '#9c4a52', ink: '#3a1f22', soft: '#f5e8e6' },
  { bg: '#dcd6e2', accent: '#6a5495', ink: '#2a2235', soft: '#efebf4' },
  { bg: '#d9e1dd', accent: '#2f7d6b', ink: '#16332c', soft: '#e9f1ee' },
  { bg: '#e7ded2', accent: '#8a6741', ink: '#322517', soft: '#f4ecdf' },
];

export const normalizeHexColor = (value) => {
  const color = String(value || '').trim();

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color.toLowerCase();
  }

  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return null;
};

const hexToRgb = (hex) => {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return null;
  }

  const value = Number.parseInt(normalized.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const rgbToHex = ({ r, g, b }) => {
  const toHex = (channel) => Math.round(Math.min(Math.max(channel, 0), 255))
    .toString(16)
    .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const lightenHex = (hex, amount) => {
  const color = hexToRgb(hex);
  if (!color) {
    return null;
  }

  return rgbToHex({
    r: color.r + ((255 - color.r) * amount),
    g: color.g + ((255 - color.g) * amount),
    b: color.b + ((255 - color.b) * amount),
  });
};

export const darkenHex = (hex, amount) => {
  const color = hexToRgb(hex);
  if (!color) {
    return null;
  }

  return rgbToHex({
    r: color.r * (1 - amount),
    g: color.g * (1 - amount),
    b: color.b * (1 - amount),
  });
};

const loadGetColors = () => {
  try {
    return require('react-native-image-colors').getColors;
  } catch (error) {
    if (!missingNativeModuleWarned) {
      missingNativeModuleWarned = true;
      console.warn('[bookCoverColors] react-native-image-colors unavailable; using fallback cover colors.', error?.message ?? error);
    }
    return null;
  }
};

const firstHex = (values) => {
  for (const value of values) {
    const normalized = normalizeHexColor(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const getBookTitle = (book) => (
  String(book?.title || book?.originalTitle || book?.name || 'Untitled').trim()
);

const getBookAuthor = (book) => (
  String(book?.author || book?.originalAuthor || 'Unknown author').trim()
);

const hashBookIdentity = (book) => {
  let hash = 0;
  const source = `${getBookTitle(book)}${getBookAuthor(book)}`;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
  }

  return hash;
};

export const getGeneratedBookCoverPalette = (book) => (
  GENERATED_COVER_PALETTES[hashBookIdentity(book) % GENERATED_COVER_PALETTES.length]
);

const makeSafeCacheKey = (value, fallback) => {
  const rawKey = String(value || fallback || 'cover').trim();
  if (rawKey.length <= 240) {
    return rawKey;
  }

  return `${rawKey.slice(0, 120)}:${rawKey.length}:${rawKey.slice(-80)}`;
};

const colorsFromImageResult = (result, fallbackColor) => {
  if (!result || typeof result !== 'object') {
    return deriveBookCoverColorsFromBaseColor(fallbackColor);
  }

  const accent = result.platform === 'ios'
    ? firstHex([result.primary, result.secondary, result.detail, result.background, fallbackColor])
    : firstHex([result.vibrant, result.dominant, result.muted, result.darkVibrant, fallbackColor]);

  const background = result.platform === 'ios'
    ? firstHex([result.background, result.secondary, result.detail, result.primary])
    : firstHex([result.darkMuted, result.muted, result.darkVibrant, result.dominant]);

  return {
    coverAccentColor: accent || normalizeHexColor(fallbackColor) || FALLBACK_COVER_COLOR,
    coverBackgroundColor: background
      || lightenHex(accent || fallbackColor || FALLBACK_COVER_COLOR, 0.58)
      || lightenHex(FALLBACK_COVER_COLOR, 0.58),
  };
};

export const deriveBookCoverColorsFromBaseColor = (baseColor) => {
  const accent = normalizeHexColor(baseColor) || FALLBACK_COVER_COLOR;

  return {
    coverAccentColor: accent,
    coverBackgroundColor: lightenHex(accent, 0.58) || accent,
  };
};

export const getGeneratedBookCoverColors = (book) => {
  const palette = getGeneratedBookCoverPalette(book);

  return {
    coverAccentColor: palette.accent,
    coverBackgroundColor: palette.bg,
  };
};

export const getStoredBookCoverColors = (book) => {
  const coverAccentColor = firstHex([
    book?.coverAccentColor,
    book?.accentColor,
    book?.coverColor,
    book?.cover?.accent,
  ]);
  const coverBackgroundColor = firstHex([
    book?.coverBackgroundColor,
    book?.softColor,
    book?.backgroundColor,
    book?.coverBg,
    book?.cover?.bg,
  ]);

  if (!coverAccentColor && !coverBackgroundColor) {
    return {};
  }

  return {
    ...(coverAccentColor ? { coverAccentColor } : {}),
    ...(coverBackgroundColor ? { coverBackgroundColor } : {}),
  };
};

export const getPublicDomainBookCoverColors = (book) => (
  getGeneratedBookCoverColors(book)
);

export const extractBookCoverColors = async ({
  coverUri,
  fallbackColor,
  cacheKey,
} = {}) => {
  const normalizedFallback = normalizeHexColor(fallbackColor) || FALLBACK_COVER_COLOR;
  const cover = typeof coverUri === 'string' ? coverUri.trim() : '';

  if (!cover) {
    return deriveBookCoverColorsFromBaseColor(normalizedFallback);
  }

  const getColors = loadGetColors();
  if (!getColors) {
    return deriveBookCoverColorsFromBaseColor(normalizedFallback);
  }

  try {
    const result = await getColors(cover, {
      fallback: normalizedFallback,
      cache: true,
      key: makeSafeCacheKey(cacheKey, cover),
      pixelSpacing: 8,
      quality: 'low',
    });

    return colorsFromImageResult(result, normalizedFallback);
  } catch (error) {
    console.warn('[bookCoverColors] Failed to extract cover colors:', error?.message ?? error);
    return deriveBookCoverColorsFromBaseColor(normalizedFallback);
  }
};
