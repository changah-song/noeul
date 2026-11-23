import { selectionText } from '../Songs/SingAlongLyrics';

jest.mock('../../services/lrc', () => ({ activeLineIndex: () => -1 }));

const line = (text, id) => ({
  id,
  text,
  isBlank: !text.trim(),
  segments: text.split(/(\s+)/).filter(Boolean).map((part, index) => ({
    id: `${id}-${index}`,
    text: part,
    isWord: !!part.trim(),
  })),
});

describe('selectionText', () => {
  const lines = [line('Burn up with the water', 'a'), line('The floods around', 'b')];
  const flat = lines.flatMap((item, lineIndex) => item.segments.map((segment) => ({
    lineIndex,
    text: segment.text,
    isWord: segment.isWord,
  })));

  it('reads one word, its line as the sentence', () => {
    expect(selectionText(lines, flat, 2, 2)).toEqual({ text: 'up', sentence: 'Burn up with the water' });
  });

  it('reads a drag backwards or forwards the same, across lines', () => {
    // "the water" (6..8) then "The floods" (9..11) on the next line.
    const forward = selectionText(lines, flat, 6, 11);
    expect(forward).toEqual({
      text: 'the water The floods',
      sentence: 'Burn up with the water The floods around',
    });
    expect(selectionText(lines, flat, 11, 6)).toEqual(forward);
  });
});
