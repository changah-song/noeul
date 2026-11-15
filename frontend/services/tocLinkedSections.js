// Contents entries for chapter files the book's contents file leaves out.
//
// Some books name only their top level in the contents file and keep the
// rest on pages of their own: a Bible lists "Genesis", and the Genesis page
// links to "Introduction", "1", "2" … each a file that follows it. Those
// links are the book's own structure, so they become entries under the one
// that owns the page. A file nothing links to stays out of the contents (it
// is still read in order).

const safeDecode = (value) => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (text = '') => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[name.toLowerCase()] ?? match;
});

const normalizePath = (path = '') => {
    const parts = [];
    String(path).replace(/\\/g, '/').split('/').forEach((part) => {
        if (!part || part === '.') return;
        if (part === '..') parts.pop();
        else parts.push(part);
    });
    return safeDecode(parts.join('/'));
};

const dirnameOf = (path = '') => {
    const index = String(path).lastIndexOf('/');
    return index >= 0 ? path.slice(0, index) : '';
};

// One link, matched from the start of a piece that begins at "<a".
const LINK_RE = /^<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/i;
const CLOSE_RE = /^<\/a\s*>/i;
const MAX_LABEL_LENGTH = 120;
// The most of a page looked at for one closing tag's trailing spaces.
const CLOSE_TAG_SPAN = 16;

// Where the first "</a>" at or after `from` ends, or -1.
const endOfLinkClose = (markup, lower, from) => {
    let at = lower.indexOf('</a', from);
    while (at >= 0) {
        const close = CLOSE_RE.exec(markup.slice(at, at + CLOSE_TAG_SPAN));
        if (close) return at + close[0].length;
        at = lower.indexOf('</a', at + 3);
    }
    return -1;
};

/**
 * The links of a page as `{ href, label }`, in page order.
 *
 * The page is walked with indexOf and the pattern only ever sees one link's
 * worth of text. Running one pattern over the whole page, link after link,
 * is what Hermes does slowly: each match re-reads the page, so a 600 KB
 * index page with 5,000 links took 14 seconds.
 */
