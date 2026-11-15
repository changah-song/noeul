import { Platform } from 'react-native';

// The soft shadow that lifts a reader panel (translation, definition, AI
// explanation) off the page. `falls` is the way the shadow drops: 'down' for
// a panel hanging from the top, 'up' for a sheet rising from the bottom.
// Android draws its shadow from `elevation` and fades it by the colour's
// alpha, so it gets a solid colour there; iOS uses the tinted one as is.
export const panelLift = (colors, falls = 'down') => ({
    shadowColor: Platform.OS === 'android' ? '#000000' : colors.panelShadow,
    shadowOffset: { width: 0, height: falls === 'up' ? -6 : 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 8,
});
