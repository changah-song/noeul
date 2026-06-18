import React, { createContext, useContext, useMemo } from 'react';

const pair = (light, dark = light) => ({ light, dark });

export const colorPairs = {
  backgroundWarm: pair('#fbf9f8', '#11151c'),
  backgroundCool: pair('#fbf9f8', '#11151c'),
  bgPage: pair('#fbf9f8', '#11151c'),
  surface: pair('#ffffff', '#1b1c1c'),
  surfaceCard: pair('#fefdfc', '#1b1c1c'),
  surfaceMuted: pair('#f0eded', '#202631'),
  surfaceAssist: pair('#f4f1f1', '#202631'),
  surfaceSelected: pair('#f0eded', '#202631'),
  surfaceElevated: pair('#ffffff', '#1b1c1c'),
  surfaceStrong: pair('#e4e2e2', '#202631'),
  border: pair('#e4e2e2', '#353c47'),
  borderStrong: pair('#c5c6cb', '#353c47'),
  divider: pair('#eceaea', '#202631'),
  frame: pair('#b0b2b6', '#44474b'),
  dotInactive: pair('#d2d0d0', '#353c47'),
  text: pair('#1b1c1c', '#f0eded'),
  textSecondary: pair('#44474b', '#c5c6cb'),
  textMuted: pair('#5c5e63', '#9a9c9f'),
  textTertiary: pair('#75777b', '#75777b'),
  textSubtle: pair('#9a9c9f', '#5c5e63'),
  inkSlate: pair('#202631', '#f0eded'),
  inkPressed: pair('#0e1014', '#f0eded'),
  inkSlateDeep: pair('#11151c', '#f0eded'),
  accent: pair('#202631', '#f0eded'),
  accentStrong: pair('#202631', '#f0eded'),
  accentDeep: pair('#11151c', '#f0eded'),
  accentSoft: pair('rgba(32, 38, 49, 0.10)', 'rgba(240, 237, 237, 0.12)'),
  accentMuted: pair('rgba(32, 38, 49, 0.18)', 'rgba(240, 237, 237, 0.18)'),
  coverSlate: pair('#353c47'),
  coverMid: pair('#75777b'),
  success: pair('#202631', '#f0eded'),
  warning: pair('#75777b', '#c5c6cb'),
  danger: pair('#c0362c', '#ff8a7a'),
  destructive: pair('#c0362c', '#ff8a7a'),
  glyphCream: pair('#faf8f5', '#faf8f5'),
  ocrNavy: pair('#3d4f72'),
  ocrDetectionFill: pair('rgba(61, 79, 114, 0.13)', 'rgba(240, 237, 237, 0.14)'),
  ocrDetectionRegionFill: pair('rgba(61, 79, 114, 0.24)', 'rgba(240, 237, 237, 0.22)'),
  ocrScrim: pair('rgba(27, 28, 28, 0.42)', 'rgba(17, 21, 28, 0.68)'),
  readerTocScrim: pair('rgba(27, 28, 28, 0.10)', 'rgba(17, 21, 28, 0.58)'),
  shadow: pair('rgba(27, 28, 28, 0.08)', 'rgba(17, 21, 28, 0.36)'),
  overlay: pair('rgba(27, 28, 28, 0.32)', 'rgba(17, 21, 28, 0.64)'),
  white: pair('#ffffff', '#1b1c1c'),
  black: pair('#11151c'),
  transparent: pair('transparent'),

  readerPaper: pair('#fbf9f8', '#11151c'),
  readerSurface: pair('#ffffff', '#1b1c1c'),
  readerBodyInk: pair('#1b1c1c', '#f0eded'),
  readerMutedInk: pair('#75777b', '#9a9c9f'),
  readerSubtleInk: pair('#9a9c9f', '#5c5e63'),
  readerHairline: pair('#eceaea', '#202631'),
  readerBorder: pair('#e4e2e2', '#353c47'),
  readerUnknownUnderline: pair('#75777b', '#5c5e63'),
  readerSavedUnderline: pair('#75777b', '#5c5e63'),
  readerLevelSameUnderline: pair('#2f8f46', '#74c476'),
  readerLevelAboveUnderline: pair('#c4661f', '#f59e0b'),
  readerTappedWordSurfaceBg: pair('#e4e2e2', '#353c47'),
  readerTappedWordSurfaceText: pair('#1b1c1c', '#f0eded'),
  readerSavedWordSurfaceBg: pair('#202631', '#202631'),
  readerSavedWordSurfaceText: pair('#ffffff', '#ffffff'),
  readerTappedWordBg: pair('#202631', '#f0eded'),
  readerTappedWordText: pair('#ffffff', '#1b1c1c'),
  readerTappedWordHighlight: pair('#40202631', '#40f0eded'),
  readerTextSelectionHighlight: pair('#2e202631', '#2ef0eded'),
  readerSavedChipBg: pair('#f0eded', '#202631'),
  readerSavedChipText: pair('#202631', '#f0eded'),
  readerProgressTrack: pair('#eceaea', '#202631'),
  readerProgressFill: pair('#202631', '#f0eded'),
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
  levelSameUnderline: themeColors.readerLevelSameUnderline,
  levelAboveUnderline: themeColors.readerLevelAboveUnderline,
  selectionHandle: themeColors.readerProgressFill,
  placeholder: themeColors.readerPlaceholder,
});

export const radii = {
  xs: 3,
  sm: 4,
  md: 6,
  lg: 10,
  xl: 16,
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
    shadowColor: 'rgba(27, 28, 28, 0.08)',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 8,
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
