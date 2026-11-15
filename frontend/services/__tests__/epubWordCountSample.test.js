// The import counts a book's words from a capped sample, so a very long book
// doesn't freeze the app while every chapter is read (services/epubMetadata.js).
import JSZip from 'jszip';

import {
    quickBodyText,
    readEpubMetadata,
    WORD_COUNT_SAMPLE_BYTES,
    wordCountSample,
} from '../epubMetadata';

jest.mock('../bookFiles', () => ({
    resolveBookSourceUri: async (uri) => uri,
}));

describe('quickBodyText', () => {
    it('takes the body text and leaves out tags, scripts, styles and the head', () => {
        const xml = `<html><head><title>Not this</title><style>p { color: red; }</style></head>
<body class="x"><h1>Genesis</h1><p>In the <i>beginning</i>&nbsp;God.</p><script>var x = 1;</script><!-- note --></body></html>`;
        expect(quickBodyText(xml)).toBe('Genesis In the beginning God.');
    });
});

describe('wordCountSample', () => {
    const items = (count, size) => Array.from({ length: count }, (_, index) => ({ index, size }));

    it('reads every chapter of a book under the limit', () => {
        const { sample, totalBytes } = wordCountSample(items(10, 1000), 50000);
        expect(sample).toHaveLength(10);
        expect(totalBytes).toBe(10000);
    });

    it('reads chapters spread through a long book, up to the limit', () => {
        const { sample, totalBytes } = wordCountSample(items(1000, 1000), 50000);
        expect(totalBytes).toBe(1000000);
        expect(sample).toHaveLength(50);
        expect(sample[0].index).toBe(0);
        expect(sample[sample.length - 1].index).toBeGreaterThan(900);
    });
});

describe('the word count of a very long book', () => {
    it('is scaled up from the sample to about the true count', async () => {
        const wordsPerChapter = 2000;
        const chapters = 400;
        const chapter = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${
            Array.from({ length: wordsPerChapter }, () => 'word').join(' ')
        }</p></body></html>`;
        expect(chapter.length * chapters).toBeGreaterThan(WORD_COUNT_SAMPLE_BYTES);

        const zip = new JSZip();
        zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
        const ids = Array.from({ length: chapters }, (_, index) => `c${index}`);
        zip.file('OEBPS/content.opf', `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Long</dc:title></metadata>
<manifest>${ids.map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${ids.map((id) => `<itemref idref="${id}"/>`).join('')}</spine></package>`);
        ids.forEach((id) => zip.file(`OEBPS/${id}.xhtml`, chapter));
        const buffer = await zip.generateAsync({ type: 'arraybuffer' });
        global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));

        const metadata = await readEpubMetadata('file:///long.epub', 'long.epub');
        const trueCount = wordsPerChapter * chapters;
        expect(Math.abs(metadata.wordCount - trueCount)).toBeLessThan(trueCount * 0.02);
    });
});
