import { useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

// Android draws the app edge to edge, under the system navigation bar. The
// gesture bar is a thin strip (about 16–24dp) that taps pass through, so
// floating controls can sit over it. The button bar (three buttons, or the
// older two) is 48dp and its buttons take the taps, so anything that must be
// tappable has to sit above it. An inset this tall or taller is buttons.
export const BUTTON_NAV_MIN_INSET = 36;

// The room to leave at the bottom for the navigation buttons: the bar's
// height with button navigation, 0 with gesture navigation.
export const navigationButtonsInset = (bottomInset) => (
    Number.isFinite(bottomInset) && bottomInset >= BUTTON_NAV_MIN_INSET ? bottomInset : 0
);

// Reads the context directly rather than useSafeAreaInsets(), which throws
// without a provider: a null context (e.g. in tests) means no insets.
export const useNavigationButtonsInset = () => (
    navigationButtonsInset(useContext(SafeAreaInsetsContext)?.bottom ?? 0)
);

export default useNavigationButtonsInset;
