import {
  anchorFraction,
  chapterMarks,
  positionForStoryProgress,
  storyBoundsForBook,
  storyProgress,
  storyRange,
  storyStartBlockId,
} from '../storyRange';

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

  it('starts at the first chapter and ends with the story, its epilogue included', () => {
    expect(storyRange(spine, toc)).toEqual({ start: 5, end: 8 });
  });

  it('reads 0% before the story and 100% after it', () => {
    const range = storyRange(spine, toc);
    expect(storyProgress(spine, range, 2)).toBe(0);
    expect(storyProgress(spine, range, 5)).toBe(0);
    expect(storyProgress(spine, range, 6)).toBeCloseTo(1 / 4);
    expect(storyProgress(spine, range, 8, 9, 10)).toBe(1);
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

describe('scrubber positions', () => {
  const spine = [item('a', 1000), item('b', 3000), item('c', 1000)];
  const range = { start: 0, end: 2 };

  it('finds the chapter and the point inside it for a spot on the line', () => {
    expect(positionForStoryProgress(spine, range, 0)).toEqual({ spineIndex: 0, chapterFraction: 0 });
    expect(positionForStoryProgress(spine, range, 0.5)).toEqual({ spineIndex: 1, chapterFraction: 0.5 });
    expect(positionForStoryProgress(spine, range, 1)).toEqual({ spineIndex: 2, chapterFraction: 1 });
  });

  it('marks where each contents entry starts', () => {
    const toc = [{ title: 'One', spineIndex: 0 }, { title: 'Two', spineIndex: 1 }, { title: 'Three', spineIndex: 2 }];
    expect(chapterMarks(spine, range, toc).map((mark) => [mark.at, mark.title]))
      .toEqual([[0.2, 'Two'], [0.8, 'Three']]);
  });

  it('marks one per file for a book without contents', () => {
    expect(chapterMarks(spine, range).map((mark) => mark.at)).toEqual([0.2, 0.8]);
  });

  it('marks chapters inside one long file where their elements sit', () => {
    const one = [item('book', 9000)];
    const toc = [
      { title: 'I', spineIndex: 0, href: 'book.xhtml#ch1' },
      { title: 'II', spineIndex: 0, href: 'book.xhtml#ch2' },
      { title: 'III', spineIndex: 0, href: 'book.xhtml#ch3' },
    ];
    const blocks = [
      { id: 'b1', text: 'a'.repeat(100), anchors: ['ch1'] },
      { id: 'b2', text: 'b'.repeat(200), anchors: ['ch2'] },
      { id: 'b3', text: 'c'.repeat(100), attrs: { id: 'ch3' } },
    ];
    expect(anchorFraction(blocks, 'ch3')).toBe(0.75);
    const marks = chapterMarks(one, { start: 0, end: 0 }, toc, { fractionFor: (_spineIndex, anchor) => anchorFraction(blocks, anchor) });
    expect(marks.map((mark) => [mark.at, mark.title])).toEqual([[0.25, 'II'], [0.75, 'III']]);
    // Before the file is read in, nothing is known about where they are.
    expect(chapterMarks(one, { start: 0, end: 0 }, toc)).toEqual([]);
  });

  it('marks a chapter split over several files once', () => {
    const split = [item('ch1a', 1000), item('ch1b', 1000), item('ch2a', 1000), item('ch2b', 1000)];
    const toc = [{ title: 'One', spineIndex: 0 }, { title: 'Two', spineIndex: 2 }];
    expect(chapterMarks(split, { start: 0, end: 3 }, toc).map((mark) => [mark.at, mark.title])).toEqual([[0.5, 'Two']]);
  });

  it('leaves out contents entries before or after the story', () => {
    const toc = [{ title: 'Preface', spineIndex: 0 }, { title: 'Two', spineIndex: 1 }, { title: 'Notes', spineIndex: 2 }];
    expect(chapterMarks(spine, { start: 1, end: 1 }, toc)).toEqual([]);
  });

  it('uses the nested lessons when the top level is front matter (Brooks)', () => {
    const one = [item('book', 9000)];
    const toc = [
      { title: 'BROOKS\'S READERS', spineIndex: 0, href: 'book.xhtml#title' },
      { title: 'CONTENTS', spineIndex: 0, href: 'book.xhtml#contents', subitems: [
        { title: 'A BUSY TIME', spineIndex: 0, href: 'book.xhtml#busy' },
        { title: 'THE COW', spineIndex: 0, href: 'book.xhtml#cow' },
        { title: 'THE RAIN', spineIndex: 0, href: 'book.xhtml#rain' },
      ] },
    ];
    const at = { title: 0, contents: 0.05, busy: 0.2, cow: 0.5, rain: 0.8 };
    // The story starts at the first lesson.
    const range = { start: 0, end: 0, startFraction: 0.2, endFraction: 1 };
    const marks = chapterMarks(one, range, toc, { fractionFor: (_spineIndex, anchor) => at[anchor] });
    expect(marks.map((mark) => mark.title)).toEqual(['THE COW', 'THE RAIN']);
  });

  it('uses the chapters inside a single top-level entry', () => {
    const toc = [{ title: 'Book One', spineIndex: 0, subitems: [{ title: 'Two', spineIndex: 1 }, { title: 'Three', spineIndex: 2 }] }];
    expect(chapterMarks(spine, range, toc).map((mark) => mark.title)).toEqual(['Two', 'Three']);
  });
});

describe('Project Gutenberg books without measured bounds', () => {
  const pg = (name, size = 4000, idref = name) => ({ path: `OEBPS/4535853941417937619_62514-${name}.htm.xhtml`, idref, size });

  it('skips the cover wrapper, title pages and front matter before numbered tales (Jataka Tales)', () => {
    const spine = [
      { path: 'OEBPS/wrap0000.xhtml', idref: 'coverpage-wrapper', size: 593 },
      pg('h-1', 1009), pg('h-2', 1013), pg('h-3', 805), pg('h-4', 822),
      pg('h-5', 1225), pg('h-6', 4367), pg('h-7', 3475), pg('h-9', 7249), pg('h-10', 2990),
    ];
    const toc = [
      { title: 'Jataka Tales', spineIndex: 2 }, { title: 'FOREWORD', spineIndex: 5 },
      { title: 'CONTENTS', spineIndex: 6 }, { title: "PUBLISHER'S NOTE", spineIndex: 7 },
      { title: 'I. THE MONKEY AND THE CROCODILE', spineIndex: 8 },
      { title: 'II. HOW THE TURTLE SAVED HIS OWN LIFE', spineIndex: 9 },
    ];
    expect(storyRange(spine, toc)).toEqual({ start: 8, end: 9 });
  });

  it('starts past the cover wrapper of a reader whose story starts inside its first file (Brooks)', () => {
    const spine = [
      { path: 'OEBPS/wrap0000.xhtml', idref: 'coverpage-wrapper', size: 603 },
      { path: 'OEBPS/8544944432921954894_41243-h-0.htm.xhtml', idref: 'pg-header', size: 105099 },
      { path: 'OEBPS/8544944432921954894_41243-h-1.htm.xhtml', idref: 'item5', size: 17701 },
    ];
    const toc = [
      { title: "BROOKS'S READERS", spineIndex: 1 }, { title: 'CONTENTS', spineIndex: 1 },
      { title: 'SUGGESTIONS TO TEACHERS', spineIndex: 1 }, { title: 'THE BOX OF TOOLS', spineIndex: 2 },
    ];
    expect(storyRange(spine, toc)).toEqual({ start: 1, end: 2 });
  });

  it("doesn't take a year on the title page for a chapter", () => {
    const spine = [{ path: 'a.xhtml', size: 100 }, { path: 'b.xhtml', size: 100 }];
    expect(storyRange(spine, [{ title: '1908', spineIndex: 0 }, { title: 'Preface', spineIndex: 1 }]))
      .toEqual({ start: 0, end: 1 });
  });
});

describe('measured story bounds', () => {
  // A reader whose lessons start a fifth of the way into its first file and
  // whose last file ends with a word list.
  const spine = [
    { path: 'OEBPS/wrap0000.xhtml', size: 1000 },
    { path: 'OEBPS/h-0.xhtml', size: 10000 },
    { path: 'OEBPS/h-1.xhtml', size: 2000 },
  ];
  const bounds = {
    start: { href: 'OEBPS/h-0.xhtml', anchors: ['pgepubid00009', 'Page_5', 'img_flag'], fraction: 0.2 },
    end: { href: 'OEBPS/h-1.xhtml', fraction: 0.5 },
  };
  const range = storyRange(spine, [], bounds);

  it('starts partway into a file and ends partway into another', () => {
    expect(range).toEqual({
      start: 1, end: 2, startFraction: 0.2, endFraction: 0.5, startAnchors: ['pgepubid00009', 'Page_5', 'img_flag'],
    });
  });

  it('reads 0% at the first lesson and 100% at the word list', () => {
    // The story is 8000 of the first file and 1000 of the second: 9000.
    expect(storyProgress(spine, range, 0)).toBe(0);
    expect(storyProgress(spine, range, 1)).toBe(0);
    expect(storyProgress(spine, range, 1, 1, 10)).toBe(0); // 20% in: still the teachers' notes
    expect(storyProgress(spine, range, 1, 5, 10)).toBeCloseTo(4000 / 9000);
    expect(storyProgress(spine, range, 1, 9, 10)).toBeCloseTo(8000 / 9000);
    expect(storyProgress(spine, range, 2)).toBeCloseTo(8000 / 9000);
    expect(storyProgress(spine, range, 2, 4, 10)).toBe(1); // halfway: the word list
    expect(storyProgress(spine, range, 2, 9, 10)).toBe(1);
  });

  it('maps the scrubber onto the story only', () => {
    expect(positionForStoryProgress(spine, range, 0)).toEqual({ spineIndex: 1, chapterFraction: 0.2 });
    const middle = positionForStoryProgress(spine, range, 0.5);
    expect(middle.spineIndex).toBe(1);
    expect(middle.chapterFraction).toBeCloseTo(0.2 + 4500 / 10000);
    expect(positionForStoryProgress(spine, range, 1)).toEqual({ spineIndex: 2, chapterFraction: 0.5 });
  });

  it('marks the next file where the first one ends', () => {
    expect(chapterMarks(spine, range).map((mark) => mark.at)).toEqual([8000 / 9000]);
  });

  it('finds the block the story starts at', () => {
    const blocks = [
      { id: 'b1', type: 'text', anchors: ['teachers'] },
      { id: 'b2', type: 'image', anchors: ['Page_5', 'img_flag'] },
    ];
    expect(storyStartBlockId(blocks, range)).toBe('b2');
    expect(storyStartBlockId(blocks, { ...range, startAnchors: ['missing'] })).toBeNull();
    // A story at the top of its file needs no seek.
    expect(storyStartBlockId(blocks, { start: 1, end: 2, startFraction: 0, startAnchors: ['img_flag'] })).toBeNull();
  });

  it('falls back to titles and file names when the bounds name a file this book lacks', () => {
    const other = { start: { href: 'OEBPS/elsewhere.xhtml', fraction: 0.3 }, end: { href: 'OEBPS/h-1.xhtml', fraction: 1 } };
    expect(storyRange(spine, [], other)).toEqual({ start: 0, end: 2 });
  });
});

describe("the library's measured bounds", () => {
  it("has Brooks's Readers start after the suggestions to teachers and end before the word list", () => {
    const bounds = storyBoundsForBook({ publicLibraryId: '2d0049fc-a65c-436f-9876-45894fc88dfc' });
    expect(bounds.start.href).toMatch(/41243-h-0\.htm\.xhtml$/);
    expect(bounds.start.anchors).toContain('Page_5');
    expect(bounds.start.fraction).toBeGreaterThan(0);
    expect(bounds.start.fraction).toBeLessThan(0.2);
    expect(bounds.end.href).toMatch(/41243-h-1\.htm\.xhtml$/);
    expect(bounds.end.fraction).toBeLessThan(1);
    expect(storyBoundsForBook({ publicLibraryId: 'not-in-the-library' })).toBeNull();
    expect(storyBoundsForBook({})).toBeNull();
  });
});
