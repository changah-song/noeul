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
