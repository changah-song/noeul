import * as FileSystem from 'expo-file-system';
import {
    extractPdfDocument as nativeExtractPdfDocument,
    renderPdfCover as nativeRenderPdfCover,
} from '../modules/native-epub-reader/src/NativeEpubReaderView';
import { countReadableTextWords } from './epubMetadata';

const PDF_NATIVE_DIR = 'pdf-native';
const PDF_COVER_DIR = 'pdf-covers';
const PDF_PACKAGE_CACHE_VERSION = 'native-pdf-text-v9';
const EXTRACTED_PDF_META_FILE = '.ff-pdf-extraction.json';
const PDF_PACKAGE_CACHE = new Map();
const SYNTHETIC_SECTION_PAGE_COUNT = 12;

const cleanFallbackTitle = (rawName = '') => {
    if (!rawName) {
        return 'Untitled';
    }

    const decodedName = (() => {
        try {
            return decodeURIComponent(rawName);
        } catch {
            return rawName;
        }
    })();

    return decodedName
        .replace(/\.(pdf|epub)$/i, '')
        .replace(/\bAnna'?s Archive\b/gi, '')
        .replace(/\b97[89][0-9\-\s]{8,}\b/g, '')
        .replace(/\b[a-f0-9]{20,}\b/gi, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s*--+\s*/g, ' - ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s-]+|[\s-]+$/g, '')
        .trim();
};

const sanitizePathSegment = (value = '') => (
    String(value)
        .replace(/\.(pdf|epub)$/i, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'book'
);

const hashString = (value = '') => {
    let hash = 5381;
    const input = String(value);

    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }

    return (hash >>> 0).toString(36);
};

const ensureDirectory = async (uri) => {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true }).catch((error) => {
        if (!String(error?.message || '').toLowerCase().includes('already exists')) {
            throw error;
        }
    });
};

const readJsonFile = async (uri) => {
    try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) {
            return null;
        }

        return JSON.parse(await FileSystem.readAsStringAsync(uri));
    } catch {
        return null;
    }
};

const writeJsonFile = async (uri, value) => {
    const slashIndex = uri.lastIndexOf('/');
    if (slashIndex >= 0) {
        await ensureDirectory(uri.slice(0, slashIndex + 1));
    }

    await FileSystem.writeAsStringAsync(uri, JSON.stringify(value));
};

const sourceFileSignature = async (uri) => {
    try {
        const info = await FileSystem.getInfoAsync(uri);
        return {
            exists: !!info.exists,
            size: Number.isFinite(info.size) ? info.size : null,
            modificationTime: Number.isFinite(info.modificationTime) ? info.modificationTime : null,
        };
    } catch {
        return {
            exists: null,
            size: null,
            modificationTime: null,
        };
    }
};

const sourceSignatureKey = (signature = {}) => (
    [
        signature.exists === null ? 'unknown' : (signature.exists ? 'exists' : 'missing'),
        Number.isFinite(signature.size) ? signature.size : 'size-unknown',
        Number.isFinite(signature.modificationTime) ? signature.modificationTime : 'mtime-unknown',
    ].join(':')
);

const canValidateSourceSignature = (signature = {}) => (
    signature.exists === true
    && (
        Number.isFinite(signature.size)
        || Number.isFinite(signature.modificationTime)
    )
);

const sourceSignatureMatches = (cachedSignatureKey, currentSignature = {}) => (
    !canValidateSourceSignature(currentSignature)
    || cachedSignatureKey === sourceSignatureKey(currentSignature)
);

const pdfExtractionRootUriForBook = (sourceUri, fallbackName = '') => {
    const documentDirectory = FileSystem.documentDirectory;

    if (!documentDirectory) {
        throw new Error('File system document directory is unavailable.');
    }

    return `${documentDirectory}${PDF_NATIVE_DIR}/${hashString(`${sourceUri}:${fallbackName}`)}-${sanitizePathSegment(fallbackName)}/`;
};

const pdfCoverRootUriForBook = (sourceUri, fallbackName = '') => {
    const documentDirectory = FileSystem.documentDirectory;

    if (!documentDirectory) {
        throw new Error('File system document directory is unavailable.');
    }

    return `${documentDirectory}${PDF_COVER_DIR}/${hashString(`${sourceUri}:${fallbackName}`)}-${sanitizePathSegment(fallbackName)}/`;
};

