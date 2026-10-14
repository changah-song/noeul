// Pure reader-settings helpers shared by the native reading surfaces (the
// song reader today; screens/Read.js still carries its own copies of the
// constants below and can switch to these later — the values match).

export const READER_FONT_SIZE_MIN = 12;
export const READER_FONT_SIZE_MAX = 30;
export const READER_FOCUS_SPAN_MIN = 1;
export const READER_FOCUS_SPAN_MAX = 5;
export const READER_BRIGHTNESS_MIN = 0.2;
export const READER_BRIGHTNESS_MAX = 1;
export const READER_READING_MODES = ['paged', 'scroll'];
// 'off' hides the level marks; the ability model keeps learning either way.
export const READER_LEVEL_MARK_STYLES = ['off', 'underline'];
export const READER_LEVEL_MARK_OPTIONS = [
    { value: 'off', icon: 'visibility-off', labelKey: 'read.markOff' },
    { value: 'underline', icon: 'format-underlined', labelKey: 'read.markUnderline' },
];

export const READER_LINE_SPACING_STEPS = [
    { value: 1.4, labelKey: 'read.lineSpacingCompact' },
    { value: 1.65, labelKey: 'read.lineSpacingRegular' },
    { value: 1.85, labelKey: 'read.lineSpacingOpen' },
    { value: 2.05, labelKey: 'read.lineSpacingRelaxed' },
    { value: 2.3, labelKey: 'read.lineSpacingAiry' },
    { value: 2.6, labelKey: 'read.lineSpacingWide' },
];

// Same defaults as the book reader (Read.js DEFAULT_READER_SETTINGS), minus the
// theme, which the song reader takes from the app-wide setting.
export const DEFAULT_BOOK_READER_SETTINGS = {
    fontSize: 18,
    lineSpacing: 2.05,
    brightness: 0.62,
    focusSpan: 1,
    focusSwipe: false,
    readingMode: 'paged',
    levelMarkStyle: 'underline',
    pinyinAnnotations: false,
};

// Lyrics are short centered lines, so they read better a little larger and
// tighter than book prose, and they scroll by default.
export const DEFAULT_SONG_READER_SETTINGS = {
    ...DEFAULT_BOOK_READER_SETTINGS,
    fontSize: 22,
    lineSpacing: 1.85,
    readingMode: 'scroll',
};

export const clampNumber = (value, min, max, fallback = min) => {
    const numeric = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(Math.max(numeric, min), max);
};

export const nearestLineSpacingIndex = (value, fallbackValue = DEFAULT_BOOK_READER_SETTINGS.lineSpacing) => {
    const target = Number.isFinite(Number(value)) && value !== null ? Number(value) : fallbackValue;
    return READER_LINE_SPACING_STEPS.reduce((closestIndex, step, index) => {
        const closestDelta = Math.abs(READER_LINE_SPACING_STEPS[closestIndex].value - target);
        const currentDelta = Math.abs(step.value - target);
        return currentDelta < closestDelta ? index : closestIndex;
    }, 0);
};

/**
 * normalizeReaderSettings — coerce a stored (possibly stale, partial, or
 * hand-edited) settings object into valid, clamped values.
 */
export const normalizeReaderSettings = (settings, defaults = DEFAULT_BOOK_READER_SETTINGS) => {
    const source = settings && typeof settings === 'object' ? settings : {};
    return {
        fontSize: Math.round(clampNumber(
            source.fontSize,
            READER_FONT_SIZE_MIN,
            READER_FONT_SIZE_MAX,
            defaults.fontSize
        )),
        lineSpacing: clampNumber(
            source.lineSpacing,
            READER_LINE_SPACING_STEPS[0].value,
            READER_LINE_SPACING_STEPS[READER_LINE_SPACING_STEPS.length - 1].value,
            defaults.lineSpacing
        ),
        brightness: clampNumber(
            source.brightness,
            READER_BRIGHTNESS_MIN,
            READER_BRIGHTNESS_MAX,
            defaults.brightness
        ),
        focusSpan: Math.round(clampNumber(
            source.focusSpan,
            READER_FOCUS_SPAN_MIN,
            READER_FOCUS_SPAN_MAX,
            defaults.focusSpan
        )),
        focusSwipe: typeof source.focusSwipe === 'boolean' ? source.focusSwipe : defaults.focusSwipe,
        readingMode: READER_READING_MODES.includes(source.readingMode)
            ? source.readingMode
            : defaults.readingMode,
        levelMarkStyle: READER_LEVEL_MARK_STYLES.includes(source.levelMarkStyle)
            ? source.levelMarkStyle
            : defaults.levelMarkStyle,
        pinyinAnnotations: typeof source.pinyinAnnotations === 'boolean'
            ? source.pinyinAnnotations
            : defaults.pinyinAnnotations,
    };
};

