import { StyleSheet } from 'react-native';
import { fontFamilies, radii } from '../../theme';

// Reader chrome styles shared by the book reader (screens/Read.js) and the
// song reader: header bar, focus controls, listen bar, lookup layer and the
// brightness overlay.
export const READER_HEADER_BUTTON_HEIGHT = 44;
// Space separating the focus (eye) and listen (headphones) buttons from the
// icons before them.
export const READER_HEADER_GROUP_GAP = 10;

export const createReaderChromeStyles = (themeColors) => StyleSheet.create({
    // ── Header ───────────────────────────────────────────────────────────────
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 6,
        paddingBottom: 8,
        backgroundColor: themeColors.readerPaper,
        borderBottomWidth: 1,
        borderBottomColor: themeColors.readerHairline,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerBackButton: {
        width: 42,
        height: READER_HEADER_BUTTON_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerIconButton: {
        width: 40,
        height: READER_HEADER_BUTTON_HEIGHT,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerIconButtonActive: {
        backgroundColor: themeColors.surfaceMuted,
    },
    headerGroupGap: {
        marginLeft: READER_HEADER_GROUP_GAP,
    },
    savedButton: {
        width: 40,
        height: READER_HEADER_BUTTON_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    savedBadge: {
        position: 'absolute',
        top: 6,
        right: 3,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.inkSlate,
        borderWidth: 2,
        borderColor: themeColors.readerPaper,
    },
    savedBadgeText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 10,
        lineHeight: 12,
        color: themeColors.readerPaper,
        includeFontPadding: false,
    },
    headerSpacer: {
        flex: 1,
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    progressCluster: {
        flex: 1,
        minWidth: 0,
        height: READER_HEADER_BUTTON_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        paddingLeft: 8,
        paddingRight: 4,
    },
    progressClusterPressed: {
        opacity: 0.6,
    },
    progressTrack: {
        width: 34,
        height: 3,
        borderRadius: 2,
        backgroundColor: themeColors.readerProgressTrack,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: themeColors.readerProgressFill,
    },
    progressLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.textSecondary,
        minWidth: 30,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    settingsButton: {
        width: 42,
        height: READER_HEADER_BUTTON_HEIGHT,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
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
        left: 16,
        zIndex: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    focusPositionPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: `${themeColors.readerPaper}EB`,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: radii.pill,
    },
    focusPositionLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.textMuted,
        fontVariant: ['tabular-nums'],
    },
    focusArrowControls: {
        position: 'absolute',
        right: 18,
        zIndex: 12,
        flexDirection: 'column',
        gap: 10,
    },
    focusArrowButtonPrev: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: themeColors.readerSurface,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.10)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 12,
        elevation: 3,
    },
    focusArrowButtonNext: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: themeColors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.18)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 5,
    },
    focusStepperDisabled: {
        opacity: 0.35,
    },

    // ── Listen bar (consumed by ListenBar) ───────────────────────────────────
    listenBarWrap: {
        position: 'absolute',
        left: 14,
        right: 14,
        zIndex: 12,
    },
    listenBar: {
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        borderRadius: 32,
        backgroundColor: themeColors.readerSurface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: themeColors.readerBorder,
        shadowColor: 'rgba(27, 28, 28, 0.14)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 8,
    },
    listenButton: {
        width: 40,
        height: 44,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listenPlayButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: themeColors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listenDivider: {
        width: 1,
        height: 26,
        marginHorizontal: 6,
        backgroundColor: themeColors.readerHairline,
    },
    listenSpeedChip: {
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        marginRight: 4,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        backgroundColor: themeColors.readerSurface,
    },
    listenSpeedLabel: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.readerBodyInk,
        fontVariant: ['tabular-nums'],
    },
    listenToggle: {
        width: 36,
        height: 36,
        marginHorizontal: 2,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        backgroundColor: themeColors.readerSurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listenToggleActive: {
        backgroundColor: themeColors.inkSlate,
        borderColor: themeColors.inkSlate,
    },
    listenSpacer: {
        flex: 1,
    },
    listenCloseButton: {
        width: 40,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default createReaderChromeStyles;