const normalizePdfText = (value = '') => (
    String(value || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
);

const normalizeParagraphs = (text = '') => {
    const normalized = normalizePdfText(text);
    if (!normalized) {
        return [];
    }

    return normalized
        .split(/\n{2,}/)
        .map((paragraph) => paragraph
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim())
        .filter(Boolean);
};

const detectLanguageFromPages = (pages = []) => {
    const text = pages
        .slice(0, 8)
        .map((page) => page?.text || '')
        .join('\n');

    if (/[\u3131-\u318e\uac00-\ud7a3]/.test(text)) {
        return 'ko';
    }

    return null;
};

const cleanDocumentTitle = (title, fallbackName) => {
    const cleanedFallback = cleanFallbackTitle(fallbackName);
    const cleanedTitle = cleanFallbackTitle(title || '');

    return cleanedTitle === 'Untitled' ? cleanedFallback : cleanedTitle;
};

const normalizeLine = (line = {}, index = 0) => {
    const text = String(line.text || '').replace(/\s{2,}/g, ' ').trim();
    if (!text) {
        return null;
    }

    return {
        index,
        text,
        x: Number(line.x) || 0,
        y: Number(line.y) || 0,
        width: Number(line.width) || 0,
        height: Number(line.height) || 0,
        fontSize: Number(line.fontSize) || null,
        fontName: String(line.fontName || '').trim(),
        bold: Boolean(line.bold),
        italic: Boolean(line.italic),
    };
};

const normalizePage = (page = {}, index = 0) => {
    const lines = Array.isArray(page.lines)
        ? page.lines.map((line, lineIndex) => normalizeLine(line, lineIndex)).filter(Boolean)
        : [];
    const lineText = lines.map((line) => line.text).join('\n');

    return {
        index: Number.isInteger(page.index) ? page.index : index,
        label: String(page.label || `Page ${index + 1}`),
        text: normalizePdfText(page.text || lineText),
        lines,
        width: Number(page.width) || null,
        height: Number(page.height) || null,
        rotation: Number(page.rotation) || 0,
        imageUri: null,
        imageWidth: null,
        imageHeight: null,
    };
};

const normalizeOutline = (outline = [], pageCount = 0) => (
    Array.isArray(outline)
        ? outline
            .map((item, index) => {
                const pageIndex = Number(item?.pageIndex);
                const title = String(item?.title || '').replace(/\s{2,}/g, ' ').trim();
                if (!title || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
                    return null;
                }

                return {
                    id: `pdf-outline-${index}`,
                    title,
                    pageIndex,
                    depth: Math.max(0, Number(item?.depth) || 0),
                    source: 'outline',
                };
            })
            .filter(Boolean)
        : []
);

const normalizeExtraction = (extraction = {}, uri, fallbackName = '') => {
    const pages = Array.isArray(extraction.pages)
        ? extraction.pages.map(normalizePage)
        : [];
    const title = cleanDocumentTitle(extraction.title, fallbackName);
    const author = String(extraction.author || '').trim();
    const wordCount = pages.reduce((total, page) => total + countReadableTextWords(page.text), 0);

    return {
        sourceUri: uri,
        fallbackName: fallbackName || '',
        title,
        author,
        language: detectLanguageFromPages(pages),
        pageCount: Number(extraction.pageCount) || pages.length,
        pages,
        outline: normalizeOutline(extraction.outline, pages.length),
        wordCount: wordCount > 0 ? wordCount : null,
    };
};

const extractionCacheMatches = (payload, expected, sourceSignature) => (
    payload?.version === PDF_PACKAGE_CACHE_VERSION
    && payload?.sourceUri === expected.sourceUri
    && payload?.fallbackName === expected.fallbackName
    && sourceSignatureMatches(payload?.sourceSignatureKey, sourceSignature)
    && Array.isArray(payload?.extraction?.pages)
);

const readPdfExtraction = async (uri, fallbackName = '') => {
    const sourceSignature = await sourceFileSignature(uri);
    const rootUri = pdfExtractionRootUriForBook(uri, fallbackName);
    const metaUri = `${rootUri}${EXTRACTED_PDF_META_FILE}`;
    const expected = {
        sourceUri: uri,
        fallbackName: fallbackName || '',
        sourceSignatureKey: sourceSignatureKey(sourceSignature),
    };
    const cacheKey = [
        PDF_PACKAGE_CACHE_VERSION,
        uri,
        fallbackName || '',
        expected.sourceSignatureKey,
    ].join('\n');

    if (PDF_PACKAGE_CACHE.has(cacheKey)) {
        return PDF_PACKAGE_CACHE.get(cacheKey);
    }

    const promise = (async () => {
        await ensureDirectory(rootUri);

        let payload = await readJsonFile(metaUri);
        let extraction = extractionCacheMatches(payload, expected, sourceSignature)
            ? normalizeExtraction(payload.extraction, uri, fallbackName)
            : null;

        if (!extraction) {
            await FileSystem.deleteAsync(rootUri, { idempotent: true });
            await ensureDirectory(rootUri);
            const nativeExtraction = await nativeExtractPdfDocument({
                sourceUri: uri,
                fallbackName: fallbackName || '',
                outputRootUri: rootUri,
            });

            extraction = normalizeExtraction(nativeExtraction, uri, fallbackName);
            payload = {
                version: PDF_PACKAGE_CACHE_VERSION,
                sourceUri: expected.sourceUri,
                fallbackName: expected.fallbackName,
                sourceSignatureKey: expected.sourceSignatureKey,
                extraction,
                createdAt: Date.now(),
            };
            await writeJsonFile(metaUri, payload);
        }

        return {
            ...extraction,
            rootUri,
            sourceSignature,
        };
    })();

    PDF_PACKAGE_CACHE.set(cacheKey, promise);

    try {
        const result = await promise;
        PDF_PACKAGE_CACHE.set(cacheKey, result);
        return result;
    } catch (error) {
        if (PDF_PACKAGE_CACHE.get(cacheKey) === promise) {
            PDF_PACKAGE_CACHE.delete(cacheKey);
        }
        throw error;
    }
};

export const readPdfMetadata = async (uri, fallbackName = '') => {
    const extraction = await readPdfExtraction(uri, fallbackName);

    return {
        title: extraction.title,
        author: extraction.author,
        cover: null,
        language: extraction.language,
        wordCount: extraction.wordCount,
        pageCount: extraction.pageCount,
        format: 'pdf',
    };
};

const normalizeCoverPageNumber = (pageNumber, pageCount) => {
    const parsed = Number.parseInt(String(pageNumber || '1'), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return null;
    }

    if (Number.isFinite(pageCount) && pageCount > 0 && parsed > pageCount) {
        return null;
    }

    return parsed;
};

export const renderPdfCover = async (uri, fallbackName = '', pageNumber = 1) => {
    const extraction = await readPdfExtraction(uri, fallbackName);
    const selectedPageNumber = normalizeCoverPageNumber(
        pageNumber,
        extraction.pageCount || extraction.pages?.length || 0
    );

    if (!selectedPageNumber) {
        return null;
    }

    const rendered = await nativeRenderPdfCover({
        sourceUri: uri,
        fallbackName: fallbackName || '',
        outputRootUri: pdfCoverRootUriForBook(uri, fallbackName),
        pageNumber: selectedPageNumber,
        maxWidth: 900,
    });

    return rendered?.coverUri || null;
};

const pageTitleCandidate = (text = '') => {
    const firstLine = normalizePdfText(text)
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);

    if (!firstLine) {
        return '';
    }

    const compact = firstLine.replace(/\s+/g, ' ').trim();
    if (compact.length < 4 || /^\d+$/.test(compact)) {
        return '';
    }

    return compact.length > 56 ? `${compact.slice(0, 53).trim()}...` : compact;
};

