import {
  colorLuminance,
  contrastRatio,
  getBookOpeningColors,
} from '../bookCoverColors';

const DARK_INK = '#11151c';
const LIGHT_INK = '#ffffff';

describe('colorLuminance / contrastRatio', () => {
  test('black on white is 21:1, a colour on itself 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3a6ea5', '#3a6ea5')).toBeCloseTo(1, 5);
  });

  test('order does not matter', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(contrastRatio('#fedcba', '#123456'), 10);
  });

  test('anything unreadable counts as black', () => {
    expect(colorLuminance('not a colour')).toBe(0);
    expect(colorLuminance(null)).toBe(0);
  });
});

describe('getBookOpeningColors', () => {
  test('no colour, no colours', () => {
    expect(getBookOpeningColors(null)).toBeNull();
    expect(getBookOpeningColors('teal')).toBeNull();
  });

  test('a light cover keeps its colour, with dark ink', () => {
    const result = getBookOpeningColors('#f2e6c9');
    expect(result).toEqual({ background: '#f2e6c9', ink: DARK_INK, inkIsDark: true });
  });

  test('a dark cover keeps its colour, with light ink', () => {
    const result = getBookOpeningColors('#1f3a5f');
    expect(result).toEqual({ background: '#1f3a5f', ink: LIGHT_INK, inkIsDark: false });
  });

  test('short colours are read in full', () => {
    expect(getBookOpeningColors('#fff').background).toBe('#ffffff');
  });

  // Mid-tones are where neither ink reaches 4.5:1 at first.
  test.each(['#777777', '#808080', '#c0392b', '#2e8b57', '#4a90d9', '#9b59b6', '#e67e22'])(
    'the tips stay readable on %s',
    (main) => {
      const { background, ink } = getBookOpeningColors(main);
      expect(contrastRatio(background, ink)).toBeGreaterThanOrEqual(4.5);
    }
  );

  // #777777 reads at 4.07:1 with the dark ink and 4.49:1 with white.
  test('a mid-tone moves only as far as it needs to', () => {
    const { background } = getBookOpeningColors('#777777');
    expect(background).not.toBe('#777777');
    // Still recognisably grey, not pushed to black or white.
    expect(colorLuminance(background)).toBeGreaterThan(0.05);
    expect(colorLuminance(background)).toBeLessThan(0.6);
  });

  test('dark mode dims the colour, so the screen does not light up the room', () => {
    const light = getBookOpeningColors('#f2e6c9');
    const dark = getBookOpeningColors('#f2e6c9', { isDarkMode: true });
    expect(colorLuminance(dark.background)).toBeLessThan(colorLuminance(light.background));
    expect(contrastRatio(dark.background, dark.ink)).toBeGreaterThanOrEqual(4.5);
  });
});
