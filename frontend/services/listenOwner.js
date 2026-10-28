// Who is using the phone's voice and the notification player right now: the
// reader's listen mode ('reader') or the Learn tab's audio review
// ('audio-review'). Both share one text-to-speech engine and one media
// session, so only the owner reacts to the lock-screen buttons, and taking
// over asks the previous owner to stop.

let current = null;

// Become the owner. The previous owner (if another) is told to stop first.
export const claimListenSession = (owner, onYield) => {
  if (current && current.owner !== owner) {
    const previous = current;
    current = null;
    try {
      previous.onYield?.();
    } catch {
      // The previous owner is gone; nothing to stop.
    }
  }
  current = { owner, onYield };
};

export const releaseListenSession = (owner) => {
  if (current?.owner === owner) current = null;
};

export const ownsListenSession = (owner) => current?.owner === owner;

// Nobody, or this owner: free to drive (or tear down) the shared session.
export const mayUseListenSession = (owner) => !current || current.owner === owner;