const pageTitleCandidateFromLines = (page, context) => {
    const line = (page?.lines || [])
        .filter((candidate) => !isPdfArtifactLine(page, candidate, context))
        .find((candidate) => {
            const text = String(candidate?.text || '').trim();
            return text.length >= 4 && !/^\d+$/.test(text);
        });

    return line ? pageTitleCandidate(line.text) : '';
};

const median = (values = []) => {
    const numbers = values
        .map(Number)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

    if (numbers.length === 0) {
        return null;
    }

    const mid = Math.floor(numbers.length / 2);
    return numbers.length % 2 === 0
        ? (numbers[mid - 1] + numbers[mid]) / 2
        : numbers[mid];
};

const quantile = (values = [], percentile = 0.5) => {
    const numbers = values
        .map(Number)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);

    if (numbers.length === 0) {
        return null;
    }

    const clamped = Math.min(1, Math.max(0, percentile));
    const index = Math.round((numbers.length - 1) * clamped);
    return numbers[index];
};

const roundedTextKey = (value = '') => (
    String(value || '')
        .toLowerCase()
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
);

const comparableTitleKey = (value = '') => (
    String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

const isMarginalLine = (page, line) => {
    const height = page?.height || 0;
    if (!height || !line) {
        return false;
    }

    return line.y <= height * 0.1 || line.y >= height * 0.9;
};

const isPageNumberLine = (page, line) => {
    if (!isMarginalLine(page, line)) {
        return false;
    }

    const text = String(line?.text || '')
        .trim()
        .replace(/[|•·]/g, '')
        .replace(/\s+/g, ' ');
    const compact = text
        .replace(/^[-–—]\s*/, '')
        .replace(/\s*[-–—]$/, '')
        .trim();

    return (
        /^\d{1,4}$/.test(compact)
        || /^page\s+\d{1,4}$/i.test(compact)
        || /^[ivxlcdm]{1,10}$/i.test(compact)
    );
};

const buildFormatContext = (pages = []) => {
    const allLines = pages.flatMap((page) => page.lines || []);
    const textLines = allLines.filter((line) => countReadableTextWords(line.text || '') > 0);
    const bodyFontSize = median(textLines.map((line) => line.fontSize).filter(Boolean)) || 11;
    const bodyLineCandidates = pages.flatMap((page) => (
        (page.lines || [])
            .filter((line) => (
                countReadableTextWords(line.text || '') > 0
                && !isMarginalLine(page, line)
                && (line.fontSize || bodyFontSize) <= bodyFontSize * 1.2
            ))
    ));
    const bodyLeft = quantile(bodyLineCandidates.map((line) => line.x), 0.2)
        ?? median(bodyLineCandidates.map((line) => line.x))
        ?? 0;
    const bodyLineGaps = pages.flatMap((page) => {
        const pageLines = (page.lines || [])
            .filter((line) => (
                countReadableTextWords(line.text || '') > 0
                && !isMarginalLine(page, line)
                && (line.fontSize || bodyFontSize) <= bodyFontSize * 1.2
            ))
            .sort((a, b) => a.y - b.y || a.x - b.x);
        const gaps = [];

        for (let index = 1; index < pageLines.length; index += 1) {
            const gap = pageLines[index].y - pageLines[index - 1].y;
            if (gap > bodyFontSize * 0.45 && gap < bodyFontSize * 4) {
                gaps.push(gap);
            }
        }

        return gaps;
    });
    const bodyLineGap = median(bodyLineGaps) || bodyFontSize * 1.25;
    const marginalCounts = new Map();

    pages.forEach((page) => {
        const seenOnPage = new Set();
        (page.lines || []).forEach((line) => {
            const key = roundedTextKey(line.text);
            if (!key || key.length < 2 || !isMarginalLine(page, line) || isPageNumberLine(page, line)) {
                return;
            }
            seenOnPage.add(key);
        });
        seenOnPage.forEach((key) => {
            marginalCounts.set(key, (marginalCounts.get(key) || 0) + 1);
        });
    });

    const repeatedMarginalTexts = new Set(
        [...marginalCounts.entries()]
            .filter(([, count]) => count >= Math.max(2, Math.ceil(pages.length * 0.2)))
            .map(([key]) => key)
    );

    return {
        bodyFontSize,
        bodyLeft,
        bodyLineGap,
        repeatedMarginalTexts,
    };
};

const isRepeatedMarginalLine = (page, line, context) => (
    context.repeatedMarginalTexts.has(roundedTextKey(line.text)) && isMarginalLine(page, line)
);

const isPdfArtifactLine = (page, line, context) => (
    isPageNumberLine(page, line)
    || isRepeatedMarginalLine(page, line, context)
);

const isCenteredLine = (page, line) => {
    if (!page?.width || !line?.width) {
        return false;
    }

    const lineCenter = line.x + (line.width / 2);
    const pageCenter = page.width / 2;

    return Math.abs(lineCenter - pageCenter) <= page.width * 0.08;
};

const lineLooksLikeHeading = (page, line, context) => {
    const text = String(line?.text || '').trim();
    if (text.length < 4 || text.length > 120) {
        return false;
    }

    if (/^[\d\s.·-]+$/.test(text)) {
        return false;
    }

    const fontSize = line.fontSize || context.bodyFontSize;
    const biggerThanBody = fontSize >= context.bodyFontSize * 1.18;
    const centered = isCenteredLine(page, line);
    const shortLine = text.length <= 80;
    const endsLikeSentence = /[.!?。！？]$/.test(text);

    return (
        biggerThanBody
        || (line.bold && shortLine && !endsLikeSentence)
        || (centered && shortLine && !endsLikeSentence)
    );
};

const lineLooksLikeRenderedHeading = (page, line, context) => {
    const text = String(line?.text || '').trim();
    if (text.length < 4 || text.length > 90) {
        return false;
    }

    if (/^[\d\s.·-]+$/.test(text)) {
        return false;
    }

    const fontSize = line.fontSize || context.bodyFontSize || 11;
    const fontRatio = context.bodyFontSize > 0 ? fontSize / context.bodyFontSize : 1;
    const centered = isCenteredLine(page, line);
    const shortLine = text.length <= 72;
    const endsLikeSentence = /[.!?。！？]$/.test(text);

    if (!shortLine || endsLikeSentence) {
        return false;
    }

    return (
        fontRatio >= 1.35
        || (centered && fontRatio >= 1.18)
        || (centered && line.bold && fontRatio >= 1.12)
    );
};

const headingCandidateForPage = (page, context) => (
    (page.lines || [])
        .filter((line) => !isPdfArtifactLine(page, line, context))
        .find((line) => lineLooksLikeHeading(page, line, context))
);

const sectionTitleFromPages = (pages, startPageIndex, endPageIndex, context) => {
    for (let pageIndex = startPageIndex; pageIndex <= endPageIndex; pageIndex += 1) {
        const page = pages[pageIndex];
        const headingLine = page ? headingCandidateForPage(page, context) : null;
        const title = headingLine?.text
            || pageTitleCandidateFromLines(page, context)
            || pageTitleCandidate(page?.text || '');
        if (title) {
            return title;
        }
    }

    return startPageIndex === endPageIndex
        ? `Page ${startPageIndex + 1}`
        : `Pages ${startPageIndex + 1}-${endPageIndex + 1}`;
};

const dedupeSectionStarts = (starts = []) => {
    const byPage = new Map();
    starts.forEach((start) => {
        const existing = byPage.get(start.pageIndex);
        if (!existing || start.depth < existing.depth) {
            byPage.set(start.pageIndex, start);
        }
    });

    return [...byPage.values()].sort((a, b) => a.pageIndex - b.pageIndex || a.depth - b.depth);
};

const sectionsFromOutline = (extraction, context) => {
    const pages = extraction.pages || [];
    const starts = dedupeSectionStarts(extraction.outline || []);
    if (starts.length === 0 || pages.length === 0) {
        return [];
    }

    const effectiveStarts = starts[0].pageIndex > 0
        ? [
            {
                id: 'pdf-front-matter',
                title: 'Front matter',
                pageIndex: 0,
                depth: 0,
                source: 'front-matter',
            },
            ...starts,
        ]
        : starts;

    return effectiveStarts
        .map((start, index) => {
            const nextStart = effectiveStarts[index + 1];
            const endPageIndex = nextStart
                ? Math.max(start.pageIndex, nextStart.pageIndex - 1)
                : pages.length - 1;

            return {
                index,
                id: start.id || `pdf-section-${index}`,
                title: start.title || sectionTitleFromPages(pages, start.pageIndex, endPageIndex, context),
                startPageIndex: start.pageIndex,
                endPageIndex,
                depth: start.depth || 0,
                source: start.source || 'outline',
            };
        })
        .filter((section) => section.startPageIndex <= section.endPageIndex);
};

const sectionsFromHeadings = (extraction, context) => {
    const pages = extraction.pages || [];
    if (pages.length < 4) {
        return [];
    }

    const starts = [];
    pages.forEach((page, pageIndex) => {
        if (pageIndex === 0) {
            return;
        }

        const headingLine = headingCandidateForPage(page, context);
        if (!headingLine) {
            return;
        }

        const previousStart = starts[starts.length - 1]?.pageIndex ?? 0;
        if (pageIndex - previousStart < 2) {
            return;
        }

        starts.push({
            id: `pdf-heading-${pageIndex}`,
            title: headingLine.text,
            pageIndex,
            depth: 0,
            source: 'heading',
        });
    });

    if (starts.length === 0 || starts.length > Math.ceil(pages.length / 2)) {
        return [];
    }

    return sectionsFromOutline(
        {
            ...extraction,
            outline: [
                {
                    id: 'pdf-start',
                    title: sectionTitleFromPages(pages, 0, Math.max(0, starts[0].pageIndex - 1), context),
                    pageIndex: 0,
                    depth: 0,
                    source: 'start',
                },
                ...starts,
            ],
        },
        context
    );
};

const syntheticSections = (extraction, context) => {
    const pages = extraction.pages || [];
    const sections = [];

    for (let startPageIndex = 0; startPageIndex < pages.length; startPageIndex += SYNTHETIC_SECTION_PAGE_COUNT) {
        const endPageIndex = Math.min(startPageIndex + SYNTHETIC_SECTION_PAGE_COUNT - 1, pages.length - 1);
        sections.push({
            index: sections.length,
            id: `pdf-pages-${startPageIndex + 1}-${endPageIndex + 1}`,
            title: sectionTitleFromPages(pages, startPageIndex, endPageIndex, context),
            startPageIndex,
            endPageIndex,
            depth: 0,
            source: 'pages',
        });
    }

    return sections;
};

const buildPdfSections = (extraction, context) => {
    const outlineSections = sectionsFromOutline(extraction, context);
    if (outlineSections.length > 0) {
        return outlineSections;
    }

    const headingSections = sectionsFromHeadings(extraction, context);
    if (headingSections.length > 0) {
        return headingSections;
    }

    return syntheticSections(extraction, context);
};

const spineItemForSection = (bookId, section) => ({
    index: section.index,
    idref: `${bookId}-section-${section.index + 1}`,
    href: `section-${section.index + 1}.pdf`,
    path: `${bookId}/section-${section.index + 1}.pdf`,
    title: section.title,
    startPageIndex: section.startPageIndex,
    endPageIndex: section.endPageIndex,
    depth: section.depth || 0,
    source: section.source || 'pages',
    mediaType: 'application/pdf-section',
    linear: 'yes',
});

const textBlockForParagraph = (paragraph, pageIndex, paragraphIndex, styleTokens = {}, spans = null, tag = 'p') => ({
    id: `pdf-${pageIndex}-p-${paragraphIndex}`,
    type: 'text',
    tag,
    attrs: {},
    styleTokens,
    text: paragraph,
    spans: spans || [
        {
            id: `pdf-${pageIndex}-p-${paragraphIndex}-s-0`,
            text: paragraph,
            marks: [],
            attrs: {},
            styleTokens: {},
            startOffset: 0,
            endOffset: paragraph.length,
        },
    ],
});

const textBlock = ({
    id,
    tag = 'p',
    text,
    styleTokens = {},
    marks = [],
}) => ({
    id,
    type: 'text',
    tag,
    attrs: {},
    styleTokens,
    text,
    spans: [
        {
            id: `${id}-s-0`,
            text,
            marks,
            attrs: {},
            styleTokens: marks.includes('strong') ? { fontWeight: 700 } : {},
            startOffset: 0,
            endOffset: text.length,
        },
    ],
});

const headingBlockForLine = (line, pageIndex, blockIndex) => ({
    id: `pdf-${pageIndex}-h-${blockIndex}`,
    type: 'text',
    tag: 'h3',
    attrs: {},
    styleTokens: {
        fontWeight: 700,
        marginTop: 18,
        marginBottom: 10,
    },
    text: line.text,
    spans: [
        {
            id: `pdf-${pageIndex}-h-${blockIndex}-s-0`,
            text: line.text,
            marks: ['strong'],
            attrs: {},
            styleTokens: { fontWeight: 700 },
            startOffset: 0,
            endOffset: line.text.length,
        },
    ],
});

const chapterTitleStyleTokens = {
    fontWeight: 700,
    marginTop: 8,
    marginBottom: 18,
};

const syntheticPageRangeTitle = (title = '') => /^Pages? \d+(?:-\d+)?$/i.test(String(title).trim());

const canPromoteSectionTitle = (section = {}) => {
    const title = String(section.title || '').trim();
    if (!title || syntheticPageRangeTitle(title) || title.toLowerCase() === 'front matter') {
        return false;
    }

    return ['outline', 'heading', 'start'].includes(section.source);
};

const sectionTitleKey = (section = {}) => (
    canPromoteSectionTitle(section)
        ? comparableTitleKey(section.title)
        : ''
);

const lineMatchesSectionTitle = (line, titleKey) => {
    const lineKey = comparableTitleKey(line?.text || '');
    if (!lineKey || !titleKey) {
        return false;
    }

    return lineKey === titleKey || lineKey.includes(titleKey);
};

const promoteBlockToChapterTitle = (block) => ({
    ...block,
    tag: 'h3',
    styleTokens: {
        ...chapterTitleStyleTokens,
        ...(block.styleTokens || {}),
        fontWeight: 700,
    },
    spans: Array.isArray(block.spans)
        ? block.spans.map((span) => ({
            ...span,
            marks: [...new Set([...(span.marks || []), 'strong'])],
            styleTokens: {
                ...(span.styleTokens || {}),
                fontWeight: 700,
            },
        }))
        : block.spans,
});

const ensureSectionTitleBlock = (blocks = [], section = {}) => {
    const titleKey = sectionTitleKey(section);
    if (!titleKey) {
        return blocks;
    }

    const matchingTextIndex = blocks.findIndex((block) => (
        block?.type === 'text'
        && !block?.excludeFromText
        && String(block?.text || '').trim()
        && comparableTitleKey(block.text) === titleKey
    ));

    if (matchingTextIndex >= 0) {
        return blocks.map((block, index) => (
            index === matchingTextIndex ? promoteBlockToChapterTitle(block) : block
        ));
    }

    return blocks;
};

const LINE_BREAK_HYPHEN_PATTERN = /[-\u2010\u2011\u2012\u2013\u2212]$/u;

const isListMarkerLine = (text = '') => (
    /^\s*(?:[•·*]\s+|[-\u2013\u2014]\s+\S|\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+|[ivxlcdm]{1,8}[.)]\s+)/i.test(text)
);

