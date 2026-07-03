import { colors, radii, elevation, layout, useTheme, createTheme, ThemeProvider, createNativeReaderThemeTokens } from './tokens';
import { spacing, insets } from './spacing';
import { fontFamilies, typeScale, lineHeights, textStyles } from './typography';

export { colors, radii, elevation, layout, useTheme, createTheme, ThemeProvider, createNativeReaderThemeTokens } from './tokens';
export { spacing, insets } from './spacing';
export { fontFamilies, typeScale, lineHeights, textStyles } from './typography';

// ─── Gradient definitions ──────────────────────────────────────────────────
// React Native doesn't support CSS gradients natively. These are the color
// stop arrays for use with expo-linear-gradient or similar.
export const Gradients = {
  // Coral → rose — used on buttons, CTAs, FABs
  accent: ['#E0654A', '#D85C76'],
  accentDusk: ['#FF7A52', '#F1789A'],
  // Amber → rose — reading progress fill
  progress: ['#EE9A4C', '#D85C76'],
  progressDusk: ['#F4B25C', '#F1789A'],
  // The brand sunset mark / hero gradient
  sunset: ['#F4A65C', '#E76A4B', '#C9506A'],
  // Default generated book cover
  cover: ['#E0654A', '#7A3D5A'],
  coverDusk: ['#FF7A52', '#4B3F6B'],
};

export const Colors = {
  inkSlate: colors.inkSlate,
  inkPressed: colors.inkPressed,
  inkSlateDeep: colors.inkSlateDeep,
  coverSlate: colors.coverSlate,
  iconSlate: colors.coverSlate,
  text: colors.text,
  textSecondary: colors.textSecondary,
  textMuted: colors.textMuted,
  textTertiary: colors.textTertiary,
  textSubtle: colors.textSubtle,
  bgPage: colors.bgPage,
  surface: colors.surface,
  surfaceCard: colors.surfaceCard,
  surfaceMuted: colors.surfaceMuted,
  surfaceAssist: colors.surfaceAssist,
  surfaceGlass: colors.surfaceGlass,
  surfaceGlassBorder: colors.surfaceGlassBorder,
  coverMid: colors.coverMid,
  divider: colors.divider,
  border: colors.border,
  borderStrong: colors.borderStrong,
  frame: colors.frame,
  dotInactive: colors.dotInactive,
  destructive: colors.destructive,
  glyphCream: colors.glyphCream,
  accent: colors.accent,
  accent2: colors.accent2,
  accent3: colors.accent3,
  accentSoft: colors.accentSoft,
  accentMuted: colors.accentMuted,
};

export const Spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xl2: 14,
  xl3: 16,
  xl4: 18,
  xl5: 22,
  xl6: 24,
  xl7: 26,
  xl8: 28,
  screenHorizontal: insets.screenHorizontal,
  screenHorizontalDense: 20,
  cardPadding: 16,
  cardPaddingLarge: 18,
  cardPaddingCompact: 12,
  sectionGap: 24,
  flashcardPadding: 32,
};

export const Radii = {
  frame: 34,
  sheet: radii.xl,       // 28 — large bottom sheets
  flashcard: radii.lg,   // 20 — glass cards
  ocrBanner: radii.sm,   // 11
  card: radii.lg,        // 20 — default glass card radius
  input: radii.sm,       // 11 — inputs
  cover: 13,             // book cover rounded corners
  pill: radii.pill,
  badge: radii.xs,       // 8 — chips/badges
};

export const Shadows = {
  sheet: elevation.sheet,
  fab: elevation.fab,
  coverLift: elevation.coverLift,
  glass: elevation.glass,
  card: elevation.card,
};

export const Layout = {
  tabBarHeight: layout.tabBarHeight,
  tabBarBorderWidth: layout.tabBarBorderWidth,
  tabBarBorderColor: colors.border,
  tabActiveUnderlineHeight: layout.tabActiveUnderlineHeight,
  tabActiveUnderlineColor: layout.tabActiveUnderlineColor,
  appBarHeight: layout.appBarHeight,
  readerHeaderHeight: layout.readerHeaderHeight,
  fabSize: layout.fabSize,
  bookCoverAspectRatio: layout.bookCoverAspectRatio,
  bookPreviewCoverWidth: layout.bookPreviewCoverWidth,
  bookPreviewCoverHeight: layout.bookPreviewCoverHeight,
  bookGridCoverSpineWidth: layout.bookGridCoverSpineWidth,
  progressTrackHeight: layout.progressTrackHeight,
  progressTrackColor: layout.progressTrackColor,
  progressFillColor: layout.progressFillColor,
  lookupButtonHeight: layout.lookupButtonHeight,
  lookupButtonHeightCompact: layout.lookupButtonHeightCompact,
};

export const Motion = {
  sheetOpenDuration: 275,
  sheetDismissDuration: 225,
  tabTransitionDuration: 200,
  caretBlinkDuration: 1100,
  copiedRevertDelay: 1500,
  autosaveDebounceDuration: 800,
  pressedOpacity: 0.82,
  disabledOpacity: 0.5,
};

export const IconDefaults = {
  fill: 0,
  weight: 300,
  grade: 0,
  opticalSize: 24,
  size: 24,
  color: colors.textSecondary,
  fillActive: 1,
  colorActive: colors.accent,  // coral — active icon state
};

export const TextStyles = {
  screenHeadingSerif: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 30,
    color: colors.text,
  },
  screenHeadingSans: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 28,
    letterSpacing: -0.56,
    color: colors.text,
  },
  appBarTitle: textStyles.appTitle,
  screenBarTitle: textStyles.screenBarTitle,
  eyebrow: textStyles.eyebrow,
  bodyUISmall: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  bodyUI: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  bodyUILarge: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textMuted,
  },
  labelSmall: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  labelBold: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  romanization: textStyles.romanization,
  koreanTitle: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 16,
    color: colors.text,
  },
  koreanCurrentReading: {
    fontFamily: fontFamilies.krSerifSemiBold,
    fontSize: 19,
    color: colors.text,
  },
};
