import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import * as FileSystem from 'expo-file-system';

const parser = new DOMParser();
const NATIVE_EPUB_DIR = 'epub-native';
const BOOK_COVER_DIR = 'book-covers';
const EPUB_PACKAGE_CACHE_VERSION = 'native-renderer-css-v6';
const EPUB_PACKAGE_CACHE = new Map();

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

const resolveHrefPath = (baseDir = '', href = '') => {
    const normalizedHref = String(href || '').replace(/\\/g, '/');
    const normalizedBase = normalizedHref.startsWith('/') ? '' : baseDir;

    return resolveRelativePath(normalizedBase, normalizedHref.replace(/^\/+/, ''));
};

const mimeFromPath = (path = '') => {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.css')) return 'text/css';
    if (lower.endsWith('.xhtml') || lower.endsWith('.html')) return 'application/xhtml+xml';
    if (lower.endsWith('.ncx')) return 'application/x-dtbncx+xml';
    if (lower.endsWith('.xml') || lower.endsWith('.opf')) return 'application/xml';
    if (lower.endsWith('.ttf')) return 'font/ttf';
    if (lower.endsWith('.otf')) return 'font/otf';
    if (lower.endsWith('.woff')) return 'font/woff';
    if (lower.endsWith('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
};

const sanitizePathSegment = (value = '') => (
    String(value)
        .replace(/\.epub$/i, '')
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

const isSafeZipPath = (path = '') => {
    const normalized = String(path).replace(/\\/g, '/');

    return (
        normalized &&
        !normalized.startsWith('/') &&
        !normalized.split('/').some((part) => part === '..')
    );
};

const ensureDirectory = async (uri) => {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
};

const ensureDirectoryForFile = async (fileUri) => {
    const directory = dirname(fileUri);

    if (directory) {
        await ensureDirectory(directory);
    }
};

const coverExtensionFromMime = (mime = '', fallbackPath = '') => {
    const lowerMime = String(mime || '').toLowerCase();
    const lowerPath = String(fallbackPath || '').toLowerCase();

    if (lowerMime.includes('png') || lowerPath.endsWith('.png')) return 'png';
    if (lowerMime.includes('webp') || lowerPath.endsWith('.webp')) return 'webp';
    if (lowerMime.includes('gif') || lowerPath.endsWith('.gif')) return 'gif';
    if (lowerMime.includes('svg') || lowerPath.endsWith('.svg')) return 'svg';
    return 'jpg';
};

const writeCoverBase64ToFile = async ({ base64, mime, sourcePath, seed }) => {
    const documentDirectory = FileSystem.documentDirectory;

    if (!documentDirectory || !base64) {
        return null;
    }

    const coverDir = `${documentDirectory}${BOOK_COVER_DIR}/`;
    const ext = coverExtensionFromMime(mime, sourcePath);
    const coverHash = hashString(`${seed || 'cover'}:${sourcePath || ''}:${base64.length}:${base64.slice(0, 512)}`);
    const coverUri = `${coverDir}${coverHash}.${ext}`;

    await ensureDirectory(coverDir);

    const existingCover = await FileSystem.getInfoAsync(coverUri);
    if (existingCover.exists) {
        return coverUri;
    }

    await FileSystem.writeAsStringAsync(coverUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
    });

    return coverUri;
};

export const persistCoverDataUri = async (cover, seed = 'cover') => {
    const value = typeof cover === 'string' ? cover.trim() : '';

    if (!value) {
        return null;
    }

    if (!value.startsWith('data:')) {
        return value;
    }

    const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
    if (!match) {
        return null;
    }

    try {
        return await writeCoverBase64ToFile({
            base64: match[2],
            mime: match[1],
            sourcePath: '',
            seed,
        });
    } catch (error) {
        console.warn('[epubMetadata] Failed to persist inline cover image:', error);
        return null;
    }
};

export const stripInlineCoverForStorage = (book) => {
    if (!book || typeof book !== 'object') {
        return book;
    }

    const cover = typeof book.cover === 'string' ? book.cover.trim() : '';

    return cover.startsWith('data:')
        ? { ...book, cover: null }
        : book;
};

const toExtractedFileUri = (rootUri, path) => {
    if (!rootUri || !path) {
        return null;
    }

    return `${rootUri}${path}`;
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

const findFallbackPackagePath = (zip) => {
    const fileNames = Object.keys(zip.files || {});
    return fileNames.find((name) => name.toLowerCase().endsWith('.opf')) || null;
};

const safeDecodePath = (path = '') => {
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
};

const findZipFile = (zip, path) => {
    const normalizedPath = String(path || '').replace(/\\/g, '/');
    const decodedPath = safeDecodePath(normalizedPath);

    return zip.file(normalizedPath) || (decodedPath !== normalizedPath ? zip.file(decodedPath) : null);
};

const stripUrlFragment = (url = '') => String(url).split('#')[0].split('?')[0];

const XML_ENTITY_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

const HTML_ENTITY_REPLACEMENTS = {
    nbsp: '&#160;',
    ensp: '&#8194;',
    emsp: '&#8195;',
    thinsp: '&#8201;',
    ndash: '&#8211;',
    mdash: '&#8212;',
    lsquo: '&#8216;',
    rsquo: '&#8217;',
    ldquo: '&#8220;',
    rdquo: '&#8221;',
    hellip: '&#8230;',
    middot: '&#183;',
    bull: '&#8226;',
    copy: '&#169;',
    reg: '&#174;',
    trade: '&#8482;',
    laquo: '&#171;',
    raquo: '&#187;',
    lsaquo: '&#8249;',
    rsaquo: '&#8250;',
    deg: '&#176;',
    plusmn: '&#177;',
    times: '&#215;',
    divide: '&#247;',
    euro: '&#8364;',
    pound: '&#163;',
    yen: '&#165;',
    cent: '&#162;',
    sect: '&#167;',
    para: '&#182;',
};

const normalizeXhtmlEntities = (xhtml = '') => (
    String(xhtml).replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => {
        if (XML_ENTITY_NAMES.has(name)) {
            return match;
        }

        return HTML_ENTITY_REPLACEMENTS[name.toLowerCase()] || `&amp;${name};`;
    })
);

const splitResourceHref = (href = '') => {
    const originalHref = String(href || '').trim();
    const hashIndex = originalHref.indexOf('#');
    const beforeFragment = hashIndex >= 0 ? originalHref.slice(0, hashIndex) : originalHref;
    const fragment = hashIndex >= 0 ? originalHref.slice(hashIndex + 1) : '';
    const queryIndex = beforeFragment.indexOf('?');

    return {
        originalHref,
        pathHref: queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment,
        query: queryIndex >= 0 ? beforeFragment.slice(queryIndex + 1) : '',
        fragment,
    };
};

const isExternalResourceHref = (href = '') => (
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) ||
    /^(?:https?|mailto|tel):/i.test(href)
);

const isDataResourceHref = (href = '') => /^data:/i.test(href);

const resourceKindFromMediaType = (mediaType = '', path = '') => {
    const type = mediaType.toLowerCase();
    const lowerPath = path.toLowerCase();

    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(lowerPath)) return 'image';
    if (type === 'text/css' || lowerPath.endsWith('.css')) return 'stylesheet';
    if (type.startsWith('font/') || /\.(ttf|otf|woff2?)$/i.test(lowerPath)) return 'font';
    if (type.startsWith('audio/')) return 'audio';
    if (type.startsWith('video/')) return 'video';
    if (type.includes('xhtml') || type.includes('html') || /\.(xhtml|html)$/i.test(lowerPath)) return 'document';
    if (type.includes('xml') || /\.(xml|opf|ncx)$/i.test(lowerPath)) return 'metadata';
    return 'asset';
};

const manifestItemForPath = (manifestByPath = {}, path = '') => {
    if (!path) {
        return null;
    }

    const decodedPath = safeDecodePath(path);
    return manifestByPath[path] || manifestByPath[decodedPath] || null;
};

const resolveEpubResource = ({
    zip,
    href,
    basePath = '',
    extractedRootUri = null,
    manifestByPath = {},
    fallbackMediaType = '',
    role = 'asset',
}) => {
    const { originalHref, pathHref, query, fragment } = splitResourceHref(href);

    if (!originalHref) {
        return null;
    }

    if (isDataResourceHref(originalHref)) {
        return {
            href: originalHref,
            path: null,
            fileUri: null,
            mediaType: fallbackMediaType || 'data-uri',
            kind: 'data',
            role,
            exists: true,
            query,
            fragment,
            manifestId: null,
            dataUri: originalHref,
        };
    }

    if (isExternalResourceHref(originalHref)) {
        return {
            href: originalHref,
            path: null,
            fileUri: originalHref,
            mediaType: fallbackMediaType || '',
            kind: 'external',
            role,
            exists: true,
            query,
            fragment,
            manifestId: null,
        };
    }

    const path = pathHref ? resolveHrefPath(dirname(basePath), pathHref) : '';
    const manifestItem = manifestItemForPath(manifestByPath, path);
    const mediaType = manifestItem?.mediaType || fallbackMediaType || mimeFromPath(path);
    const resourceFile = path ? findZipFile(zip, path) : null;
    const resolvedPath = resourceFile?.name || path;
    const exists = Boolean(resourceFile);

    return {
        href: originalHref,
        path: resolvedPath,
        fileUri: resolvedPath ? toExtractedFileUri(extractedRootUri, resolvedPath) : null,
        mediaType,
        kind: resourceKindFromMediaType(mediaType, resolvedPath),
        role,
        exists,
        query,
        fragment,
        manifestId: manifestItem?.id || null,
    };
};

