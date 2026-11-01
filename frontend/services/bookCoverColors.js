import { colors } from '../theme';

const FALLBACK_COVER_COLOR = colors.coverSlate;
let missingNativeModuleWarned = false;

const GENERATED_COVER_PALETTES = [
  { bg: colors.surfaceMuted, accent: colors.inkSlate, ink: colors.text, soft: colors.textTertiary },
  { bg: colors.surfaceAssist, accent: colors.coverSlate, ink: colors.textSecondary, soft: colors.borderStrong },
  { bg: colors.surfaceStrong, accent: colors.inkSlate, ink: colors.text, soft: colors.textTertiary },
  { bg: colors.border, accent: colors.coverSlate, ink: colors.textSecondary, soft: colors.textTertiary },
  { bg: colors.borderStrong, accent: colors.inkSlateDeep, ink: colors.text, soft: colors.surfaceMuted },
  { bg: colors.coverMid, accent: colors.inkSlate, ink: colors.surfaceMuted, soft: colors.surfaceMuted },
  { bg: colors.textTertiary, accent: colors.inkSlateDeep, ink: colors.surface, soft: colors.border },
  { bg: colors.textMuted, accent: colors.inkSlateDeep, ink: colors.surface, soft: colors.border },
  { bg: colors.coverSlate, accent: colors.inkSlateDeep, ink: colors.border, soft: colors.surfaceMuted },
  { bg: colors.inkSlate, accent: colors.inkSlateDeep, ink: colors.surfaceMuted, soft: colors.surfaceMuted },
  { bg: colors.inkSlateDeep, accent: colors.black, ink: colors.surface, soft: colors.borderStrong },
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
  String(book?.title || book?.originalTitle || book?.name || '').trim()
);

const getBookAuthor = (book) => (
  String(book?.author || book?.originalAuthor || '').trim()
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

// WCAG relative luminance of a hex colour (0 for anything unreadable).
export const colorLuminance = (value) => {
  const color = normalizeHexColor(value);
  if (!color) {
    return 0;
  }

  const channelLuminance = (hexChannel) => {
    const channel = Number.parseInt(hexChannel, 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return (
    (0.2126 * channelLuminance(color.slice(1, 3)))
    + (0.7152 * channelLuminance(color.slice(3, 5)))
    + (0.0722 * channelLuminance(color.slice(5, 7)))
  );
};

export const contrastRatio = (firstColor, secondColor) => {
  const firstLuminance = colorLuminance(firstColor);
  const secondLuminance = colorLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

// The cover's main colour: the image's dominant colour (on iOS, its
// background), or null when there is no image or it can't be read. Shares
// the colour library's cache with extractBookCoverColors.
export const extractBookCoverMainColor = async ({ coverUri, cacheKey } = {}) => {
  const cover = typeof coverUri === 'string' ? coverUri.trim() : '';
  if (!cover) {
    return null;
  }

  const getColors = loadGetColors();
  if (!getColors) {
    return null;
  }

  try {
    const result = await getColors(cover, {
      fallback: FALLBACK_COVER_COLOR,
      cache: true,
      key: makeSafeCacheKey(cacheKey, cover),
      pixelSpacing: 8,
      quality: 'low',
    });
    if (!result || typeof result !== 'object') {
      return null;
    }

    return result.platform === 'ios'
      ? firstHex([result.background, result.primary])
      : firstHex([result.dominant, result.average, result.muted]);
  } catch (error) {
    console.warn('[bookCoverColors] Failed to read the cover\'s main colour:', error?.message ?? error);
    return null;
  }
};

const OPENING_INK_DARK = '#11151c';
const OPENING_INK_LIGHT = '#ffffff';
// The tips are body text: WCAG AA.
const OPENING_MIN_CONTRAST = 4.5;
// In dark mode the colour is dimmed this much, so opening a book at night
// doesn't light up the room.
const OPENING_DARK_MODE_DIM = 0.55;
// Each step the background takes away from the ink when they're too close.
const OPENING_CONTRAST_STEP = 0.08;
const OPENING_CONTRAST_MAX_STEPS = 8;

/**
 * The book-opening screen's colours from the cover's main colour: that colour
 * as the background (dimmed in dark mode), and ink for the bar, the tips and
 * the status bar, dark or light, whichever reads better on it. When neither
 * reaches 4.5:1 (mid-tones), the background steps away from the ink until it
 * does. Null when there is no colour to work from.
 */
export const getBookOpeningColors = (mainColor, { isDarkMode = false } = {}) => {
  const main = normalizeHexColor(mainColor);
  if (!main) {
    return null;
  }

  let background = isDarkMode ? darkenHex(main, OPENING_DARK_MODE_DIM) : main;
  const ink = contrastRatio(background, OPENING_INK_DARK) >= contrastRatio(background, OPENING_INK_LIGHT)
    ? OPENING_INK_DARK
    : OPENING_INK_LIGHT;
  for (
    let step = 0;
    step < OPENING_CONTRAST_MAX_STEPS && contrastRatio(background, ink) < OPENING_MIN_CONTRAST;
    step += 1
  ) {
    background = ink === OPENING_INK_LIGHT
      ? darkenHex(background, OPENING_CONTRAST_STEP)
      : lightenHex(background, OPENING_CONTRAST_STEP);
  }

  return { background, ink, inkIsDark: ink === OPENING_INK_DARK };
};
