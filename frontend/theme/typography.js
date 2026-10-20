import { Platform } from 'react-native';
import { colors } from './tokens';

export const fontFamilies = {
  sans: 'FFSans-Regular',
  sansRegular: 'FFSans-Regular',
  sansMedium: 'FFSans-Medium',
  sansSemiBold: 'FFSans-SemiBold',
  sansBold: 'FFSans-Bold',
  display: 'FFDisplay-Regular',
  displayRegular: 'FFDisplay-Regular',
  displayMedium: 'FFDisplay-Medium',
  displayItalic: 'FFDisplay-Italic',
  displayMediumItalic: 'FFDisplay-MediumItalic',
  displaySemiBold: 'FFDisplay-SemiBold',
  displayBold: 'FFDisplay-Bold',
  serifRegular: 'FFDisplay-Regular',
  serifMedium: 'FFDisplay-Medium',
  serifBold: 'FFDisplay-Bold',
  krSerifRegular: 'FFSerif-Regular',
  krSerifMedium: 'FFSerif-Medium',
  krSerifSemiBold: 'FFSerif-SemiBold',
  krSerifBold: 'FFSerif-Bold',
};

export const typeScale = {
  hero: 28,
  title: 24,
  section: 19,
  bodyLg: 17,
  body: 14,
  bodySm: 13,
  caption: 11,
  micro: 10,
};

export const lineHeights = {
  hero: 34,
  title: 30,
  section: 24,
  bodyLg: 24,
  body: 20,
  bodySm: 18,
  caption: 15,
  micro: 13,
};

const tracking = Platform.select({
  ios: 0.1,
  android: 0.15,
  default: 0.1,
});

export const textStyles = {
  hero: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: typeScale.hero,
    lineHeight: lineHeights.hero,
    get color() { return colors.text; },
    letterSpacing: -0.56,
  },
  title: {
    fontFamily: fontFamilies.serifMedium,
    fontSize: typeScale.title,
    lineHeight: lineHeights.title,
    get color() { return colors.text; },
  },
  sectionTitle: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: typeScale.section,
    lineHeight: lineHeights.section,
    get color() { return colors.text; },
    letterSpacing: 0,
  },
  body: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.body,
    lineHeight: lineHeights.body,
    get color() { return colors.text; },
  },
  bodyMuted: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.body,
    lineHeight: lineHeights.body,
    get color() { return colors.textMuted; },
  },
  label: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    get color() { return colors.textTertiary; },
  },
  caption: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: typeScale.caption,
    lineHeight: lineHeights.caption,
    get color() { return colors.textSubtle; },
    letterSpacing: 0.2,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 13,
    lineHeight: 18,
    get color() { return colors.textTertiary; },
  },
  appTitle: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    get color() { return colors.text; },
    letterSpacing: -0.2,
  },
  screenBarTitle: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 16,
    lineHeight: 21,
    get color() { return colors.text; },
  },
  tabLabel: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 14,
    lineHeight: 19,
    get color() { return colors.textTertiary; },
  },
  buttonLabel: {
    fontFamily: fontFamilies.sansSemiBold,
    fontSize: 15,
    lineHeight: 20,
    get color() { return colors.white; },
  },
  romanization: {
    fontFamily: fontFamilies.displayItalic,
    fontSize: 13,
    lineHeight: 18,
    get color() { return colors.textTertiary; },
  },
};

export default {
  fontFamilies,
  typeScale,
  lineHeights,
  textStyles,
};