const dedupeResources = (resources = []) => {
    const seen = new Set();

    return resources.filter((resource) => {
        if (!resource) {
            return false;
        }

        const key = `${resource.role}:${resource.path || resource.href}`;
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
};

const isChapterSpineItem = (item, { allowNonLinear = false } = {}) => {
    const mediaType = item?.mediaType?.toLowerCase?.() || '';
    const path = item?.path?.toLowerCase?.() || '';

    return (
        item?.path &&
        (allowNonLinear || item.linear !== 'no') &&
        (
            mediaType === 'application/xhtml+xml' ||
            mediaType === 'text/html' ||
            path.endsWith('.xhtml') ||
            path.endsWith('.html')
        )
    );
};

const spineItemSkipReason = (item, options) => {
    if (!item?.path) {
        return 'missing path';
    }

    if (item.linear === 'no' && !options?.allowNonLinear) {
        return 'linear=no';
    }

    if (!isChapterSpineItem(item, options)) {
        return 'not an XHTML chapter';
    }

    return null;
};

const spineItemNameCandidates = (item = {}) => (
    [item.idref, item.href, item.path]
        .map((value) => {
            const fileName = stripUrlFragment(String(value || '').replace(/\\/g, '/'))
                .split('/')
                .pop() || '';

            return safeDecodePath(fileName)
                .replace(/\.[a-z0-9]+$/i, '')
                .toLowerCase();
        })
        .filter(Boolean)
);

const spineItemAutoSkipReason = (item) => {
    const names = spineItemNameCandidates(item);

    for (const name of names) {
        const compactName = name.replace(/[\s_-]+/g, '');

        if (/^(cover|coverpage|frontcover|backcover|titlepage)$/.test(compactName)) {
            return 'front matter: cover/title page';
        }

        if (/^incover\d*$/.test(compactName)) {
            return 'front matter: inside cover';
        }

        if (/^(author|authors|aboutauthor|abouttheauthor)$/.test(compactName)) {
            return 'front matter: author page';
        }

        if (/^(copy|copyright|rights|legal|imprint|colophon)$/.test(compactName)) {
            return 'front matter: copyright';
        }

        if (/^(toc|nav|navigation|contents|tableofcontents)$/.test(compactName)) {
            return 'front matter: navigation';
        }
    }

    return null;
};

const normalizeTextValue = (value = '', preserveWhitespace = false) => {
    const raw = String(value || '');

    if (preserveWhitespace) {
        return raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    }

    return raw
        .replace(/\u00a0/g, ' ')
        .replace(/[\t\n\r\f ]+/g, ' ');
};

const convertLeadingIndentWhitespace = (rawText = '', normalizedText = '', tokens = {}) => {
    const match = String(rawText || '').match(/^([\u00A0\u3000\s]+)/);

    if (!match) {
        return normalizedText;
    }

    const leading = match[1];
    const nbspCount = (leading.match(/\u00A0/g) || []).length;
    const ideographicSpaceCount = (leading.match(/\u3000/g) || []).length;
    const indentEm = (nbspCount * 0.5) + ideographicSpaceCount;

    if (indentEm > 0 && tokens.textIndent === undefined) {
        tokens.textIndent = { value: indentEm, unit: 'em' };
    }

    return indentEm > 0
        ? normalizedText.replace(/^[\u00A0\u3000\s]+/, '')
        : normalizedText;
};

const hasRenderableContent = (node) => {
    if (!node) {
        return false;
    }

    if (node.type === 'text') {
        return node.text.length > 0;
    }

    if (node.type === 'image' || node.type === 'lineBreak') {
        return true;
    }

    return (node.children || []).some(hasRenderableContent);
};

const trimLeadingText = (node) => {
    if (!node) {
        return false;
    }

    if (node.type === 'text') {
        node.text = node.text.replace(/^ +/, '');
        return node.text.length > 0;
    }

    if (node.type === 'image') {
        return true;
    }

    if (node.type === 'lineBreak') {
        return false;
    }

    while (node.children?.length) {
        const first = node.children[0];
        if (trimLeadingText(first)) {
            return true;
        }

        node.children.shift();
    }

    return hasRenderableContent(node);
};

const trimTrailingText = (node) => {
    if (!node) {
        return false;
    }

    if (node.type === 'text') {
        node.text = node.text.replace(/ +$/, '');
        return node.text.length > 0;
    }

    if (node.type === 'image') {
        return true;
    }

    if (node.type === 'lineBreak') {
        return false;
    }

    while (node.children?.length) {
        const last = node.children[node.children.length - 1];
        if (trimTrailingText(last)) {
            return true;
        }

        node.children.pop();
    }

    return hasRenderableContent(node);
};

const normalizeParsedChildren = (children, { trimEdges = false, preserveWhitespace = false } = {}) => {
    if (preserveWhitespace) {
        return children.filter(hasRenderableContent);
    }

    const normalized = children.filter(hasRenderableContent);

    if (trimEdges) {
        while (normalized.length && !trimLeadingText(normalized[0])) {
            normalized.shift();
        }

        while (normalized.length && !trimTrailingText(normalized[normalized.length - 1])) {
            normalized.pop();
        }
    }

    return normalized.filter(hasRenderableContent);
};

const loadEpubZip = async (uri) => {
    const response = await fetch(uri);
    if (!response.ok) {
        throw new Error(`Failed to fetch EPUB: ${response.status}`);
    }

    const epubBuffer = await response.arrayBuffer();
    return JSZip.loadAsync(epubBuffer);
};

const extractEpubZip = async (zip, sourceUri, fallbackName = '') => {
    const documentDirectory = FileSystem.documentDirectory;

    if (!documentDirectory) {
        throw new Error('File system document directory is unavailable.');
    }

    const rootUri = `${documentDirectory}${NATIVE_EPUB_DIR}/${hashString(`${sourceUri}:${fallbackName}`)}-${sanitizePathSegment(fallbackName)}/`;

    await FileSystem.deleteAsync(rootUri, { idempotent: true });
    await ensureDirectory(rootUri);

    const entries = Object.values(zip.files || {});
    let fileCount = 0;

    for (const entry of entries) {
        const entryPath = String(entry.name || '').replace(/\\/g, '/');

        if (!isSafeZipPath(entryPath)) {
            console.warn(`[epubMetadata] Skipping unsafe EPUB path: ${entryPath}`);
            continue;
        }

        const targetUri = toExtractedFileUri(rootUri, entryPath);

        if (entry.dir) {
            await ensureDirectory(targetUri.endsWith('/') ? targetUri : `${targetUri}/`);
            continue;
        }

        await ensureDirectoryForFile(targetUri);
        const base64 = await entry.async('base64');
        await FileSystem.writeAsStringAsync(targetUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
        });
        fileCount += 1;
    }

    return {
        rootUri,
        fileCount,
    };
};

const packageCacheKey = (uri = '', fallbackName = '') => (
    `${EPUB_PACKAGE_CACHE_VERSION}\n${uri}\n${fallbackName || ''}`
);

const loadCachedEpubPackage = async (uri, fallbackName = '') => {
    const cacheKey = packageCacheKey(uri, fallbackName);
    const cachedPackage = EPUB_PACKAGE_CACHE.get(cacheKey);

    if (cachedPackage) {
        return cachedPackage;
    }

    const packagePromise = (async () => {
        const zip = await loadEpubZip(uri);
        const extractedBook = await extractEpubZip(zip, uri, fallbackName);
        const containerFile = zip.file('META-INF/container.xml');
        let containerXml = null;
        let packagePath = null;

        if (containerFile) {
            containerXml = await containerFile.async('string');
            packagePath = findPackagePath(containerXml);
        }

        if (!packagePath) {
            packagePath = findFallbackPackagePath(zip);
        }

        if (!packagePath) {
            throw new Error('No OPF package file was found inside this EPUB.');
        }

        const packageFile = findZipFile(zip, packagePath);

        if (!packageFile) {
            throw new Error(`The EPUB points to "${packagePath}", but that file is missing.`);
        }

        const packageXml = await packageFile.async('string');
        const parsedPackageBase = parsePackageDocument(packageXml, packagePath, fallbackName, extractedBook.rootUri);
        const parsedToc = await readPackageToc(zip, parsedPackageBase);
        const parsedPackage = {
            ...parsedPackageBase,
            toc: buildTocNavigation(parsedToc.items, parsedPackageBase.spine, {
                hasTocEntries: parsedToc.items.length > 0,
            }),
            tocSource: parsedToc.source,
        };
        const bookResources = buildBookResources(zip, parsedPackage);

        return {
            zip,
            extractedBook,
            containerXml,
            packagePath,
            packageXml,
            parsedPackage,
            bookResources,
        };
    })();

    EPUB_PACKAGE_CACHE.set(cacheKey, packagePromise);

    try {
        const loadedPackage = await packagePromise;
        EPUB_PACKAGE_CACHE.set(cacheKey, loadedPackage);
        return loadedPackage;
    } catch (error) {
        if (EPUB_PACKAGE_CACHE.get(cacheKey) === packagePromise) {
            EPUB_PACKAGE_CACHE.delete(cacheKey);
        }
        throw error;
    }
};

const parsePackageDocument = (opfXml, packagePath, fallbackName = '', extractedRootUri = null) => {
    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    const packageDir = dirname(packagePath);

    const titleNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'title');
    const creatorNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'creator');
    const languageNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'language');
    const metadataNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'metadata');
    const manifestNode = firstDescendant(opfDoc, (node) => {
        const name = localNameOf(node);
        return name === 'manifest' || name === 'manifests';
    });
    const spineNode = firstDescendant(opfDoc, (node) => localNameOf(node) === 'spine');
    const manifestItems = descendants(manifestNode, (node) => localNameOf(node) === 'item')
        .map((item) => {
            const href = item.getAttribute('href') || '';
            const path = href ? resolveHrefPath(packageDir, href) : '';

            return {
                id: item.getAttribute('id') || '',
                href,
                path,
                fileUri: path ? toExtractedFileUri(extractedRootUri, path) : null,
                mediaType: item.getAttribute('media-type') || '',
                properties: item.getAttribute('properties') || '',
            };
        })
        .filter((item) => item.id || item.href);
    const manifestById = manifestItems.reduce((acc, item) => {
        if (item.id) {
            acc[item.id] = item;
        }

        return acc;
    }, {});
    const manifestByPath = manifestItems.reduce((acc, item) => {
        if (item.path) {
            acc[item.path] = item;
            acc[safeDecodePath(item.path)] = item;
        }

        return acc;
    }, {});
    const spineTocId = spineNode?.getAttribute('toc') || '';
    const navManifestItem = manifestItems.find((item) => {
        const isHtmlDocument = /(?:xhtml|html)/i.test(`${item.mediaType} ${item.path}`);
        if (!isHtmlDocument) {
            return false;
        }

        if (item.properties.split(/\s+/).includes('nav')) {
            return true;
        }

        return spineItemNameCandidates(item).some((name) => {
            const compactName = name.replace(/[\s_-]+/g, '');
            return /^(toc|nav|navigation|contents|tableofcontents)$/.test(compactName);
        });
    }) || null;
    const ncxManifestItem = (spineTocId ? manifestById[spineTocId] : null)
        || manifestItems.find((item) => (
            /(?:ncx|dtbncx)/i.test(item.mediaType)
            || item.path.toLowerCase().endsWith('.ncx')
        ))
        || null;
    const spine = descendants(spineNode, (node) => localNameOf(node) === 'itemref')
        .map((itemref, index) => {
            const idref = itemref.getAttribute('idref') || '';
            const manifestItem = manifestById[idref] || null;

            return {
                index,
                idref,
                linear: itemref.getAttribute('linear') || 'yes',
                href: manifestItem?.href || '',
                path: manifestItem?.path || '',
                fileUri: manifestItem?.fileUri || null,
                mediaType: manifestItem?.mediaType || '',
                properties: manifestItem?.properties || '',
            };
        });

    return {
        metadata: {
            title: textOf(titleNode) || cleanFallbackTitle(fallbackName),
            author: textOf(creatorNode) || 'Unknown author',
            language: textOf(languageNode) || null,
            identifier: textOf(firstDescendant(metadataNode, (node) => localNameOf(node) === 'identifier')) || null,
        },
        packagePath,
        packageDir,
        extractedRootUri,
        manifest: manifestItems,
        manifestById,
        manifestByPath,
        spineTocId,
        navManifestItem,
        ncxManifestItem,
        spine,
        toc: [],
        tocSource: null,
        firstSpineItem: spine.find(isChapterSpineItem) || spine.find((item) => item.path) || null,
    };
};