export const linksInMarkup = (xhtml = '') => {
    const links = [];
    const markup = String(xhtml || '');
    const lowered = markup.toLowerCase();
    // Lower-casing can change the length of a few letters; positions must line up.
    const lower = lowered.length === markup.length ? lowered : markup.replace(/[A-Z]/g, (c) => c.toLowerCase());
    let at = lower.indexOf('<a');
    while (at >= 0) {
        const end = endOfLinkClose(markup, lower, at + 2);
        if (end < 0) break;
        const match = LINK_RE.exec(markup.slice(at, end));
        if (match) {
            const href = decodeEntities(match[1] ?? match[2] ?? '').trim();
            const label = decodeEntities(match[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
            if (href && label) links.push({ href, label: label.slice(0, MAX_LABEL_LENGTH) });
            at = lower.indexOf('<a', at + match[0].length);
        } else {
            at = lower.indexOf('<a', at + 2);
        }
    }
    return links;
};

// A bare number under "Genesis" reads "Genesis 3" (in the header too).
const titleUnder = (ownerTitle, label) => (
    /^\d+$/.test(label) && ownerTitle ? `${ownerTitle} ${label}` : label
);

// Pages read looking for links, for a whole book.
const MAX_PAGES_READ = 400;
// Levels added under a contents entry (a notes index, then each book's notes).
const MAX_LEVELS = 2;
// One linked file is a footnote page, not a list of chapters.
const MIN_LINKED_FILES = 2;

/**
 * addLinkedSections — the contents with an entry for each unlisted file that
 * the page of the entry before it links to. `readFile(path)` gives a spine
 * file's markup (or null). The list comes back unchanged when every file is
 * already in the contents, which costs no reads.
 */
export const addLinkedSections = async (toc = [], spine = [], readFile) => {
    if (!Array.isArray(toc) || !Array.isArray(spine) || toc.length === 0 || typeof readFile !== 'function') {
        return toc;
    }

    const listed = [...new Set(
        toc.map((item) => item?.spineIndex).filter(Number.isInteger)
    )].sort((a, b) => a - b);
    if (listed.length >= spine.length) return toc;

    const indexByPath = new Map();
    spine.forEach((item, index) => {
        const key = normalizePath(item?.path || '');
        if (key && !indexByPath.has(key)) indexByPath.set(key, index);
    });

    let pagesRead = 0;
    const total = spine.length;

    // The entries for the files in (owner, end) that owner's page links to.
    const sectionsUnder = async (owner, end, ownerTitle, depth, level) => {
        if (end - owner <= 1 || pagesRead >= MAX_PAGES_READ) return [];
        pagesRead += 1;
        const ownerPath = String(spine[owner]?.path || '').replace(/\\/g, '/');
        let markup = null;
        try {
            markup = await readFile(ownerPath);
        } catch {
            markup = null;
        }
        if (!markup) return [];

        const found = new Map();
        linksInMarkup(markup).forEach(({ href, label }) => {
            if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
            const [file, fragment = ''] = href.split('#');
            if (!file) return;
            const path = normalizePath(`${dirnameOf(ownerPath)}/${file.split('?')[0]}`);
            const index = indexByPath.get(path);
            if (!Number.isInteger(index) || index <= owner || index >= end || found.has(index)) return;
            const spinePath = String(spine[index]?.path || path);
            found.set(index, { label, href: fragment ? `${spinePath}#${fragment}` : spinePath, path: spinePath });
        });
        if (found.size < MIN_LINKED_FILES) return [];

        const indexes = [...found.keys()].sort((a, b) => a - b);
        const entries = [];
        for (let position = 0; position < indexes.length; position += 1) {
            const index = indexes[position];
            const { label, href, path } = found.get(index);
            const title = titleUnder(ownerTitle, label);
            entries.push({
                id: `linked-${index}`,
                title,
                label: title,
                href,
                path,
                spineIndex: index,
                depth,
                positionLabel: `${index + 1}/${total}`,
                disabled: false,
                source: 'linked',
                listed: true,
                // "1", "2" … straight under a contents entry are the chapters of
                // the book itself (services/storyRange.js measures progress
                // over them); the numbered pages of a notes index are not.
                ...(level === 1 && /^\d+$/.test(label) ? { chapter: true } : null),
            });
            if (level < MAX_LEVELS) {
                const next = position + 1 < indexes.length ? indexes[position + 1] : end;
                entries.push(...await sectionsUnder(index, next, title, depth + 1, level + 1));
            }
        }
        return entries;
    };

    const expanded = new Set();
    const out = [];
    for (let position = 0; position < toc.length; position += 1) {
        const item = toc[position];
        out.push(item);
        const owner = item?.spineIndex;
        if (!Number.isInteger(owner) || expanded.has(owner)) continue;
        expanded.add(owner);
        const depth = Number.isFinite(Number(item?.depth)) ? Math.max(0, Number(item.depth)) : 0;
        // The entry's own sections (deeper entries right after it) stay with it.
        while (position + 1 < toc.length && Number(toc[position + 1]?.depth) > depth) {
            position += 1;
            out.push(toc[position]);
            if (Number.isInteger(toc[position]?.spineIndex)) expanded.add(toc[position].spineIndex);
        }
        const end = listed.find((index) => index > owner) ?? total;
        const title = String(item?.title || item?.label || '').trim();
        out.push(...await sectionsUnder(owner, end, title, depth + 1, 1));
    }
    return out;
};

/**
 * tocGroups — for a flattened contents list, the index of each entry's parent
 * (-1 at the top level) and whether it has entries under it. An entry's
 * parent is the nearest one before it that is less deep.
 */
export const tocGroups = (flatItems = []) => {
    const parentOf = [];
    const hasChildren = [];
    const open = [];
    (Array.isArray(flatItems) ? flatItems : []).forEach((item, index) => {
        const depth = Number(item?.depth) || 0;
        while (open.length && (Number(flatItems[open[open.length - 1]]?.depth) || 0) >= depth) open.pop();
        const parent = open.length ? open[open.length - 1] : -1;
        parentOf[index] = parent;
        hasChildren[index] = false;
        if (parent >= 0) hasChildren[parent] = true;
        open.push(index);
    });
    return { parentOf, hasChildren };
};

/** The entries above `index` in its branch, nearest first. */
export const tocAncestors = (parentOf = [], index) => {
    const out = [];
    let parent = Number.isInteger(index) && index >= 0 ? parentOf[index] : -1;
    while (Number.isInteger(parent) && parent >= 0) {
        out.push(parent);
        parent = parentOf[parent];
    }
    return out;
};
