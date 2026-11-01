// The story bounds come from backend/scripts/epub_story.py, which names the
// element ids at the story's first block. These pin that the reader's own
// blocks (services/epubMetadata.js) carry those ids on that block, using the
// markup of Brooks's Readers, First Year (Project Gutenberg #41243), where the
// first lesson follows the suggestions to teachers in the same file.
import JSZip from 'jszip';

import { __parseXhtmlRenderTree } from '../epubMetadata';
import { storyStartBlockId } from '../storyRange';

const BROOKS_CHAPTER = `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>BROOKS'S READERS</title></head>
<body class="x-ebookmaker x-ebookmaker-3"><div/>
<p><span class="x-ebookmaker-pageno" title="[Pg 4]" id="pgepubid00007"><a id="Page_4" title="[Pg 4]"></a></span></p>
<h4 id="pgepubid00008">SUGGESTIONS TO TEACHERS</h4>
<p>As stated on the preceding page, the foundation of this work is phonetic.</p>
<table style="width: 50%" data-summary="List of keywords">
<tr><td class="tdr">Page  5,</td><td class="tdl"><i>flag</i>;</td><td class="tdl">teach <i>f</i>, <i>l</i>, <i>g</i>.</td></tr>
</table>
<p>The blackboard should be in constant use. The diacritical marks should not be taught to the children.</p>
<p><span class="x-ebookmaker-pageno" title="[Pg 5]" id="pgepubid00009"><a id="Page_5" title="[Pg 5]"></a></span></p>
<div class="figcenter">
<img alt="Stars_And_Stripes" src="4076814719640186063_0005a-illus.jpg" id="img_images_0005a-illus.jpg"/>
</div>
<div class="poem"><div class="stanza">
<span class="i16">a flag</span>
</div></div>
<p><span class="x-ebookmaker-pageno" title="[Pg 6]" id="pgepubid00010"><a id="Page_6" title="[Pg 6]"></a></span></p>
<div class="poem"><div class="stanza">
<span class="i0">I have a flag</span>
</div></div>
</body></html>`;

describe('the story start in the reader\'s blocks', () => {
  it('lands on the first lesson\'s picture, after the teachers\' notes', async () => {
    const zip = new JSZip();
    zip.file('OEBPS/h-0.xhtml', BROOKS_CHAPTER);
    const parsed = await __parseXhtmlRenderTree(zip, BROOKS_CHAPTER, 'OEBPS/h-0.xhtml');
    const blocks = parsed.chapterBlocks;
    // As written into library-story.generated.json for this book.
    const range = {
      start: 1,
      end: 2,
      startFraction: 0.08,
      startAnchors: ['pgepubid00009', 'Page_5', 'img_images_0005a-illus.jpg'],
    };
    const blockId = storyStartBlockId(blocks, range);
    const index = blocks.findIndex((block) => block.id === blockId);
    expect(index).toBeGreaterThan(0);
    expect(blocks[index].type).toBe('image');
    const before = blocks.slice(0, index).map((block) => block.text || '').join(' ');
    expect(before).toContain('SUGGESTIONS TO TEACHERS');
    expect(before).toContain('diacritical');
    const after = blocks.slice(index).map((block) => block.text || '').join(' ');
    expect(after).toContain('I have a flag');
    expect(after).not.toContain('diacritical');
  });
});