const attributeValue = (node, ...names) => {
    for (const name of names) {
        const value = node?.getAttribute?.(name);
        if (value) {
            return value;
        }
    }

    return '';
};

const hasToken = (value = '', token = '') => (
    String(value || '').split(/\s+/).filter(Boolean).includes(token)
);

const tocItemPathFromHref = (tocPath = '', href = '') => {
    const hrefPath = stripUrlFragment(href).replace(/\\/g, '/');

    if (!hrefPath) {
        return '';
    }

    return resolveHrefPath(dirname(tocPath), hrefPath);
};

const normalizeTocDepth = (depth) => {
    const value = Number(depth);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
};

const parseNavList = (olNode, tocPath, depth = 0) => {
    const items = [];

    childElements(olNode)
        .filter((node) => localNameOf(node).toLowerCase() === 'li')
        .forEach((liNode) => {
            const liChildren = childElements(liNode);
            const labelNode = liChildren.find((node) => {
                const name = localNameOf(node).toLowerCase();
                return name === 'a' || name === 'span';
            });
            const labelNodeName = localNameOf(labelNode).toLowerCase();
            const href = labelNodeName === 'a' ? attributeValue(labelNode, 'href') : '';
            const label = normalizeTextValue(textOf(labelNode)).trim();

            if (labelNode || href) {
                items.push({
                    id: attributeValue(labelNode, 'id') || attributeValue(liNode, 'id') || '',
                    label,
                    href,
                    path: tocItemPathFromHref(tocPath, href),
                    depth,
                    source: 'nav',
                });
            }

            liChildren
                .filter((node) => localNameOf(node).toLowerCase() === 'ol')
                .forEach((childOl) => {
                    items.push(...parseNavList(childOl, tocPath, depth + 1));
                });
        });

    return items;
};

const parseNavDocumentToc = (navXml, navPath) => {
    const navDoc = parser.parseFromString(normalizeXhtmlEntities(navXml), 'application/xml');
    const navNodes = descendants(navDoc, (node) => localNameOf(node).toLowerCase() === 'nav');
    const tocNavNode = navNodes.find((node) => (
        hasToken(attributeValue(node, 'epub:type', 'type'), 'toc')
    )) || navNodes[0] || null;
    const rootList = tocNavNode
        ? childElements(tocNavNode).find((node) => localNameOf(node).toLowerCase() === 'ol')
            || firstDescendant(tocNavNode, (node) => localNameOf(node).toLowerCase() === 'ol')
        : null;

    return rootList ? parseNavList(rootList, navPath, 0) : [];
};

const parseNcxNavPoint = (navPointNode, ncxPath, depth = 0) => {
    const navLabelNode = childElements(navPointNode)
        .find((node) => localNameOf(node).toLowerCase() === 'navlabel');
    const textNode = firstDescendant(navLabelNode, (node) => localNameOf(node).toLowerCase() === 'text');
    const contentNode = childElements(navPointNode)
        .find((node) => localNameOf(node).toLowerCase() === 'content');
    const href = attributeValue(contentNode, 'src');
    const label = normalizeTextValue(textOf(textNode || navLabelNode)).trim();
    const item = {
        id: attributeValue(navPointNode, 'id') || '',
        label,
        href,
        path: tocItemPathFromHref(ncxPath, href),
        depth,
        playOrder: Number(attributeValue(navPointNode, 'playOrder')) || null,
        source: 'ncx',
    };
    const children = childElements(navPointNode)
        .filter((node) => localNameOf(node).toLowerCase() === 'navpoint')
        .flatMap((childNode) => parseNcxNavPoint(childNode, ncxPath, depth + 1));

    return (label || href) ? [item, ...children] : children;
};

const parseNcxDocumentToc = (ncxXml, ncxPath) => {
    const ncxDoc = parser.parseFromString(normalizeXhtmlEntities(ncxXml), 'application/xml');
    const navMapNode = firstDescendant(ncxDoc, (node) => localNameOf(node).toLowerCase() === 'navmap');

    if (!navMapNode) {
        return [];
    }

    return childElements(navMapNode)
        .filter((node) => localNameOf(node).toLowerCase() === 'navpoint')
        .flatMap((navPointNode) => parseNcxNavPoint(navPointNode, ncxPath, 0));
};

const readPackageToc = async (zip, parsedPackage) => {
    const readTocFile = async (manifestItem) => {
        if (!manifestItem?.path) {
            return null;
        }

        const tocFile = findZipFile(zip, manifestItem.path);
        return tocFile ? tocFile.async('string') : null;
    };

    if (parsedPackage.navManifestItem) {
        try {
            const navXml = await readTocFile(parsedPackage.navManifestItem);
            const navItems = navXml
                ? parseNavDocumentToc(navXml, parsedPackage.navManifestItem.path)
                : [];

            if (navItems.length > 0) {
                return { items: navItems, source: 'nav' };
            }
        } catch (error) {
            console.warn('[epubMetadata] Failed to parse EPUB NAV table of contents:', error);
        }
    }

    if (parsedPackage.ncxManifestItem) {
        try {
            const ncxXml = await readTocFile(parsedPackage.ncxManifestItem);
            const ncxItems = ncxXml
                ? parseNcxDocumentToc(ncxXml, parsedPackage.ncxManifestItem.path)
                : [];

            if (ncxItems.length > 0) {
                return { items: ncxItems, source: 'ncx' };
            }
        } catch (error) {
            console.warn('[epubMetadata] Failed to parse EPUB NCX table of contents:', error);
        }
    }

    return {
        items: [],
        source: parsedPackage.navManifestItem || parsedPackage.ncxManifestItem ? 'empty' : 'spine',
    };
};