const joinParagraphLines = (lines = []) => (
    lines.reduce((text, line) => {
        const lineText = String(line?.text || '').trim();

        if (!text) {
            return lineText;
        }

        return LINE_BREAK_HYPHEN_PATTERN.test(text) && /^\p{L}/u.test(lineText)
            ? `${text.replace(LINE_BREAK_HYPHEN_PATTERN, '')}${lineText}`
            : `${text} ${lineText}`;
    }, '').replace(/\s{2,}/g, ' ').trim()
);

const spansForParagraphLines = (lines = [], text = '') => {
    if (!text) {
        return [{ text: '' }];
    }

    const firstLine = lines[0] || {};

    return [{
        id: `pdf-line-span-${firstLine.pageIndex ?? 'page'}-${firstLine.index ?? 0}`,
        text,
        marks: [],
        attrs: {},
        styleTokens: {},
        startOffset: 0,
        endOffset: text.length,
    }];
};

const paragraphStyleForLines = (lines = [], page, context) => {
    const firstLine = lines[0];
    if (!firstLine) {
        return {};
    }

    const styleTokens = {};
    const fontSize = firstLine.fontSize || context.bodyFontSize || 11;
    if (isListMarkerLine(firstLine.text)) {
        styleTokens.marginLeft = {
            value: 1.4,
            unit: 'em',
        };
        return styleTokens;
    }

    const indentPoints = Math.max(0, firstLine.x - (context.bodyLeft || 0));
    if (indentPoints >= fontSize * 1.05) {
        styleTokens.textIndent = {
            value: Math.min(3, indentPoints / fontSize),
            unit: 'em',
        };
    }

    return styleTokens;
};

