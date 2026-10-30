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
