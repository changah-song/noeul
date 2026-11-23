import { activeLineIndex, lineEndTime, lyricLineTimes, parseLrc } from '../lrc';

describe('parseLrc', () => {
  it('reads times, repeated tags and skips metadata', () => {
    const lines = parseLrc('[ar:IU]\n[00:12.30] 이 밤 그날의\n[01:02.5][02:10.00] 반딧불을\n[00:20.000]\nplain');
    expect(lines).toEqual([
      { time: 12.3, text: '이 밤 그날의' },
      { time: 20, text: '' },
      { time: 62.5, text: '반딧불을' },
      { time: 130, text: '반딧불을' },
    ]);
  });
});

describe('lyricLineTimes', () => {
  const timed = parseLrc('[00:10.00] Hello, world\n[00:15.00] second line\n[00:20.00] third\n[00:25.00] second line');

  it('matches lines in order, ignoring case and punctuation', () => {
    expect(lyricLineTimes(['hello world!', '', 'Second line', 'third', 'second line'], timed))
      .toEqual([10, null, 15, 20, 25]);
  });

  it('keeps going after a line the timed lyrics do not have', () => {
    expect(lyricLineTimes(['hello world', 'my own line', 'third'], timed)).toEqual([10, null, 20]);
  });
});

describe('activeLineIndex / lineEndTime', () => {
  const times = [10, null, 15, 20];
  it('finds the line being sung', () => {
    expect(activeLineIndex(times, 5)).toBe(-1);
    expect(activeLineIndex(times, 10)).toBe(0);
    expect(activeLineIndex(times, 16)).toBe(2);
    expect(activeLineIndex(times, 99)).toBe(3);
  });
  it('ends a line where the next one starts', () => {
    expect(lineEndTime(times, 0)).toBe(15);
    expect(lineEndTime(times, 3)).toBe(null);
    expect(lineEndTime(times, 1)).toBe(null);
  });
});
