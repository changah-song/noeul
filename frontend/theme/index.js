import { colors, radii, elevation, layout, useTheme, createTheme, ThemeProvider, createNativeReaderThemeTokens } from './tokens';
import { spacing, insets } from './spacing';
import { fontFamilies, typeScale, lineHeights, textStyles } from './typography';

export { colors, radii, elevation, layout, useTheme, createTheme, ThemeProvider, createNativeReaderThemeTokens } from './tokens';
export { spacing, insets } from './spacing';
export { fontFamilies, typeScale, lineHeights, textStyles } from './typography';

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
  coverMid: colors.coverMid,
  divider: colors.divider,
  border: colors.border,
  borderStrong: colors.borderStrong,
  frame: colors.frame,
  dotInactive: colors.dotInactive,
  destructive: colors.destructive,
  glyphCream: colors.glyphCream,
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
  sheet: 16,
  flashcard: 10,
  ocrBanner: 10,
  card: radii.sm,
  input: radii.xs,
  cover: 2,
  pill: radii.pill,
  badge: 2,
};

export const Shadows = {
  sheet: elevation.sheet,
  fab: elevation.fab,
  coverLift: elevation.coverLift,
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
  colorActive: colors.inkSlate,
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
    lineHeight: 19,
    color: colors.textMuted,
  },
  bodyUI: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
  },
  bodyUILarge: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: 15,
    lineHeight: 25,
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
