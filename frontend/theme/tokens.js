import React, { createContext, useContext, useMemo } from 'react';

const pair = (light, dark = light) => ({ light, dark });

// ─── Sunset & Paper palette ────────────────────────────────────────────────
// Light = warm peach-paper sky. Dark = glowing plum-dusk.
// Accent trio: coral (#E0654A), rose (#D85C76), amber (#EE9A4C).
// Surfaces are frosted glass over the gradient sky.
// ──────────────────────────────────────────────────────────────────────────

export const colorPairs = {
  // Page background (solid fallback under the gradient)
  backgroundWarm: pair('#FBE3D2', '#201016'),
  backgroundCool: pair('#FBE3D2', '#201016'),
  bgPage: pair('#FBE3D2', '#201016'),

  // Surfaces
  surface:          pair('#ffffff',               '#2A1A1F'),
  surfaceCard:      pair('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.08)'),
  surfaceMuted:     pair('rgba(255,255,255,0.40)', 'rgba(255,255,255,0.06)'),
  surfaceAssist:    pair('rgba(255,255,255,0.40)', 'rgba(255,255,255,0.06)'),
  surfaceSelected:  pair('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.08)'),
  surfaceElevated:  pair('#ffffff',               '#2A1A1F'),
  surfaceStrong:    pair('rgba(255,255,255,0.72)', 'rgba(255,255,255,0.12)'),
  // Glass-specific
  surfaceGlass:       pair('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.08)'),
  surfaceGlassBorder: pair('rgba(255,255,255,0.75)', 'rgba(255,255,255,0.16)'),

  // Borders and lines
  border:       pair('rgba(43,36,51,0.10)',  'rgba(255,255,255,0.10)'),
  borderStrong: pair('rgba(43,36,51,0.18)',  'rgba(255,255,255,0.18)'),
  divider:      pair('rgba(154,139,143,0.22)', 'rgba(255,255,255,0.10)'),
  frame:        pair('#9A8B8F', '#9B8278'),
  dotInactive:  pair('rgba(154,139,143,0.40)', 'rgba(255,255,255,0.18)'),

  // Ink — warm plum-black to dusty mauve
  text:          pair('#2B2433', '#F6EAE3'),
  textSecondary: pair('#574C56', '#D9C1B8'),
  textMuted:     pair('#6C5F66', '#CBB1A8'),
  textTertiary:  pair('#857680', '#AB9188'),
  textSubtle:    pair('#9A8B8F', '#9B8278'),
  glyphCream:    pair('#ffffff', '#ffffff'),

  // Sunset accent trio — coral / rose / amber
  inkSlate:      pair('#E0654A', '#FF7A52'),   // was the primary action color
  inkPressed:    pair('#C9506A', '#F1789A'),
  inkSlateDeep:  pair('#7A3D5A', '#C9506A'),
  accent:        pair('#E0654A', '#FF7A52'),   // coral
  accentStrong:  pair('#C9506A', '#F1789A'),
  accentDeep:    pair('#7A3D5A', '#C9506A'),
  accentSoft:    pair('rgba(224,101,74,0.14)', 'rgba(255,122,82,0.16)'),
  accentMuted:   pair('rgba(224,101,74,0.22)', 'rgba(255,122,82,0.24)'),
  accent2:       pair('#D85C76', '#F1789A'),   // rose
  accent3:       pair('#EE9A4C', '#F4B25C'),   // amber
  accentPressed: pair('#C9506A', '#F1789A'),

  // Cover
  coverSlate: pair('#E0654A', '#FF7A52'),
  coverMid:   pair('#7A3D5A', '#4B3F6B'),

  // Status — warm, restrained
  success:     pair('#1F8A5B', '#1F8A5B'),
  warning:     pair('#C77A2E', '#C77A2E'),
  danger:      pair('#C0362C', '#ff8a7a'),
  destructive: pair('#C0362C', '#ff8a7a'),

  // Misc
  white:       pair('#ffffff', '#2A1A1F'),
  black:       pair('#2B2433', '#F6EAE3'),
  transparent: pair('transparent'),

  // Reader surface system
  readerPaper:          pair('rgba(255,251,248,0.92)', 'rgba(36,21,26,0.72)'),
  readerSurface:        pair('#fffbf8',                '#241518'),
  readerBodyInk:        pair('#2B2433', '#F6EAE3'),
  readerMutedInk:       pair('#6C5F66', '#CBB1A8'),
  readerSubtleInk:      pair('#9A8B8F', '#9B8278'),
  readerHairline:       pair('rgba(154,139,143,0.18)', 'rgba(255,255,255,0.10)'),
  readerBorder:         pair('rgba(43,36,51,0.10)',    'rgba(255,255,255,0.10)'),
  readerUnknownUnderline:    pair('#D85C76', '#F1789A'), // rose — unknown word
  readerSavedUnderline:      pair('#E0654A', '#FF7A52'), // coral — saved word
  readerLevelSameUnderline:  pair('#EE9A4C', '#F4B25C'), // amber — at your level
  readerLevelAboveUnderline: pair('#E0654A', '#FF7A52'), // coral — above your level
  // Heat map — peripheral warm fills over difficult words (no underlines)
  readerHeatSame:   pair('rgba(238,154,76,0.17)', 'rgba(244,178,92,0.20)'),  // amber wash — at your level
  readerHeatAbove:  pair('rgba(224,101,74,0.26)', 'rgba(255,122,82,0.30)'),  // coral wash — above your level
  readerSavedFill:  pair('rgba(224,101,74,0.15)', 'rgba(255,122,82,0.20)'),  // saved word wash
  readerSavedLine:  pair('#E0654A', '#FF7A52'),                              // saved word baseline accent
  readerTappedWordSurfaceBg:   pair('#E0654A', '#FF7A52'),
  readerTappedWordSurfaceText: pair('#ffffff', '#ffffff'),
  readerSavedWordSurfaceBg:    pair('#E0654A', '#FF7A52'),
  readerSavedWordSurfaceText:  pair('#ffffff', '#ffffff'),
  readerTappedWordBg:          pair('#E0654A', '#FF7A52'),
  readerTappedWordText:        pair('#ffffff', '#ffffff'),
  readerTappedWordHighlight:   pair('rgba(224,101,74,0.25)', 'rgba(255,122,82,0.25)'),
  readerTextSelectionHighlight: pair('rgba(224,101,74,0.20)', 'rgba(255,122,82,0.20)'),
  readerSavedChipBg:   pair('rgba(224,101,74,0.14)', 'rgba(255,122,82,0.16)'),
  readerSavedChipText: pair('#E0654A', '#FF7A52'),
  readerProgressTrack: pair('rgba(154,139,143,0.24)', 'rgba(255,255,255,0.14)'),
  readerProgressFill:  pair('#D85C76', '#F1789A'), // rose — progress fill
  readerEdgeRule:      pair('rgba(43,36,51,0.12)',  'rgba(255,255,255,0.12)'),
  readerEdgeButtonBg:  pair('#E0654A', '#FF7A52'),
  readerEdgeButtonText: pair('#ffffff', '#ffffff'),
  readerPlaceholder:   pair('#9A8B8F', '#9B8278'),
  readerTocScrim:      pair('rgba(43,36,51,0.10)',  'rgba(0,0,0,0.40)'),

  // OCR (unchanged — not part of redesign)
  ocrNavy:              pair('#3d4f72'),
  ocrDetectionFill:     pair('rgba(61,79,114,0.13)', 'rgba(240,237,237,0.14)'),
  ocrDetectionRegionFill: pair('rgba(61,79,114,0.24)', 'rgba(240,237,237,0.22)'),
  ocrScrim:             pair('rgba(43,36,51,0.42)',   'rgba(17,21,28,0.68)'),

  // Lookup / sheet popover surfaces
  popover:       pair('rgba(255,252,250,0.97)', 'rgba(46,27,33,0.96)'),
  popoverBorder: pair('rgba(43,36,51,0.10)',    'rgba(255,255,255,0.13)'),

  // Shadows / overlay
  shadow:  pair('rgba(80,30,30,0.10)', 'rgba(0,0,0,0.36)'),
  overlay: pair('rgba(43,36,51,0.32)', 'rgba(0,0,0,0.50)'),
};

