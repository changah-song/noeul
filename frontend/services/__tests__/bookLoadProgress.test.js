/**
 * The steps a book's import or open announces, for the screens that wait on
 * it (Home's "Adding book" line, the reader's opening spinner).
 */
import JSZip from 'jszip';

import { announceBookLoadStep, subscribeBookLoadProgress } from '../bookLoadProgress';
import { readEpubMetadata } from '../epubMetadata';

jest.mock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///docs/',
    EncodingType: { Base64: 'base64' },
    getInfoAsync: jest.fn(async () => ({ exists: false })),
    makeDirectoryAsync: jest.fn(async () => {}),
    writeAsStringAsync: jest.fn(async () => {}),
    readAsStringAsync: jest.fn(async () => ''),
    deleteAsync: jest.fn(async () => {}),
}));
jest.mock('expo-file-system', () => ({ File: undefined }));

describe('announceBookLoadStep', () => {
    it('tells listeners the step and keeps the fraction between 0 and 1', async () => {
        const seen = [];
        const unsubscribe = subscribeBookLoadProgress((progress) => seen.push(progress));

        await announceBookLoadStep('file:///a.epub', 'file');
        await announceBookLoadStep('file:///a.epub', 'text', 1.4);
        unsubscribe();
        await announceBookLoadStep('file:///a.epub', 'cover');

        expect(seen).toEqual([
            { uri: 'file:///a.epub', step: 'file', fraction: null },
            { uri: 'file:///a.epub', step: 'text', fraction: 1 },
        ]);
    });

    it('keeps going when a listener throws', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const seen = [];
        const stopBad = subscribeBookLoadProgress(() => { throw new Error('boom'); });
        const stopGood = subscribeBookLoadProgress((progress) => seen.push(progress.step));

        await announceBookLoadStep('file:///a.epub', 'chapter');
        stopBad();
        stopGood();
        warn.mockRestore();

        expect(seen).toEqual(['chapter']);
    });
});

describe('importing an EPUB', () => {
    it('announces reading the file, then scanning the text up to the end', async () => {
        const zip = new JSZip();
        zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
        const chapters = Array.from({ length: 20 }, (_, index) => `ch${index}`);
        zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Long Book</dc:title><dc:language>en</dc:language></metadata>
<manifest>${chapters.map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${chapters.map((id) => `<itemref idref="${id}"/>`).join('')}</spine>
</package>`);
        chapters.forEach((id) => {
            zip.file(`OEBPS/${id}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>One two three four five.</p></body></html>`);
        });
        const bytes = await zip.generateAsync({ type: 'arraybuffer' });
        global.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => bytes }));

        const uri = 'file:///docs/books/long.epub';
        const seen = [];
        const unsubscribe = subscribeBookLoadProgress((progress) => {
            if (progress.uri === uri) seen.push(progress);
        });
        const metadata = await readEpubMetadata(uri, 'long.epub');
        unsubscribe();

        expect(metadata.title).toBe('Long Book');
        expect(metadata.wordCount).toBe(100);
        expect(seen[0]).toEqual({ uri, step: 'file', fraction: null });
        const textFractions = seen.filter((progress) => progress.step === 'text').map((progress) => progress.fraction);
        expect(textFractions[0]).toBe(0);
        expect(textFractions.length).toBeGreaterThan(1);
        expect([...textFractions].sort((a, b) => a - b)).toEqual(textFractions);
        expect(Math.max(...textFractions)).toBeLessThanOrEqual(1);
    });
});
