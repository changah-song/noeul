// The reader's listen mode as the rest of the app sees it. The reader
// (screens/Read.js) publishes what is playing and registers its controls;
// Home shows a small player while it runs (components/Home/ListenMiniPlayer.js).
// The voice never reads with no player on screen: moving to a screen that has
// none (Learn, Profile) pauses it. In the background the notification player
// stands in, so it keeps reading there.

// Screens that show a player for the reader's voice.
const PLAYER_ROUTES = new Set(['Read', 'Home']);

let state = { active: false, playing: false, title: '', subtitle: '' };
let commands = {};
const listeners = new Set();

const notify = () => {
    listeners.forEach((listener) => {
        try {
            listener(state);
        } catch {
            // A listener's failure is its own.
        }
    });
};

export const getReaderListen = () => state;

export const subscribeReaderListen = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const publishReaderListen = (patch) => {
    const next = { ...state, ...patch };
    if (Object.keys(next).every((key) => next[key] === state[key])) return;
    state = next;
    notify();
};

// { toggle, pause, next, previous, stop }: the reader's own handlers.
export const registerReaderListenCommands = (next) => {
    commands = next || {};
    return () => {
        if (commands === next) commands = {};
    };
};

export const runReaderListenCommand = (name) => {
    commands[name]?.();
};

// The navigator moved to `routeName`: a screen without a player pauses the
// voice (it can be resumed from the reader or Home).
export const noteRouteShown = (routeName) => {
    if (state.active && state.playing && routeName && !PLAYER_ROUTES.has(routeName)) {
        commands.pause?.();
    }
};

// For tests.
export const __resetReaderListen = () => {
    state = { active: false, playing: false, title: '', subtitle: '' };
    commands = {};
    listeners.clear();
};