export const stepFontSize = (fontSize, direction) => Math.round(clampNumber(
    Number(fontSize) + direction,
    READER_FONT_SIZE_MIN,
    READER_FONT_SIZE_MAX,
    DEFAULT_BOOK_READER_SETTINGS.fontSize
));

export const stepLineSpacing = (lineSpacing, direction) => {
    const index = nearestLineSpacingIndex(lineSpacing);
    const nextIndex = Math.min(Math.max(index + direction, 0), READER_LINE_SPACING_STEPS.length - 1);
    return READER_LINE_SPACING_STEPS[nextIndex].value;
};

export const stepFocusSpan = (focusSpan, direction) => Math.round(clampNumber(
    Number(focusSpan) + direction,
    READER_FOCUS_SPAN_MIN,
    READER_FOCUS_SPAN_MAX,
    DEFAULT_BOOK_READER_SETTINGS.focusSpan
));

/**
 * brightnessOverlay — the reader dims/brightens the page with a translucent
 * overlay rather than touching the system brightness. Below the neutral point
 * it fades in black (up to 28%); above it, a faint white wash (up to 8%).
 * Mirrors Read.js.
 */
export const brightnessOverlay = (brightness, neutral = DEFAULT_BOOK_READER_SETTINGS.brightness) => {
    const value = clampNumber(brightness, READER_BRIGHTNESS_MIN, READER_BRIGHTNESS_MAX, neutral);
    const delta = value - neutral;
    if (delta < 0) {
        return {
            color: '#000000',
            opacity: Math.min(0.28, (Math.abs(delta) / (neutral - READER_BRIGHTNESS_MIN)) * 0.28),
        };
    }
    return {
        color: '#ffffff',
        opacity: Math.min(0.08, (delta / (READER_BRIGHTNESS_MAX - neutral)) * 0.08),
    };
};

// ─── Level-underline legend ──────────────────────────────────────────────────

// Number of segments in the legend gradient bar. Enough to read as continuous.
export const LEGEND_GRADIENT_STEPS = 12;

// Parse "#rrggbb" → [r, g, b]; tolerant of a missing/short value (→ null so the
// caller can skip a broken stop rather than render black).
const parseHexColor = (hex) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex.trim() : '');
    if (!match) {
        return null;
    }
    const int = parseInt(match[1], 16);
    return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
};

const rgbToHex = ([r, g, b]) => `#${[r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')}`;

const lerpRgb = (from, to, t) => from.map((c, i) => c + (to[i] - c) * t);

// Interpolate easy → mid → hard into LEGEND_GRADIENT_STEPS colors (mid at the
// centre), mirroring EpubPageView.applyLevelUnderlineShade so the legend and the
// page agree. Falls back to the raw stops if any hex fails to parse.
export const buildLegendGradient = (easyHex, midHex, hardHex) => {
    const easy = parseHexColor(easyHex);
    const mid = parseHexColor(midHex);
    const hard = parseHexColor(hardHex);
    if (!easy || !mid || !hard) {
        return [easyHex, midHex, hardHex].filter(Boolean);
    }
    return Array.from({ length: LEGEND_GRADIENT_STEPS }, (_, i) => {
        const t = i / (LEGEND_GRADIENT_STEPS - 1);
        const rgb = t <= 0.5 ? lerpRgb(easy, mid, t / 0.5) : lerpRgb(mid, hard, (t - 0.5) / 0.5);
        return rgbToHex(rgb);
    });
};