const findSpineItemForTocPath = (tocPath = '', spine = []) => {
    const normalizedPath = String(tocPath || '').replace(/\\/g, '/');

    if (!normalizedPath) {
        return null;
    }

    const pathCandidates = [...new Set([
        normalizedPath,
        safeDecodePath(normalizedPath),
    ].filter(Boolean))];

    return spine.find((spineItem) => {
        const spinePath = String(spineItem?.path || '').replace(/\\/g, '/');
        const spinePathCandidates = [...new Set([
            spinePath,
            safeDecodePath(spinePath),
        ].filter(Boolean))];

        return spinePathCandidates.some((candidate) => (
            pathCandidates.some((pathCandidate) => (
                candidate === pathCandidate
                || candidate.endsWith(`/${pathCandidate}`)
            ))
        ));
    }) || null;
};

const tocLabelForItem = (item = {}) => normalizeTextValue(item.label || item.title || '').trim();

const positionLabelForSpineIndex = (spineIndex, totalSpineItems) => (
    Number.isInteger(spineIndex) ? `${spineIndex + 1}/${totalSpineItems}` : ''
);

const buildTocSpineMap = (tocItems = [], spine = []) => {
    const totalSpineItems = spine.length;

    return tocItems.flatMap((item, index) => {
        const title = tocLabelForItem(item);
        if (!title) {
            return [];
        }

        const hrefPath = item.path || stripUrlFragment(item.href || '');
        const spineItem = findSpineItemForTocPath(hrefPath, spine);
        const spineIndex = Number.isInteger(spineItem?.index) ? spineItem.index : null;

        return [{
            id: item.id || `toc-${index}`,
            title,
            label: title,
            href: item.href || '',
            path: hrefPath || '',
            spineIndex,
            depth: normalizeTocDepth(item.depth),
            positionLabel: positionLabelForSpineIndex(spineIndex, totalSpineItems),
            disabled: spineIndex === null,
            source: item.source || 'toc',
            listed: true,
        }];
    });
};

const buildTocNavigation = (tocItems = [], spine = [], { hasTocEntries = false } = {}) => {
    if (!hasTocEntries) {
        return [];
    }

    return buildTocSpineMap(tocItems, spine);
};

const buildBookResources = (zip, parsedPackage) => (
    parsedPackage.manifest
        .filter((item) => item.path)
        .map((item) => {
            const resourceFile = findZipFile(zip, item.path);
            const resolvedPath = resourceFile?.name || item.path;

            return {
                id: item.id,
                href: item.href,
                path: resolvedPath,
                fileUri: toExtractedFileUri(parsedPackage.extractedRootUri, resolvedPath),
                mediaType: item.mediaType || mimeFromPath(resolvedPath),
                kind: resourceKindFromMediaType(item.mediaType, resolvedPath),
                role: 'manifest',
                exists: Boolean(resourceFile),
                properties: item.properties,
                manifestId: item.id || null,
            };
        })
);

const buildBookManifest = ({
    sourceUri,
    fallbackName,
    parsedPackage,
    extractedBook,
    packagePath,
    currentSpineItem,
}) => {
    const metadata = parsedPackage.metadata;
    const stableBookSeed = metadata.identifier
        || `${metadata.title}:${metadata.author}:${packagePath}:${fallbackName || sourceUri}`;

    return {
        bookId: `book_${hashString(stableBookSeed)}`,
        sourceUri,
        title: metadata.title,
        author: metadata.author,
        identifier: metadata.identifier,
        language: metadata.language,
        packagePath,
        packageFileUri: toExtractedFileUri(extractedBook.rootUri, packagePath),
        extractedRootUri: extractedBook.rootUri,
        currentSpineIndex: currentSpineItem?.index ?? 0,
        currentSpineHref: currentSpineItem?.href || '',
        currentSpinePath: currentSpineItem?.path || '',
        totalSpineItems: parsedPackage.spine.length,
        manifestItemCount: parsedPackage.manifest.length,
        resourceCount: parsedPackage.manifest.filter((item) => item.path).length,
        spineOrder: parsedPackage.spine.map((item) => ({
            index: item.index,
            idref: item.idref,
            path: item.path,
            fileUri: item.fileUri,
            mediaType: item.mediaType,
            linear: item.linear,
            properties: item.properties,
        })),
    };
};

const extractBodyText = (xhtmlXml) => {
    const xhtmlDoc = parser.parseFromString(normalizeXhtmlEntities(xhtmlXml), 'application/xml');
    const bodyNode = firstDescendant(xhtmlDoc, (node) => localNameOf(node) === 'body');
    const text = textOf(bodyNode || xhtmlDoc);

    return normalizeTextValue(text).trim();
};

const blockTags = new Set([
    'body',
    'section',
    'article',
    'main',
    'header',
    'footer',
    'nav',
    'aside',
    'div',
    'p',
    'blockquote',
    'pre',
    'ul',
    'ol',
    'li',
    'figure',
    'figcaption',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
]);

const headingTagPattern = /^h([1-6])$/;

const attributeMap = (node) => ({
    id: node.getAttribute?.('id') || null,
    className: node.getAttribute?.('class') || null,
    href: node.getAttribute?.('href') || null,
    src: node.getAttribute?.('src') || node.getAttribute?.('xlink:href') || null,
    alt: node.getAttribute?.('alt') || null,
    style: node.getAttribute?.('style') || null,
});

const compactAttributes = (attrs = {}) => (
    Object.entries(attrs).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
            acc[key] = value;
        }

        return acc;
    }, {})
);

const mergeStyleTokens = (...tokenSets) => (
    tokenSets.reduce((acc, tokens) => {
        Object.entries(tokens || {}).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                acc[key] = value;
            }
        });

        return acc;
    }, {})
);

const inheritedStyleTokenKeys = new Set([
    'color',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'lineHeight',
    'textAlign',
    'textIndent',
]);

const blockContextStyleTokenKeys = new Set([
    'marginLeft',
    'paddingLeft',
]);

const pickStyleTokens = (tokens = {}, allowedKeys = new Set()) => (
    Object.entries(tokens || {}).reduce((acc, [key, value]) => {
        if (allowedKeys.has(key) && value !== null && value !== undefined && value !== '') {
            acc[key] = value;
        }

        return acc;
    }, {})
);

const parseCssDeclarations = (declarations = '') => (
    String(declarations || '')
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .reduce((acc, declaration) => {
            const separatorIndex = declaration.indexOf(':');

            if (separatorIndex <= 0) {
                return acc;
            }

            const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
            const value = declaration.slice(separatorIndex + 1).trim();

            if (property && value) {
                acc[property] = value.replace(/\s*!important$/i, '').trim();
            }

            return acc;
        }, {})
);

const numericCssValue = (value = '') => {
    const match = String(value).trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i);
    return match ? Number(match[1]) : value;
};

const expandShorthand = (value = '') => {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);

    switch (parts.length) {
        case 1:
            return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
        case 2:
            return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
        case 3:
            return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
        case 4:
            return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
        default:
            return {};
    }
};

