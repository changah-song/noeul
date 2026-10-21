// Right-to-left layout for Arabic (and any later RTL language).
//
// React Native mirrors the whole layout (rows, margins, absolute positions,
// text alignment) when I18nManager says RTL. That flag is read once when the
// app starts, so switching direction means setting it and reloading the app.
// Icons that point somewhere (chevrons, arrows) are not mirrored for us; use
// rtlIcon() for those.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';

const RTL_LANGUAGES = new Set(['ar']);

// Guards against a reload loop if the platform ever ignores forceRTL.
const RELOAD_GUARD_KEY = '@noeul/layout-direction-reload';
const RELOAD_GUARD_MS = 60 * 1000;

export const isRtlLanguage = (language) => (
  RTL_LANGUAGES.has(String(language || '').trim().toLowerCase().split(/[-_]/)[0])
);

export const isLayoutRtl = () => Boolean(I18nManager.isRTL);

const MIRRORED_ICONS = {
  'chevron-left': 'chevron-right',
  'chevron-right': 'chevron-left',
  'arrow-left': 'arrow-right',
  'arrow-right': 'arrow-left',
};

// A row whose children must stay in left-to-right order even in an RTL layout
// (Korean/Chinese text built from pieces). Android ignores the `direction`
// style, so flip the row instead: in RTL, row-reverse runs left to right.
export const ltrRow = () => (isLayoutRtl() ? 'row-reverse' : 'row');

/**
 * The `left` style for a child measured with onLayout. Layout x is always
 * measured from the parent's left edge, but in RTL a `left` style counts from
 * the right, so convert it. Before the parent is measured, returns x as is.
 */
export const startOffset = (x, width, containerWidth) => (
  isLayoutRtl() && containerWidth > 0 ? containerWidth - x - width : x
);

/** The icon to draw for a direction: in RTL, "back" points right. */
export const rtlIcon = (name) => (isLayoutRtl() ? MIRRORED_ICONS[name] ?? name : name);

/**
 * Make the layout direction match the interface language. Returns true when
 * the app is reloading to apply it.
 */
export const applyLayoutDirection = async (language, { reload } = {}) => {
  const wantRtl = isRtlLanguage(language);
  try {
    I18nManager.allowRTL(wantRtl);
    I18nManager.forceRTL(wantRtl);
  } catch (error) {
    console.warn('[layoutDirection] failed to set direction:', error?.message ?? error);
    return false;
  }
  if (isLayoutRtl() === wantRtl) {
    return false;
  }

  try {
    const raw = await AsyncStorage.getItem(RELOAD_GUARD_KEY);
    const last = raw ? JSON.parse(raw) : null;
    if (last && last.rtl === wantRtl && Date.now() - last.at < RELOAD_GUARD_MS) {
      return false;
    }
    await AsyncStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ rtl: wantRtl, at: Date.now() }));
  } catch {
    // Without the guard, still try once.
  }

  try {
    const reloadApp = reload ?? require('expo').reloadAppAsync;
    await reloadApp('Layout direction changed');
    return true;
  } catch (error) {
    console.warn('[layoutDirection] failed to reload:', error?.message ?? error);
    return false;
  }
};
