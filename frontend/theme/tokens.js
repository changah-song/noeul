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
  panelShadow: pair('rgba(27, 28, 28, 0.16)', 'rgba(0, 0, 0, 0.5)'),
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
  // Three stops of the reader's level-underline gradient (easy → mid → hard).
  // A word's shade is interpolated between them from its P(known); see
  // services/abilityModel.js `levelUnderlineWeight`.
  // They colour the words themselves, so the light ones are dark enough to
  // read as text on the paper (4.5:1 or better).
  readerLevelUnderlineEasy: pair('#2a7a3d', '#74c476'),
  readerLevelUnderlineMid: pair('#a8520f', '#f59e0b'),
  readerLevelUnderlineHard: pair('#b32d2d', '#e5686a'),
  // Book brown, so the tapped word stands out on the grey sentence wash.
  readerTappedWordSurfaceBg: pair('#e3cfb4', '#5c4630'),
  readerTappedWordSurfaceText: pair('#1b1c1c', '#f0eded'),
  readerSavedWordSurfaceBg: pair('#202631', '#f0eded'),
  readerSavedWordSurfaceText: pair('#ffffff', '#1b1c1c'),
  readerTappedWordBg: pair('#202631', '#f0eded'),
  readerTappedWordText: pair('#ffffff', '#1b1c1c'),
  readerTappedWordHighlight: pair('#40202631', '#40f0eded'),
  readerTextSelectionHighlight: pair('#12202631', '#1af0eded'),
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

// Sepia is the light theme on warm paper: cream surfaces and brown ink in
// place of the greys. Anything not listed here keeps its light value.
const SEPIA_INK = '#43352a';
const SEPIA_PAPER = '#f4ecd8';
const SEPIA_SURFACE = '#fbf5e6';
const sepiaOverrides = {
  backgroundWarm: SEPIA_PAPER,
  backgroundCool: SEPIA_PAPER,
  bgPage: SEPIA_PAPER,
  surface: SEPIA_SURFACE,
  surfaceCard: '#f9f2e2',
  surfaceMuted: '#eae0c8',
  surfaceAssist: '#eee5cf',
  surfaceSelected: '#eae0c8',
  surfaceElevated: SEPIA_SURFACE,
  surfaceStrong: '#dfd3b8',
  border: '#dfd3b8',
  borderStrong: '#c4b594',
  divider: '#e6dcc4',
  frame: '#b3a488',
  dotInactive: '#d3c6a8',
  text: '#3b2f25',
  textSecondary: '#574839',
  textMuted: '#6b5a48',
  textTertiary: '#766451',
  textSubtle: '#a3927a',
  inkSlate: SEPIA_INK,
  inkPressed: '#2a2019',
  inkSlateDeep: '#33271e',
  accent: SEPIA_INK,
  accentStrong: SEPIA_INK,
  accentDeep: '#33271e',
  accentSoft: 'rgba(67, 53, 42, 0.10)',
  accentMuted: 'rgba(67, 53, 42, 0.18)',
  success: SEPIA_INK,
  warning: '#766451',
  ocrScrim: 'rgba(59, 47, 37, 0.42)',
  readerTocScrim: 'rgba(59, 47, 37, 0.10)',
  shadow: 'rgba(59, 47, 37, 0.08)',
  panelShadow: 'rgba(59, 47, 37, 0.16)',
  overlay: 'rgba(59, 47, 37, 0.32)',
  white: SEPIA_SURFACE,

  readerPaper: SEPIA_PAPER,
  readerSurface: SEPIA_SURFACE,
  readerBodyInk: '#3b2f25',
  readerMutedInk: '#766451',
  readerSubtleInk: '#a3927a',
  readerHairline: '#e6dcc4',
  readerBorder: '#dfd3b8',
  readerUnknownUnderline: '#766451',
  readerSavedUnderline: '#766451',
  // A shade darker than on white paper, to keep 4.5:1 on the cream.
  readerLevelUnderlineEasy: '#256b36',
  readerLevelUnderlineMid: '#96480c',
  readerLevelUnderlineHard: '#a32828',
  readerTappedWordSurfaceBg: '#dcc19c',
  readerTappedWordSurfaceText: '#3b2f25',
  readerSavedWordSurfaceBg: SEPIA_INK,
  readerSavedWordSurfaceText: SEPIA_SURFACE,
  readerTappedWordBg: SEPIA_INK,
  readerTappedWordText: SEPIA_SURFACE,
  readerTappedWordHighlight: '#4043352a',
  readerTextSelectionHighlight: '#1243352a',
  readerSavedChipBg: '#eae0c8',
  readerSavedChipText: SEPIA_INK,
  readerProgressTrack: '#e6dcc4',
  readerProgressFill: SEPIA_INK,
  readerEdgeRule: '#c4b594',
  readerEdgeButtonBg: SEPIA_INK,
  readerEdgeButtonText: SEPIA_SURFACE,
  readerPlaceholder: '#b9aa8c',
};

export const lightColors = resolveColors('light');
export const darkColors = resolveColors('dark');
export const sepiaColors = { ...lightColors, ...sepiaOverrides };

export const THEME_MODES = ['light', 'sepia', 'dark'];
const colorsByMode = { light: lightColors, sepia: sepiaColors, dark: darkColors };

// The theme a stored settings object asks for. `themeMode` is the newer field;
// `isDarkMode` is the older one, and a build from before sepia changes only
// that. So when the two disagree, isDarkMode is the fresher answer.
export const resolveThemeMode = ({ themeMode, isDarkMode } = {}, fallback = 'light') => {
  const hasMode = THEME_MODES.includes(themeMode);
  if (typeof isDarkMode === 'boolean') {
    if (hasMode && (themeMode === 'dark') === isDarkMode) {
      return themeMode;
    }
    return isDarkMode ? 'dark' : 'light';
  }
  return hasMode ? themeMode : fallback;
};

// Accepts a mode name, or the older true / false for dark / light.
const toThemeMode = (mode) => {
  if (mode === true) return 'dark';
  return THEME_MODES.includes(mode) ? mode : 'light';
};

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
  // Solid ink: the tapped word is drawn in the page colour on it.
  activeHighlight: themeColors.readerTappedWordBg,
  textSelectionHighlight: themeColors.readerTextSelectionHighlight,
  savedHighlight: themeColors.readerSavedWordSurfaceBg,
  savedHighlightText: themeColors.readerSavedWordSurfaceText,
  levelUnderlineEasy: themeColors.readerLevelUnderlineEasy,
  levelUnderlineMid: themeColors.readerLevelUnderlineMid,
  levelUnderlineHard: themeColors.readerLevelUnderlineHard,
  // Muted grey, so the handles stay quieter than the text they select.
  selectionHandle: themeColors.textTertiary,
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

export const createTheme = (modeOrIsDark = 'light') => {
  const mode = toThemeMode(modeOrIsDark);
  const themeColors = colorsByMode[mode];

  return {
    mode,
    isDarkMode: mode === 'dark',
    colors: themeColors,
    t: themeColors,
    radii,
    elevation,
    layout: createLayout(themeColors),
  };
};

export const theme = createTheme(false);

const ThemeContext = createContext(theme);

export const ThemeProvider = ({ mode, isDarkMode = false, children }) => {
  const themeMode = toThemeMode(mode ?? isDarkMode);
  activeColors = colorsByMode[themeMode];
  const value = useMemo(() => createTheme(themeMode), [themeMode]);

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
