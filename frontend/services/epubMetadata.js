import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const parser = new DOMParser();

const textOf = (node) => (node?.textContent || '').trim();

const localNameOf = (node) => {
    const tagName = node?.tagName || node?.nodeName || '';
    return tagName.includes(':') ? tagName.split(':').pop() : tagName;
};

const childElements = (node) => {
    const children = [];
    for (let i = 0; i < (node?.childNodes?.length || 0); i += 1) {
        const child = node.childNodes[i];
        if (child?.nodeType === 1) {
            children.push(child);
        }
    }
    return children;
};

const firstDescendant = (root, predicate) => {
    const stack = [root];

    while (stack.length > 0) {
        const node = stack.shift();
        if (node?.nodeType === 1 && predicate(node)) {
            return node;
        }

        childElements(node).forEach((child) => stack.push(child));
    }

    return null;
};

const descendants = (root, predicate) => {
    const matches = [];
    const stack = [root];

    while (stack.length > 0) {
        const node = stack.shift();
        if (node?.nodeType === 1 && predicate(node)) {
            matches.push(node);
        }

        childElements(node).forEach((child) => stack.push(child));
    }

    return matches;
};

const dirname = (path = '') => {
    const normalized = path.replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index + 1) : '';
};

const resolveRelativePath = (baseDir = '', relativePath = '') => {
    const raw = `${baseDir}${relativePath}`.replace(/\\/g, '/');
    const parts = raw.split('/');
    const resolved = [];

    parts.forEach((part) => {
        if (!part || part === '.') {
            return;
        }

        if (part === '..') {
            resolved.pop();
            return;
        }

        resolved.push(part);
    });

    return resolved.join('/');
};

const mimeFromPath = (path = '') => {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
};

const cleanFallbackTitle = (rawName = '') => {
    if (!rawName) {
        return 'Untitled';
    }

    return rawName
        .replace(/\.epub$/i, '')
        .replace(/\bAnna'?s Archive\b/gi, '')
        .replace(/\b97[89][0-9\-\s]{8,}\b/g, '')
        .replace(/\b[a-f0-9]{20,}\b/gi, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s*--+\s*/g, ' — ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s—-]+|[\s—-]+$/g, '')
        .trim() || 'Untitled';
};

const findPackagePath = (containerXml) => {
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    const rootfileNode = firstDescendant(
        containerDoc,
        (node) => localNameOf(node) === 'rootfile' && node.getAttribute('full-path')
    );

    return rootfileNode?.getAttribute('full-path') || null;
};

const parseOpfMetadata = async (zip, packagePath, fallbackName) => {
    const opfFile = zip.file(packagePath);
    if (!opfFile) {
        return {
            title: cleanFallbackTitle(fallbackName),
            author: 'Unknown author',
            cover: null,
        };
    }

    const opfXml = await opfFile.async('string');
    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    const packageDir = dirname(packagePath);

    const titleNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'title');
    const creatorNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'creator');
    const metadataNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'metadata');
    const manifestNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'manifest');
    const manifestItems = descendants(manifestNode, (node) => localNameOf(node) === 'item');

    const title = textOf(titleNode) || cleanFallbackTitle(fallbackName);
    const author = textOf(creatorNode) || 'Unknown author';

    let coverHref = null;
    let coverType = null;

    const coverMetaNode = descendants(metadataNode, (node) => localNameOf(node) === 'meta')
        .find((node) => (node.getAttribute('name') || '').toLowerCase() === 'cover');
    const coverId = coverMetaNode?.getAttribute('content');

    if (coverId) {
        const coverItem = manifestItems.find((item) => item.getAttribute('id') === coverId);
        if (coverItem) {
            coverHref = coverItem.getAttribute('href');
            coverType = coverItem.getAttribute('media-type');
        }
    }

    if (!coverHref) {
        const coverItem = manifestItems.find((item) => {
            const properties = item.getAttribute('properties') || '';
            return properties.split(/\s+/).includes('cover-image');
        });

        if (coverItem) {
            coverHref = coverItem.getAttribute('href');
            coverType = coverItem.getAttribute('media-type');
        }
    }

    if (!coverHref) {
        const coverItem = manifestItems.find((item) => {
            const id = (item.getAttribute('id') || '').toLowerCase();
            const href = (item.getAttribute('href') || '').toLowerCase();
            return id === 'cover' || href.includes('cover');
        });

        if (coverItem) {
            coverHref = coverItem.getAttribute('href');
            coverType = coverItem.getAttribute('media-type');
        }
    }

    let cover = null;

    if (coverHref) {
        const coverPath = resolveRelativePath(packageDir, coverHref);
        const coverFile = zip.file(coverPath);

        if (coverFile) {
            const base64 = await coverFile.async('base64');
            const mime = coverType || mimeFromPath(coverPath);
            cover = `data:${mime};base64,${base64}`;
        }
    }

    return { title, author, cover };
};

export const readEpubMetadata = async (uri, fallbackName = '') => {
    try {
        const response = await fetch(uri);
        if (!response.ok) {
            throw new Error(`Failed to fetch EPUB: ${response.status}`);
        }

        const epubBuffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(epubBuffer);
        const containerFile = zip.file('META-INF/container.xml');

        if (!containerFile) {
            return {
                title: cleanFallbackTitle(fallbackName),
                author: 'Unknown author',
                cover: null,
            };
        }

        const containerXml = await containerFile.async('string');
        const packagePath = findPackagePath(containerXml);

        if (!packagePath) {
            return {
                title: cleanFallbackTitle(fallbackName),
                author: 'Unknown author',
                cover: null,
            };
        }

        return await parseOpfMetadata(zip, packagePath, fallbackName);
    } catch (error) {
        console.error('[epubMetadata] Failed to read EPUB metadata:', error);
        return {
            title: cleanFallbackTitle(fallbackName),
            author: 'Unknown author',
            cover: null,
        };
    }
};