const cssDeclarationsToStyleTokens = (declarations = {}) => {
    const tokens = {};

    Object.entries(declarations).forEach(([property, rawValue]) => {
        const value = String(rawValue || '').trim();
        const lowerValue = value.toLowerCase();

        switch (property) {
            case 'display':
                tokens.display = lowerValue;
                break;
            case 'text-align':
                tokens.textAlign = lowerValue;
                break;
            case 'font-size':
                tokens.fontSize = numericCssValue(value);
                break;
            case 'font-weight':
                tokens.fontWeight = /^\d+$/.test(lowerValue)
                    ? Number(lowerValue)
                    : lowerValue;
                break;
            case 'font-style':
                tokens.fontStyle = lowerValue;
                break;
            case 'font-family':
                tokens.fontFamily = value.replace(/^['"]|['"]$/g, '');
                break;
            case 'line-height':
                tokens.lineHeight = numericCssValue(value);
                break;
            case 'color':
                tokens.color = value;
                break;
            case 'background':
            case 'background-color':
                tokens.backgroundColor = value;
                break;
            case 'text-indent':
                tokens.textIndent = numericCssValue(value);
                break;
            case 'margin': {
                const parts = expandShorthand(value);

                if (parts.top !== undefined) tokens.marginTop = numericCssValue(parts.top);
                if (parts.right !== undefined) tokens.marginRight = numericCssValue(parts.right);
                if (parts.bottom !== undefined) tokens.marginBottom = numericCssValue(parts.bottom);
                if (parts.left !== undefined) tokens.marginLeft = numericCssValue(parts.left);
                break;
            }
            case 'margin-top':
                tokens.marginTop = numericCssValue(value);
                break;
            case 'margin-right':
                tokens.marginRight = numericCssValue(value);
                break;
            case 'margin-bottom':
                tokens.marginBottom = numericCssValue(value);
                break;
            case 'margin-left':
                tokens.marginLeft = numericCssValue(value);
                break;
            case 'padding': {
                const parts = expandShorthand(value);

                if (parts.top !== undefined) tokens.paddingTop = numericCssValue(parts.top);
                if (parts.right !== undefined) tokens.paddingRight = numericCssValue(parts.right);
                if (parts.bottom !== undefined) tokens.paddingBottom = numericCssValue(parts.bottom);
                if (parts.left !== undefined) tokens.paddingLeft = numericCssValue(parts.left);
                break;
            }
            case 'padding-top':
                tokens.paddingTop = numericCssValue(value);
                break;
            case 'padding-right':
                tokens.paddingRight = numericCssValue(value);
                break;
            case 'padding-bottom':
                tokens.paddingBottom = numericCssValue(value);
                break;
            case 'padding-left':
                tokens.paddingLeft = numericCssValue(value);
                break;
            case 'width':
                tokens.width = numericCssValue(value);
                break;
            case 'height':
                tokens.height = numericCssValue(value);
                break;
            case 'max-width':
                tokens.maxWidth = numericCssValue(value);
                break;
            case 'max-height':
                tokens.maxHeight = numericCssValue(value);
                break;
            case 'vertical-align':
                tokens.verticalAlign = lowerValue;
                break;
            case 'text-decoration':
            case 'text-decoration-line':
                if (lowerValue.includes('underline')) {
                    tokens.textDecorationLine = 'underline';
                } else if (lowerValue.includes('line-through')) {
                    tokens.textDecorationLine = 'line-through';
                } else if (lowerValue !== 'none') {
                    tokens.textDecorationLine = lowerValue;
                }
                break;
            case 'page-break-before':
            case 'break-before':
                tokens.breakBefore = lowerValue;
                break;
            case 'page-break-after':
            case 'break-after':
                tokens.breakAfter = lowerValue;
                break;
            default:
                break;
        }
    });

    return tokens;
};

const tagStyleTokens = (tag = '') => {
    const headingMatch = tag.match(headingTagPattern);

    if (headingMatch) {
        const level = Number(headingMatch[1]);
        const scaleByLevel = {
            1: 1.7,
            2: 1.45,
            3: 1.25,
            4: 1.1,
            5: 1,
            6: 0.95,
        };

        return {
            display: 'block',
            fontWeight: 700,
            fontScale: scaleByLevel[level] || 1,
            marginTop: '0.8em',
            marginBottom: '0.4em',
        };
    }

    switch (tag) {
        case 'p':
            return { display: 'block', marginTop: 0, marginBottom: '0.75em' };
        case 'blockquote':
            return { display: 'block', marginLeft: '1em', marginRight: '1em' };
        case 'li':
            return { display: 'list-item', marginBottom: '0.25em' };
        case 'pre':
            return { display: 'block', whiteSpace: 'pre-wrap', fontFamily: 'monospace' };
        case 'figcaption':
            return { display: 'block', fontScale: 0.9 };
        case 'strong':
        case 'b':
            return { fontWeight: 700 };
        case 'em':
        case 'i':
            return { fontStyle: 'italic' };
        case 'u':
            return { textDecorationLine: 'underline' };
        case 'a':
            return { textDecorationLine: 'underline' };
        case 'sup':
            return { verticalAlign: 'super', fontScale: 0.75 };
        case 'sub':
            return { verticalAlign: 'sub', fontScale: 0.75 };
        case 'rt':
            return { fontScale: 0.55 };
        default:
            return {};
    }
};

const cleanCssSelector = (selector = '') => (
    String(selector)
        .trim()
        .replace(/::?[a-zA-Z0-9_-]+(?:\([^)]*\))?/g, '')
        .replace(/\[[^\]]+\]/g, '')
        .trim()
);

const selectorParts = (selector = '') => (
    cleanCssSelector(selector)
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
);

const selectorSpecificity = (selector = '') => {
    const parts = selectorParts(selector);
    const idCount = (cleanCssSelector(selector).match(/#[a-zA-Z0-9_-]+/g) || []).length;
    const classCount = (cleanCssSelector(selector).match(/\.[a-zA-Z0-9_-]+/g) || []).length;
    const tagCount = parts.reduce((count, part) => (
        count + (part.match(/^[a-zA-Z][a-zA-Z0-9_-]*/) ? 1 : 0)
    ), 0);

    return (idCount * 100) + (classCount * 10) + tagCount;
};

const simpleSelectorMatches = (tag, attrs = {}, selector = '') => {
    const target = String(selector || '').trim();

    if (!target || target === '*') {
        return true;
    }

    const idMatch = target.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch && attrs.id !== idMatch[1]) {
        return false;
    }

    const classNames = String(attrs.className || '').split(/\s+/).filter(Boolean);
    const requiredClasses = (target.match(/\.([a-zA-Z0-9_-]+)/g) || [])
        .map((className) => className.slice(1));

    if (requiredClasses.some((className) => !classNames.includes(className))) {
        return false;
    }

    const tagMatch = target.match(/^[a-zA-Z][a-zA-Z0-9_-]*/);
    if (tagMatch && tagMatch[0].toLowerCase() !== tag) {
        return false;
    }

    return true;
};

const nodeMatchesCssSelector = (tag, attrs = {}, selector = '', ancestorChain = []) => {
    const parts = selectorParts(selector);
    const target = parts[parts.length - 1] || '';

    if (!simpleSelectorMatches(tag, attrs, target)) {
        return false;
    }

    let ancestorIndex = ancestorChain.length - 1;

    for (let partIndex = parts.length - 2; partIndex >= 0; partIndex -= 1) {
        const ancestorSelector = parts[partIndex];
        let matchedIndex = -1;

        for (let i = ancestorIndex; i >= 0; i -= 1) {
            const ancestor = ancestorChain[i];

            if (simpleSelectorMatches(ancestor?.tag, ancestor?.attrs, ancestorSelector)) {
                matchedIndex = i;
                break;
            }
        }

        if (matchedIndex < 0) {
            return false;
        }

        ancestorIndex = matchedIndex - 1;
    }

    return true;
};

const canEvaluateSelectorStatically = (selector = '') => {
    const raw = String(selector || '');

    if (/:(first|last|nth|only)-(child|of-type)/i.test(raw)) {
        return false;
    }

    if (/:(not|is|where|has)\s*\(/i.test(raw)) {
        return false;
    }

    if (/(^|[^:]):[a-zA-Z0-9_-]+(?:\([^)]*\))?/i.test(raw)) {
        return false;
    }

    if (/\[[^\]]+\]/.test(raw)) {
        return false;
    }

    if (/[+~>]/.test(raw)) {
        return false;
    }

    if (selectorParts(raw).length === 0) {
        return false;
    }

    return true;
};

const parseCssRules = (cssText = '', sourcePath = '') => {
    const cleanedCss = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    const rulePattern = /([^{}@]+)\{([^{}]+)\}/g;
    let match = rulePattern.exec(cleanedCss);

    while (match) {
        const selectors = match[1].split(',').map((selector) => selector.trim()).filter(Boolean);
        const declarations = parseCssDeclarations(match[2]);
        const styleTokens = cssDeclarationsToStyleTokens(declarations);

        selectors.forEach((selector) => {
            const trimmedSelector = selector.trim();

            if (
                Object.keys(styleTokens).length > 0 &&
                canEvaluateSelectorStatically(trimmedSelector)
            ) {
                rules.push({
                    selector: trimmedSelector,
                    declarations,
                    styleTokens,
                    specificity: selectorSpecificity(trimmedSelector),
                    sourcePath,
                    order: rules.length,
                });
            }
        });

        match = rulePattern.exec(cleanedCss);
    }

    return rules;
};

const matchedCssRulesForNode = (tag, attrs = {}, cssRules = [], ancestorChain = []) => (
    cssRules
        .filter((rule) => nodeMatchesCssSelector(tag, attrs, rule.selector, ancestorChain))
        .sort((a, b) => (
            a.specificity === b.specificity
                ? a.order - b.order
                : a.specificity - b.specificity
        ))
);

const resolveNodeStyleTokens = (tag, attrs = {}, cssRules = [], ancestorChain = []) => {
    const matchedCssTokens = matchedCssRulesForNode(tag, attrs, cssRules, ancestorChain)
        .map((rule) => rule.styleTokens);

    return mergeStyleTokens(
        tagStyleTokens(tag),
        ...matchedCssTokens,
        cssDeclarationsToStyleTokens(parseCssDeclarations(attrs.style || ''))
    );
};

const blockTypeForTag = (tag = '') => {
    if (headingTagPattern.test(tag)) return 'heading';
    if (tag === 'p') return 'paragraph';
    if (tag === 'li') return 'listItem';
    if (tag === 'blockquote') return 'quote';
    if (tag === 'pre') return 'preformatted';
    if (tag === 'figcaption') return 'caption';
    return 'block';
};

const blockMetadataForTag = (tag = '', context = {}) => {
    const metadata = {};
    const headingMatch = tag.match(headingTagPattern);

    if (headingMatch) {
        metadata.level = Number(headingMatch[1]);
    }

    if (tag === 'li') {
        metadata.listType = context.listStack?.[context.listStack.length - 1] || 'unordered';
    }

    return metadata;
};