// Tint helper — '#E0654A' + 0.14 → 'rgba(224,101,74,0.14)'.
// Used for the soft accent tint fills (badge/coin backgrounds).
export const withAlpha = (hex, alpha) => {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const resolveColors = (mode = 'light') => Object.fromEntries(
  Object.entries(colorPairs).map(([key, value]) => [key, value[mode] ?? value.light])
);

export const lightColors = resolveColors('light');
export const darkColors = resolveColors('dark');
let activeColors = lightColors;

export const colors = new Proxy(lightColors, {
  get: (_target, key) => activeColors[key] ?? lightColors[key],
  ownKeys: () => Reflect.ownKeys(activeColors),
  getOwnPropertyDescriptor: (_target, key) => (
    key in activeColors
      ? { enumerable: true, configurable: true, value: activeColors[key] }
      : undefined
  ),
});

// Android's Color.parseColor only understands #RRGGBB / #AARRGGBB — convert
// any CSS rgba()/rgb() token to that form before crossing the bridge.
export const toNativeColor = (value) => {
  if (typeof value !== 'string') return value;
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!match) return value;
  const toHex = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');
  const alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
  return `#${toHex(alpha * 255)}${toHex(Number(match[1]))}${toHex(Number(match[2]))}${toHex(Number(match[3]))}`;
};

