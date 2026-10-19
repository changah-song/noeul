import React, { createContext, useContext, useMemo } from 'react';

const pair = (light, dark = light) => ({ light, dark });

// Paper palette (Noeul redesign, direction B): a quiet paper ground, near-black
// ink, hairlines instead of boxes, and one teal accent for state (the active
// tab, a selected word, links). Dark mode is the same paper at night, chosen
// step by step rather than inverted.
export const colorPairs = {
  backgroundWarm: pair('#f5f5f2', '#121311'),
  backgroundCool: pair('#f5f5f2', '#121311'),
  bgPage: pair('#f5f5f2', '#121311'),
  surface: pair('#ffffff', '#1b1c1a'),
  surfaceCard: pair('#ffffff', '#1b1c1a'),
  surfaceMuted: pair('#ecebe6', '#23241f'),
  surfaceAssist: pair('#efeee9', '#23241f'),
  surfaceSelected: pair('#ecebe6', '#2a2b27'),
  surfaceElevated: pair('#ffffff', '#1f201d'),
  surfaceStrong: pair('#e2e1db', '#2e2f2b'),
  border: pair('#deddd7', '#33342f'),
  borderStrong: pair('#cfcec7', '#45463f'),
  divider: pair('#e7e6e0', '#262723'),
  frame: pair('#b0afa8', '#4a4b45'),
  dotInactive: pair('#d2d1ca', '#3a3b36'),
  text: pair('#161616', '#edece7'),
  textSecondary: pair('#3c3c38', '#cfcec8'),
  textMuted: pair('#5e5e5a', '#a3a29b'),
  textTertiary: pair('#6e6e68', '#8f8e87'),
  textSubtle: pair('#9a9a94', '#6b6a64'),
  inkSlate: pair('#161616', '#edece7'),
  inkPressed: pair('#000000', '#ffffff'),
  inkSlateDeep: pair('#0b0b0b', '#edece7'),
  accent: pair('#161616', '#edece7'),
  accentStrong: pair('#161616', '#edece7'),
  accentDeep: pair('#0b0b0b', '#edece7'),
  accentSoft: pair('rgba(22, 22, 22, 0.08)', 'rgba(237, 236, 231, 0.10)'),
  accentMuted: pair('rgba(22, 22, 22, 0.14)', 'rgba(237, 236, 231, 0.16)'),
  // The one colour accent: active tab, selection, links, "in this sentence".
  tint: pair('#0e6b66', '#5fb8ae'),
  tintSoft: pair('rgba(14, 107, 102, 0.10)', 'rgba(95, 184, 174, 0.14)'),
  onInk: pair('#f5f5f2', '#121311'),
  coverSlate: pair('#2f3238'),
  coverMid: pair('#75756f'),
  success: pair('#1e6b3a', '#7bc790'),
  warning: pair('#7a4a00', '#e8b05a'),
  danger: pair('#b42318', '#ff8a7a'),
  destructive: pair('#b42318', '#ff8a7a'),
  glyphCream: pair('#f5f5f2', '#f5f5f2'),
  ocrNavy: pair('#3d4f72'),
  ocrDetectionFill: pair('rgba(61, 79, 114, 0.13)', 'rgba(237, 236, 231, 0.14)'),
  ocrDetectionRegionFill: pair('rgba(61, 79, 114, 0.24)', 'rgba(237, 236, 231, 0.22)'),
  ocrScrim: pair('rgba(22, 22, 22, 0.42)', 'rgba(8, 8, 7, 0.68)'),
  readerTocScrim: pair('rgba(22, 22, 22, 0.10)', 'rgba(8, 8, 7, 0.58)'),
  shadow: pair('rgba(22, 22, 22, 0.10)', 'rgba(0, 0, 0, 0.40)'),
  overlay: pair('rgba(22, 22, 22, 0.28)', 'rgba(0, 0, 0, 0.56)'),
  white: pair('#ffffff', '#1b1c1a'),
  black: pair('#0b0b0b'),
  transparent: pair('transparent'),

  readerPaper: pair('#f5f5f2', '#121311'),
  readerSurface: pair('#ffffff', '#1b1c1a'),
  readerBodyInk: pair('#161616', '#e6e5df'),
  readerMutedInk: pair('#5e5e5a', '#a3a29b'),
  readerSubtleInk: pair('#9a9a94', '#6b6a64'),
  readerHairline: pair('#e7e6e0', '#262723'),
  readerBorder: pair('#deddd7', '#33342f'),
  readerUnknownUnderline: pair('#75777b', '#5c5e63'),
  readerSavedUnderline: pair('#75777b', '#5c5e63'),
  // Three stops of the reader's level-underline gradient (easy → mid → hard).
  // A word's shade is interpolated between them from its P(known); see
  // services/abilityModel.js `levelUnderlineWeight`.
  readerLevelUnderlineEasy: pair('#2f8f46', '#74c476'),
  readerLevelUnderlineMid: pair('#c4661f', '#f59e0b'),
  readerLevelUnderlineHard: pair('#b32d2d', '#e5686a'),
  readerTappedWordSurfaceBg: pair('#d9ebe9', '#28403d'),
  readerTappedWordSurfaceText: pair('#161616', '#edece7'),
  readerSavedWordSurfaceBg: pair('#161616', '#e6e5df'),
  readerSavedWordSurfaceText: pair('#f5f5f2', '#121311'),
  readerTappedWordBg: pair('#202631', '#f0eded'),
  readerTappedWordText: pair('#ffffff', '#1b1c1c'),
  readerTappedWordHighlight: pair('#40202631', '#40f0eded'),
  readerTextSelectionHighlight: pair('#2e202631', '#2ef0eded'),
  readerSavedChipBg: pair('#f0eded', '#202631'),
  readerSavedChipText: pair('#202631', '#f0eded'),
  readerProgressTrack: pair('#deddd7', '#2e2f2b'),
  readerProgressFill: pair('#161616', '#edece7'),
  readerEdgeRule: pair('#c5c6cb', '#353c47'),
  readerEdgeButtonBg: pair('#202631', '#1b1c1c'),
  readerEdgeButtonText: pair('#ffffff', '#f0eded'),
  readerPlaceholder: pair('#b4aea6', '#44474b'),
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
      ? {
        enumerable: true,
        configurable: true,
        value: activeColors[key],
      }
      : undefined
  ),
});