const contentLinesForPage = (page, context) => (
    (page?.lines || [])
        .map((line) => ({ ...line, pageIndex: page.index, page }))
        .filter((line) => !isPdfArtifactLine(page, line, context))
        .sort((a, b) => a.y - b.y || a.x - b.x)
);

const shouldStartNewParagraph = (line, previousLine, currentParagraph, context) => {
    if (!previousLine || currentParagraph.length === 0) {
        return false;
    }

    const fontSize = previousLine.fontSize || context.bodyFontSize || 11;
    const previousHeight = previousLine.height || fontSize * 1.15;
    const gap = line.y - previousLine.y;
    const firstLineIndent = line.x - (context.bodyLeft || 0);
    const previousLineIndent = previousLine.x - (context.bodyLeft || 0);
    const previousText = previousLine.text || '';
    const typicalLineGap = context.bodyLineGap || previousHeight || fontSize * 1.25;

    if (isListMarkerLine(line.text)) {
        return true;
    }

    if (line.pageIndex !== previousLine.pageIndex) {
        return firstLineIndent > fontSize * 1.05;
    }

    if (gap > Math.max(typicalLineGap * 1.65, previousHeight * 1.8)) {
        return true;
    }

    if (
        firstLineIndent > fontSize * 1.05
        && Math.abs(firstLineIndent - previousLineIndent) > fontSize * 0.55
        && /[.!?。！？;；:]$/.test(previousText)
    ) {
        return true;
    }

    return false;
};

