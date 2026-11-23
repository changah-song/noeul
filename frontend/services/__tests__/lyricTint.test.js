import { buildLevelLookup, lerpColor, levelBandColor, tintWord } from '../lyricTint';

const colors = { easy: '#00aa00', mid: '#0000aa', hard: '#aa0000', ink: '#000000' };

describe('lyricTint', () => {
  it('picks the level colour by weight', () => {
    expect(levelBandColor(0.1, colors)).toBe('#00aa00');
    expect(levelBandColor(0.5, colors)).toBe('#0000aa');
    expect(levelBandColor(0.9, colors)).toBe('#aa0000');
    expect(levelBandColor(undefined, colors)).toBe('#aa0000');
  });

  it('colours only the part of the word the term covers', () => {
    const lookup = buildLevelLookup([{ text: '그리움', weight: 0.9 }, { text: '그', weight: 0.1 }]);
    expect(tintWord('그리움이', lookup, colors, new Set())).toEqual([
      { text: '그리움', color: '#aa0000' },
      { text: '이' },
    ]);
    expect(tintWord('사랑', lookup, colors, new Set())).toEqual([{ text: '사랑' }]);
  });

  it('settles a looked-up word most of the way back to the ink', () => {
    const lookup = buildLevelLookup([{ text: 'Longing', weight: 0.9 }]);
    const [piece] = tintWord('longing,', lookup, colors, new Set(['longing']));
    expect(piece.color).toBe(lerpColor('#aa0000', '#000000', 0.6));
    expect(piece.color).toBe('#440000');
  });

  it('leaves colours it cannot read alone', () => {
    expect(lerpColor('rgba(0,0,0,1)', '#000000', 0.5)).toBe('rgba(0,0,0,1)');
  });
});
