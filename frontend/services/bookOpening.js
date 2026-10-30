// The book-opening screen (components/shared/BookOpeningOverlay.js): the
// book's cover, large, the moment it is pressed on Home, so the press is
// answered at once even while a free book is copied in; it goes once the
// reader has the book laid out (or failed to). Home begins it with the book;
// the reader, or a failed open on Home, ends it.

// `token` counts openings.
let state = { visible: false, startedAt: 0, token: 0, book: null };
const listeners = new Set();

const set = (next) => {
    state = next;
    listeners.forEach((listener) => {
        try {
            listener(state);
        } catch {
            // A listener's failure is its own.
        }
    });
};

export const getBookOpening = () => state;

export const subscribeBookOpening = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

// `book`: the library entry being opened (its cover is shown).
export const beginBookOpening = (book = null) => {
    set({ visible: true, startedAt: Date.now(), token: state.token + 1, book });
};

export const endBookOpening = () => {
    if (state.visible) set({ ...state, visible: false });
};

export const isBookOpening = () => state.visible;

// For tests.
export const __resetBookOpening = () => {
    state = { visible: false, startedAt: 0, token: 0, book: null };
    listeners.clear();
};
