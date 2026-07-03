// ─── Reader themes — Paper / Sepia / Dark ──────────────────────────────────
// The reading surface has its own calm, solid palette, fully independent of the
// app's global light/dark theme. Each theme is a set of reader-scoped token
// overrides (opaque surfaces, no gradients) merged over the base color map, so
// it can drive both the RN reader chrome and the native page via
// createNativeReaderThemeTokens(). Ported from the Noeul design prototype.
// ────────────────────────────────────────────────────────────────────────────
import { darkColors, lightColors } from './tokens';

export const READER_THEME_ORDER = ['paper', 'sepia', 'dark'];
export const DEFAULT_READER_THEME = 'paper';

// Each entry overrides only the reader-relevant tokens. `statusDark` tells the
// status bar / chrome whether to use light glyphs.
const READER_THEME_OVERRIDES = {
  paper: {
    statusDark: false,
    readerPaper: '#fbf9f8',
    readerSurface: '#fbf9f8',
    bgPage: '#fbf9f8',
    text: '#1b1c1c',
    textSecondary: '#44474b',
    textMuted: '#5c5e63',
    textTertiary: '#75777b',
    textSubtle: '#9a9c9f',
    readerBodyInk: '#1b1c1c',
    readerMutedInk: '#75777b',
    readerSubtleInk: '#9a9c9f',
    surface: '#ffffff',
    surfaceElevated: '#ffffff',
    surfaceCard: '#fefdfc',
    surfaceMuted: '#f0eded',
    surfaceAssist: '#f4f1f1',
    surfaceStrong: '#e4e2e2',
    surfaceSelected: '#fefdfc',
    border: '#e4e2e2',
    readerBorder: '#e4e2e2',
    borderStrong: '#c5c6cb',
    divider: '#eceaea',
    readerHairline: 'rgba(27,28,28,0.10)',
    readerProgressTrack: '#e4e2e2',
    readerProgressFill: '#75777b',
    inkSlate: '#202631',
    inkPressed: '#2f3644',
    glyphCream: '#ffffff',
    accent: '#202631',
    accentStrong: '#202631',
    accentSoft: '#f0eded',
    accentMuted: '#e4e2e2',
    readerTappedWordBg: '#202631',
    readerTappedWordText: '#ffffff',
    readerTappedWordSurfaceBg: '#202631',
    readerTappedWordSurfaceText: '#ffffff',
    readerSavedWordSurfaceBg: '#202631',
    readerSavedWordSurfaceText: '#ffffff',
    readerTappedWordHighlight: 'rgba(32,38,49,0.14)',
    readerTextSelectionHighlight: 'rgba(32,38,49,0.14)',
    readerSavedFill: 'rgba(196,102,31,0.15)',
    readerSavedLine: '#c4661f',
    readerHeatSame: 'rgba(238,154,76,0.16)',
    readerHeatAbove: 'rgba(224,101,74,0.20)',
    readerLevelSameUnderline: 'rgba(238,154,76,0.16)',
    readerLevelAboveUnderline: 'rgba(224,101,74,0.20)',
    readerEdgeRule: 'rgba(27,28,28,0.12)',
    readerEdgeButtonBg: '#202631',
    readerEdgeButtonText: '#ffffff',
    readerPlaceholder: '#9a9c9f',
    overlay: 'rgba(27,28,28,0.32)',
    readerTocScrim: 'rgba(27,28,28,0.28)',
    popover: '#ffffff',
    popoverBorder: '#e4e2e2',
  },
  sepia: {
    statusDark: false,
    readerPaper: '#f3e8d2',
    readerSurface: '#f3e8d2',
    bgPage: '#f3e8d2',
    text: '#3d3324',
    textSecondary: '#574a37',
    textMuted: '#6a5c45',
    textTertiary: '#8a7b61',
    textSubtle: '#a8997f',
    readerBodyInk: '#3d3324',
    readerMutedInk: '#8a7b61',
    readerSubtleInk: '#a8997f',
    surface: '#fbf3e1',
    surfaceElevated: '#fbf3e1',
    surfaceCard: '#f7eed8',
    surfaceMuted: '#eaddc2',
    surfaceAssist: '#efe5cc',
    surfaceStrong: '#dccfae',
    surfaceSelected: '#f7eed8',
    border: '#ddccaa',
    readerBorder: '#ddccaa',
    borderStrong: '#c7b389',
    divider: '#e6d8ba',
    readerHairline: 'rgba(61,51,36,0.12)',
    readerProgressTrack: '#dccfae',
    readerProgressFill: '#8a7b61',
    inkSlate: '#574a37',
    inkPressed: '#6a5c45',
    glyphCream: '#fbf3e1',
    accent: '#574a37',
    accentStrong: '#574a37',
    accentSoft: '#eaddc2',
    accentMuted: '#dccfae',
    readerTappedWordBg: '#574a37',
    readerTappedWordText: '#fbf3e1',
    readerTappedWordSurfaceBg: '#574a37',
    readerTappedWordSurfaceText: '#fbf3e1',
    readerSavedWordSurfaceBg: '#574a37',
    readerSavedWordSurfaceText: '#fbf3e1',
    readerTappedWordHighlight: 'rgba(87,74,55,0.16)',
    readerTextSelectionHighlight: 'rgba(87,74,55,0.16)',
    readerSavedFill: 'rgba(196,102,31,0.16)',
    readerSavedLine: '#c4661f',
    readerHeatSame: 'rgba(196,140,60,0.18)',
    readerHeatAbove: 'rgba(196,102,31,0.20)',
    readerLevelSameUnderline: 'rgba(196,140,60,0.18)',
    readerLevelAboveUnderline: 'rgba(196,102,31,0.20)',
    readerEdgeRule: 'rgba(61,51,36,0.14)',
    readerEdgeButtonBg: '#574a37',
    readerEdgeButtonText: '#fbf3e1',
    readerPlaceholder: '#a8997f',
    overlay: 'rgba(61,51,36,0.30)',
    readerTocScrim: 'rgba(61,51,36,0.26)',
    popover: '#fbf3e1',
    popoverBorder: '#ddccaa',
  },
  dark: {
    statusDark: true,
    readerPaper: '#141619',
    readerSurface: '#141619',
    bgPage: '#141619',
    text: '#e7e5e1',
    textSecondary: '#bdbec2',
    textMuted: '#9d9fa3',
    textTertiary: '#86888c',
    textSubtle: '#6c6e72',
    readerBodyInk: '#e7e5e1',
    readerMutedInk: '#9d9fa3',
    readerSubtleInk: '#6c6e72',
    surface: '#1d2026',
    surfaceElevated: '#1d2026',
    surfaceCard: '#1a1d22',
    surfaceMuted: '#23262c',
    surfaceAssist: '#202329',
    surfaceStrong: '#2c3037',
    surfaceSelected: '#1a1d22',
    border: '#2c3037',
    readerBorder: '#2c3037',
    borderStrong: '#3a3f48',
    divider: '#262a30',
    readerHairline: 'rgba(255,255,255,0.10)',
    readerProgressTrack: 'rgba(255,255,255,0.14)',
    readerProgressFill: '#9d9fa3',
    inkSlate: '#e7e5e1',
    inkPressed: '#cdccc8',
    glyphCream: '#15171b',
    accent: '#e7e5e1',
    accentStrong: '#e7e5e1',
    accentSoft: '#23262c',
    accentMuted: '#2c3037',
    readerTappedWordBg: '#e7e5e1',
    readerTappedWordText: '#15171b',
    readerTappedWordSurfaceBg: '#e7e5e1',
    readerTappedWordSurfaceText: '#15171b',
    readerSavedWordSurfaceBg: '#e7e5e1',
    readerSavedWordSurfaceText: '#15171b',
    readerTappedWordHighlight: 'rgba(231,229,225,0.18)',
    readerTextSelectionHighlight: 'rgba(231,229,225,0.16)',
    readerSavedFill: 'rgba(255,122,82,0.20)',
    readerSavedLine: '#ff7a52',
    readerHeatSame: 'rgba(244,178,92,0.20)',
    readerHeatAbove: 'rgba(255,122,82,0.28)',
    readerLevelSameUnderline: 'rgba(244,178,92,0.20)',
    readerLevelAboveUnderline: 'rgba(255,122,82,0.28)',
    readerEdgeRule: 'rgba(255,255,255,0.12)',
    readerEdgeButtonBg: '#e7e5e1',
    readerEdgeButtonText: '#15171b',
    readerPlaceholder: '#6c6e72',
    overlay: 'rgba(0,0,0,0.50)',
    readerTocScrim: 'rgba(0,0,0,0.44)',
    popover: '#1d2026',
    popoverBorder: '#2c3037',
  },
};

export const normalizeReaderTheme = (themeName) => (
  READER_THEME_ORDER.includes(themeName) ? themeName : DEFAULT_READER_THEME
);

export const isReaderThemeDark = (themeName) => normalizeReaderTheme(themeName) === 'dark';

// Native `theme` prop only distinguishes light/dark for fallback defaults; the
// full palette is driven by themeTokens, so paper and sepia both map to "light".
export const nativeReaderThemeName = (themeName) => (
  isReaderThemeDark(themeName) ? 'dark' : 'light'
);

// Merge the reader overrides over a base color map resolved for the theme's
// light/dark polarity — this gives sensible values for any non-overridden
// tokens (shadows, status colors, etc.).
export const getReaderThemeColors = (themeName) => {
  const name = normalizeReaderTheme(themeName);
  const base = name === 'dark' ? darkColors : lightColors;
  return { ...base, ...READER_THEME_OVERRIDES[name] };
};

export const getReaderThemeMeta = (themeName) => {
  const overrides = READER_THEME_OVERRIDES[normalizeReaderTheme(themeName)];
  return { statusDark: Boolean(overrides.statusDark) };
};