export const createNativeReaderThemeTokens = (themeColors) => Object.fromEntries(
  Object.entries({
    background: themeColors.readerPaper,
    bodyText: themeColors.readerBodyInk,
    mutedText: themeColors.readerMutedInk,
    subtleText: themeColors.readerSubtleInk,
    rule: themeColors.readerEdgeRule,
    edgeButton: themeColors.readerEdgeButtonBg,
    edgeButtonText: themeColors.readerEdgeButtonText,
    activeHighlight: themeColors.readerTappedWordSurfaceBg,
    textSelectionHighlight: themeColors.readerTextSelectionHighlight,
    savedHighlight: themeColors.readerSavedFill,
    savedHighlightText: themeColors.readerBodyInk,
    savedLine: themeColors.readerSavedLine,
    levelSameHeat: themeColors.readerHeatSame,
    levelAboveHeat: themeColors.readerHeatAbove,
    levelSameUnderline: themeColors.readerHeatSame,
    levelAboveUnderline: themeColors.readerHeatAbove,
    selectionHandle: themeColors.readerProgressFill,
    placeholder: themeColors.readerPlaceholder,
  }).map(([key, value]) => [key, toNativeColor(value)])
);

// ─── Radii ─────────────────────────────────────────────────────────────────
// Soft, generous corners matching the glass-card aesthetic.
export const radii = {
  xs: 8,    // chips, badges
  sm: 11,   // inputs, small tiles
  md: 14,   // buttons, module blocks
  lg: 20,   // glass cards (default)
  xl: 28,   // large sheets, hero panels
  pill: 999,
};

// ─── Elevation / Shadows ───────────────────────────────────────────────────
// Luminous and sunset-tinted. Accent glow under CTAs/FABs.
export const elevation = {
  card: {
    shadowColor: 'rgba(80,30,30,0.10)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  },
  subtle: {
    shadowColor: 'rgba(80,30,30,0.07)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 1,
  },
  glass: {
    shadowColor: 'rgba(80,30,30,0.10)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 4,
  },
  sheet: {
    shadowColor: 'rgba(43,20,26,0.16)',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 8,
  },
  coverLift: {
    shadowColor: 'rgba(0,0,0,0.34)',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 1,
    shadowRadius: 34,
    elevation: 12,
  },
  fab: {
    // Coral accent glow — the FAB sits in front of the gradient sky
    shadowColor: 'rgba(224,101,74,0.40)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 7,
  },
  readerToc: {
    shadowColor: 'rgba(43,20,26,0.18)',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 1,
    shadowRadius: 34,
    elevation: 12,
  },
};

const createLayout = (themeColors) => ({
  screenMaxWidth: 560,
  headerHeight: 52,
  appBarHeight: 52,
  readerHeaderHeight: 56,
  tabBarHeight: 64,
  tabBarBorderWidth: 1,
  tabActiveUnderlineHeight: 2,
  tabActiveUnderlineColor: themeColors.accent,  // coral underline for active tab
  fabSize: 52,
  bookCoverAspectRatio: 2 / 3,
  bookPreviewCoverWidth: 172,
  bookPreviewCoverHeight: 244,
  bookGridCoverSpineWidth: 4,
  progressTrackHeight: 3,
  progressTrackColor: themeColors.readerProgressTrack,
  progressFillColor: themeColors.readerProgressFill,
  lookupButtonHeight: 52,
  lookupButtonHeightCompact: 44,
});

export const layout = createLayout(colors);

export const createTheme = (isDarkMode = false) => {
  const themeColors = isDarkMode ? darkColors : lightColors;
  return {
    isDarkMode: Boolean(isDarkMode),
    colors: themeColors,
    t: themeColors,
    radii,
    elevation,
    layout: createLayout(themeColors),
  };
};

export const theme = createTheme(false);

const ThemeContext = createContext(theme);

export const ThemeProvider = ({ isDarkMode = false, children }) => {
  activeColors = isDarkMode ? darkColors : lightColors;
  const value = useMemo(() => createTheme(isDarkMode), [isDarkMode]);
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

const defaultTheme = { colors, t: colors, radii, elevation, layout };
export default defaultTheme;