const createChapterIdFactory = (spineItemOrPath) => {
    const spineIndex = Number.isInteger(spineItemOrPath?.index) ? spineItemOrPath.index : null;
    const path = typeof spineItemOrPath === 'string' ? spineItemOrPath : spineItemOrPath?.path;
    const chapterId = spineIndex !== null
        ? `spine_${String(spineIndex).padStart(4, '0')}`
        : `spine_${hashString(path || 'chapter')}`;
    const counters = {
        block: 0,
        inline: 0,
        span: 0,
        image: 0,
        line: 0,
    };

    return {
        chapterId,
        nextId: (kind) => {
            counters[kind] = (counters[kind] ?? 0) + 1;
            return `${chapterId}_${kind}_${String(counters[kind]).padStart(4, '0')}`;
        },
    };
};

const nodeHasText = (node) => {
    if (!node) {
        return false;
    }

    if (node.type === 'text') {
        return node.text.length > 0;
    }

    return (node.children || []).some(nodeHasText);
};

const nodeHasNestedBlock = (node) => (
    (node?.children || []).some((child) => child.type === 'block' || nodeHasNestedBlock(child))
);

const collectTextSpans = (node, spans = []) => {
    if (!node) {
        return spans;
    }

    if (node.type === 'text') {
        spans.push({
            id: node.id,
            text: node.text,
            tag: node.tag || null,
        });
        return spans;
    }

    if (node.type === 'lineBreak') {
        spans.push({
            id: node.id,
            text: '\n',
            tag: 'br',
        });
        return spans;
    }

    (node.children || []).forEach((child) => collectTextSpans(child, spans));
    return spans;
};

const buildSelectionBlocks = (root) => {
    const blocks = [];

    const visit = (node) => {
        if (!node) {
            return;
        }

        if (node.type === 'block' && nodeHasText(node) && !nodeHasNestedBlock(node)) {
            let offset = 0;
            const spans = collectTextSpans(node)
                .filter((span) => span.text.length > 0)
                .map((span) => {
                    const startOffset = offset;
                    offset += span.text.length;

                    return {
                        ...span,
                        startOffset,
                        endOffset: offset,
                    };
                });

            if (spans.length > 0) {
                blocks.push({
                    id: node.id,
                    tag: node.tag,
                    attrs: node.attrs,
                    styleTokens: node.styleTokens || {},
                    text: spans.map((span) => span.text).join(''),
                    spans,
                });
            }

            return;
        }

        (node.children || []).forEach(visit);
    };

    visit(root);
    return blocks;
};

const spanFromTextNode = (node, marks = [], text) => {
    const nearestMark = marks[marks.length - 1] || null;
    const linkMark = [...marks].reverse().find((mark) => mark.attrs?.href);
    const styleTokens = mergeStyleTokens(...marks.map((mark) => mark.styleTokens));

    return {
        id: node.id,
        text,
        tag: nearestMark?.tag || null,
        marks: marks.map((mark) => mark.tag),
        attrs: nearestMark?.attrs || {},
        href: linkMark?.attrs?.href || null,
        styleTokens,
    };
};

const collectNativeSpans = (node, marks = [], spans = []) => {
    if (!node) {
        return spans;
    }

    if (node.type === 'text') {
        if (node.text.length > 0) {
            spans.push(spanFromTextNode(node, marks, node.text));
        }

        return spans;
    }

    if (node.type === 'lineBreak') {
        spans.push(spanFromTextNode(node, marks, '\n'));
        return spans;
    }

    if (node.type === 'image') {
        return spans;
    }

    const nextMarks = node.type === 'inline'
        ? [
            ...marks,
            {
                tag: node.tag,
                attrs: compactAttributes(node.attrs),
                styleTokens: node.styleTokens || {},
            },
        ]
        : marks;

    (node.children || []).forEach((child) => collectNativeSpans(child, nextMarks, spans));
    return spans;
};

const withOffsets = (spans) => {
    let offset = 0;

    return spans.map((span) => {
        const startOffset = offset;
        offset += span.text.length;

        return {
            ...span,
            startOffset,
            endOffset: offset,
        };
    });
};

const normalizeNativeBlockSpans = (spans) => {
    let start = 0;
    let end = spans.length;

    while (start < end && spans[start]?.text === '\n') {
        start += 1;
    }

    while (end > start && spans[end - 1]?.text === '\n') {
        end -= 1;
    }

    return spans.slice(start, end).map((span) => (
        span.text === '\n'
            ? { ...span, text: ' ' }
            : span
    ));
};

const buildNativeChapterBlocks = (root) => {
    const blocks = [];

    const addTextBlock = (sourceNode, segmentNodes, blockId, context) => {
        const spans = withOffsets(
            normalizeNativeBlockSpans(
                segmentNodes.flatMap((node) => collectNativeSpans(node))
            )
        );
        const text = spans.map((span) => span.text).join('');

        if (!text.replace(/\s/g, '').length) {
            return;
        }

        const tag = sourceNode?.tag || 'p';

        const styleTokens = mergeStyleTokens(
            context.blockStyleTokens || {},
            sourceNode?.styleTokens || {}
        );

        blocks.push({
            id: blockId,
            type: blockTypeForTag(tag),
            tag,
            attrs: compactAttributes(sourceNode?.attrs),
            styleTokens,
            text,
            spans,
            ...blockMetadataForTag(tag, context),
        });
    };

    const addImageBlock = (node) => {
        blocks.push({
            id: node.id,
            type: 'image',
            tag: node.tag || 'img',
            attrs: compactAttributes(node.attrs),
            alt: node.attrs?.alt || '',
            path: node.path || null,
            fileUri: node.fileUri || null,
            dataUri: node.dataUri || null,
            mediaType: node.mediaType || null,
            exists: Boolean(node.exists),
            resource: node.resource || null,
            styleTokens: node.styleTokens || {},
            text: node.attrs?.alt || '',
            spans: [],
        });
    };

    const visit = (node, context = { listStack: [], blockStyleTokens: {} }) => {
        if (!node) {
            return;
        }

        if (node.type === 'root') {
            (node.children || []).forEach((child) => visit(child, context));
            return;
        }

        if (node.type === 'image') {
            addImageBlock(node);
            return;
        }

        if (node.type !== 'block') {
            addTextBlock({ tag: 'p', attrs: {} }, [node], node.id, context);
            return;
        }

        const nodeBlockStyleTokens = pickStyleTokens(
            node.styleTokens || {},
            blockContextStyleTokenKeys
        );
        const nextContext = {
            ...context,
            blockStyleTokens: mergeStyleTokens(context.blockStyleTokens || {}, nodeBlockStyleTokens),
            listStack: node.tag === 'ul' || node.tag === 'ol'
                ? [
                    ...(context.listStack || []),
                    node.tag === 'ol' ? 'ordered' : 'unordered',
                ]
                : (context.listStack || []),
        };
        let pendingInlineNodes = [];
        let textSegmentCount = 0;

        const flushPendingText = () => {
            if (!pendingInlineNodes.length) {
                return;
            }

            textSegmentCount += 1;
            const blockId = textSegmentCount === 1
                ? node.id
                : `${node.id}_text_${String(textSegmentCount).padStart(4, '0')}`;

            addTextBlock(node, pendingInlineNodes, blockId, nextContext);
            pendingInlineNodes = [];
        };

        (node.children || []).forEach((child) => {
            if (child.type === 'block' || child.type === 'image') {
                flushPendingText();
                visit(child, nextContext);
                return;
            }

            pendingInlineNodes.push(child);
        });

        flushPendingText();
    };

    visit(root);
    return blocks;
};

const extractStylesheetResources = (zip, xhtmlDoc, chapterPath, extractedRootUri, manifestByPath = {}) => (
    descendants(xhtmlDoc, (node) => {
        if (localNameOf(node).toLowerCase() !== 'link') {
            return false;
        }

        const rel = (node.getAttribute('rel') || '').toLowerCase();
        return rel.split(/\s+/).includes('stylesheet') && Boolean(node.getAttribute('href'));
    }).map((node) => resolveEpubResource({
        zip,
        href: node.getAttribute('href'),
        basePath: chapterPath,
        extractedRootUri,
        manifestByPath,
        fallbackMediaType: node.getAttribute('type') || 'text/css',
        role: 'stylesheet',
    }))
);

const cssUrlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

const extractCssReferencedResources = async (zip, stylesheetResources, extractedRootUri, manifestByPath = {}) => {
    const resources = [];

    for (const stylesheet of stylesheetResources) {
        if (!stylesheet?.path || !stylesheet.exists) {
            continue;
        }

        const cssFile = findZipFile(zip, stylesheet.path);
        if (!cssFile) {
            continue;
        }

        const cssText = await cssFile.async('string');
        cssUrlPattern.lastIndex = 0;
        let match = cssUrlPattern.exec(cssText);

        while (match) {
            const href = match[2]?.trim();

            if (href) {
                resources.push(resolveEpubResource({
                    zip,
                    href,
                    basePath: stylesheet.path,
                    extractedRootUri,
                    manifestByPath,
                    role: 'stylesheet-url',
                }));
            }

            match = cssUrlPattern.exec(cssText);
        }
    }

    return dedupeResources(resources);
};