const buildTextBlocksFromPages = (pages = [], context, section = null) => {
    const blocks = [];
    const rawLineCount = pages.reduce((total, page) => total + ((page?.lines || []).length), 0);
    const lines = pages.flatMap((page) => contentLinesForPage(page, context));
    const titleKey = sectionTitleKey(section);
    let promotedSectionTitle = false;
    let paragraphLines = [];
    let previousLine = null;
    let paragraphIndex = 0;

    const flushParagraph = () => {
        if (paragraphLines.length === 0) {
            return;
        }

        const text = joinParagraphLines(paragraphLines);
        if (text) {
            const tag = isListMarkerLine(paragraphLines[0]?.text || '') ? 'li' : 'p';
            const firstLine = paragraphLines[0] || {};
            const pageIndex = firstLine.pageIndex ?? 0;
            blocks.push(textBlockForParagraph(
                text,
                pageIndex,
                paragraphIndex,
                paragraphStyleForLines(paragraphLines, firstLine.page, context),
                spansForParagraphLines(paragraphLines, text),
                tag
            ));
            paragraphIndex += 1;
        }

        paragraphLines = [];
    };

    lines.forEach((line) => {
        if (!promotedSectionTitle && lineMatchesSectionTitle(line, titleKey)) {
            flushParagraph();
            blocks.push(headingBlockForLine(line, line.pageIndex ?? 0, blocks.length));
            promotedSectionTitle = true;
            previousLine = line;
            return;
        }

        if (lineLooksLikeRenderedHeading(line.page, line, context)) {
            flushParagraph();
            blocks.push(headingBlockForLine(line, line.pageIndex ?? 0, blocks.length));
            previousLine = line;
            return;
        }

        if (shouldStartNewParagraph(line, previousLine, paragraphLines, context)) {
            flushParagraph();
        }

        paragraphLines.push(line);
        previousLine = line;
    });

    flushParagraph();

    if (blocks.length > 0) {
        return blocks;
    }

    if (rawLineCount > 0) {
        return [];
    }

    return pages.flatMap((page) => (
        normalizeParagraphs(page.text)
            .map((paragraph, fallbackIndex) => (
                textBlockForParagraph(paragraph, page.index, fallbackIndex)
            ))
    ));
};

