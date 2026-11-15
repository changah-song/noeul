// Which layer of transient reader chrome hardware back closes first
// (screens/Read.js): the options dropdown, then the open lookup panel (the
// dictionary card or the long-press AI explanation), then the way back from a
// followed link, then fullscreen. Null
// when none is up, so back falls through to leaving the book.
export const readerBackLayer = ({ showMenu, lookupOpen, linkReturn, isFullscreen } = {}) => {
    if (showMenu) return 'menu';
    if (lookupOpen) return 'lookup';
    if (linkReturn) return 'linkReturn';
    if (isFullscreen) return 'fullscreen';
    return null;
};