const extractStylesheetRules = async (zip, stylesheetResources) => {
    const rules = [];

    for (const stylesheet of stylesheetResources) {
        if (!stylesheet?.path || !stylesheet.exists) {
            continue;
        }

        const cssFile = findZipFile(zip, stylesheet.path);
        if (!cssFile) {
            continue;
        }

        const cssText = await cssFile.async('string');
        const stylesheetRules = parseCssRules(cssText, stylesheet.path);

        stylesheetRules.forEach((rule) => {
            rules.push({
                ...rule,
                order: rules.length,
            });
        });
    }

    return rules;
};

const collectImageResources = (root, resources = []) => {
    if (!root) {
        return resources;
    }

    if (root.type === 'image' && root.resource) {
        resources.push(root.resource);
    }

    (root.children || []).forEach((child) => collectImageResources(child, resources));
    return resources;
};

const parseXhtmlRenderTree = async (
    zip,
    xhtmlXml,
    spineItemOrPath,
    extractedRootUri = null,
    manifestByPath = {}
) => {
    const xhtmlDoc = parser.parseFromString(normalizeXhtmlEntities(xhtmlXml), 'application/xml');
    const bodyNode = firstDescendant(xhtmlDoc, (node) => localNameOf(node) === 'body') || xhtmlDoc;
    const chapterPath = typeof spineItemOrPath === 'string' ? spineItemOrPath : spineItemOrPath?.path;
    const chapterDir = dirname(chapterPath);
    const idFactory = createChapterIdFactory(spineItemOrPath);
    const stylesheetResources = extractStylesheetResources(
        zip,
        xhtmlDoc,
        chapterPath,
        extractedRootUri,
        manifestByPath
    );
    const stylesheetReferencedResources = await extractCssReferencedResources(
        zip,
        stylesheetResources,
        extractedRootUri,
        manifestByPath
    );
    const styleRules = await extractStylesheetRules(zip, stylesheetResources);

    const parseNode = async (node, context = {}) => {
        const preserveWhitespace = Boolean(context.preserveWhitespace);
        const inheritedStyleTokens = context.inheritedStyleTokens || {};
        const blockStartState = context.blockStartState;
        const ancestorChain = context.ancestorChain || [];

        if (node?.nodeType === 3) {
            const rawText = String(node.nodeValue || '');
            const normalizedText = normalizeTextValue(rawText, preserveWhitespace);
            const text = !preserveWhitespace && blockStartState?.canSynthesizeIndent
                ? convertLeadingIndentWhitespace(rawText, normalizedText, blockStartState.tokens)
                : normalizedText;

            if (!preserveWhitespace && !text.trim()) {
                return null;
            }

            if (!preserveWhitespace && blockStartState) {
                blockStartState.canSynthesizeIndent = false;
            }

            return {
                id: idFactory.nextId('span'),
                type: 'text',
                text,
            };
        }

        if (node?.nodeType !== 1) {
            return null;
        }

        const tag = localNameOf(node).toLowerCase();
        const attrs = attributeMap(node);
        const styleTokens = mergeStyleTokens(
            inheritedStyleTokens,
            resolveNodeStyleTokens(tag, attrs, styleRules, ancestorChain)
        );
        const nextBlockStartState = blockTags.has(tag)
            ? { canSynthesizeIndent: true, tokens: styleTokens }
            : blockStartState;
        const nextContext = {
            preserveWhitespace: preserveWhitespace || tag === 'pre',
            inheritedStyleTokens: pickStyleTokens(styleTokens, inheritedStyleTokenKeys),
            blockStartState: nextBlockStartState,
            ancestorChain: [
                ...ancestorChain,
                { tag, attrs },
            ],
        };

        if (tag === 'br') {
            return {
                id: idFactory.nextId('line'),
                type: 'lineBreak',
            };
        }

        if (tag === 'img' || tag === 'image') {
            const src = stripUrlFragment(attrs.src || '');
            const resource = resolveEpubResource({
                zip,
                href: attrs.src || '',
                basePath: chapterPath,
                extractedRootUri,
                manifestByPath,
                role: 'image',
            });
            const imagePath = resource?.path || (src ? resolveHrefPath(chapterDir, src) : null);
            const imageFile = imagePath ? findZipFile(zip, imagePath) : null;
            const fileUri = resource?.fileUri || toExtractedFileUri(extractedRootUri, imagePath);
            let dataUri = null;

            if (resource?.dataUri) {
                dataUri = resource.dataUri;
            } else if (!fileUri && imageFile) {
                const base64 = await imageFile.async('base64');
                dataUri = `data:${mimeFromPath(imagePath)};base64,${base64}`;
            }

            return {
                id: idFactory.nextId('image'),
                type: 'image',
                tag,
                attrs,
                styleTokens,
                path: imagePath,
                fileUri,
                dataUri,
                exists: resource?.exists ?? Boolean(imageFile),
                mediaType: resource?.mediaType || mimeFromPath(imagePath),
                resource,
            };
        }

        const children = [];
        for (let i = 0; i < (node.childNodes?.length || 0); i += 1) {
            const child = await parseNode(node.childNodes[i], nextContext);
            if (child) {
                children.push(child);
            }
        }

        const nodeId = idFactory.nextId(blockTags.has(tag) ? 'block' : 'inline');

        return {
            id: nodeId,
            type: blockTags.has(tag) ? 'block' : 'inline',
            tag,
            attrs,
            styleTokens,
            children: normalizeParsedChildren(children, {
                trimEdges: blockTags.has(tag),
                preserveWhitespace: nextContext.preserveWhitespace,
            }),
        };
    };

    const root = await parseNode(bodyNode);

    const renderTree = {
        id: idFactory.chapterId,
        type: 'root',
        children: normalizeParsedChildren(root?.children || [], { trimEdges: true }),
    };

    return {
        renderTree,
        selectionBlocks: buildSelectionBlocks(renderTree),
        chapterBlocks: buildNativeChapterBlocks(renderTree),
        stylesheets: stylesheetResources,
        stylesheetResources: stylesheetReferencedResources,
        styleRules,
        resources: dedupeResources([
            ...stylesheetResources,
            ...stylesheetReferencedResources,
            ...collectImageResources(renderTree),
        ]),
    };
};

const countRenderTreeNodes = (node, predicate) => {
    if (!node) {
        return 0;
    }

    const current = predicate(node) ? 1 : 0;
    return current + (node.children || []).reduce(
        (total, child) => total + countRenderTreeNodes(child, predicate),
        0
    );
};

const spineDiagnosticBase = (item) => ({
    index: item?.index ?? null,
    idref: item?.idref || '',
    path: item?.path || '',
    fileUri: item?.fileUri || null,
    mediaType: item?.mediaType || '',
    linear: item?.linear || '',
});

const analyzeParsedChapter = (chapterText, parsedChapter) => {
    const textLength = chapterText.replace(/\s/g, '').length;
    const selectionBlockCount = parsedChapter.selectionBlocks.length;
    const blockCount = parsedChapter.chapterBlocks.length;
    const styleRuleCount = parsedChapter.styleRules.length;
    const imageCount = countRenderTreeNodes(
        parsedChapter.renderTree,
        (node) => node.type === 'image'
    );
    const isReadable = textLength > 0 && selectionBlockCount > 0;
    let reason = 'text found';

    if (!isReadable && imageCount > 0 && textLength === 0) {
        reason = 'image-only or cover page';
    } else if (!isReadable && textLength === 0) {
        reason = 'empty body text';
    } else if (!isReadable) {
        reason = 'no selectable text blocks';
    }

    return {
        isReadable,
        reason,
        textLength,
        selectionBlockCount,
        blockCount,
        styleRuleCount,
        imageCount,
    };
};

const readSpineChapter = async (zip, spineItem, extractedRootUri, manifestByPath = {}) => {
    const chapterFile = findZipFile(zip, spineItem.path);

    if (!chapterFile) {
        return {
            spineItem,
            chapterXml: '',
            chapterText: '',
            parsedChapter: {
                renderTree: { type: 'root', children: [] },
                selectionBlocks: [],
                chapterBlocks: [],
                stylesheets: [],
                stylesheetResources: [],
                styleRules: [],
                resources: [],
            },
            diagnostic: {
                ...spineDiagnosticBase(spineItem),
                status: 'skipped',
                reason: 'missing XHTML file',
                isReadable: false,
                textLength: 0,
                selectionBlockCount: 0,
                blockCount: 0,
                styleRuleCount: 0,
                imageCount: 0,
            },
        };
    }

    const chapterXml = await chapterFile.async('string');
    const parsedChapter = await parseXhtmlRenderTree(
        zip,
        chapterXml,
        spineItem,
        extractedRootUri,
        manifestByPath
    );
    const chapterText = extractBodyText(chapterXml);
    const analysis = analyzeParsedChapter(chapterText, parsedChapter);

    return {
        spineItem,
        chapterXml,
        chapterText,
        parsedChapter,
        diagnostic: {
            ...spineDiagnosticBase(spineItem),
            status: analysis.isReadable ? 'readable' : 'skipped',
            ...analysis,
        },
    };
};

