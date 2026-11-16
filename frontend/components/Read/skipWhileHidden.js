// A React.memo comparator for the reader's sheets and drawers: one that is
// hidden, and stays hidden, is not rendered again. The reader screen renders
// on every word tap, and each of these used to run again with it. A sheet
// that is showing (or just opened or closed) renders as before.
const skipWhileHidden = (previous, next) => !previous.visible && !next.visible;

export default skipWhileHidden;
