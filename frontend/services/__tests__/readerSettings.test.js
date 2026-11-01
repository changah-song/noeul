import {
  DEFAULT_BOOK_READER_SETTINGS,
  DEFAULT_SONG_READER_SETTINGS,
  LEGEND_GRADIENT_STEPS,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_LINE_SPACING_STEPS,
  brightnessOverlay,
  buildLegendGradient,
  clampNumber,
  nearestLineSpacingIndex,
  normalizeReaderSettings,
  stepFocusSpan,
  stepFontSize,
  stepLineSpacing,
} from '../readerSettings';
import { UI_TRANSLATIONS } from '../../i18n/translations';

describe('clampNumber', () => {
  it('clamps and falls back on non-numbers', () => {
    expect(clampNumber(50, 0, 10)).toBe(10);
    expect(clampNumber(-5, 0, 10)).toBe(0);
    expect(clampNumber('7', 0, 10)).toBe(7);
    expect(clampNumber('abc', 0, 10, 4)).toBe(4);
    expect(clampNumber(undefined, 0, 10, 4)).toBe(4);
    expect(clampNumber(null, 0, 10, 4)).toBe(4);
  });
});

describe('normalizeReaderSettings', () => {
  it('returns the defaults for missing or junk input', () => {
    expect(normalizeReaderSettings(null, DEFAULT_SONG_READER_SETTINGS)).toEqual(DEFAULT_SONG_READER_SETTINGS);
    expect(normalizeReaderSettings('garbage')).toEqual(DEFAULT_BOOK_READER_SETTINGS);
  });

  it('clamps out-of-range values and rejects unknown enums', () => {
    const normalized = normalizeReaderSettings({
      fontSize: 99,
      lineSpacing: 0.5,
      brightness: 4,
      focusSpan: 0,
      focusSwipe: 'yes',
      readingMode: 'sideways',
      levelMarkStyle: 'sparkles',
      pinyinAnnotations: true,
    }, DEFAULT_SONG_READER_SETTINGS);

    expect(normalized).toEqual({
      fontSize: READER_FONT_SIZE_MAX,
      lineSpacing: READER_LINE_SPACING_STEPS[0].value,
      brightness: 1,
      focusSpan: 1,
      focusSwipe: DEFAULT_SONG_READER_SETTINGS.focusSwipe,
      readingMode: DEFAULT_SONG_READER_SETTINGS.readingMode,
      levelMarkStyle: DEFAULT_SONG_READER_SETTINGS.levelMarkStyle,
      pinyinAnnotations: true,
    });
  });

  it('song defaults scroll and keep level underlines on', () => {
    expect(DEFAULT_SONG_READER_SETTINGS.readingMode).toBe('scroll');
    expect(DEFAULT_SONG_READER_SETTINGS.levelMarkStyle).toBe('underline');
  });
});

describe('steppers', () => {
  it('steps font size within bounds', () => {
    expect(stepFontSize(18, 1)).toBe(19);
    expect(stepFontSize(READER_FONT_SIZE_MAX, 1)).toBe(READER_FONT_SIZE_MAX);
    expect(stepFontSize(READER_FONT_SIZE_MIN, -1)).toBe(READER_FONT_SIZE_MIN);
  });

  it('steps line spacing between the stops', () => {
    expect(stepLineSpacing(1.65, 1)).toBe(1.85);
    expect(stepLineSpacing(1.7, -1)).toBe(1.5); // snaps 1.7 → 1.65 first
    expect(stepLineSpacing(2.6, 1)).toBe(2.6);
    expect(stepLineSpacing(1.2, -1)).toBe(1.2);
    expect(nearestLineSpacingIndex(undefined)).toBe(
      READER_LINE_SPACING_STEPS.findIndex((step) => step.value === DEFAULT_BOOK_READER_SETTINGS.lineSpacing)
    );
  });

  it('steps focus span within 1..5', () => {
    expect(stepFocusSpan(1, -1)).toBe(1);
    expect(stepFocusSpan(2, 1)).toBe(3);
    expect(stepFocusSpan(5, 1)).toBe(5);
  });

  it('steps line spacing one stop at a time, within the range', () => {
    const values = READER_LINE_SPACING_STEPS.map((step) => step.value);
    expect(stepLineSpacing(2.05, -1)).toBe(1.85);
    expect(stepLineSpacing(1.5, -1)).toBe(1.4);
    expect(stepLineSpacing(values[0], -1)).toBe(values[0]);
    expect(stepLineSpacing(values[values.length - 1], 1)).toBe(values[values.length - 1]);
  });

  it('has translated labels for the line-spacing stepper', () => {
    Object.values(UI_TRANSLATIONS).forEach((table) => {
      ['read.decreaseLineSpacing', 'read.increaseLineSpacing'].forEach((key) => {
        expect(typeof table[key]).toBe('string');
        expect(table[key].length).toBeGreaterThan(0);
      });
    });
  });
});

describe('brightnessOverlay', () => {
  it('is invisible at the neutral point', () => {
    expect(brightnessOverlay(DEFAULT_BOOK_READER_SETTINGS.brightness).opacity).toBe(0);
  });

  it('darkens below neutral (max 0.28) and brightens above (max 0.08)', () => {
    const dim = brightnessOverlay(0.2);
    expect(dim.color).toBe('#000000');
    expect(dim.opacity).toBeCloseTo(0.28);

    const bright = brightnessOverlay(1);
    expect(bright.color).toBe('#ffffff');
    expect(bright.opacity).toBeCloseTo(0.08);
  });
});

describe('buildLegendGradient', () => {
  it('interpolates easy → mid → hard', () => {
    const colors = buildLegendGradient('#00ff00', '#ffff00', '#ff0000');
    expect(colors).toHaveLength(LEGEND_GRADIENT_STEPS);
    expect(colors[0]).toBe('#00ff00');
    expect(colors[colors.length - 1]).toBe('#ff0000');
  });

  it('falls back to the raw stops when a color does not parse', () => {
    expect(buildLegendGradient('#00ff00', 'amber', '#ff0000')).toEqual(['#00ff00', 'amber', '#ff0000']);
  });
});