const chooseSpineChapter = async (
    zip,
    spine,
    extractedRootUri,
    options = {},
    manifestByPath = {}
) => {
    const requestedSpineIndex = Number.isInteger(options.spineIndex)
        ? options.spineIndex
        : null;
    const diagnostics = [];

    if (requestedSpineIndex !== null) {
        const requestedItem = spine.find((item) => item.index === requestedSpineIndex);

        if (!requestedItem) {
            throw new Error(`No spine item exists at index ${requestedSpineIndex}.`);
        }

        const skipReason = spineItemSkipReason(requestedItem, { allowNonLinear: true });
        if (skipReason) {
            throw new Error(`Spine item ${requestedSpineIndex + 1} cannot be parsed: ${skipReason}.`);
        }

        const requestedChapter = await readSpineChapter(
            zip,
            requestedItem,
            extractedRootUri,
            manifestByPath
        );

        return {
            ...requestedChapter,
            diagnostics: [requestedChapter.diagnostic],
            skippedSpineItems: [],
            selection: {
                requestedSpineIndex,
                selectedSpineIndex: requestedItem.index,
                inspectedCount: 1,
                skippedCount: 0,
                reason: 'requested spine item',
            },
        };
    }

    let fallbackChapter = null;

    for (const item of spine) {
        const skipReason = spineItemSkipReason(item);

        if (skipReason) {
            diagnostics.push({
                ...spineDiagnosticBase(item),
                status: 'skipped',
                reason: skipReason,
                isReadable: false,
                textLength: 0,
                selectionBlockCount: 0,
                blockCount: 0,
                styleRuleCount: 0,
                imageCount: 0,
            });
            continue;
        }

        const autoSkipReason = spineItemAutoSkipReason(item);
        if (autoSkipReason) {
            diagnostics.push({
                ...spineDiagnosticBase(item),
                status: 'skipped',
                reason: autoSkipReason,
                isReadable: false,
                textLength: 0,
                selectionBlockCount: 0,
                blockCount: 0,
                styleRuleCount: 0,
                imageCount: 0,
            });
            continue;
        }

        const chapter = await readSpineChapter(zip, item, extractedRootUri, manifestByPath);
        diagnostics.push(chapter.diagnostic);

        if (!fallbackChapter && chapter.chapterXml) {
            fallbackChapter = chapter;
        }

        if (chapter.diagnostic.isReadable) {
            const skippedSpineItems = diagnostics.filter((diagnostic) => (
                diagnostic.index !== item.index
            ));

            return {
                ...chapter,
                diagnostics,
                skippedSpineItems,
                selection: {
                    requestedSpineIndex: null,
                    selectedSpineIndex: item.index,
                    inspectedCount: diagnostics.length,
                    skippedCount: skippedSpineItems.length,
                    reason: chapter.diagnostic.reason,
                },
            };
        }
    }

    if (fallbackChapter) {
        const skippedSpineItems = diagnostics.filter((diagnostic) => (
            diagnostic.index !== fallbackChapter.spineItem.index
        ));

        return {
            ...fallbackChapter,
            diagnostics,
            skippedSpineItems,
            selection: {
                requestedSpineIndex: null,
                selectedSpineIndex: fallbackChapter.spineItem.index,
                inspectedCount: diagnostics.length,
                skippedCount: skippedSpineItems.length,
                reason: 'no text-bearing chapter found; loaded first parseable spine item',
            },
        };
    }

    throw new Error('The OPF was parsed, but no XHTML spine item could be loaded.');
};

const parseOpfMetadata = async (zip, packagePath, fallbackName, sourceUri = '') => {
    const opfFile = findZipFile(zip, packagePath);
    if (!opfFile) {
        return {
            title: cleanFallbackTitle(fallbackName),
            author: 'Unknown author',
            cover: null,
        };
    }

    const opfXml = await opfFile.async('string');
    const parsedPackage = parsePackageDocument(opfXml, packagePath, fallbackName);
    const metadataNode = firstDescendant(
        parser.parseFromString(opfXml, 'application/xml'),
        (node) => localNameOf(node) === 'metadata'
    );
    const title = parsedPackage.metadata.title;
    const author = parsedPackage.metadata.author;
    const packageDir = parsedPackage.packageDir;
    const manifestItems = parsedPackage.manifest;

    let coverHref = null;
    let coverType = null;

    const coverMetaNode = descendants(metadataNode, (node) => localNameOf(node) === 'meta')
        .find((node) => (node.getAttribute('name') || '').toLowerCase() === 'cover');
    const coverId = coverMetaNode?.getAttribute('content');

    if (coverId) {
        const coverItem = manifestItems.find((item) => item.id === coverId);
        if (coverItem) {
            coverHref = coverItem.href;
            coverType = coverItem.mediaType;
        }
    }

    if (!coverHref) {
        const coverItem = manifestItems.find((item) => {
            const properties = item.properties || '';
            return properties.split(/\s+/).includes('cover-image');
        });

        if (coverItem) {
            coverHref = coverItem.href;
            coverType = coverItem.mediaType;
        }
    }

    if (!coverHref) {
        const coverItem = manifestItems.find((item) => {
            const id = (item.id || '').toLowerCase();
            const href = (item.href || '').toLowerCase();
            return id === 'cover' || href.includes('cover');
        });

        if (coverItem) {
            coverHref = coverItem.href;
            coverType = coverItem.mediaType;
        }
    }

    let cover = null;

    if (coverHref) {
        const coverPath = resolveHrefPath(packageDir, coverHref);
        const coverFile = findZipFile(zip, coverPath);

        if (coverFile) {
            const base64 = await coverFile.async('base64');
            const mime = coverType || mimeFromPath(coverPath);
            try {
                cover = await writeCoverBase64ToFile({
                    base64,
                    mime,
                    sourcePath: coverPath,
                    seed: `${sourceUri}:${fallbackName}:${coverPath}`,
                });
            } catch (error) {
                console.warn('[epubMetadata] Failed to persist EPUB cover image:', error);
            }
        }
    }

    return { title, author, cover };
};

export const readEpubMetadata = async (uri, fallbackName = '') => {
    try {
        const zip = await loadEpubZip(uri);
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

        return await parseOpfMetadata(zip, packagePath, fallbackName, uri);
    } catch (error) {
        console.error('[epubMetadata] Failed to read EPUB metadata:', error);
        return {
            title: cleanFallbackTitle(fallbackName),
            author: 'Unknown author',
            cover: null,
        };
    }
};

export const readEpubPackageXml = async (uri, fallbackName = '', options = {}) => {
    const readOptions = typeof options === 'number' ? { spineIndex: options } : (options || {});
    const {
        zip,
        extractedBook,
        containerXml,
        packagePath,
        packageXml,
        parsedPackage,
        bookResources,
    } = await loadCachedEpubPackage(uri, fallbackName);
    const loadedChapter = await chooseSpineChapter(
        zip,
        parsedPackage.spine,
        extractedBook.rootUri,
        readOptions,
        parsedPackage.manifestByPath
    );
    const loadedSpineItem = loadedChapter.spineItem;
    const bookManifest = buildBookManifest({
        sourceUri: uri,
        fallbackName,
        parsedPackage,
        extractedBook,
        packagePath,
        currentSpineItem: loadedSpineItem,
    });

    return {
        fileName: fallbackName || 'Untitled',
        bookManifest,
        extractedRootUri: extractedBook.rootUri,
        extractedFileCount: extractedBook.fileCount,
        packagePath,
        metadata: parsedPackage.metadata,
        manifest: parsedPackage.manifest,
        bookResources,
        spine: parsedPackage.spine,
        toc: parsedPackage.toc,
        tocSource: parsedPackage.tocSource,
        loadedSpineItem,
        loadedChapterXml: loadedChapter.chapterXml,
        loadedChapterText: loadedChapter.chapterText,
        loadedChapterRenderTree: loadedChapter.parsedChapter.renderTree,
        loadedChapterSelectionBlocks: loadedChapter.parsedChapter.selectionBlocks,
        loadedChapterBlocks: loadedChapter.parsedChapter.chapterBlocks,
        loadedChapterStylesheets: loadedChapter.parsedChapter.stylesheets,
        loadedChapterStylesheetResources: loadedChapter.parsedChapter.stylesheetResources,
        loadedChapterStyleRules: loadedChapter.parsedChapter.styleRules,
        loadedChapterResources: loadedChapter.parsedChapter.resources,
        loadedChapterDiagnostic: loadedChapter.diagnostic,
        spineSelection: loadedChapter.selection,
        spineDiagnostics: loadedChapter.diagnostics,
        skippedSpineItems: loadedChapter.skippedSpineItems,
        firstSpineItem: loadedSpineItem,
        firstChapterXml: loadedChapter.chapterXml,
        firstChapterText: loadedChapter.chapterText,
        firstChapterRenderTree: loadedChapter.parsedChapter.renderTree,
        firstChapterSelectionBlocks: loadedChapter.parsedChapter.selectionBlocks,
        firstChapterBlocks: loadedChapter.parsedChapter.chapterBlocks,
        firstChapterStylesheets: loadedChapter.parsedChapter.stylesheets,
        firstChapterStylesheetResources: loadedChapter.parsedChapter.stylesheetResources,
        firstChapterStyleRules: loadedChapter.parsedChapter.styleRules,
        firstChapterResources: loadedChapter.parsedChapter.resources,
        packageXml,
        containerXml,
    };
};
