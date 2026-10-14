// Pure decision logic for native reader selection events, shared by the book
// and song readers through hooks/useReaderLookup.js. Mirrors the behavior of
// Read.js handleNativeWordSelected / handleNativeTextSelected.

const placementFor = (event) => (event?.placement === 'top' ? 'top' : 'bottom');

const trimText = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * resolveWordSelection — what a native single-word tap should do.
 *
 *   { type: 'ignore' }   empty/whitespace tap
 *   { type: 'dismiss' }  a lookup panel is already open: the tap only closes it
 *                        and is NOT registered as a new selection
 *   { type: 'select', text, sentence, placement }
 *
 * `cleanText` lets a caller strip extra edge punctuation (lyrics) before the
 * emptiness check.
 */
export const resolveWordSelection = (event, { lookupOpen = false, cleanText } = {}) => {
    const raw = trimText(event?.text);
    const text = typeof cleanText === 'function' ? trimText(cleanText(raw)) : raw;
    if (!text) {
        return { type: 'ignore' };
    }
    if (lookupOpen) {
        return { type: 'dismiss' };
    }
    return {
        type: 'select',
        text,
        sentence: trimText(event?.sentence),
        placement: placementFor(event),
    };
};

/**
 * resolveTextSelection — a long-press range selection (translation lookup).
 * Unlike word taps it always opens: native clears its own range selection.
 */
export const resolveTextSelection = (event) => {
    const text = trimText(event?.text);
    if (!text) {
        return { type: 'ignore' };
    }
    return { type: 'select', text, placement: placementFor(event) };
};

/**
 * lookupLayerPlacement — focus mode always presents the panel from the bottom
 * so the anchored sentence can lift above it.
 */
export const lookupLayerPlacement = (placement, focusMode) => (
    placement === 'top' && !focusMode ? 'top' : 'bottom'
);
