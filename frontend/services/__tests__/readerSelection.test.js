import {
  lookupLayerPlacement,
  resolveTextSelection,
  resolveWordSelection,
} from '../readerSelection';

describe('resolveWordSelection', () => {
  it('ignores empty taps', () => {
    expect(resolveWordSelection({ text: '   ' })).toEqual({ type: 'ignore' });
    expect(resolveWordSelection(undefined)).toEqual({ type: 'ignore' });
  });

  it('opens a lookup for a word tap', () => {
    expect(resolveWordSelection({ text: ' 사랑 ', sentence: ' 사랑해요 ', placement: 'top' })).toEqual({
      type: 'select',
      text: '사랑',
      sentence: '사랑해요',
      placement: 'top',
    });
  });

  it('defaults placement to bottom', () => {
    expect(resolveWordSelection({ text: 'hi', placement: 'middle' }).placement).toBe('bottom');
  });

  it('only dismisses when a lookup panel is already open', () => {
    expect(resolveWordSelection({ text: 'next' }, { lookupOpen: true })).toEqual({ type: 'dismiss' });
  });

  it('applies cleanText before the emptiness check', () => {
    const strip = (value) => value.replace(/[!?,.]/g, '');
    expect(resolveWordSelection({ text: 'love!' }, { cleanText: strip }).text).toBe('love');
    expect(resolveWordSelection({ text: '?!' }, { cleanText: strip })).toEqual({ type: 'ignore' });
  });
});

describe('resolveTextSelection', () => {
  it('opens a translation for a range selection', () => {
    expect(resolveTextSelection({ text: ' a whole line ', placement: 'top' })).toEqual({
      type: 'select',
      text: 'a whole line',
      placement: 'top',
    });
    expect(resolveTextSelection({ text: '' })).toEqual({ type: 'ignore' });
  });
});

describe('lookupLayerPlacement', () => {
  it('forces the panel to the bottom in focus mode', () => {
    expect(lookupLayerPlacement('top', false)).toBe('top');
    expect(lookupLayerPlacement('top', true)).toBe('bottom');
    expect(lookupLayerPlacement('bottom', false)).toBe('bottom');
  });
});