export const createNativeReaderThemeTokens = (themeColors) => ({
  background: themeColors.readerPaper,
  bodyText: themeColors.readerBodyInk,
  mutedText: themeColors.readerMutedInk,
  subtleText: themeColors.readerSubtleInk,
  rule: themeColors.readerEdgeRule,
  edgeButton: themeColors.readerEdgeButtonBg,
  edgeButtonText: themeColors.readerEdgeButtonText,
  activeHighlight: themeColors.readerTappedWordSurfaceBg,
  textSelectionHighlight: themeColors.readerTextSelectionHighlight,
  savedHighlight: themeColors.readerSavedWordSurfaceBg,
  savedHighlightText: themeColors.readerSavedWordSurfaceText,
  levelUnderlineEasy: themeColors.readerLevelUnderlineEasy,
  levelUnderlineMid: themeColors.readerLevelUnderlineMid,
  levelUnderlineHard: themeColors.readerLevelUnderlineHard,
  selectionHandle: themeColors.readerProgressFill,
  placeholder: themeColors.readerPlaceholder,
});

export const radii = {
  xs: 3,
  sm: 4,
  md: 6,
  lg: 10,
  xl: 16,
  xxl: 24,
  pill: 999,
};

export const elevation = {
  card: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  subtle: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sheet: {
    shadowColor: 'rgba(22, 22, 22, 0.12)',
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 12,
  },
  coverLift: {
    shadowColor: 'rgba(27, 28, 28, 0.22)',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 12,
  },
  fab: {
    shadowColor: 'rgba(27, 28, 28, 0.25)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 7,
  },
  readerToc: {
    shadowColor: 'rgba(27, 28, 28, 0.18)',
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
  tabActiveUnderlineColor: themeColors.text,
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

const defaultTheme = {
  colors,
  t: colors,
  radii,
  elevation,
  layout,
};

export default defaultTheme;
