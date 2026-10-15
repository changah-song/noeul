import { StyleSheet } from 'react-native';
import { radii } from '../../theme';

// Reader chrome styles (header bar, focus controls, lookup layer, brightness
// overlay). Values are copied from screens/Read.js
// createStyles so the song reader renders identically; Read.js still owns its
// own copy and can switch to this module later.
export const createReaderChromeStyles = (themeColors) => StyleSheet.create({
    // ── Header ───────────────────────────────────────────────────────────────
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: themeColors.readerPaper,
        borderBottomWidth: 1,
        borderBottomColor: themeColors.readerHairline,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    headerIconButton: {
        width: 30,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
    },
    savedButton: {
        width: 34,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
    },
    savedBadge: {
        position: 'absolute',
        top: 3,
        right: -1,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        paddingHorizontal: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.inkSlate,
        borderWidth: 1.5,
        borderColor: themeColors.readerPaper,
    },
    savedBadgeText: {
        fontFamily: 'FFSans-Bold',
        fontSize: 10,
        lineHeight: 12,
        color: themeColors.readerPaper,
    },
    headerSpacer: {
        flex: 1,
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    settingsButton: {
        width: 20,
        height: 42,
        borderRadius: 0,
        backgroundColor: themeColors.transparent,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // ── Reading surface ──────────────────────────────────────────────────────
    reader: {
        flex: 1,
        position: 'relative',
    },
    nativeReaderView: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    readerBrightnessOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000000',
    },
    lookupLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
    lookupLayerTop: {
        justifyContent: 'flex-start',
    },
    lookupLayerBottom: {
        justifyContent: 'flex-end',
    },

    // ── Focus controls (consumed by FocusControls) ───────────────────────────
    focusControlsLeft: {
        position: 'absolute',
        left: 22,
        zIndex: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    focusPositionPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: `${themeColors.readerPaper}EB`,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radii.pill,
    },
    focusPositionLabel: {
        fontFamily: 'FFSans-SemiBold',
        fontSize: 10,
        lineHeight: 14,
        letterSpacing: 1.4,
        color: themeColors.readerSubtleInk,
    },
    focusArrowControls: {
        position: 'absolute',
        right: 16,
        zIndex: 12,
        flexDirection: 'column',
        gap: 9,
    },
    focusArrowButtonPrev: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: themeColors.readerSurface,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.12)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 4,
    },
    focusArrowButtonNext: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: themeColors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.20)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 5,
    },
    focusStepperDisabled: {
        opacity: 0.35,
    },
});

export default createReaderChromeStyles;
