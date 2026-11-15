// How a chapter's stylesheet rules reach its blocks. The rules are indexed by
// what the node itself must have (services/epubMetadata.js cssRuleIndexFor),
// so these pin that the index picks the same rules, in the same order, as
// checking every rule against every node did.
import JSZip from 'jszip';

import { __parseXhtmlRenderTree } from '../epubMetadata';

const CSS = `
p { text-align: left; margin-left: 1em; }
.verse { text-align: center; }
p.verse.first { text-align: right; }
#intro { text-align: justify; }
div.poem p { margin-left: 2em; }
.poem .verse { margin-left: 3em; }
.late { text-align: center; }
.early { text-align: right; }
`;

const chapter = (body) => `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;

const parseBlocks = async (body) => {
    const xhtml = chapter(body);
    const zip = new JSZip();
    zip.file('OEBPS/ch.xhtml', xhtml);
    zip.file('OEBPS/style.css', CSS);
    const parsed = await __parseXhtmlRenderTree(zip, xhtml, 'OEBPS/ch.xhtml');
    return parsed.chapterBlocks;
};

const tokensOf = (blocks, text) => blocks.find((block) => block.text === text)?.styleTokens || {};

describe('stylesheet rules on chapter blocks', () => {
    it('lets a class beat the tag, two classes beat one, and an id beat them all', async () => {
        const blocks = await parseBlocks(`
            <p>plain</p>
            <p class="verse">verse</p>
            <p class="first verse">first</p>
            <p id="intro" class="verse first">intro</p>
        `);
        expect(tokensOf(blocks, 'plain').textAlign).toBe('left');
        expect(tokensOf(blocks, 'verse').textAlign).toBe('center');
        expect(tokensOf(blocks, 'first').textAlign).toBe('right');
        expect(tokensOf(blocks, 'intro').textAlign).toBe('justify');
    });

    it('matches a rule through its ancestors only inside them', async () => {
        const blocks = await parseBlocks(`
            <p class="verse">outside</p>
            <div class="poem"><p>line</p><p class="verse">inside</p></div>
        `);
        expect(tokensOf(blocks, 'outside').marginLeft).toBe(tokensOf(await parseBlocks('<p>x</p>'), 'x').marginLeft);
        expect(tokensOf(blocks, 'line').marginLeft).not.toBe(tokensOf(blocks, 'outside').marginLeft);
        expect(tokensOf(blocks, 'inside').marginLeft).not.toBe(tokensOf(blocks, 'line').marginLeft);
    });

    it('takes the later of two equal rules, whatever order the classes are written in', async () => {
        const blocks = await parseBlocks('<p class="early late">a</p><p class="late early">b</p>');
        expect(tokensOf(blocks, 'a').textAlign).toBe('right');
        expect(tokensOf(blocks, 'b').textAlign).toBe('right');
    });
});
