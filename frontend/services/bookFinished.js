// Finishing a book: the reader marks it (finishedAt) when the last page of
// the last chapter turns, and announces it here; Home, where the reader goes
// next, shows the finishing screen once it is on screen.

// A book counts as finished once it has been read to the end. progress syncs
// across devices while finishedAt (the date) is kept on this device, so
// either one is enough.
export const isBookFinished = (book) => (
  !!book?.finishedAt || Number(book?.progress) >= 1
);

let pendingUri = null;
const listeners = new Set();

export const announceBookFinished = (bookUri) => {
  if (!bookUri) return;
  pendingUri = bookUri;
  listeners.forEach((listener) => listener(bookUri));
};

// The finished book waiting for its screen, if any; taking it clears it.
export const takeFinishedBook = () => {
  const uri = pendingUri;
  pendingUri = null;
  return uri;
};

export const peekFinishedBook = () => pendingUri;

export const subscribeBookFinished = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Tests only.
export const __resetBookFinished = () => {
  pendingUri = null;
  listeners.clear();
};
