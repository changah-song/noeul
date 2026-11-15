// Contents entries that point inside a chapter file (`text/fables.xhtml#the-fox`):
// the reader seeks to the block where that element starts. Blocks carry the
// ids of elements that start at them as `anchors` (services/epubMetadata.js).

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The `#fragment` of a contents link, or null. */
export const tocAnchorFromHref = (href) => {
  const index = String(href || '').indexOf('#');
  if (index < 0) return null;
  const anchor = safeDecode(String(href).slice(index + 1)).trim();
  return anchor || null;
};

/** The id of the block an element id starts at, or null. */
export const blockIdForAnchor = (blocks = [], anchor) => {
  if (!anchor || !Array.isArray(blocks)) return null;
  const block = blocks.find((candidate) => (
    candidate?.attrs?.id === anchor
    || (Array.isArray(candidate?.anchors) && candidate.anchors.includes(anchor))
  ));
  return block?.id || null;
};

/**
 * Which contents entry the reader is in: the index into the flattened
 * contents, or -1.
 *
 * The file on screen picks the candidates (the entries for the nearest file at
 * or before it). When several entries share that file (a book whose chapters,
 * or a chapter whose sections, sit in one file) the block at the top of the
 * page picks among them: the last entry that starts at or before it.
 */
export const activeTocIndex = (flatItems = [], { spineIndex, blocks = null, firstBlockId = null } = {}) => {
  if (!Number.isInteger(spineIndex) || !Array.isArray(flatItems)) return -1;

  const usable = (item) => (
    !item?.disabled && Number.isInteger(item?.spineIndex) && item.spineIndex <= spineIndex
  );
  // Not "the last entry at or before this file": contents aren't always in
  // reading order (notes or an appendix listed out of place).
  const nearestSpine = flatItems.reduce(
    (nearest, item) => (usable(item) && item.spineIndex > nearest ? item.spineIndex : nearest),
    -1
  );
  if (nearestSpine < 0) return -1;

  const candidates = [];
  flatItems.forEach((item, index) => {
    if (usable(item) && item.spineIndex === nearestSpine) candidates.push(index);
  });
  if (candidates.length === 1) return candidates[0];
  // Past the end of that file (this one has no entry of its own): still in
  // whatever started last in it.
  if (nearestSpine < spineIndex) return candidates[candidates.length - 1];

  const currentBlockIndex = firstBlockId && Array.isArray(blocks)
    ? blocks.findIndex((candidate) => candidate?.id === firstBlockId)
    : -1;
  if (currentBlockIndex < 0) return candidates[0];

  let active = candidates[0];
  let activeStart = -1;
  candidates.forEach((index) => {
    const anchor = tocAnchorFromHref(flatItems[index]?.href);
    const anchorBlockId = anchor ? blockIdForAnchor(blocks, anchor) : null;
    const start = anchor
      ? (anchorBlockId ? blocks.findIndex((candidate) => candidate?.id === anchorBlockId) : -1)
      : 0;
    if (start >= 0 && start <= currentBlockIndex && start >= activeStart) {
      active = index;
      activeStart = start;
    }
  });
  return active;
};
