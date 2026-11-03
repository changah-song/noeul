// Which layer of transient reader chrome hardware back closes first
// (screens/Read.js): the options dropdown, then the open lookup panel (the
// dictionary card or the long-press AI explanation), then fullscreen. Null
// when none is up, so back falls through to leaving the book.
export const readerBackLayer = ({ showMenu, lookupOpen, isFullscreen } = {}) => {
    if (showMenu) return 'menu';
    if (lookupOpen) return 'lookup';
    if (isFullscreen) return 'fullscreen';
    return null;
};
