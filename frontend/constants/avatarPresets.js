// Avatar presets — five gradient fields for the profile initial. The letter
// color is tuned per field (light cream on deep fields, warm ink on the pale
// one). 'sunset' is the brand default and follows the theme's accent pair;
// the rest are deliberately outside the sunset palette.
export const AVATAR_PRESETS = {
  sunset: {
    colors: ['#E0654A', '#D85C76'],
    colorsDusk: ['#FF7A52', '#F1789A'],
    letter: '#FFFFFF',
  },
  tide: {
    colors: ['#4CC3B8', '#4A5FC1'],
    letter: '#EFFDFB',
  },
  meadow: {
    colors: ['#A8D26B', '#3E8E5A'],
    letter: '#F4FBE9',
  },
  lilac: {
    colors: ['#C08BE0', '#7A4FA8'],
    letter: '#F8F0FF',
  },
  honey: {
    colors: ['#FFE29A', '#FFB27A'],
    letter: '#7A431D',
  },
};

export const AVATAR_PRESET_KEYS = Object.keys(AVATAR_PRESETS);

export const DEFAULT_AVATAR_PRESET = 'sunset';

export const getAvatarPreset = (key) => (
  AVATAR_PRESETS[key] ?? AVATAR_PRESETS[DEFAULT_AVATAR_PRESET]
);

export const getAvatarGradient = (preset, isDarkMode = false) => (
  (isDarkMode && preset.colorsDusk) ? preset.colorsDusk : preset.colors
);
