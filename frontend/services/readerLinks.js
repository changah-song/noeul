// Links inside a book's text. Each span of a block carries the `href` of the
// <a> around it (services/epubMetadata.js), with block-local offsets. Two
// things use that here: a tap on a link follows it instead of looking the
// word up, and listen mode stays quiet over note markers (the "1", "[2]" or
// "*" that only exist to be pressed).

const safeDecode = (value) => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const spansOf = (block) => (Array.isArray(block?.spans) ? block.spans : []);

// The links of a block, each as one range: neighbouring spans of the same
// link (`<a><sup>1</sup></a>`, a link with a bold word in it) are joined.
export const linkRangesForBlock = (block) => {
    const ranges = [];
    let offset = 0;
    spansOf(block).forEach((span) => {
        const length = typeof span?.text === 'string' ? span.text.length : 0;
        const start = Number.isFinite(span?.startOffset) ? span.startOffset : offset;
        const end = Number.isFinite(span?.endOffset) ? span.endOffset : start + length;
        offset = end;
        const href = typeof span?.href === 'string' ? span.href.trim() : '';
        if (!href || end <= start) return;
        const marks = Array.isArray(span.marks) ? span.marks : [];
        const raised = marks.includes('sup') || marks.includes('sub');
        const last = ranges[ranges.length - 1];
        if (last && last.href === href && last.end === start) {
            last.end = end;
            last.text += span.text;
            last.raised = last.raised && raised;
            return;
        }
        ranges.push({ href, start, end, text: span.text, raised });
    });
    return ranges;
};

/** The link at a block-local offset, or null. */
export const linkAtOffset = (block, offset) => {
    if (!Number.isFinite(offset)) return null;
    return linkRangesForBlock(block).find((range) => offset >= range.start && offset < range.end) || null;
};

const HAS_LETTER = /\p{L}/u;
const OPENERS = '[(（［【〔';
const CLOSERS = '])）］】〕';

// A link that is only a marker: no words in it ("1", "[12]", "*", "†", "①"),
// or a short raised label ("a", "주1").
const isNoteMarker = (range) => {
    const label = range.text.trim();
    if (!label || label.length > 8) return false;
    if (!HAS_LETTER.test(label)) return true;
    return range.raised && label.length <= 4;
};

// The stretches of a block's text listen mode should not read: its note
// markers, with the brackets written around them outside the link ("[<a>1</a>]").
// Nothing when the block is only links (a contents page: there the numbers
// are the text).
export const silentRangesForBlock = (block) => {
    const links = linkRangesForBlock(block);
    if (!links.length) return [];
    const text = typeof block?.text === 'string' ? block.text : '';
    let outside = '';
    let cursor = 0;
    links.forEach((range) => {
        outside += text.slice(cursor, range.start);
        cursor = range.end;
    });
    outside += text.slice(cursor);
    if (!HAS_LETTER.test(outside)) return [];

    return links.filter(isNoteMarker).map(({ start, end }) => {
        const opener = OPENERS.indexOf(text[start - 1]);
        if (start > 0 && opener >= 0 && text[end] === CLOSERS[opener]) {
            return { start: start - 1, end: end + 1 };
        }
        return { start, end };
    });
};

// `text` (what the focus payload hands listen mode) with its note markers
// turned to spaces. Same length as `text`, so the offsets the voice reports
// still line up with the words on the page. `segments` are the payload's
// sentences ({ blockId, start, end, at }, see listenSpokenWord.js).
export const blankNoteMarkers = (text, segments, blocks) => {
    const full = typeof text === 'string' ? text : '';
    if (!full || !Array.isArray(segments) || !Array.isArray(blocks)) return full;
    let chars = null;
    segments.forEach((segment) => {
        const { blockId, start, end, at } = segment || {};
        if (typeof blockId !== 'string' || ![start, end, at].every(Number.isFinite)) return;
        const block = blocks.find((candidate) => candidate?.id === blockId);
        if (!block) return;
        silentRangesForBlock(block).forEach((range) => {
            const from = Math.max(range.start, start);
            const to = Math.min(range.end, end);
            for (let index = from; index < to; index += 1) {
                const position = at + (index - start);
                if (position < 0 || position >= full.length) continue;
                if (!chars) chars = full.split('');
                chars[position] = ' ';
            }
        });
    });
    return chars ? chars.join('') : full;
};

const normalizePath = (path) => {
    const parts = [];
    String(path || '').replace(/\\/g, '/').split('/').forEach((part) => {
        if (!part || part === '.') return;
        if (part === '..') {
            parts.pop();
            return;
        }
        parts.push(part);
    });
    return parts.join('/');
};

// Where a link goes. A web address: { kind: 'external', url }. A place in
// the book: { kind: 'internal', spineIndex, anchor, path }, `anchor` being the
// element id after `#` (null for a whole file). Null for anything else (a
// link to a file that isn't a chapter, an address the app shouldn't open).
export const resolveLinkTarget = (href, { spine = [], spineIndex = null } = {}) => {
    const raw = String(href || '').trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return { kind: 'external', url: raw };
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

    const hashAt = raw.indexOf('#');
    const filePart = (hashAt < 0 ? raw : raw.slice(0, hashAt)).split('?')[0];
    const anchor = hashAt < 0 ? null : (safeDecode(raw.slice(hashAt + 1)).trim() || null);
    const items = Array.isArray(spine) ? spine : [];
    const indexOfItem = (item, position) => (Number.isInteger(item?.index) ? item.index : position);
    const currentPosition = items.findIndex((item, position) => indexOfItem(item, position) === spineIndex);
    const current = currentPosition >= 0 ? items[currentPosition] : null;

    if (!filePart) {
        return anchor && current
            ? { kind: 'internal', spineIndex, anchor, path: current.path || '' }
            : null;
    }

    const currentPath = String(current?.path || '').replace(/\\/g, '/');
    const baseDir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
    const wanted = [filePart, safeDecode(filePart)].map((part) => normalizePath(`${baseDir}/${part}`));
    const position = items.findIndex((item) => {
        const path = normalizePath(item?.path);
        return Boolean(path) && (wanted.includes(path) || wanted.includes(safeDecode(path)));
    });
    if (position < 0) return null;
    return {
        kind: 'internal',
        spineIndex: indexOfItem(items[position], position),
        anchor,
        path: items[position].path || '',
    };
};
