import { Platform } from 'react-native';
import { colors } from './tokens';

export const fontFamilies = {
  sansRegular: 'FFSans-Regular',
  sansMedium: 'FFSans-Medium',
  sansSemiBold: 'FFSans-SemiBold',
  sansBold: 'FFSans-Bold',
  displayRegular: 'FFDisplay-Regular',
  displayMedium: 'FFDisplay-Medium',
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
  hero: 30,
  title: 24,
  section: 20,
  bodyLg: 17,
  body: 15,
  bodySm: 13,
  caption: 12,
  micro: 11,
};

export const lineHeights = {
  hero: 38,
  title: 30,
  section: 26,
  bodyLg: 24,
  body: 22,
  bodySm: 18,
  caption: 16,
  micro: 14,
};

const tracking = Platform.select({
  ios: 0.1,
  android: 0.15,
  default: 0.1,
});

export const textStyles = {
  hero: {
    fontFamily: fontFamilies.serifBold,
    fontSize: typeScale.hero,
    lineHeight: lineHeights.hero,
    color: colors.text,
    letterSpacing: tracking,
  },
  title: {
    fontFamily: fontFamilies.serifMedium,
    fontSize: typeScale.title,
    lineHeight: lineHeights.title,
    color: colors.text,
  },
  sectionTitle: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.section,
    lineHeight: lineHeights.section,
    color: colors.text,
    letterSpacing: tracking,
  },
  body: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.body,
    lineHeight: lineHeights.body,
    color: colors.text,
  },
  bodyMuted: {
    fontFamily: fontFamilies.sansRegular,
    fontSize: typeScale.body,
    lineHeight: lineHeights.body,
    color: colors.textMuted,
  },
  label: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: typeScale.bodySm,
    lineHeight: lineHeights.bodySm,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  caption: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: typeScale.caption,
    lineHeight: lineHeights.caption,
    color: colors.textSubtle,
    letterSpacing: 0.2,
  },
  eyebrow: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typeScale.micro,
    lineHeight: lineHeights.micro,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
};

export default {
  fontFamilies,
  typeScale,
  lineHeights,
  textStyles,
};
