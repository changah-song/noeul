import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import {
    BUTTON_NAV_MIN_INSET,
    navigationButtonsInset,
    useNavigationButtonsInset,
} from '../useNavigationButtonsInset';

// On Android the app draws under the system navigation bar, and the bottom
// safe-area inset is that bar's height. A gesture bar is thin (about 16–24dp)
// and taps pass through it; a three-button bar is 48dp and its buttons take
// the taps. So the bottom inset tells the two apart: buttons get the whole
// inset as extra room, gestures get 0 so the layout stays as it is.

describe('navigationButtonsInset', () => {
    it('gives no extra room for a gesture bar or no bar', () => {
        expect(navigationButtonsInset(0)).toBe(0);
        expect(navigationButtonsInset(16)).toBe(0);
        expect(navigationButtonsInset(24)).toBe(0);
    });

    it('gives the whole inset for a button bar', () => {
        expect(navigationButtonsInset(48)).toBe(48);
        expect(navigationButtonsInset(56)).toBe(56);
    });

    it('counts an inset right at the threshold as buttons', () => {
        expect(navigationButtonsInset(BUTTON_NAV_MIN_INSET)).toBe(BUTTON_NAV_MIN_INSET);
        expect(navigationButtonsInset(BUTTON_NAV_MIN_INSET - 0.5)).toBe(0);
    });

    it('treats a missing or broken inset as no bar', () => {
        expect(navigationButtonsInset(undefined)).toBe(0);
        expect(navigationButtonsInset(null)).toBe(0);
        expect(navigationButtonsInset(NaN)).toBe(0);
    });
});

describe('useNavigationButtonsInset', () => {
    // Renders a component that calls the hook and returns what it saw.
    const readHook = (insets) => {
        let seen;
        const Probe = () => {
            seen = useNavigationButtonsInset();
            return null;
        };
        act(() => {
            renderer.create(
                insets === undefined
                    ? <Probe />
                    : (
                        <SafeAreaInsetsContext.Provider value={insets}>
                            <Probe />
                        </SafeAreaInsetsContext.Provider>
                    ),
            );
        });
        return seen;
    };

    it('reads the bottom inset from the safe-area provider', () => {
        expect(readHook({ top: 24, right: 0, bottom: 48, left: 0 })).toBe(48);
        expect(readHook({ top: 24, right: 0, bottom: 20, left: 0 })).toBe(0);
    });

    it('returns 0 instead of throwing when there is no provider', () => {
        expect(readHook(undefined)).toBe(0);
    });
});
