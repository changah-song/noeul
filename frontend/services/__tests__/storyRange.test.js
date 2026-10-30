import { storyProgress, storyRange } from '../storyRange';

const item = (path, size = 1000) => ({ path: `epub/text/${path}.xhtml`, size });

describe('story range', () => {
  // The shape of the library's Standard Ebooks-style books.
  const spine = [
    item('cover'), item('titlepage'), item('public-domain'), item('preface'), item('halftitlepage'),
    item('chapter-1'), item('chapter-2'), item('chapter-3'),
    item('epilogue'), item('endnotes'), item('donate'), item('acknowledgments'),
  ];
  const toc = [
    { title: 'Cover', spineIndex: 0 }, { title: 'Titlepage', spineIndex: 1 },
    { title: 'Public domain', spineIndex: 2 }, { title: 'Preface', spineIndex: 3 },
    { title: 'The Book', spineIndex: 4 }, { title: 'I: The Start', spineIndex: 5 },
    { title: 'II', spineIndex: 6 }, { title: 'III', spineIndex: 7 },
    { title: 'Epilogue', spineIndex: 8 }, { title: 'Endnotes', spineIndex: 9 },
    { title: 'Donate', spineIndex: 10 }, { title: 'Acknowledgments', spineIndex: 11 },
  ];

  it('starts at the first chapter and ends with the story', () => {
    expect(storyRange(spine, toc)).toEqual({ start: 5, end: 7 });
  });

  it('reads 0% before the story and 100% after it', () => {
    const range = storyRange(spine, toc);
    expect(storyProgress(spine, range, 2)).toBe(0);
    expect(storyProgress(spine, range, 5)).toBe(0);
    expect(storyProgress(spine, range, 6)).toBeCloseTo(1 / 3);
    expect(storyProgress(spine, range, 7, 9, 10)).toBe(1);
    expect(storyProgress(spine, range, 10)).toBe(1);
  });

  it('weights chapters by size', () => {
    // One long file holds nearly all of the book (Aesop's fables).
    const sized = [item('intro', 100), item('fables', 9000), item('short', 1000)];
    const range = { start: 0, end: 2 };
    expect(storyProgress(sized, range, 1)).toBeCloseTo(0.01);
    expect(storyProgress(sized, range, 1, 49, 100)).toBeCloseTo(0.46);
    expect(storyProgress(sized, range, 2)).toBeCloseTo(0.9);
  });

  it('keeps a chapter whose title only looks like back matter', () => {
    const plain = [item('part-1'), item('part-2'), item('notes')];
    expect(storyRange(plain, [{ title: 'Chapter 1', spineIndex: 0 }, { title: 'Chapter 2', spineIndex: 1 }, { title: 'Chapter 3', spineIndex: 2 }]))
      .toEqual({ start: 0, end: 2 });
  });

  it('falls back to the whole book when nothing stands out', () => {
    const plain = [item('a'), item('b')];
    expect(storyRange(plain, [])).toEqual({ start: 0, end: 1 });
    expect(storyRange([], [])).toEqual({ start: 0, end: 0 });
  });
});