const buildPdfPageBlocks = (page, context) => {
    const blocks = [];

    blocks.push(...buildTextBlocksFromPages([page], context));
    return blocks.filter(Boolean);
};

const pagesForSection = (pages = [], section) => (
    pages.slice(section.startPageIndex, section.endPageIndex + 1)
);

const buildPdfSectionBlocks = (pages, section, context) => (
    ensureSectionTitleBlock(
        buildTextBlocksFromPages(pagesForSection(pages, section), context, section),
        section
    )
);

const buildBookManifest = ({
    uri,
    fallbackName,
    extraction,
    spine,
    loadedSpineItem,
}) => ({
    bookId: `pdf_${hashString(`${extraction.title}:${extraction.author}:${uri}:${fallbackName}`)}`,
    sourceUri: uri,
    title: extraction.title,
    author: extraction.author,
    identifier: null,
    language: extraction.language,
    format: 'pdf',
    packagePath: '',
    packageFileUri: uri,
    extractedRootUri: extraction.rootUri,
    currentSpineIndex: loadedSpineItem?.index ?? 0,
    currentSpineHref: loadedSpineItem?.href || '',
    currentSpinePath: loadedSpineItem?.path || '',
    totalSpineItems: spine.length,
    manifestItemCount: spine.length,
    resourceCount: 0,
    pageCount: extraction.pageCount,
    wordCount: extraction.wordCount,
    spineOrder: spine.map((item) => ({
        index: item.index,
        idref: item.idref,
        path: item.path,
        fileUri: uri,
        mediaType: item.mediaType,
        linear: item.linear,
        properties: '',
    })),
});

