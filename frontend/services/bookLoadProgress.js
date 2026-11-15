// Where a book is in being imported or opened, for the screens that wait on
// it. The EPUB reader code announces each step; a screen listens and shows it.
//
// Steps: 'file' (reading the book file), 'text' (scanning the text at import,
// with a fraction done), 'cover', 'contents' (building the table of contents
// on a first open), 'chapter' (preparing the chapter to show).

const listeners = new Set();

export const subscribeBookLoadProgress = (listener) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

// Tell the listeners, then give the app one turn to draw the new step before
// the work that follows holds the JavaScript thread. With nobody listening
// this does nothing and does not wait.
export const announceBookLoadStep = async (uri, step, fraction = null) => {
    if (listeners.size === 0) {
        return;
    }

    const progress = {
        uri,
        step,
        fraction: Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null,
    };
    listeners.forEach((listener) => {
        try {
            listener(progress);
        } catch (error) {
            console.warn('[bookLoadProgress] A listener failed:', error);
        }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
};
