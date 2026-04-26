export const colors = {
  backgroundWarm: '#f5f4f0',
  backgroundCool: '#f2f4f6',
  surface: '#fcfbf7',
  surfaceMuted: '#f0ece4',
  surfaceElevated: '#ffffff',
  surfaceStrong: '#e7dfd1',
  border: '#ddd5c8',
  text: '#211c17',
  textMuted: '#6f675d',
  textSubtle: '#978e81',
  accent: '#c87d00',
  accentStrong: '#a66700',
  accentSoft: 'rgba(200, 125, 0, 0.14)',
  success: '#2f7d4c',
  warning: '#b57618',
  danger: '#b64f44',
  shadow: 'rgba(41, 28, 14, 0.08)',
  overlay: 'rgba(28, 24, 19, 0.32)',
  white: '#ffffff',
  black: '#000000',
};

export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
};

export const elevation = {
  card: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  subtle: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 2,
  },
};

export const layout = {
  screenMaxWidth: 560,
  headerHeight: 72,
  tabBarHeight: 72,
};

const theme = {
  colors,
  radii,
  elevation,
  layout,
};

export default theme;