export const readPdfPackageXml = async (uri, fallbackName = '', options = {}) => {
    const readOptions = typeof options === 'number' ? { spineIndex: options } : (options || {});
    const requestedSpineIndex = Number.isInteger(readOptions.spineIndex)
        ? readOptions.spineIndex
        : 0;
    const extraction = await readPdfExtraction(uri, fallbackName);
    const context = buildFormatContext(extraction.pages || []);
    let sections = buildPdfSections(extraction, context);
    const currentSpineIndex = Math.min(
        Math.max(requestedSpineIndex, 0),
        Math.max(sections.length - 1, 0)
    );

    const finalContext = buildFormatContext(extraction.pages || []);
    const pages = extraction.pages.length > 0
        ? extraction.pages
        : [normalizePage({ index: 0, label: 'Page 1', text: '' }, 0)];
    sections = sections.length > 0
        ? sections
        : syntheticSections({ ...extraction, pages }, finalContext);
    const clampedSpineIndex = Math.min(
        Math.max(currentSpineIndex, 0),
        Math.max(sections.length - 1, 0)
    );
    const clampedSection = sections[clampedSpineIndex] ?? sections[0];
    const bookId = `pdf_${hashString(`${extraction.title}:${extraction.author}:${uri}:${fallbackName}`)}`;
    const spine = sections.map((section, index) => spineItemForSection(bookId, { ...section, index }));
    const loadedSpineItem = spine[clampedSpineIndex] ?? spine[0];
    const loadedChapterBlocks = clampedSection
        ? buildPdfSectionBlocks(pages, clampedSection, finalContext)
        : buildPdfPageBlocks(pages[0], finalContext);
    const loadedChapterResources = [];
    const bookResources = [];
    const toc = spine.map((item) => ({
        id: item.idref,
        label: item.title,
        title: item.title,
        href: item.href,
        path: item.path,
        spineIndex: item.index,
        depth: item.depth || 0,
        positionLabel: item.startPageIndex === item.endPageIndex
            ? `Page ${item.startPageIndex + 1}`
            : `Pages ${item.startPageIndex + 1}-${item.endPageIndex + 1}`,
        disabled: false,
        source: item.source || 'pdf-section',
        listed: true,
    }));
    const metadata = {
        title: extraction.title,
        author: extraction.author,
        language: extraction.language,
        identifier: null,
        wordCount: extraction.wordCount,
        pageCount: extraction.pageCount,
        format: 'pdf',
    };
    const bookManifest = buildBookManifest({
        uri,
        fallbackName,
        extraction,
        spine,
        loadedSpineItem,
    });
    const chapterText = loadedChapterBlocks
        .filter((block) => !block?.excludeFromText)
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n');

    return {
        fileName: fallbackName || '',
        bookManifest,
        extractedRootUri: extraction.rootUri,
        extractedFileCount: 0,
        packagePath: '',
        metadata,
        manifest: spine,
        bookResources,
        spine,
        toc,
        tocSource: 'pdf-pages',
        loadedSpineItem,
        loadedChapterXml: '',
        loadedChapterText: chapterText,
        loadedChapterRenderTree: { id: `pdf-section-${clampedSpineIndex}`, type: 'root', children: [] },
        loadedChapterSelectionBlocks: [],
        loadedChapterBlocks,
        loadedChapterStylesheets: [],
        loadedChapterStylesheetResources: [],
        loadedChapterStyleRules: [],
        loadedChapterResources,
        loadedChapterDiagnostic: {
            index: loadedSpineItem?.index ?? clampedSpineIndex,
            idref: loadedSpineItem?.idref || '',
            path: loadedSpineItem?.path || '',
            fileUri: uri,
            mediaType: 'application/pdf-section',
            linear: 'yes',
            status: loadedChapterBlocks.length > 0 ? 'readable' : 'skipped',
            reason: chapterText.trim() ? 'pdf text layer found' : 'empty PDF page',
            isReadable: chapterText.trim().length > 0,
            textLength: chapterText.replace(/\s/g, '').length,
            selectionBlockCount: loadedChapterBlocks.filter((block) => !block?.excludeFromText).length,
            blockCount: loadedChapterBlocks.length,
            styleRuleCount: 0,
            imageCount: 0,
        },
        spineSelection: {
            requestedSpineIndex,
            selectedSpineIndex: clampedSpineIndex,
            inspectedCount: 1,
            skippedCount: 0,
            reason: 'requested PDF section',
        },
        spineDiagnostics: [],
        skippedSpineItems: [],
        firstSpineItem: loadedSpineItem,
        firstChapterXml: '',
        firstChapterText: chapterText,
        firstChapterRenderTree: { id: `pdf-section-${clampedSpineIndex}`, type: 'root', children: [] },
        firstChapterSelectionBlocks: [],
        firstChapterBlocks: loadedChapterBlocks,
        firstChapterStylesheets: [],
        firstChapterStylesheetResources: [],
        firstChapterStyleRules: [],
        firstChapterResources: loadedChapterResources,
        packageXml: '',
        containerXml: '',
    };
};
