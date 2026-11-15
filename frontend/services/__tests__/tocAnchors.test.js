import { blockIdForAnchor, tocAnchorFromHref } from '../tocAnchors';
import { __buildNativeChapterBlocks } from '../epubMetadata';

const text = (value) => ({ type: 'text', text: value });
const block = (id, tag, children, attrs = {}) => ({ type: 'block', id, tag, attrs, children });

describe('contents entries inside a chapter file', () => {
  it('reads the fragment of a contents link', () => {
    expect(tocAnchorFromHref('text/fables.xhtml#the-fox-and-the-grapes')).toBe('the-fox-and-the-grapes');
    expect(tocAnchorFromHref('text/fables.xhtml')).toBeNull();
    expect(tocAnchorFromHref('chapter.xhtml#ch%C3%A9')).toBe('ché');
  });

  it('puts a wrapper\'s id on the first block inside it', () => {
    // <article id="the-fox"><h2>The Fox</h2><p>…</p></article>
    // <article id="the-goose"><h2>The Goose</h2><p>…</p></article>
    const tree = {
      type: 'root',
      children: [
        block('a1', 'article', [block('h1', 'h2', [text('The Fox')]), block('p1', 'p', [text('A fox…')])], { id: 'the-fox' }),
        block('a2', 'article', [block('h2', 'h2', [text('The Goose')]), block('p2', 'p', [text('A goose…')])], { id: 'the-goose' }),
      ],
    };
    const blocks = __buildNativeChapterBlocks(tree);
    expect(blockIdForAnchor(blocks, 'the-fox')).toBe('h1');
    expect(blockIdForAnchor(blocks, 'the-goose')).toBe('h2');
    expect(blockIdForAnchor(blocks, 'missing')).toBeNull();
  });

  it('finds an empty inline anchor before a title', () => {
    // <h2><a id="chapter-2"></a>Chapter II</h2>
    const tree = {
      type: 'root',
      children: [
        block('p0', 'p', [text('The end of chapter one.')]),
        block('h', 'h2', [{ type: 'inline', tag: 'a', attrs: { id: 'chapter-2' }, children: [] }, text('Chapter II')]),
      ],
    };
    expect(blockIdForAnchor(__buildNativeChapterBlocks(tree), 'chapter-2')).toBe('h');
  });
});

describe('which contents entry the reader is in', () => {
  const { activeTocIndex } = require('../tocAnchors');
  const blocks = [
    { id: 'b0' },
    { id: 'b1', anchors: ['one'] },
    { id: 'b2' },
    { id: 'b3', anchors: ['two'] },
    { id: 'b4' },
    { id: 'b5', attrs: { id: 'three' } },
    { id: 'b6' },
  ];
  // One file holding three chapters, then a file of its own.
  const toc = [
    { title: 'One', href: 'book.xhtml#one', spineIndex: 1 },
    { title: 'Two', href: 'book.xhtml#two', spineIndex: 1 },
    { title: 'Three', href: 'book.xhtml#three', spineIndex: 1 },
    { title: 'Four', href: 'four.xhtml', spineIndex: 3 },
  ];

  it('follows the reader through chapters that share a file', () => {
    expect(activeTocIndex(toc, { spineIndex: 1, blocks, firstBlockId: 'b0' })).toBe(0);
    expect(activeTocIndex(toc, { spineIndex: 1, blocks, firstBlockId: 'b2' })).toBe(0);
    expect(activeTocIndex(toc, { spineIndex: 1, blocks, firstBlockId: 'b3' })).toBe(1);
    expect(activeTocIndex(toc, { spineIndex: 1, blocks, firstBlockId: 'b6' })).toBe(2);
  });

  it('marks the first entry of the file when the spot in it is unknown', () => {
    expect(activeTocIndex(toc, { spineIndex: 1 })).toBe(0);
    expect(activeTocIndex(toc, { spineIndex: 1, blocks, firstBlockId: 'gone' })).toBe(0);
  });

  it('stays in the last chapter of a file through files with no entry', () => {
    expect(activeTocIndex(toc, { spineIndex: 2 })).toBe(2);
    expect(activeTocIndex(toc, { spineIndex: 3 })).toBe(3);
    expect(activeTocIndex(toc, { spineIndex: 0 })).toBe(-1);
  });

  it('marks a section once the reader reaches it, the chapter before that', () => {
    const nested = [
      { title: 'Chapter', href: 'book.xhtml', spineIndex: 1 },
      { title: 'Section', href: 'book.xhtml#two', spineIndex: 1 },
    ];
    expect(activeTocIndex(nested, { spineIndex: 1, blocks, firstBlockId: 'b1' })).toBe(0);
    expect(activeTocIndex(nested, { spineIndex: 1, blocks, firstBlockId: 'b4' })).toBe(1);
  });

  it('ignores entries listed out of reading order', () => {
    const outOfOrder = [
      { title: 'One', href: 'one.xhtml', spineIndex: 2 },
      { title: 'Two', href: 'two.xhtml', spineIndex: 4 },
      { title: 'Cover', href: 'cover.xhtml', spineIndex: 0 },
    ];
    expect(activeTocIndex(outOfOrder, { spineIndex: 4 })).toBe(1);
    expect(activeTocIndex(outOfOrder, { spineIndex: 3 })).toBe(0);
  });
});
